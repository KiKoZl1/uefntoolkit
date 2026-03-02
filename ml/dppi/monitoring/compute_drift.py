#!/usr/bin/env python3
"""Compute DPPI feature drift metrics (PSI/KS) and persist to dppi_drift_metrics."""

from __future__ import annotations

import math
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from runtime import open_db, parse_args_with_common, query_df


FEATURES = [
    "ccu_avg",
    "ccu_max",
    "entries_1h",
    "exits_1h",
    "replacements_1h",
    "exposure_minutes_1h",
]


def _extra_args(parser) -> None:
    parser.add_argument("--model-name", required=True)
    parser.add_argument("--model-version", required=True)
    parser.add_argument("--region", default="NAE")
    parser.add_argument("--surface-name", default="CreativeDiscoverySurface_Frontend")
    parser.add_argument("--window-hours", type=int, default=24)
    parser.add_argument("--baseline-shift-hours", type=int, default=168, help="Offset for baseline window (default: 7d)")


def _quantile_bins(ref: np.ndarray, bins: int = 10) -> np.ndarray:
    q = np.linspace(0.0, 1.0, bins + 1)
    edges = np.quantile(ref, q)
    edges[0] = -np.inf
    edges[-1] = np.inf
    for i in range(1, len(edges)):
        if edges[i] <= edges[i - 1]:
            edges[i] = edges[i - 1] + 1e-9
    return edges


def _psi(expected: np.ndarray, actual: np.ndarray, bins: int = 10) -> float:
    if expected.size == 0 or actual.size == 0:
        return 0.0
    edges = _quantile_bins(expected, bins=bins)
    exp_hist, _ = np.histogram(expected, bins=edges)
    act_hist, _ = np.histogram(actual, bins=edges)
    exp_dist = np.clip(exp_hist / max(1, exp_hist.sum()), 1e-6, 1)
    act_dist = np.clip(act_hist / max(1, act_hist.sum()), 1e-6, 1)
    return float(np.sum((act_dist - exp_dist) * np.log(act_dist / exp_dist)))


def _ks(x: np.ndarray, y: np.ndarray) -> float:
    if x.size == 0 or y.size == 0:
        return 0.0
    x_sorted = np.sort(x)
    y_sorted = np.sort(y)
    values = np.sort(np.concatenate([x_sorted, y_sorted]))
    cdf_x = np.searchsorted(x_sorted, values, side="right") / x_sorted.size
    cdf_y = np.searchsorted(y_sorted, values, side="right") / y_sorted.size
    return float(np.max(np.abs(cdf_x - cdf_y)))


def _drift_level(psi_value: float) -> str:
    if psi_value >= 0.25:
        return "high"
    if psi_value >= 0.10:
        return "medium"
    return "low"


def main() -> None:
    args = parse_args_with_common("Compute DPPI drift metrics", extra_args=_extra_args)
    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    window = timedelta(hours=max(1, int(args.window_hours)))
    baseline_shift = timedelta(hours=max(1, int(args.baseline_shift_hours)))

    current_from = now - window
    current_to = now
    baseline_to = now - baseline_shift
    baseline_from = baseline_to - window

    with open_db() as conn:
        current = query_df(
            conn,
            """
            select ccu_avg, ccu_max, entries_1h, exits_1h, replacements_1h, exposure_minutes_1h
            from public.dppi_feature_store_hourly
            where region = %s
              and surface_name = %s
              and as_of_bucket >= %s
              and as_of_bucket < %s
            """,
            [args.region, args.surface_name, current_from, current_to],
        )
        baseline = query_df(
            conn,
            """
            select ccu_avg, ccu_max, entries_1h, exits_1h, replacements_1h, exposure_minutes_1h
            from public.dppi_feature_store_hourly
            where region = %s
              and surface_name = %s
              and as_of_bucket >= %s
              and as_of_bucket < %s
            """,
            [args.region, args.surface_name, baseline_from, baseline_to],
        )

        if current.empty or baseline.empty:
            raise RuntimeError("insufficient rows for drift computation")

        rows = []
        for feature in FEATURES:
            x = baseline[feature].astype(float).to_numpy()
            y = current[feature].astype(float).to_numpy()
            psi_val = _psi(x, y)
            ks_val = _ks(x, y)
            level = _drift_level(psi_val)
            rows.append((feature, psi_val, ks_val, level))

        with conn.cursor() as cur:
            cur.executemany(
                """
                insert into public.dppi_drift_metrics (
                  measured_at, model_name, model_version, feature_name, psi, ks, drift_level, created_at
                ) values (now(), %s, %s, %s, %s, %s, %s, now())
                """,
                [[args.model_name, args.model_version, feat, psi_val, ks_val, level] for feat, psi_val, ks_val, level in rows],
            )
        conn.commit()

    print("[DPPI] drift metrics computed")
    for feat, psi_val, ks_val, level in rows:
        print(f"- {feat}: psi={psi_val:.4f} ks={ks_val:.4f} level={level}")


if __name__ == "__main__":
    main()
