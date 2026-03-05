from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import pandas as pd
import yaml

from ml.tgis.runtime import connect_db, load_runtime, utc_now_iso


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Apply manual TGIS V2 cluster merge rules")
    p.add_argument("--config", default="ml/tgis/configs/base.yaml")
    p.add_argument("--input", default="ml/tgis/artifacts/clusters_v2_misc.csv")
    p.add_argument("--output", default="ml/tgis/artifacts/clusters_v2.csv")
    p.add_argument("--report", default="ml/tgis/artifacts/cluster_merges_report_v2.json")
    p.add_argument("--rules-yaml", default=None, help="optional yaml mapping source_slug -> target_slug")
    return p.parse_args()


def _load_rules_from_db(runtime) -> dict[str, str]:
    out: dict[str, str] = {}
    with connect_db(runtime) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select source_cluster_slug, target_cluster_slug
                from public.tgis_cluster_merge_rules
                where is_active = true
                """
            )
            for src, dst in cur.fetchall():
                s = str(src or "").strip()
                d = str(dst or "").strip()
                if s and d:
                    out[s] = d
        conn.commit()
    return out


def _load_rules_from_yaml(path: Path) -> dict[str, str]:
    raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    if not isinstance(raw, dict):
        raise RuntimeError("rules-yaml must be a mapping source_slug -> target_slug")
    out: dict[str, str] = {}
    for k, v in raw.items():
        src = str(k or "").strip()
        dst = str(v or "").strip()
        if src and dst:
            out[src] = dst
    return out


def _family_from_slug(slug: str) -> str:
    s = str(slug or "").strip()
    if not s:
        return "misc"
    if s.startswith("combat_") or s == "combat":
        return "combat"
    if "_" in s:
        return s.split("_", 1)[0]
    return s


def main() -> None:
    args = parse_args()
    runtime = load_runtime(args.config)
    input_csv = Path(args.input)
    output_csv = Path(args.output)
    report_json = Path(args.report)

    if not input_csv.exists():
        raise FileNotFoundError(f"input csv not found: {input_csv}")
    df = pd.read_csv(input_csv)
    if df.empty:
        raise RuntimeError("input csv is empty")
    if "cluster_slug" not in df.columns:
        raise RuntimeError("input missing cluster_slug")

    rules = _load_rules_from_db(runtime)
    yaml_rules = {}
    if args.rules_yaml:
        yaml_path = Path(args.rules_yaml)
        if not yaml_path.exists():
            raise FileNotFoundError(f"rules yaml not found: {yaml_path}")
        yaml_rules = _load_rules_from_yaml(yaml_path)
    rules.update(yaml_rules)

    merged = 0
    merged_from: list[dict[str, Any]] = []
    out = df.copy()
    out["merged_from_cluster_slug"] = None
    for i in range(len(out)):
        src = str(out.at[i, "cluster_slug"] or "").strip()
        if not src:
            continue
        dst = rules.get(src)
        if not dst:
            continue
        if src == dst:
            continue
        out.at[i, "merged_from_cluster_slug"] = src
        out.at[i, "cluster_slug"] = dst
        out.at[i, "cluster_family"] = _family_from_slug(dst)
        out.at[i, "phase"] = "manual_merge"
        merged += 1
        if len(merged_from) < 200:
            merged_from.append({"source": src, "target": dst})

    if out["cluster_slug"].astype(str).str.strip().eq("").any():
        raise RuntimeError("output has empty cluster_slug after merge")

    uniq = out.groupby(["link_code", "image_url"])["cluster_slug"].nunique().reset_index(name="slug_n")
    conflicts = uniq[uniq["slug_n"] > 1]
    if not conflicts.empty:
        raise RuntimeError(f"found pair conflicts after merge: {len(conflicts)}")

    out = out.sort_values(by=["quality_score"], ascending=False)
    output_csv.parent.mkdir(parents=True, exist_ok=True)
    out.to_csv(output_csv, index=False)

    report = {
        "generated_at": utc_now_iso(),
        "rows_total": int(len(out)),
        "merge_rules_count": int(len(rules)),
        "merged_rows": int(merged),
        "clusters_total": int(out["cluster_slug"].nunique()),
        "families_total": int(out["cluster_family"].nunique()) if "cluster_family" in out.columns else None,
        "sample_merges": merged_from[:50],
        "counts_by_cluster_slug": {str(k): int(v) for k, v in out["cluster_slug"].value_counts().to_dict().items()},
        "output": str(output_csv),
    }
    report_json.parent.mkdir(parents=True, exist_ok=True)
    report_json.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    try:
        with connect_db(runtime) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    insert into public.tgis_dataset_runs
                      (run_type, status, summary_json, started_at, ended_at)
                    values
                      ('clustering', 'success', %s::jsonb, now(), now())
                    """,
                    (json.dumps({"type": "apply_cluster_merges_v2", **report}),),
                )
            conn.commit()
    except Exception:
        pass

    print(
        f"[TGIS][apply_cluster_merges] rows={len(out)} merged={merged} rules={len(rules)} output={output_csv}"
    )


if __name__ == "__main__":
    main()
