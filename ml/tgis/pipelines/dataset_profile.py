from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd

from ml.tgis.runtime import load_yaml, utc_now_iso, write_json


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Generate dataset profile for TGIS clustering outputs")
    p.add_argument("--config", default="ml/tgis/configs/base.yaml")
    p.add_argument("--input", default=None, help="clusters csv path")
    p.add_argument("--output", default=None, help="profile json output path")
    # Kept for backward CLI compatibility. No longer used to gate LoRA training.
    p.add_argument("--min-cluster-size", type=int, default=1)
    return p.parse_args()


def main() -> None:
    args = parse_args()
    cfg = load_yaml(args.config)
    input_csv = Path(args.input or cfg.get("paths", {}).get("clusters_csv", "ml/tgis/artifacts/clusters.csv"))
    out_json = Path(args.output or "ml/tgis/artifacts/dataset_profile.json")

    if not input_csv.exists():
        raise FileNotFoundError(f"clusters csv not found: {input_csv}")

    df = pd.read_csv(input_csv)
    if df.empty:
        payload = {
            "generated_at": utc_now_iso(),
            "rows_total": 0,
            "clusters": 0,
            "recommended_loras": 0,
            "lora_policy": "all_clusters_trainable",
            "notes": "empty_clusters_csv",
        }
        write_json(out_json, payload)
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return

    rows_total = int(len(df))
    unique_islands = int(df["link_code"].nunique()) if "link_code" in df.columns else rows_total
    unique_tags = int(df["tag_group"].nunique()) if "tag_group" in df.columns else 0

    cluster_counts = (
        df.groupby("cluster_id")
        .size()
        .sort_values(ascending=False)
        .rename("thumbs")
        .reset_index()
    )
    cluster_stats = [
        {
            "cluster_id": int(r.cluster_id),
            "thumbs": int(r.thumbs),
            "eligible_for_lora": True,
        }
        for r in cluster_counts.itertuples(index=False)
    ]
    recommended_loras = int(cluster_counts.shape[0])

    top_tags = []
    if "tag_group" in df.columns:
        top_tags_series = df["tag_group"].fillna("unknown").astype(str).value_counts().head(20)
        top_tags = [{"tag": str(tag), "thumbs": int(count)} for tag, count in top_tags_series.items()]

    payload = {
        "generated_at": utc_now_iso(),
        "rows_total": rows_total,
        "unique_islands": unique_islands,
        "unique_tags": unique_tags,
        "clusters": int(cluster_counts.shape[0]),
        "min_cluster_size_for_lora": 1,
        "recommended_loras": int(recommended_loras),
        "lora_policy": "all_clusters_trainable",
        "cluster_stats": cluster_stats,
        "top_tags": top_tags,
    }

    out_json.parent.mkdir(parents=True, exist_ok=True)
    write_json(out_json, payload)
    print(json.dumps(payload, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
