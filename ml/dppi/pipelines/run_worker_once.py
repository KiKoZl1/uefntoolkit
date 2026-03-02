#!/usr/bin/env python3
"""Consume one queued DPPI training run and execute corresponding train script."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from runtime import open_db, query_df


def main() -> None:
    config_path = os.getenv("DPPI_CONFIG_PATH", str(ROOT / "configs" / "base.yaml"))

    with open_db() as conn:
        queued = query_df(
            conn,
            """
            select id, task_type, model_name, model_version, payload_json
            from public.dppi_training_log
            where status = 'queued'
            order by requested_at asc
            limit 1
            """,
        )

    if queued.empty:
        print("[DPPI] no queued runs")
        return

    row = queued.iloc[0]
    run_id = int(row["id"])
    task_type = str(row["task_type"])
    model_name = str(row["model_name"])
    model_version = str(row["model_version"])

    if task_type == "entry":
        script = ROOT / "train_entry_model.py"
    elif task_type == "survival":
        script = ROOT / "train_survival_model.py"
    else:
        raise RuntimeError(f"Unsupported task_type in queue: {task_type}")

    cmd = [
        sys.executable,
        str(script),
        "--config",
        config_path,
        "--run-id",
        str(run_id),
        "--model-name",
        model_name,
        "--model-version",
        model_version,
    ]

    print("[DPPI] executing queued run", run_id, task_type)
    print("[DPPI] cmd:", " ".join(cmd))
    subprocess.check_call(cmd, cwd=str(ROOT.parents[1]))


if __name__ == "__main__":
    main()
