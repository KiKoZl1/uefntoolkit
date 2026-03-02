from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd

from ml.tgis.pipelines._category_map import normalize_tag_group
from ml.tgis.runtime import load_yaml, utc_now_iso


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Export filtered candidates for cloud visual clustering")
    p.add_argument("--config", default="ml/tgis/configs/base.yaml")
    p.add_argument("--input", default=None, help="dataset csv path")
    p.add_argument(
        "--source",
        choices=["visual_pool", "performance"],
        default="visual_pool",
        help="default source when --input is not provided",
    )
    p.add_argument("--output", default="ml/tgis/artifacts/cloud/candidates_for_visual_cluster.csv")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    cfg = load_yaml(args.config)
    if args.input:
        input_csv = Path(args.input)
    else:
        paths = cfg.get("paths", {})
        if args.source == "visual_pool":
            input_csv = Path(paths.get("dataset_visual_csv", "ml/tgis/artifacts/dataset_visual_pool_ab.csv"))
        else:
            input_csv = Path(paths.get("dataset_csv", "ml/tgis/artifacts/dataset_candidates.csv"))
    output_csv = Path(args.output)

    if not input_csv.exists():
        raise FileNotFoundError(f"dataset csv not found: {input_csv}")

    df = pd.read_csv(input_csv)
    if df.empty:
        raise RuntimeError("dataset csv is empty; run thumb_pipeline first")

    needed = ["link_code", "image_url", "tag_group", "quality_score"]
    missing = [c for c in needed if c not in df.columns]
    if missing:
        raise RuntimeError(f"dataset missing columns: {missing}")

    out = df[needed].copy()
    out = out[out["image_url"].astype(str).str.startswith("http")]
    out["seed_category"] = out["tag_group"].astype(str).map(normalize_tag_group)
    out["exported_at"] = utc_now_iso()

    output_csv.parent.mkdir(parents=True, exist_ok=True)
    out.to_csv(output_csv, index=False)
    print(f"[TGIS] cloud manifest exported rows={len(out)} output={output_csv}")


if __name__ == "__main__":
    main()
