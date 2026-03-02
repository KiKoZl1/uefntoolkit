#!/usr/bin/env python3
"""Evaluate trained DPPI models and fit calibration artifacts."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from mlops import (
    get_training_readiness,
    insert_calibration_metric,
    load_entry_dataset,
    load_model_artifact,
    load_survival_dataset,
    pick_best_calibrator,
    temporal_split,
    write_calibrator_artifact,
)
from runtime import RuntimeConfig, open_db, parse_args_with_common, save_json


@dataclass
class TargetSpec:
    horizon: str
    label_col: str


ENTRY_TARGETS = [
    TargetSpec("2h", "y_2h"),
    TargetSpec("5h", "y_5h"),
    TargetSpec("12h", "y_12h"),
]

SURVIVAL_TARGETS = [
    TargetSpec("30m", "y_30m"),
    TargetSpec("60m", "y_60m"),
    TargetSpec("replace_lt_30m", "y_replace_lt_30m"),
]

ENTRY_FEATURES = [
    "panel_name",
    "ccu_avg",
    "ccu_max",
    "entries_1h",
    "exits_1h",
    "replacements_1h",
    "exposure_minutes_1h",
    "panel_avg_ccu",
    "keep_alive_ccu_min",
]

SURVIVAL_FEATURES = ENTRY_FEATURES + ["duration_minutes"]


def _extra_args(parser) -> None:
    parser.add_argument("--task-type", choices=["entry", "survival"], required=True)
    parser.add_argument("--model-name", required=True)
    parser.add_argument("--model-version", required=True)
    parser.add_argument("--lookback-days", type=int, default=365)


def main() -> None:
    args = parse_args_with_common("Evaluate and calibrate DPPI model", extra_args=_extra_args)
    cfg = RuntimeConfig.load(args.config, region=args.region, surface_name=args.surface_name, artifacts_dir=args.artifacts_dir)

    task_type = str(args.task_type)
    targets = ENTRY_TARGETS if task_type == "entry" else SURVIVAL_TARGETS
    feature_cols = ENTRY_FEATURES if task_type == "entry" else SURVIVAL_FEATURES

    with open_db() as conn:
        readiness = get_training_readiness(conn, cfg.region, cfg.surface_name, cfg.min_days)
        if not bool(readiness.get("ready")):
            raise RuntimeError(f"calibration blocked by readiness: {readiness}")

        if task_type == "entry":
            frame = load_entry_dataset(conn, cfg.region, cfg.surface_name, lookback_days=max(30, int(args.lookback_days)))
        else:
            frame = load_survival_dataset(conn, cfg.region, cfg.surface_name, lookback_days=max(30, int(args.lookback_days)))

        if frame.empty:
            raise RuntimeError(f"{task_type} dataset is empty")

        frame["ts"] = frame["ts"].astype("datetime64[ns, UTC]")
        split = temporal_split(frame, "ts", cfg.validation_days, cfg.test_days)
        if split.valid.empty or split.test.empty:
            raise RuntimeError("invalid split for calibration")

        report: dict[str, Any] = {
            "task_type": task_type,
            "model_name": args.model_name,
            "model_version": args.model_version,
            "region": cfg.region,
            "surface_name": cfg.surface_name,
            "targets": {},
        }

        for spec in targets:
            if spec.label_col not in split.valid.columns or spec.label_col not in split.test.columns:
                continue

            model = load_model_artifact(cfg.artifacts_dir, args.model_name, args.model_version, spec.horizon)

            valid_df = split.valid.dropna(subset=[spec.label_col]).copy()
            test_df = split.test.dropna(subset=[spec.label_col]).copy()
            if valid_df.empty or test_df.empty:
                continue

            valid_true = valid_df[spec.label_col].astype(int).to_numpy()
            test_true = test_df[spec.label_col].astype(int).to_numpy()
            valid_prob = model.predict_proba(valid_df[feature_cols])[:, 1]
            test_prob = model.predict_proba(test_df[feature_cols])[:, 1]

            method, calibrator, metrics = pick_best_calibrator(valid_true, valid_prob, test_true, test_prob)
            artifact_path = write_calibrator_artifact(
                calibrator=calibrator,
                method=method,
                base_dir=cfg.artifacts_dir,
                model_name=args.model_name,
                model_version=args.model_version,
                horizon=spec.horizon,
            )

            insert_calibration_metric(
                conn,
                model_name=args.model_name,
                model_version=args.model_version,
                task_type=task_type,
                horizon=spec.horizon,
                brier=float(metrics["brier"]),
                logloss=float(metrics["logloss"]),
                ece=float(metrics["ece"]),
                method=method,
            )

            report["targets"][spec.horizon] = {
                "method": method,
                "metrics": metrics,
                "artifact_path": str(artifact_path) if artifact_path else None,
                "rows_valid": int(len(valid_df)),
                "rows_test": int(len(test_df)),
            }

        out_path = cfg.artifacts_dir / "calibrators" / args.model_name / args.model_version / "calibration_report.json"
        save_json(out_path, report)

    print("[DPPI] calibration finished")
    print("report:", out_path)


if __name__ == "__main__":
    main()
