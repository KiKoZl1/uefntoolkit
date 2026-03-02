from __future__ import annotations

import argparse
import json
from pathlib import Path

from ml.tgis.runtime import connect_db, load_runtime, load_yaml, utc_now_iso, write_json


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Write TGIS cluster_manifest.json from DB registry")
    p.add_argument("--config", default="ml/tgis/configs/base.yaml")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    cfg = load_yaml(args.config)
    runtime = load_runtime(args.config)
    output = Path(cfg.get("paths", {}).get("cluster_manifest", "ml/tgis/artifacts/cluster_manifest.json"))

    with connect_db(runtime) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select cluster_id, cluster_name, trigger_word, categories_json, lora_fal_path, lora_version, is_active
                from public.tgis_cluster_registry
                where is_active = true
                order by cluster_id asc
                """
            )
            rows = cur.fetchall()

    clusters = []
    for row in rows:
        clusters.append(
            {
                "cluster_id": int(row[0]),
                "cluster_name": str(row[1]),
                "trigger_word": str(row[2]),
                "categories": row[3] if isinstance(row[3], list) else json.loads(row[3] if isinstance(row[3], str) else "[]"),
                "lora_fal_path": row[4],
                "lora_version": row[5],
                "is_active": bool(row[6]),
            }
        )

    payload = {
        "version": "1.0.0",
        "updated_at": utc_now_iso(),
        "n_clusters": len(clusters),
        "clusters": clusters,
    }
    write_json(output, payload)
    print(f"[TGIS] manifest written={output} clusters={len(clusters)}")


if __name__ == "__main__":
    main()
