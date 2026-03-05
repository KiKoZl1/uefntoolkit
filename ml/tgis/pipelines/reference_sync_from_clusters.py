from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path
from typing import Any

import pandas as pd

from ml.tgis.runtime import connect_db, load_runtime, utc_now_iso


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Sync tgis_reference_images from clusters CSV")
    p.add_argument("--config", default="ml/tgis/configs/base.yaml")
    p.add_argument("--input", default="ml/tgis/artifacts/clusters_v3.csv")
    p.add_argument("--top-n", type=int, default=20)
    p.add_argument("--report", default="ml/tgis/artifacts/reference_sync_from_clusters_report.json")
    return p.parse_args()


def _slug(v: Any) -> str:
    s = str(v or "").strip().lower().replace("-", "_").replace(" ", "_")
    return "".join(ch for ch in s if ch.isalnum() or ch == "_").strip("_")


def main() -> None:
    args = parse_args()
    runtime = load_runtime(args.config)
    input_csv = Path(args.input)
    report_json = Path(args.report)

    if not input_csv.exists():
        raise FileNotFoundError(f"input csv not found: {input_csv}")

    df = pd.read_csv(input_csv)
    if df.empty:
        raise RuntimeError("input is empty")
    required = {"cluster_slug", "link_code", "image_url", "quality_score"}
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise RuntimeError(f"missing required columns: {missing}")

    df = df.copy()
    df["cluster_slug"] = df["cluster_slug"].astype(str).map(_slug)
    df["link_code"] = df["link_code"].astype(str).str.strip()
    df["image_url"] = df["image_url"].astype(str).str.strip()
    df["quality_score"] = pd.to_numeric(df["quality_score"], errors="coerce").fillna(0)
    if "seed_tag_group" in df.columns:
        df["seed_tag_group"] = df["seed_tag_group"].astype(str).map(_slug)
    else:
        df["seed_tag_group"] = "misc"
    df = df[df["image_url"].str.startswith("http")].copy()
    df = df.sort_values(by=["cluster_slug", "quality_score"], ascending=[True, False])
    df = df.drop_duplicates(subset=["cluster_slug", "image_url"], keep="first")

    top_n = max(1, int(args.top_n))
    active_clusters = 0
    clusters_with_refs = 0
    inserts: list[tuple[Any, ...]] = []
    defaults: dict[int, tuple[str, str]] = {}

    with connect_db(runtime) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select cluster_id, cluster_slug
                from public.tgis_cluster_registry
                where is_active = true and cluster_slug is not null
                """
            )
            slug_to_id = {_slug(slug): int(cid) for cid, slug in cur.fetchall() if _slug(slug)}
            active_ids = sorted(slug_to_id.values())
            active_clusters = len(active_ids)

            if active_ids:
                cur.execute("delete from public.tgis_reference_images where cluster_id = any(%s::int[])", (active_ids,))

            for slug, group in df.groupby("cluster_slug", dropna=False):
                cid = slug_to_id.get(_slug(slug))
                if cid is None:
                    continue
                counters: defaultdict[str, int] = defaultdict(int)
                taken = 0
                first: tuple[str, str] | None = None
                for row in group.itertuples(index=False):
                    if taken >= top_n:
                        break
                    tag_group = _slug(getattr(row, "seed_tag_group", "") or "") or _slug(slug) or "misc"
                    counters[tag_group] += 1
                    rank = counters[tag_group]
                    link_code = str(getattr(row, "link_code", "") or "").strip()
                    image_url = str(getattr(row, "image_url", "") or "").strip()
                    score = float(getattr(row, "quality_score", 0.0) or 0.0)
                    inserts.append((cid, tag_group, rank, link_code, image_url, score))
                    if first is None:
                        first = (image_url, tag_group)
                    taken += 1
                if first is not None:
                    defaults[cid] = first

            if inserts:
                cur.executemany(
                    """
                    insert into public.tgis_reference_images
                      (cluster_id, tag_group, rank, link_code, image_url, quality_score, updated_at)
                    values (%s, %s, %s, %s, %s, %s, now())
                    """,
                    inserts,
                )

            for cid in active_ids:
                d = defaults.get(cid)
                if d:
                    clusters_with_refs += 1
                    cur.execute(
                        """
                        update public.tgis_cluster_registry
                        set reference_image_url=%s,
                            reference_tag=%s,
                            reference_updated_at=now(),
                            updated_at=now()
                        where cluster_id=%s
                        """,
                        (d[0], d[1], cid),
                    )
                else:
                    cur.execute(
                        """
                        update public.tgis_cluster_registry
                        set reference_image_url=null,
                            reference_tag=null,
                            reference_updated_at=now(),
                            updated_at=now()
                        where cluster_id=%s
                        """,
                        (cid,),
                    )
        conn.commit()

    payload = {
        "generated_at": utc_now_iso(),
        "input": str(input_csv),
        "top_n": top_n,
        "active_clusters": active_clusters,
        "clusters_with_refs": clusters_with_refs,
        "rows_inserted": len(inserts),
    }
    report_json.parent.mkdir(parents=True, exist_ok=True)
    report_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    main()
