from __future__ import annotations

import argparse
import subprocess
import sys


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Run nightly TGIS pipeline")
    p.add_argument("--config", default="ml/tgis/configs/base.yaml")
    return p.parse_args()


def run(cmd: list[str]) -> None:
    proc = subprocess.run(cmd, check=False)
    if proc.returncode != 0:
        raise SystemExit(proc.returncode)


def main() -> None:
    args = parse_args()
    run([sys.executable, "-m", "ml.tgis.runtime.heartbeat", "--config", args.config])
    run([sys.executable, "-m", "ml.tgis.pipelines.build_visual_pool_ab", "--config", args.config])
    run([sys.executable, "-m", "ml.tgis.pipelines.thumb_pipeline", "--config", args.config])
    run([sys.executable, "-m", "ml.tgis.pipelines.export_cloud_manifest", "--config", args.config])
    run([sys.executable, "-m", "ml.tgis.pipelines.cost_sync", "--config", args.config])


if __name__ == "__main__":
    main()
