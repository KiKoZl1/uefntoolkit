from __future__ import annotations

import argparse
import json

from ml.tgis.runtime import connect_db, load_runtime


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Queue quarterly retrain for active TGIS clusters")
    p.add_argument("--config", default="ml/tgis/configs/base.yaml")
    p.add_argument("--dry-run", action="store_true")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    runtime = load_runtime(args.config)

    with connect_db(runtime) as conn:
        with conn.cursor() as cur:
            cur.execute("select cluster_id from public.tgis_cluster_registry where is_active = true order by cluster_id")
            cluster_ids = [int(r[0]) for r in cur.fetchall()]

            for cluster_id in cluster_ids:
                cur.execute(
                    """
                    insert into public.tgis_training_runs(cluster_id, status, run_mode, target_version, result_json, created_at, updated_at)
                    values (%s, 'queued', %s, %s, %s::jsonb, now(), now())
                    """,
                    (
                        cluster_id,
                        "dry_run" if args.dry_run else "scheduled",
                        "v_quarterly_auto",
                        json.dumps({"source": "quarterly_retrain", "dry_run": args.dry_run}),
                    ),
                )
        conn.commit()

    print(f"[TGIS] quarterly retrain queued for {len(cluster_ids)} clusters (dry_run={args.dry_run})")


if __name__ == "__main__":
    main()
