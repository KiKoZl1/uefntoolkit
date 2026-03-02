from __future__ import annotations

import argparse
import subprocess
import sys

from ml.tgis.runtime import connect_db, load_runtime


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Process queued TGIS training runs")
    p.add_argument("--config", default="ml/tgis/configs/base.yaml")
    p.add_argument("--max-runs", type=int, default=1)
    return p.parse_args()


def main() -> None:
    args = parse_args()
    runtime = load_runtime(args.config)
    max_runs = max(1, int(args.max_runs))
    processed = 0

    with connect_db(runtime) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select training_enabled
                from public.tgis_runtime_config
                where config_key = 'default'
                limit 1
                """
            )
            row = cur.fetchone()
            training_enabled = bool(row[0]) if row is not None else False
        conn.commit()

    while processed < max_runs:
        with connect_db(runtime) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    select id, cluster_id, run_mode, target_version
                    from public.tgis_training_runs
                    where status = 'queued'
                      and cluster_id is not null
                    order by created_at asc, id asc
                    limit 1
                    """
                )
                job = cur.fetchone()
            conn.commit()

        if not job:
            break

        run_id, cluster_id, run_mode, target_version = int(job[0]), int(job[1]), str(job[2] or "manual"), str(job[3] or "v_auto")

        if run_mode != "dry_run" and not training_enabled:
            with connect_db(runtime) as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        update public.tgis_training_runs
                        set status = 'failed',
                            ended_at = now(),
                            updated_at = now(),
                            error_text = 'training_disabled_in_runtime_config'
                        where id = %s
                        """,
                        (run_id,),
                    )
                conn.commit()
            processed += 1
            continue

        cmd = [
            sys.executable,
            "-m",
            "ml.tgis.train.runpod_train_cluster",
            "--config",
            args.config,
            "--cluster-id",
            str(cluster_id),
            "--run-id",
            str(run_id),
            "--target-version",
            target_version,
        ]
        if run_mode == "dry_run":
            cmd.append("--dry-run")

        proc = subprocess.run(cmd, check=False)
        if proc.returncode != 0:
            with connect_db(runtime) as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        update public.tgis_training_runs
                        set status = 'failed',
                            ended_at = now(),
                            updated_at = now(),
                            error_text = coalesce(error_text, 'runpod_train_dispatch_failed')
                        where id = %s
                        """,
                        (run_id,),
                    )
                conn.commit()
        processed += 1

    print(f"[TGIS] training queue processed={processed}")


if __name__ == "__main__":
    main()

