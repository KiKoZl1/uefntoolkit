from __future__ import annotations

import argparse
import json

from ml.tgis.runtime import connect_db, load_runtime, load_yaml, utc_now_iso


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Register LoRA version in tgis_model_versions")
    p.add_argument("--config", default="ml/tgis/configs/base.yaml")
    p.add_argument("--cluster-id", type=int, required=True)
    p.add_argument("--version", required=True)
    p.add_argument("--fal-path", required=True)
    p.add_argument("--artifact-uri", default=None)
    p.add_argument("--status", default="candidate", choices=["draft", "candidate", "active", "archived", "failed"])
    p.add_argument("--gate-json", default="{}")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    runtime = load_runtime(args.config)
    gate = json.loads(args.gate_json)

    with connect_db(runtime) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                insert into public.tgis_model_versions(
                  cluster_id, version, lora_fal_path, artifact_uri, quality_gate_json, status, created_at, updated_at
                ) values (%s, %s, %s, %s, %s::jsonb, %s, now(), now())
                on conflict (cluster_id, version) do update
                  set lora_fal_path = excluded.lora_fal_path,
                      artifact_uri = excluded.artifact_uri,
                      quality_gate_json = excluded.quality_gate_json,
                      status = excluded.status,
                      updated_at = now()
                """,
                (args.cluster_id, args.version, args.fal_path, args.artifact_uri, json.dumps(gate), args.status),
            )

            if args.status == "active":
                cur.execute(
                    """
                    update public.tgis_cluster_registry
                    set lora_fal_path = %s,
                        lora_version = %s,
                        updated_at = now()
                    where cluster_id = %s
                    """,
                    (args.fal_path, args.version, args.cluster_id),
                )

            cur.execute(
                """
                insert into public.tgis_training_runs(cluster_id, status, run_mode, target_version, result_json, started_at, ended_at, created_at, updated_at)
                values (%s, 'success', 'manual', %s, %s::jsonb, now(), now(), now(), now())
                """,
                (
                    args.cluster_id,
                    args.version,
                    json.dumps({"registered_by": "lora_uploader", "ts": utc_now_iso()}),
                ),
            )
        conn.commit()

    print(f"[TGIS] model registered cluster={args.cluster_id} version={args.version} status={args.status}")


if __name__ == "__main__":
    main()
