from __future__ import annotations

import argparse
import shutil
from pathlib import Path

from ml.tgis.runtime import connect_db, load_runtime


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Reset TGIS state for V2 reclustering/training")
    p.add_argument("--config", default="ml/tgis/configs/base.yaml")
    p.add_argument("--keep-generation-log", action="store_true")
    p.add_argument("--clean-local-artifacts", action="store_true")
    p.add_argument("--yes-i-know", action="store_true")
    return p.parse_args()


def _rm_path(path: Path) -> None:
    if not path.exists():
        return
    if path.is_dir():
        shutil.rmtree(path, ignore_errors=True)
    else:
        try:
            path.unlink(missing_ok=True)
        except Exception:
            pass


def main() -> None:
    args = parse_args()
    if not args.yes_i_know:
        raise RuntimeError("refusing to run without --yes-i-know")
    runtime = load_runtime(args.config)

    with connect_db(runtime) as conn:
        with conn.cursor() as cur:
            # Reset active lora pointers from registry.
            cur.execute(
                """
                update public.tgis_cluster_registry
                set lora_fal_path = null,
                    lora_version = null,
                    updated_at = now()
                """
            )

            # Old model/training runs are no longer useful for V2 baseline.
            cur.execute("delete from public.tgis_model_versions")
            cur.execute("delete from public.tgis_training_runs")

            if not args.keep_generation_log:
                cur.execute("delete from public.tgis_prompt_rewrite_log")
                cur.execute("delete from public.tgis_generation_log")
                cur.execute("delete from public.tgis_cost_usage_daily")
        conn.commit()

    if args.clean_local_artifacts:
        targets = [
            Path("ml/tgis/artifacts/train_output"),
            Path("ml/tgis/artifacts/train_configs"),
            Path("ml/tgis/artifacts/train_datasets"),
            Path("ml/tgis/artifacts/captions.jsonl"),
            Path("ml/tgis/artifacts/training_metadata.csv"),
            Path("ml/tgis/artifacts/training_metadata_report.json"),
            Path("ml/tgis/artifacts/clusters.csv"),
            Path("ml/tgis/artifacts/clusters_v2.csv"),
            Path("ml/tgis/artifacts/clusters_v2_keyword.csv"),
            Path("ml/tgis/artifacts/clusters_v2_misc.csv"),
            Path("ml/tgis/artifacts/clusters_v2_misc_vision.csv"),
        ]
        for p in targets:
            _rm_path(p)

    print(
        "[TGIS][reset_v2] reset complete "
        f"(keep_generation_log={args.keep_generation_log}, clean_local_artifacts={args.clean_local_artifacts})"
    )


if __name__ == "__main__":
    main()
