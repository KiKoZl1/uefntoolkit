#!/usr/bin/env python3
"""Compute explicit DPPI baseline metrics (constant + panel-rate) before first model."""

from __future__ import annotations

import json
from pathlib import Path
import sys
from typing import Any

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from mlops import (
    precision_at_k,
    safe_metric_auc_pr,
    safe_metric_auc_roc,
    safe_metric_brier,
    safe_metric_logloss,
    temporal_split,
    upsert_model_registry,
)
from runtime import RuntimeConfig, open_db, parse_args_with_common, save_json, utc_now_iso


def _extra_args(parser) -> None:
    parser.add_argument("--lookback-days", type=int, default=365)
    parser.add_argument("--model-name", default="dppi_baseline")
    parser.add_argument("--model-version", default="v0")
    parser.add_argument("--task-type", choices=["entry", "survival"], default="entry")
    parser.add_argument("--output", default=None)
    parser.add_argument("--write-registry", action="store_true", help="Upsert baseline metrics into dppi_model_registry")


def _load_frame(conn, task_type: str, region: str, surface_name: str, lookback_days: int) -> pd.DataFrame:
    if task_type == "entry":
        sql = """
        select
          h.as_of_bucket as ts,
          h.panel_name,
          h.island_code,
          l.enter_2h::int as y_2h,
          l.enter_5h::int as y_5h,
          l.enter_12h::int as y_12h
        from public.dppi_feature_store_hourly h
        join public.dppi_labels_entry l
          on l.as_of_bucket = h.as_of_bucket
         and l.target_id = h.target_id
         and l.panel_name = h.panel_name
         and l.island_code = h.island_code
        where h.region = %s
          and h.surface_name = %s
          and h.as_of_bucket >= now() - (%s::text || ' days')::interval
        order by h.as_of_bucket asc
        """
    else:
        sql = """
        select
          date_trunc('hour', l.stint_start) as ts,
          l.panel_name,
          l.island_code,
          l.stay_30m::int as y_30m,
          l.stay_60m::int as y_60m,
          l.replaced_lt_30m::int as y_replace_lt_30m
        from public.dppi_labels_survival l
        join public.discovery_exposure_targets t
          on t.id = l.target_id
        where t.region = %s
          and t.surface_name = %s
          and l.stint_start >= now() - (%s::text || ' days')::interval
        order by l.stint_start asc
        """

    with conn.cursor() as cur:
        cur.execute(sql, [region, surface_name, lookback_days])
        rows = cur.fetchall()
        cols = [c.name for c in cur.description] if cur.description else []
    return pd.DataFrame(rows, columns=cols)


def _horizons(task_type: str, cfg: RuntimeConfig) -> list[str]:
    return cfg.entry_horizons if task_type == "entry" else cfg.survival_horizons


def _target_col(task_type: str, horizon: str) -> str:
    if task_type == "entry":
        return f"y_{horizon}"
    if horizon == "replace_lt_30m":
        return "y_replace_lt_30m"
    return f"y_{horizon}"


def _eval(y_true: np.ndarray, y_prob: np.ndarray) -> dict[str, float]:
    return {
        "test_auc_pr": safe_metric_auc_pr(y_true, y_prob),
        "test_auc_roc": safe_metric_auc_roc(y_true, y_prob),
        "test_precision_at_20": precision_at_k(y_true, y_prob, 20),
        "test_precision_at_50": precision_at_k(y_true, y_prob, 50),
        "test_brier": safe_metric_brier(y_true, y_prob),
        "test_logloss": safe_metric_logloss(y_true, y_prob),
    }


def _compute_baseline_for_horizon(df: pd.DataFrame, target_col: str, valid_days: int, test_days: int) -> dict[str, Any]:
    local = df[["ts", "panel_name", target_col]].copy()
    local["ts"] = pd.to_datetime(local["ts"], utc=True)
    local = local.sort_values("ts").reset_index(drop=True)
    split = temporal_split(local, "ts", valid_days=valid_days, test_days=test_days)

    train = split.train.dropna(subset=[target_col]).copy()
    test = split.test.dropna(subset=[target_col]).copy()
    if train.empty or test.empty:
        return {
            "rows_train": int(len(train)),
            "rows_test": int(len(test)),
            "global_mean": 0.0,
            "panel_rate": _eval(np.zeros(1, dtype=int), np.zeros(1, dtype=float)),
            "constant_rate": _eval(np.zeros(1, dtype=int), np.zeros(1, dtype=float)),
        }

    global_mean = float(train[target_col].mean())
    panel_means = train.groupby("panel_name")[target_col].mean().to_dict()

    y_true = test[target_col].astype(int).to_numpy()
    y_prob_panel = test["panel_name"].map(panel_means).fillna(global_mean).astype(float).to_numpy()
    y_prob_const = np.full(shape=len(test), fill_value=global_mean, dtype=float)

    return {
        "rows_train": int(len(train)),
        "rows_test": int(len(test)),
        "global_mean": float(global_mean),
        "panel_rate": _eval(y_true, y_prob_panel),
        "constant_rate": _eval(y_true, y_prob_const),
    }


def main() -> None:
    args = parse_args_with_common("Compute DPPI baseline metrics", extra_args=_extra_args)
    cfg = RuntimeConfig.load(args.config, region=args.region, surface_name=args.surface_name, artifacts_dir=args.artifacts_dir)
    lookback_days = max(30, int(args.lookback_days))
    task_type = str(args.task_type)

    with open_db() as conn:
        frame = _load_frame(conn, task_type, cfg.region, cfg.surface_name, lookback_days)
        if frame.empty:
            raise RuntimeError("No data available to compute baseline metrics")

        metrics_by_horizon: dict[str, dict[str, Any]] = {}
        for hz in _horizons(task_type, cfg):
            col = _target_col(task_type, hz)
            if col not in frame.columns:
                continue
            result = _compute_baseline_for_horizon(
                frame,
                target_col=col,
                valid_days=cfg.validation_days,
                test_days=cfg.test_days,
            )
            metrics_by_horizon[hz] = result["panel_rate"]

        payload = {
            "generated_at": utc_now_iso(),
            "task_type": task_type,
            "region": cfg.region,
            "surface_name": cfg.surface_name,
            "lookback_days": lookback_days,
            "metrics_by_horizon": metrics_by_horizon,
            "notes": "Baseline = panel historical positive rate (fallback global mean)",
        }

        if bool(args.write_registry):
            upsert_model_registry(
                conn,
                model_name=str(args.model_name),
                model_version=str(args.model_version),
                task_type=task_type,
                status="draft",
                metrics_json=payload,
                artifacts_uri=None,
                set_trained_at=False,
            )

    out_path = Path(args.output) if args.output else (cfg.artifacts_dir / "reports" / f"baseline_{task_type}_{cfg.region}_{cfg.surface_name}.json")
    save_json(out_path, payload)

    print("[DPPI] baseline metrics")
    print(json.dumps(payload, ensure_ascii=True, indent=2))
    print("output:", out_path)
    if bool(args.write_registry):
        print("registry_upsert:", str(args.model_name), str(args.model_version))


if __name__ == "__main__":
    main()
