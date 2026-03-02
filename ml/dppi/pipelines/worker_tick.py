#!/usr/bin/env python3
"""Single orchestration tick for DPPI worker automation."""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = ROOT.parents[1]


def run_step(name: str, cmd: list[str]) -> tuple[bool, str]:
    try:
        subprocess.check_call(cmd, cwd=str(REPO_ROOT))
        return True, f"{name}:ok"
    except subprocess.CalledProcessError as exc:
        return False, f"{name}:failed(code={exc.returncode})"


def main() -> None:
    parser = argparse.ArgumentParser(description="Run one DPPI worker tick")
    parser.add_argument("--config", default=str(ROOT / "configs" / "base.yaml"))
    parser.add_argument("--channel", default="production")
    parser.add_argument("--skip-heartbeat", action="store_true")
    parser.add_argument("--skip-training", action="store_true")
    parser.add_argument("--skip-inference", action="store_true")
    parser.add_argument("--skip-drift", action="store_true")
    args = parser.parse_args()

    steps: list[tuple[str, list[str]]] = []
    if not args.skip_heartbeat:
        steps.append(("heartbeat", [sys.executable, str(ROOT / "monitoring" / "worker_heartbeat.py")]))
    if not args.skip_training:
        steps.append(("train_queue", [sys.executable, str(ROOT / "pipelines" / "run_worker_once.py")]))
    if not args.skip_inference:
        steps.append(("inference", [sys.executable, str(ROOT / "batch_inference.py"), "--config", args.config, "--channel", args.channel]))
    if not args.skip_drift:
        steps.append(
            (
                "drift",
                [
                    sys.executable,
                    str(ROOT / "monitoring" / "run_drift_for_release.py"),
                    "--config",
                    args.config,
                ],
            )
        )

    results: list[str] = []
    ok_all = True
    for name, cmd in steps:
        ok, message = run_step(name, cmd)
        ok_all = ok_all and ok
        results.append(message)

    print("[DPPI] worker tick:", ", ".join(results))
    if not ok_all:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
