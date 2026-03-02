from __future__ import annotations

import argparse
import subprocess
import sys

from ml.tgis.runtime import load_yaml


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Single operational tick for TGIS worker")
    p.add_argument("--config", default="ml/tgis/configs/base.yaml")
    p.add_argument("--skip-heartbeat", action="store_true")
    p.add_argument("--skip-cost-sync", action="store_true")
    p.add_argument("--skip-training-queue", action="store_true")
    p.add_argument("--max-training-runs", type=int, default=1)
    return p.parse_args()


def run(cmd: list[str]) -> None:
    proc = subprocess.run(cmd, check=False)
    if proc.returncode != 0:
        raise SystemExit(proc.returncode)


def main() -> None:
    args = parse_args()
    _ = load_yaml(args.config)

    if not args.skip_heartbeat:
        run([sys.executable, "-m", "ml.tgis.runtime.heartbeat", "--config", args.config])

    if not args.skip_training_queue:
        run(
            [
                sys.executable,
                "-m",
                "ml.tgis.runtime.process_training_queue",
                "--config",
                args.config,
                "--max-runs",
                str(max(1, int(args.max_training_runs))),
            ]
        )

    if not args.skip_cost_sync:
        run([sys.executable, "-m", "ml.tgis.pipelines.cost_sync", "--config", args.config])


if __name__ == "__main__":
    main()
