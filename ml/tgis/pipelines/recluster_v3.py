from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

import pandas as pd

from ml.tgis.runtime import load_yaml, utc_now_iso


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="TGIS V3 reclustering (metadata-first + quality p70 filter)")
    p.add_argument("--config", default="ml/tgis/configs/base.yaml")
    p.add_argument("--input", default=None, help="dataset csv; defaults to paths.dataset_csv from config")
    p.add_argument("--output", default="ml/tgis/artifacts/clusters_v3.csv")
    p.add_argument("--purity-report", default="ml/tgis/artifacts/cluster_purity_report_v3.json")
    p.add_argument("--size-report", default="ml/tgis/artifacts/cluster_size_report_v3.json")
    p.add_argument("--conflicts-output", default="ml/tgis/artifacts/cluster_conflicts_v3.csv")
    p.add_argument("--quality-percentile", type=float, default=0.70)
    p.add_argument("--min-cluster-size", type=int, default=1, help="keep 1 to avoid auto-collapse; merge manually after")
    p.add_argument("--small-cluster-threshold", type=int, default=50)
    p.add_argument("--use-taxonomy-rules", action="store_true", default=False)
    p.add_argument("--limit", type=int, default=None)
    return p.parse_args()


def _run(cmd: list[str]) -> None:
    proc = subprocess.run(cmd, check=False)
    if proc.returncode != 0:
        raise SystemExit(proc.returncode)


def _load_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> None:
    args = parse_args()
    cfg = load_yaml(args.config)

    input_csv = Path(args.input or cfg.get("paths", {}).get("dataset_csv", "ml/tgis/artifacts/dataset_candidates.csv"))
    output_csv = Path(args.output)
    purity_report = Path(args.purity_report)
    size_report = Path(args.size_report)
    conflicts_output = Path(args.conflicts_output)
    filtered_csv = Path("ml/tgis/artifacts/dataset_candidates_p70_v3.csv")

    if not input_csv.exists():
        raise FileNotFoundError(f"dataset csv not found: {input_csv}")

    df = pd.read_csv(input_csv)
    if args.limit:
        df = df.head(int(args.limit))
    if df.empty:
        raise RuntimeError("empty input dataset")
    if "quality_score" not in df.columns:
        raise RuntimeError("input missing required column: quality_score")

    df["quality_score"] = pd.to_numeric(df["quality_score"], errors="coerce")
    df = df.dropna(subset=["quality_score"]).copy()
    if df.empty:
        raise RuntimeError("dataset has no valid quality_score rows")

    q = float(args.quality_percentile)
    if q <= 0 or q >= 1:
        raise RuntimeError("--quality-percentile must be between 0 and 1 (exclusive)")
    threshold = float(df["quality_score"].quantile(q))
    filtered = df[df["quality_score"] >= threshold].copy()
    if filtered.empty:
        raise RuntimeError("quality filter produced zero rows")

    filtered_csv.parent.mkdir(parents=True, exist_ok=True)
    filtered.to_csv(filtered_csv, index=False)

    cmd = [
        sys.executable,
        "-m",
        "ml.tgis.pipelines.recluster_keywords",
        "--config",
        args.config,
        "--input",
        str(filtered_csv),
        "--output",
        str(output_csv),
        "--purity-report",
        str(purity_report),
        "--size-report",
        str(size_report),
        "--conflicts-output",
        str(conflicts_output),
        "--min-cluster-size",
        str(max(1, int(args.min_cluster_size))),
    ]
    if args.use_taxonomy_rules:
        cmd.append("--use-taxonomy-rules")
    _run(cmd)

    out = pd.read_csv(output_csv)
    if out.empty:
        raise RuntimeError("clusters_v3 output is empty")

    uniq = out.groupby(["link_code", "image_url"])["cluster_slug"].nunique().reset_index(name="slug_n")
    conflicts = uniq[uniq["slug_n"] > 1]
    if not conflicts.empty:
        conflict_rows = out.merge(conflicts[["link_code", "image_url"]], on=["link_code", "image_url"], how="inner")
        conflicts_output.parent.mkdir(parents=True, exist_ok=True)
        conflict_rows.to_csv(conflicts_output, index=False)
        raise RuntimeError(f"V3 conflict check failed; conflicting_pairs={len(conflicts)}")

    cluster_counts = out["cluster_slug"].value_counts().sort_values(ascending=False)
    small_threshold = max(1, int(args.small_cluster_threshold))
    small_clusters = [
        {"cluster_slug": str(slug), "rows": int(rows), "needs_manual_merge": True}
        for slug, rows in cluster_counts.items()
        if int(rows) < small_threshold
    ]

    size_payload = _load_json(size_report)
    size_payload.update(
        {
            "version": "v3",
            "generated_at": utc_now_iso(),
            "source_input_csv": str(input_csv),
            "quality_percentile": q,
            "quality_threshold": round(threshold, 6),
            "rows_input": int(len(df)),
            "rows_after_quality_filter": int(len(filtered)),
            "rows_removed_by_quality_filter": int(len(df) - len(filtered)),
            "conflicting_pairs": int(len(conflicts)),
            "small_cluster_threshold": int(small_threshold),
            "clusters_below_threshold": small_clusters,
        }
    )
    size_report.write_text(json.dumps(size_payload, ensure_ascii=False, indent=2), encoding="utf-8")

    purity_payload = _load_json(purity_report)
    purity_payload.update(
        {
            "version": "v3",
            "generated_at": utc_now_iso(),
            "quality_percentile": q,
            "quality_threshold": round(threshold, 6),
            "go_live_gate_purity": 0.90,
            "conflicting_pairs": int(len(conflicts)),
        }
    )
    purity_report.write_text(json.dumps(purity_payload, ensure_ascii=False, indent=2), encoding="utf-8")

    print(
        f"[TGIS][recluster_v3] rows_in={len(df)} rows_out={len(out)} "
        f"quality_threshold={threshold:.6f} clusters={out['cluster_slug'].nunique()} "
        f"conflicts={len(conflicts)} output={output_csv}"
    )


if __name__ == "__main__":
    main()
