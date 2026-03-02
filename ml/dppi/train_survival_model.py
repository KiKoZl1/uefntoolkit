#!/usr/bin/env python3
"""Train DPPI survival model (CatBoost) with temporal split and readiness gate."""

from __future__ import annotations

import json

from mlops import (
    create_or_mark_training_run,
    evaluate_binary_model,
    fit_catboost_binary,
    finish_training_run,
    get_training_readiness,
    load_survival_dataset,
    temporal_split,
    upsert_model_registry,
    write_model_artifact,
)
from runtime import RuntimeConfig, open_db, parse_args_with_common, save_json, utc_now_iso


FEATURE_COLS = [
    "panel_name",
    "ccu_avg",
    "ccu_max",
    "entries_1h",
    "exits_1h",
    "replacements_1h",
    "exposure_minutes_1h",
    "panel_avg_ccu",
    "keep_alive_ccu_min",
    "duration_minutes",
]

HORIZON_TO_LABEL = {
    "30m": "y_30m",
    "60m": "y_60m",
    "replace_lt_30m": "y_replace_lt_30m",
}


def _extra_args(parser) -> None:
    parser.add_argument("--model-name", default="dppi_survival")
    parser.add_argument("--model-version", default=None)
    parser.add_argument("--run-id", type=int, default=None, help="Optional queued run id from dppi_training_log")
    parser.add_argument("--lookback-days", type=int, default=365)


def main() -> None:
    args = parse_args_with_common("Train DPPI survival model", extra_args=_extra_args)
    cfg = RuntimeConfig.load(args.config, region=args.region, surface_name=args.surface_name, artifacts_dir=args.artifacts_dir)

    model_name = str(args.model_name or "dppi_survival")
    model_version = str(args.model_version or utc_now_iso().replace("-", "").replace(":", "").replace(".", ""))
    run_id: int | None = int(args.run_id) if args.run_id else None

    with open_db() as conn:
        readiness = get_training_readiness(conn, cfg.region, cfg.surface_name, cfg.min_days)
        if not bool(readiness.get("ready")):
            message = f"training blocked: readiness={json.dumps(readiness, ensure_ascii=True)}"
            if run_id:
                finish_training_run(conn, run_id, status="failed", result_json={"readiness": readiness}, error_text=message)
            raise RuntimeError(message)

        frame = load_survival_dataset(conn, cfg.region, cfg.surface_name, lookback_days=max(30, int(args.lookback_days)))
        if frame.empty:
            if run_id:
                finish_training_run(conn, run_id, status="failed", result_json={}, error_text="survival dataset empty")
            raise RuntimeError("survival dataset is empty")

        frame["ts"] = frame["ts"].astype("datetime64[ns, UTC]")
        run_id = create_or_mark_training_run(
            conn,
            run_id,
            task_type="survival",
            model_name=model_name,
            model_version=model_version,
            payload={
                "region": cfg.region,
                "surface_name": cfg.surface_name,
                "min_days": cfg.min_days,
                "readiness": readiness,
                "lookback_days": int(args.lookback_days),
            },
        )

        try:
            split = temporal_split(frame, "ts", cfg.validation_days, cfg.test_days)
            if split.train.empty or split.valid.empty or split.test.empty:
                raise RuntimeError("invalid temporal split for survival dataset")

            metrics_by_horizon: dict[str, dict[str, float]] = {}
            model_files: dict[str, str] = {}

            for horizon in cfg.survival_horizons:
                label_col = HORIZON_TO_LABEL.get(horizon)
                if not label_col:
                    continue
                if label_col not in split.train.columns:
                    continue

                train_df = split.train.dropna(subset=[label_col]).copy()
                valid_df = split.valid.dropna(subset=[label_col]).copy()
                test_df = split.test.dropna(subset=[label_col]).copy()
                if train_df.empty or valid_df.empty or test_df.empty:
                    continue

                model = fit_catboost_binary(
                    train_df=train_df,
                    valid_df=valid_df,
                    feature_cols=FEATURE_COLS,
                    target_col=label_col,
                    seed=cfg.random_seed,
                    model_params=cfg.model_params,
                )

                train_metrics = evaluate_binary_model(model, train_df, FEATURE_COLS, label_col)
                valid_metrics = evaluate_binary_model(model, valid_df, FEATURE_COLS, label_col)
                test_metrics = evaluate_binary_model(model, test_df, FEATURE_COLS, label_col)
                metrics_by_horizon[horizon] = {
                    "train_auc_pr": train_metrics["auc_pr"],
                    "valid_auc_pr": valid_metrics["auc_pr"],
                    "test_auc_pr": test_metrics["auc_pr"],
                    "test_auc_roc": test_metrics["auc_roc"],
                    "test_precision_at_20": test_metrics["precision_at_20"],
                    "test_precision_at_50": test_metrics["precision_at_50"],
                    "test_brier": test_metrics["brier"],
                    "test_logloss": test_metrics["logloss"],
                    "test_ece": test_metrics["ece"],
                    "train_rows": float(len(train_df)),
                    "valid_rows": float(len(valid_df)),
                    "test_rows": float(len(test_df)),
                    "positives_test": float(test_df[label_col].astype(int).sum()),
                }

                model_path = write_model_artifact(model, cfg.artifacts_dir, model_name, model_version, horizon)
                model_files[horizon] = str(model_path)

            if not metrics_by_horizon:
                raise RuntimeError("no survival horizons could be trained")

            summary_metrics = {
                "task_type": "survival",
                "region": cfg.region,
                "surface_name": cfg.surface_name,
                "trained_at": utc_now_iso(),
                "metrics_by_horizon": metrics_by_horizon,
                "feature_cols": FEATURE_COLS,
                "model_files": model_files,
            }

            artifacts_uri = str((cfg.artifacts_dir / "models" / model_name / model_version).resolve())
            save_json(cfg.artifacts_dir / "models" / model_name / model_version / "metrics.json", summary_metrics)

            upsert_model_registry(
                conn,
                model_name=model_name,
                model_version=model_version,
                task_type="survival",
                status="production_candidate",
                metrics_json=summary_metrics,
                artifacts_uri=artifacts_uri,
                set_trained_at=True,
            )

            finish_training_run(
                conn,
                run_id,
                status="success",
                result_json={
                    "metrics": summary_metrics,
                    "artifacts_uri": artifacts_uri,
                },
            )
        except Exception as exc:
            upsert_model_registry(
                conn,
                model_name=model_name,
                model_version=model_version,
                task_type="survival",
                status="failed",
                metrics_json={"error": str(exc)},
                artifacts_uri=None,
                set_trained_at=False,
            )
            finish_training_run(conn, run_id, status="failed", result_json={}, error_text=str(exc))
            raise

    print("[DPPI] survival training finished")
    print("model:", model_name, model_version)


if __name__ == "__main__":
    main()
