from __future__ import annotations

import argparse
import json
import os
import subprocess
import tempfile
from pathlib import Path

import yaml

from ml.tgis.runtime import connect_db, load_runtime, load_yaml


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Dispatch a RunPod training job for one TGIS cluster")
    p.add_argument("--config", default="ml/tgis/configs/base.yaml")
    p.add_argument("--cluster-id", type=int, required=True)
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--smoke", action="store_true", help="Run a short smoke training")
    p.add_argument("--smoke-steps", type=int, default=120, help="Steps when --smoke is enabled")
    p.add_argument("--run-id", type=int, default=None, help="Existing tgis_training_runs.id to execute/update")
    p.add_argument("--target-version", default=None)
    return p.parse_args()


def _prepare_smoke_config(cluster_cfg: Path, smoke_steps: int) -> Path:
    with cluster_cfg.open("r", encoding="utf-8") as f:
        cfg = yaml.safe_load(f) or {}

    process = (((cfg.get("config") or {}).get("process")) or [{}])[0]
    train = process.get("train") or {}
    save = process.get("save") or {}

    train["steps"] = int(smoke_steps)
    save["save_every"] = min(50, max(20, int(smoke_steps // 2)))
    process["train"] = train
    process["save"] = save

    if isinstance(cfg.get("config"), dict):
        cfg["config"]["name"] = f"{cfg['config'].get('name', 'tgis_cluster')}_smoke"

    out = Path(tempfile.gettempdir()) / f"{cluster_cfg.stem}_smoke.yaml"
    with out.open("w", encoding="utf-8") as f:
        yaml.safe_dump(cfg, f, sort_keys=False)
    return out


def main() -> None:
    args = parse_args()
    cfg = load_yaml(args.config)
    runtime = load_runtime(args.config)
    target_version = args.target_version or "v_auto"

    config_dir = Path(cfg.get("paths", {}).get("train_configs_dir", "ml/tgis/artifacts/train_configs"))
    cluster_cfg = (config_dir / f"cluster_{int(args.cluster_id):02d}.yaml").resolve()
    if not cluster_cfg.exists():
        raise FileNotFoundError(f"cluster config not found: {cluster_cfg}")

    ai_toolkit_runner = Path(os.getenv("AI_TOOLKIT_RUNNER", "/workspace/ai-toolkit/run.py"))
    if not ai_toolkit_runner.exists():
        raise FileNotFoundError(
            f"AI Toolkit runner not found: {ai_toolkit_runner}. "
            "Set AI_TOOLKIT_RUNNER or install ai-toolkit in /workspace/ai-toolkit."
        )
    ai_toolkit_python = Path(os.getenv("AI_TOOLKIT_PYTHON", "/workspace/.venv_aitk/bin/python"))
    if not ai_toolkit_python.exists():
        raise FileNotFoundError(
            f"AI Toolkit python not found: {ai_toolkit_python}. "
            "Set AI_TOOLKIT_PYTHON or create /workspace/.venv_aitk."
        )

    cfg_to_run = _prepare_smoke_config(cluster_cfg, args.smoke_steps) if args.smoke else cluster_cfg

    run_cmd = [
        str(ai_toolkit_python),
        str(ai_toolkit_runner),
        str(cfg_to_run),
    ]

    # Keep run_mode compatible with DB CHECK constraint:
    # ('manual','scheduled','dry_run')
    run_mode = "dry_run" if args.dry_run else "manual"
    run_payload = {
        "run_cmd": run_cmd,
        "dry_run": args.dry_run,
        "smoke": args.smoke,
        "cluster_config": str(cluster_cfg),
        "config_used": str(cfg_to_run),
    }

    if args.run_id is None:
        with connect_db(runtime) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    insert into public.tgis_training_runs(cluster_id, status, run_mode, target_version, result_json, started_at, created_at, updated_at)
                    values (%s, 'running', %s, %s, %s::jsonb, now(), now(), now())
                    returning id
                    """,
                    (
                        args.cluster_id,
                        run_mode,
                        target_version,
                        json.dumps(run_payload),
                    ),
                )
                run_id = cur.fetchone()[0]
            conn.commit()
    else:
        run_id = int(args.run_id)
        with connect_db(runtime) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    update public.tgis_training_runs
                    set status = 'running',
                        run_mode = %s,
                        target_version = %s,
                        result_json = coalesce(result_json, '{}'::jsonb) || %s::jsonb,
                        started_at = coalesce(started_at, now()),
                        updated_at = now()
                    where id = %s
                    """,
                    (run_mode, target_version, json.dumps(run_payload), run_id),
                )
            conn.commit()

    if args.dry_run:
        with connect_db(runtime) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    update public.tgis_training_runs
                    set status = 'success',
                        ended_at = now(),
                        updated_at = now(),
                        error_text = null
                    where id = %s
                    """,
                    (run_id,),
                )
            conn.commit()
        print(f"[TGIS] dry-run training completed run_id={run_id} cmd={' '.join(run_cmd)}")
        return

    proc = subprocess.run(run_cmd, check=False, cwd=str(ai_toolkit_runner.parent))
    status = "success" if proc.returncode == 0 else "failed"

    with connect_db(runtime) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                update public.tgis_training_runs
                set status = %s,
                    ended_at = now(),
                    updated_at = now(),
                    error_text = case when %s = 'failed' then 'runpod_train_failed' else null end
                where id = %s
                """,
                (status, status, run_id),
            )
        conn.commit()

    if status != "success":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
