from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

import pandas as pd

from ml.tgis.runtime import connect_db, load_runtime, load_yaml


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="TGIS preflight check (end-to-end readiness)")
    p.add_argument("--config", default="ml/tgis/configs/base.yaml")
    return p.parse_args()


def _ok(name: str, status: bool, detail: str) -> dict:
    return {"name": name, "ok": bool(status), "detail": detail}


def main() -> None:
    args = parse_args()
    cfg = load_yaml(args.config)
    runtime = load_runtime(args.config)

    checks: list[dict] = []

    # Env checks
    required_env = [
        "SUPABASE_URL",
        "SUPABASE_SERVICE_ROLE_KEY",
        "SUPABASE_DB_URL",
        "OPENROUTER_API_KEY",
        "FAL_API_KEY",
        "RUNPOD_API_KEY",
    ]
    for key in required_env:
        v = os.getenv(key, "").strip()
        checks.append(_ok(f"env:{key}", bool(v), "present" if v else "missing"))

    ai_toolkit_runner = os.getenv("AI_TOOLKIT_RUNNER", "/workspace/ai-toolkit/run.py")
    checks.append(_ok("file:ai_toolkit_runner", Path(ai_toolkit_runner).exists(), ai_toolkit_runner))
    ai_toolkit_python = os.getenv("AI_TOOLKIT_PYTHON", "/workspace/.venv_aitk/bin/python")
    checks.append(_ok("file:ai_toolkit_python", Path(ai_toolkit_python).exists(), ai_toolkit_python))

    # File/artifact checks
    paths = cfg.get("paths", {})
    dataset_csv = Path(paths.get("dataset_csv", "ml/tgis/artifacts/dataset_candidates.csv"))
    clusters_csv = Path(paths.get("clusters_csv", "ml/tgis/artifacts/clusters.csv"))
    train_cfg_dir = Path(paths.get("train_configs_dir", "ml/tgis/artifacts/train_configs"))
    manifest_path = Path(paths.get("cluster_manifest", "ml/tgis/artifacts/cluster_manifest.json"))
    cloud_manifest = Path("ml/tgis/artifacts/cloud/candidates_for_visual_cluster.csv")

    checks.append(_ok("file:dataset_csv", dataset_csv.exists(), str(dataset_csv)))
    checks.append(_ok("file:clusters_csv", clusters_csv.exists(), str(clusters_csv)))
    checks.append(_ok("file:manifest", manifest_path.exists(), str(manifest_path)))
    checks.append(_ok("file:cloud_candidates", cloud_manifest.exists(), str(cloud_manifest)))
    checks.append(_ok("dir:train_configs", train_cfg_dir.exists(), str(train_cfg_dir)))

    dataset_rows = 0
    cluster_rows = 0
    if dataset_csv.exists():
        try:
            dataset_rows = int(len(pd.read_csv(dataset_csv)))
        except Exception:
            dataset_rows = 0
    if clusters_csv.exists():
        try:
            cdf = pd.read_csv(clusters_csv)
            cluster_rows = int(cdf["cluster_id"].nunique()) if "cluster_id" in cdf.columns else 0
        except Exception:
            cluster_rows = 0

    checks.append(_ok("data:dataset_rows", dataset_rows > 0, str(dataset_rows)))
    checks.append(_ok("data:clusters_present", cluster_rows > 0, str(cluster_rows)))

    # DB checks
    db_ok = False
    active_clusters = 0
    taxonomy_ok = False
    training_enabled = None
    try:
        with connect_db(runtime) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    select count(*)::int
                    from public.tgis_cluster_registry
                    where is_active = true
                    """
                )
                active_clusters = int(cur.fetchone()[0] or 0)

                cur.execute(
                    """
                    select bool_and(jsonb_array_length(categories_json) = 1)
                    from public.tgis_cluster_registry
                    where is_active = true
                    """
                )
                taxonomy_ok = bool(cur.fetchone()[0] or False)

                cur.execute(
                    """
                    select training_enabled
                    from public.tgis_runtime_config
                    where config_key = 'default'
                    limit 1
                    """
                )
                row = cur.fetchone()
                training_enabled = bool(row[0]) if row is not None else None
        db_ok = True
    except Exception as e:
        checks.append(_ok("db:connect", False, str(e)))

    if db_ok:
        checks.append(_ok("db:connect", True, "ok"))
        checks.append(_ok("db:active_clusters", active_clusters > 0, str(active_clusters)))
        checks.append(_ok("db:taxonomy_single_category", taxonomy_ok, "single-category clusters"))
        checks.append(
            _ok(
                "db:training_enabled",
                training_enabled is not None,
                "true" if training_enabled is True else ("false" if training_enabled is False else "missing"),
            )
        )

    all_ok = all(item["ok"] for item in checks)
    payload = {
        "success": all_ok,
        "checks": checks,
        "summary": {
            "dataset_rows": dataset_rows,
            "clusters_csv_distinct": cluster_rows,
            "active_clusters_db": active_clusters,
            "training_enabled": training_enabled,
        },
        "next_steps": [
            "1) Se env falhou: preencher ml/tgis/deploy/worker.env com as chaves.",
            "2) Se dataset falta: rodar thumb_pipeline + export_cloud_manifest.",
            "3) Rodar clustering cloud (visual_cluster_job) e aplicar com apply_visual_clusters.",
            "4) Depois gerar config_generator + manifest_writer e iniciar treino piloto no /admin/tgis/training.",
        ],
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
