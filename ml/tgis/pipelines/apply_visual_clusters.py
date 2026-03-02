from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd

from ml.tgis.pipelines._category_map import CATEGORY_TO_CLUSTER_ID, FIXED_CATEGORIES
from ml.tgis.runtime import connect_db, load_runtime, load_yaml, utc_now_iso


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Apply cloud visual clustering output to DB + local artifacts")
    p.add_argument("--config", default="ml/tgis/configs/base.yaml")
    p.add_argument("--input", default="ml/tgis/artifacts/cloud/visual_clusters.csv")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    cfg = load_yaml(args.config)
    runtime = load_runtime(args.config)
    input_csv = Path(args.input)
    clusters_csv = Path(cfg.get("paths", {}).get("clusters_csv", "ml/tgis/artifacts/clusters.csv"))

    if not input_csv.exists():
        raise FileNotFoundError(f"visual cluster csv not found: {input_csv}")

    df = pd.read_csv(input_csv)
    if df.empty:
        raise RuntimeError("visual cluster csv is empty")

    required = ["link_code", "image_url", "tag_group", "quality_score", "assigned_category"]
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise RuntimeError(f"visual cluster csv missing columns: {missing}")

    out = df[["link_code", "image_url", "tag_group", "quality_score"]].copy()
    out["cluster_id"] = df["assigned_category"].astype(str).map(CATEGORY_TO_CLUSTER_ID).astype(int)
    out["cluster_name"] = df["assigned_category"].astype(str).map(lambda c: f"cluster_{c}")
    out["collected_at"] = utc_now_iso()
    out.to_csv(clusters_csv, index=False)

    # Update DB cluster registry with the 10 fixed categories.
    with connect_db(runtime) as conn:
        with conn.cursor() as cur:
            active_ids = []
            for category in FIXED_CATEGORIES:
                cluster_id = CATEGORY_TO_CLUSTER_ID[category]
                active_ids.append(cluster_id)
                cluster_name = f"cluster_{category}"
                trigger_word = f"tgis_{cluster_name}"
                cur.execute(
                    """
                    insert into public.tgis_cluster_registry(cluster_id, cluster_name, trigger_word, categories_json, is_active, updated_at)
                    values (%s, %s, %s, %s::jsonb, true, now())
                    on conflict (cluster_id) do update
                      set cluster_name = excluded.cluster_name,
                          trigger_word = excluded.trigger_word,
                          categories_json = excluded.categories_json,
                          is_active = true,
                          updated_at = now()
                    """,
                    (cluster_id, cluster_name, trigger_word, json.dumps([category])),
                )

            cur.execute(
                """
                update public.tgis_cluster_registry
                set is_active = false, updated_at = now()
                where cluster_id <> all(%s)
                """,
                (active_ids,),
            )

            cur.execute(
                """
                insert into public.tgis_dataset_runs(run_type, status, summary_json, started_at, ended_at)
                values ('clustering', 'success', %s::jsonb, now(), now())
                """,
                (
                    json.dumps(
                        {
                            "rows": int(len(out)),
                            "input": str(input_csv),
                            "output": str(clusters_csv),
                            "clusters": int(out["cluster_id"].nunique()),
                            "ts": utc_now_iso(),
                        }
                    ),
                ),
            )
        conn.commit()

    print(
        json.dumps(
            {
                "success": True,
                "rows": int(len(out)),
                "clusters": int(out["cluster_id"].nunique()),
                "output": str(clusters_csv),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
