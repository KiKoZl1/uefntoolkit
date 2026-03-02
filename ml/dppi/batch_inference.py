#!/usr/bin/env python3
"""Run DPPI batch inference and persist prediction tables."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from mlops import (
    apply_calibrator,
    as_confidence_bucket,
    call_materialize_opportunities,
    get_release_model,
    insert_prediction_rows,
    load_calibrator_artifact,
    load_inference_features,
    load_model_artifact,
    log_inference,
)
from runtime import RuntimeConfig, open_db, parse_args_with_common, utc_now


ENTRY_HORIZONS = ["2h", "5h", "12h"]
SURVIVAL_HORIZONS = ["30m", "60m", "replace_lt_30m"]
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
]
SURVIVAL_FEATURE_COLS = FEATURE_COLS + ["duration_minutes"]


def _extra_args(parser) -> None:
    parser.add_argument("--as-of-bucket", default=None, help="UTC bucket, e.g. 2026-02-27T18:00:00Z")
    parser.add_argument("--channel", default="production", choices=["shadow", "candidate", "limited", "production"])


def _parse_bucket(value: str | None) -> datetime:
    if not value:
        now = utc_now()
        return now.replace(minute=0, second=0, microsecond=0)
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)


def main() -> None:
    args = parse_args_with_common("Run DPPI batch inference", extra_args=_extra_args)
    cfg = RuntimeConfig.load(args.config, region=args.region, surface_name=args.surface_name, artifacts_dir=args.artifacts_dir)
    as_of_bucket = _parse_bucket(args.as_of_bucket)

    with open_db() as conn:
        features = load_inference_features(conn, cfg.region, cfg.surface_name, as_of_bucket)
        if features.empty:
            log_inference(
                conn,
                mode="batch_inference_empty",
                target_scope={"region": cfg.region, "surface_name": cfg.surface_name, "as_of_bucket": as_of_bucket.isoformat()},
                processed_rows=0,
                failed_rows=0,
                model_name=None,
                model_version=None,
                error_text="no_features",
            )
            print("[DPPI] no feature rows for inference")
            return

        generated_at = utc_now()

        entry_release = get_release_model(conn, "entry", channel=args.channel)
        survival_release = get_release_model(conn, "survival", channel=args.channel)

        entry_rows: list[dict[str, Any]] = []
        survival_rows: list[dict[str, Any]] = []

        if entry_release:
            entry_model_name = str(entry_release["model_name"])
            entry_model_version = str(entry_release["model_version"])
            for horizon in ENTRY_HORIZONS:
                model = load_model_artifact(cfg.artifacts_dir, entry_model_name, entry_model_version, horizon)
                method, calibrator = load_calibrator_artifact(cfg.artifacts_dir, entry_model_name, entry_model_version, horizon)
                probs = model.predict_proba(features[FEATURE_COLS])[:, 1]
                probs = apply_calibrator(calibrator, method, probs)
                for idx, prob in enumerate(probs):
                    row = features.iloc[idx]
                    entry_rows.append(
                        {
                            "generated_at": generated_at,
                            "as_of_bucket": as_of_bucket,
                            "target_id": row["target_id"],
                            "region": row["region"],
                            "surface_name": row["surface_name"],
                            "panel_name": row["panel_name"],
                            "island_code": row["island_code"],
                            "prediction_horizon": horizon,
                            "score": float(prob),
                            "confidence_bucket": as_confidence_bucket(float(prob)),
                            "model_name": entry_model_name,
                            "model_version": entry_model_version,
                            "evidence_json": {
                                "calibration_method": method,
                                "ccu_avg": float(row["ccu_avg"]),
                                "entries_1h": float(row["entries_1h"]),
                                "exits_1h": float(row["exits_1h"]),
                                "replacements_1h": float(row["replacements_1h"]),
                            },
                        }
                    )

        if survival_release:
            survival_model_name = str(survival_release["model_name"])
            survival_model_version = str(survival_release["model_version"])
            scoped = features.copy()
            scoped["duration_minutes"] = scoped["exposure_minutes_1h"].clip(lower=0.0)
            for horizon in SURVIVAL_HORIZONS:
                model = load_model_artifact(cfg.artifacts_dir, survival_model_name, survival_model_version, horizon)
                method, calibrator = load_calibrator_artifact(cfg.artifacts_dir, survival_model_name, survival_model_version, horizon)
                probs = model.predict_proba(scoped[SURVIVAL_FEATURE_COLS])[:, 1]
                probs = apply_calibrator(calibrator, method, probs)
                for idx, prob in enumerate(probs):
                    row = scoped.iloc[idx]
                    survival_rows.append(
                        {
                            "generated_at": generated_at,
                            "as_of_bucket": as_of_bucket,
                            "target_id": row["target_id"],
                            "region": row["region"],
                            "surface_name": row["surface_name"],
                            "panel_name": row["panel_name"],
                            "island_code": row["island_code"],
                            "prediction_horizon": horizon,
                            "score": float(prob),
                            "confidence_bucket": as_confidence_bucket(float(prob)),
                            "model_name": survival_model_name,
                            "model_version": survival_model_version,
                            "evidence_json": {
                                "calibration_method": method,
                                "duration_minutes": float(row["duration_minutes"]),
                                "ccu_avg": float(row["ccu_avg"]),
                                "replacements_1h": float(row["replacements_1h"]),
                            },
                        }
                    )

        entry_count = insert_prediction_rows(conn, "dppi_predictions", entry_rows) if entry_rows else 0
        survival_count = insert_prediction_rows(conn, "dppi_survival_predictions", survival_rows) if survival_rows else 0

        materialize_result = call_materialize_opportunities(conn, cfg.region, cfg.surface_name, as_of_bucket)

        log_inference(
            conn,
            mode="batch_inference",
            target_scope={
                "region": cfg.region,
                "surface_name": cfg.surface_name,
                "as_of_bucket": as_of_bucket.isoformat(),
                "channel": args.channel,
            },
            processed_rows=entry_count + survival_count,
            failed_rows=0,
            model_name=(entry_release or survival_release or {}).get("model_name"),
            model_version=(entry_release or survival_release or {}).get("model_version"),
            error_text=None,
        )

    print("[DPPI] batch inference complete")
    print("entry rows:", entry_count)
    print("survival rows:", survival_count)
    print("materialize:", materialize_result)


if __name__ == "__main__":
    main()
