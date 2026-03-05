from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from pathlib import Path
from typing import Any

import pandas as pd

from ml.tgis.runtime import connect_db, load_runtime, utc_now_iso


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Sync cluster registry from clusters_v2.csv")
    p.add_argument("--config", default="ml/tgis/configs/base.yaml")
    p.add_argument("--input", default="ml/tgis/artifacts/clusters_v2.csv")
    p.add_argument("--deactivate-missing", action="store_true")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--report", default="ml/tgis/artifacts/cluster_registry_sync_v2_report.json")
    return p.parse_args()


def _slug(v: Any) -> str:
    s = str(v or "").strip().lower().replace("-", "_").replace(" ", "_")
    s = re.sub(r"[^a-z0-9_]+", "", s)
    s = re.sub(r"_+", "_", s).strip("_")
    return s


def _family_from_slug(slug: str, current: str | None = None) -> str:
    if current:
        c = _slug(current)
        if c:
            return c
    s = _slug(slug)
    if "_" in s:
        return s.split("_", 1)[0]
    return s or "misc"


def _routing_tags_for_group(group: pd.DataFrame, slug: str, family: str) -> list[str]:
    values: list[str] = [family, slug]
    if "seed_tag_group" in group.columns:
        values.extend([_slug(v) for v in group["seed_tag_group"].astype(str).tolist()[:200] if _slug(v)])
    if "tags" in group.columns:
        # tags column may be list-like string.
        for raw in group["tags"].head(200).tolist():
            text = str(raw or "").strip().lower()
            for token in re.split(r"[^a-z0-9_]+", text):
                token = _slug(token)
                if token and len(token) >= 3:
                    values.append(token)
    counts = Counter(values)
    ordered = [k for k, _ in counts.most_common() if k]
    # Keep concise and deterministic.
    return ordered[:10]


def main() -> None:
    args = parse_args()
    runtime = load_runtime(args.config)
    input_csv = Path(args.input)
    report_json = Path(args.report)
    if not input_csv.exists():
        raise FileNotFoundError(f"input csv not found: {input_csv}")

    df = pd.read_csv(input_csv)
    if df.empty:
        raise RuntimeError("input csv is empty")
    if "cluster_slug" not in df.columns:
        raise RuntimeError("input csv missing cluster_slug")
    if "cluster_family" not in df.columns:
        df["cluster_family"] = df["cluster_slug"].astype(str).map(lambda x: _family_from_slug(str(x)))

    cluster_rows = []
    for slug, g in df.groupby("cluster_slug", dropna=False):
        s = _slug(slug)
        if not s:
            continue
        fam = _family_from_slug(s, str(g["cluster_family"].iloc[0] if "cluster_family" in g.columns else ""))
        routing_tags = _routing_tags_for_group(g, s, fam)
        cluster_rows.append(
            {
                "cluster_slug": s,
                "cluster_family": fam,
                "cluster_name": f"cluster_{s}",
                "trigger_word": f"tgis_{s}",
                "categories_json": [fam, s],
                "routing_tags": routing_tags,
                "rows": int(len(g)),
            }
        )
    cluster_rows = sorted(cluster_rows, key=lambda x: x["cluster_slug"])
    wanted_slugs = {r["cluster_slug"] for r in cluster_rows}

    with connect_db(runtime) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select cluster_id, cluster_slug, cluster_name
                from public.tgis_cluster_registry
                order by cluster_id asc
                """
            )
            existing = cur.fetchall()

            existing_by_slug: dict[str, int] = {}
            max_cluster_id = 0
            for cid, slug, _ in existing:
                max_cluster_id = max(max_cluster_id, int(cid))
                ss = _slug(slug)
                if ss:
                    existing_by_slug[ss] = int(cid)

            inserts = 0
            updates = 0
            deactivated = 0
            for row in cluster_rows:
                slug = row["cluster_slug"]
                cid = existing_by_slug.get(slug)
                if cid is None:
                    max_cluster_id += 1
                    cid = max_cluster_id
                    inserts += 1
                else:
                    updates += 1

                if not args.dry_run:
                    cur.execute(
                        """
                        insert into public.tgis_cluster_registry
                          (cluster_id, cluster_name, trigger_word, categories_json, routing_tags, cluster_slug, cluster_family, is_active, updated_at)
                        values
                          (%s, %s, %s, %s::jsonb, %s::text[], %s, %s, true, now())
                        on conflict (cluster_id) do update
                        set cluster_name = excluded.cluster_name,
                            trigger_word = excluded.trigger_word,
                            categories_json = excluded.categories_json,
                            routing_tags = excluded.routing_tags,
                            cluster_slug = excluded.cluster_slug,
                            cluster_family = excluded.cluster_family,
                            is_active = true,
                            updated_at = now()
                        """,
                        (
                            int(cid),
                            row["cluster_name"],
                            row["trigger_word"],
                            json.dumps(row["categories_json"]),
                            row["routing_tags"],
                            row["cluster_slug"],
                            row["cluster_family"],
                        ),
                    )

            if args.deactivate_missing and not args.dry_run:
                cur.execute(
                    """
                    update public.tgis_cluster_registry
                    set is_active = false,
                        updated_at = now()
                    where cluster_slug is not null
                      and not (cluster_slug = any(%s::text[]))
                    """,
                    (sorted(wanted_slugs),),
                )
                deactivated = int(cur.rowcount or 0)

        if not args.dry_run:
            conn.commit()

    report = {
        "generated_at": utc_now_iso(),
        "input_rows": int(len(df)),
        "clusters_found": int(len(cluster_rows)),
        "dry_run": bool(args.dry_run),
        "deactivate_missing": bool(args.deactivate_missing),
        "wanted_slugs": sorted(wanted_slugs),
        "sample": cluster_rows[:25],
    }
    report_json.parent.mkdir(parents=True, exist_ok=True)
    report_json.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    print(
        f"[TGIS][sync_cluster_registry_v2] clusters={len(cluster_rows)} dry_run={args.dry_run} "
        f"output={report_json}"
    )


if __name__ == "__main__":
    main()
