from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.cluster import KMeans

from ml.tgis.pipelines.thumb_clusterer import feature_for_row, merge_small_clusters
from ml.tgis.runtime import connect_db, load_runtime, load_yaml, utc_now_iso


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="TGIS V2 visual misc reclustering")
    p.add_argument("--config", default="ml/tgis/configs/base.yaml")
    p.add_argument("--input", default="ml/tgis/artifacts/clusters_v2_keyword.csv")
    p.add_argument("--output", default="ml/tgis/artifacts/clusters_v2_misc.csv")
    p.add_argument("--report", default="ml/tgis/artifacts/cluster_misc_visual_report.json")
    p.add_argument("--k", type=int, default=8)
    p.add_argument("--min-cluster-size", type=int, default=25)
    p.add_argument("--thumb-cache-dir", default=None)
    p.add_argument("--download-missing", action="store_true")
    return p.parse_args()


def _safe_slug(idx: int) -> str:
    return f"misc_visual_{idx + 1:02d}"


def main() -> None:
    args = parse_args()
    cfg = load_yaml(args.config)
    runtime = load_runtime(args.config)
    input_csv = Path(args.input)
    output_csv = Path(args.output)
    report_json = Path(args.report)
    thumb_cache = Path(
        args.thumb_cache_dir
        or cfg.get("clustering", {}).get("thumb_cache_dir", "ml/tgis/artifacts/thumbs_clean_025")
    )

    if not input_csv.exists():
        raise FileNotFoundError(f"input csv not found: {input_csv}")

    df = pd.read_csv(input_csv)
    if df.empty:
        raise RuntimeError("input csv is empty")

    needed = {"link_code", "image_url", "quality_score", "seed_tag_group", "cluster_slug", "cluster_family"}
    missing = [c for c in needed if c not in df.columns]
    if missing:
        raise RuntimeError(f"missing required columns: {missing}")

    misc_mask = df["cluster_slug"].astype(str).eq("misc_unclassified")
    misc_df = df[misc_mask].copy()
    base_df = df[~misc_mask].copy()

    if misc_df.empty:
        out = df.copy()
        output_csv.parent.mkdir(parents=True, exist_ok=True)
        out.to_csv(output_csv, index=False)
        report = {
            "generated_at": utc_now_iso(),
            "input_rows": int(len(df)),
            "misc_rows": 0,
            "message": "no misc_unclassified rows found; passthrough",
            "output": str(output_csv),
        }
        report_json.parent.mkdir(parents=True, exist_ok=True)
        report_json.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"[TGIS][recluster_misc_visual] no misc rows, passthrough output={output_csv}")
        return

    feats = np.stack(
        [
            feature_for_row(
                link_code=str(getattr(r, "link_code", "") or ""),
                image_url=str(getattr(r, "image_url", "") or ""),
                tag_group=str(getattr(r, "seed_tag_group", "general") or "general"),
                quality_score=float(getattr(r, "quality_score", 0.0) or 0.0),
                cache_root=thumb_cache,
                download_missing=bool(args.download_missing),
            )
            for r in misc_df.itertuples(index=False)
        ]
    )

    k = max(1, min(int(args.k), len(misc_df)))
    if k == 1:
        labels = np.zeros((len(misc_df),), dtype=np.int32)
        model = None
    else:
        model = KMeans(n_clusters=k, random_state=42, n_init=10)
        labels = model.fit_predict(feats)
        labels = merge_small_clusters(labels=labels, feats=feats, min_size=max(1, int(args.min_cluster_size)))

    misc_df["cluster_slug"] = [_safe_slug(int(x)) for x in labels.tolist()]
    misc_df["cluster_family"] = "misc"
    misc_df["phase"] = "misc_visual"

    # Confidence proxy from distance-to-centroid.
    if model is not None:
        centers = model.cluster_centers_
        dists = np.linalg.norm(feats - centers[labels], axis=1)
        max_dist = float(np.max(dists)) if len(dists) else 1.0
        conf = 1.0 - (dists / max(1e-6, max_dist))
        misc_df["cluster_confidence"] = np.clip(conf, 0.05, 0.95).round(4)
    else:
        misc_df["cluster_confidence"] = 0.50

    out = pd.concat([base_df, misc_df], ignore_index=True)
    out = out.sort_values(by=["quality_score"], ascending=False)
    output_csv.parent.mkdir(parents=True, exist_ok=True)
    out.to_csv(output_csv, index=False)

    misc_counts = misc_df["cluster_slug"].value_counts().to_dict()
    report = {
        "generated_at": utc_now_iso(),
        "input_rows": int(len(df)),
        "misc_rows_input": int(len(misc_df)),
        "misc_clusters_generated": int(len(misc_counts)),
        "misc_counts": {str(k): int(v) for k, v in misc_counts.items()},
        "output_rows": int(len(out)),
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
                    (json.dumps({"type": "recluster_misc_visual_v2", **report}),),
                )
            conn.commit()
    except Exception:
        pass
    print(
        f"[TGIS][recluster_misc_visual] misc_rows={len(misc_df)} generated={len(misc_counts)} output={output_csv}"
    )


if __name__ == "__main__":
    main()
