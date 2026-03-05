from __future__ import annotations

import argparse
import shutil
from pathlib import Path

from ml.tgis.runtime import connect_db, load_runtime


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Hard reset TGIS legacy state before Nano Banana rollout")
    p.add_argument("--config", default="ml/tgis/configs/base.yaml")
    p.add_argument("--keep-cluster-registry", action="store_true", default=True)
    p.add_argument("--clean-local-artifacts", action="store_true")
    p.add_argument("--yes-i-know", action="store_true")
    return p.parse_args()


def _rm_path(path: Path) -> None:
    if not path.exists():
        return
    if path.is_dir():
        shutil.rmtree(path, ignore_errors=True)
        return
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
            # Legacy train/model state is intentionally dropped for Nano baseline.
            cur.execute("delete from public.tgis_training_runs")
            cur.execute("delete from public.tgis_model_versions")

            # Reset active LoRA pointers from registry.
            cur.execute(
                """
                update public.tgis_cluster_registry
                set lora_fal_path = null,
                    lora_version = null,
                    updated_at = now()
                """
            )

            # Reset historical generation/cost logs (fresh baseline).
            cur.execute("delete from public.tgis_prompt_rewrite_log")
            cur.execute("delete from public.tgis_generation_log")
            cur.execute("delete from public.tgis_cost_usage_daily")
            cur.execute("delete from public.tgis_skin_usage_daily")

            # Keep taxonomy + merge + reference tables by design.
        conn.commit()

    if args.clean_local_artifacts:
        targets = [
            Path("ml/tgis/artifacts/train_output"),
            Path("ml/tgis/artifacts/train_configs"),
            Path("ml/tgis/artifacts/train_datasets"),
            Path("ml/tgis/artifacts/train_datasets_v2"),
            Path("ml/tgis/artifacts/captions.jsonl"),
            Path("ml/tgis/artifacts/captions_v2.jsonl"),
            Path("ml/tgis/artifacts/training_metadata.csv"),
            Path("ml/tgis/artifacts/training_metadata_v2.csv"),
            Path("ml/tgis/artifacts/training_metadata_report.json"),
            Path("ml/tgis/artifacts/cluster_01.yaml"),
            Path("ml/tgis/artifacts/clusters.csv"),
            Path("ml/tgis/artifacts/clusters_v2.csv"),
            Path("ml/tgis/artifacts/clusters_v2_keyword.csv"),
            Path("ml/tgis/artifacts/clusters_v2_misc.csv"),
            Path("ml/tgis/artifacts/clusters_v2_misc_vision.csv"),
            Path("ml/tgis/artifacts/cluster_purity_report_v2_keyword.json"),
            Path("ml/tgis/artifacts/cluster_size_report_v2_keyword.json"),
            Path("ml/tgis/artifacts/cluster_merges_report_v2.json"),
        ]
        for target in targets:
            _rm_path(target)

    print(
        "[TGIS][reset_nano_state] completed "
        f"(clean_local_artifacts={bool(args.clean_local_artifacts)})"
    )


if __name__ == "__main__":
    main()
