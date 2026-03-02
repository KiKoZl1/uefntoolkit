#!/usr/bin/env python3
"""ML and SQL helpers for DPPI model lifecycle."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
import psycopg
from catboost import CatBoostClassifier
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, log_loss, roc_auc_score, brier_score_loss

from runtime import query_df, scalar_json, utc_now, utc_now_iso


@dataclass
class SplitData:
    train: pd.DataFrame
    valid: pd.DataFrame
    test: pd.DataFrame


def temporal_split(df: pd.DataFrame, ts_col: str, valid_days: int, test_days: int) -> SplitData:
    if df.empty:
        return SplitData(df.copy(), df.copy(), df.copy())

    ordered = df.sort_values(ts_col).reset_index(drop=True)
    ts = pd.to_datetime(ordered[ts_col], utc=True)
    max_ts = ts.max()
    test_start = max_ts - pd.Timedelta(days=max(1, test_days))
    valid_start = test_start - pd.Timedelta(days=max(1, valid_days))

    train = ordered[ts < valid_start].copy()
    valid = ordered[(ts >= valid_start) & (ts < test_start)].copy()
    test = ordered[ts >= test_start].copy()

    if train.empty or valid.empty or test.empty:
        n = len(ordered)
        train_end = max(1, int(n * 0.7))
        valid_end = max(train_end + 1, int(n * 0.85))
        train = ordered.iloc[:train_end].copy()
        valid = ordered.iloc[train_end:valid_end].copy()
        test = ordered.iloc[valid_end:].copy()

    return SplitData(train=train, valid=valid, test=test)


def safe_metric_auc_pr(y_true: np.ndarray, y_prob: np.ndarray) -> float:
    if len(np.unique(y_true)) < 2:
        return 0.0
    return float(average_precision_score(y_true, y_prob))


def safe_metric_auc_roc(y_true: np.ndarray, y_prob: np.ndarray) -> float:
    if len(np.unique(y_true)) < 2:
        return 0.0
    return float(roc_auc_score(y_true, y_prob))


def safe_metric_logloss(y_true: np.ndarray, y_prob: np.ndarray) -> float:
    y_prob = np.clip(y_prob, 1e-6, 1 - 1e-6)
    if len(np.unique(y_true)) < 2:
        return 0.0
    return float(log_loss(y_true, y_prob, labels=[0, 1]))


def safe_metric_brier(y_true: np.ndarray, y_prob: np.ndarray) -> float:
    y_prob = np.clip(y_prob, 1e-6, 1 - 1e-6)
    return float(brier_score_loss(y_true, y_prob))


def precision_at_k(y_true: np.ndarray, y_prob: np.ndarray, k: int) -> float:
    if y_true.size == 0:
        return 0.0
    k_eff = max(1, min(int(k), int(y_true.size)))
    order = np.argsort(-y_prob)
    top_idx = order[:k_eff]
    return float(np.mean(y_true[top_idx].astype(float)))


def expected_calibration_error(y_true: np.ndarray, y_prob: np.ndarray, bins: int = 10) -> float:
    y_prob = np.clip(y_prob, 1e-6, 1 - 1e-6)
    edges = np.linspace(0.0, 1.0, bins + 1)
    total = 0.0
    n = len(y_true)
    if n == 0:
        return 0.0
    for i in range(bins):
        lo, hi = edges[i], edges[i + 1]
        if i == bins - 1:
            mask = (y_prob >= lo) & (y_prob <= hi)
        else:
            mask = (y_prob >= lo) & (y_prob < hi)
        if not np.any(mask):
            continue
        p_bin = y_prob[mask]
        y_bin = y_true[mask]
        conf = float(np.mean(p_bin))
        acc = float(np.mean(y_bin))
        total += (len(y_bin) / n) * abs(acc - conf)
    return float(total)


def fit_catboost_binary(
    train_df: pd.DataFrame,
    valid_df: pd.DataFrame,
    feature_cols: list[str],
    target_col: str,
    seed: int,
    model_params: dict[str, Any] | None = None,
) -> CatBoostClassifier:
    params = {
        "iterations": 600,
        "depth": 6,
        "learning_rate": 0.05,
        "loss_function": "Logloss",
        "eval_metric": "AUC",
        "random_seed": seed,
        "verbose": False,
        "auto_class_weights": "Balanced",
        "allow_writing_files": False,
    }
    if model_params:
        params.update(model_params)

    cat_features = [idx for idx, col in enumerate(feature_cols) if train_df[col].dtype == "object"]

    model = CatBoostClassifier(**params)
    model.fit(
        train_df[feature_cols],
        train_df[target_col].astype(int),
        eval_set=(valid_df[feature_cols], valid_df[target_col].astype(int)),
        cat_features=cat_features if cat_features else None,
        use_best_model=True,
    )
    return model


def evaluate_binary_model(model: CatBoostClassifier, data: pd.DataFrame, feature_cols: list[str], target_col: str) -> dict[str, float]:
    y_true = data[target_col].astype(int).to_numpy()
    y_prob = model.predict_proba(data[feature_cols])[:, 1]
    return {
        "auc_pr": safe_metric_auc_pr(y_true, y_prob),
        "auc_roc": safe_metric_auc_roc(y_true, y_prob),
        "precision_at_20": precision_at_k(y_true, y_prob, 20),
        "precision_at_50": precision_at_k(y_true, y_prob, 50),
        "brier": safe_metric_brier(y_true, y_prob),
        "logloss": safe_metric_logloss(y_true, y_prob),
        "ece": expected_calibration_error(y_true, y_prob),
    }


def fit_platt(y_prob: np.ndarray, y_true: np.ndarray) -> LogisticRegression:
    model = LogisticRegression(max_iter=200)
    model.fit(y_prob.reshape(-1, 1), y_true.astype(int))
    return model


def fit_isotonic(y_prob: np.ndarray, y_true: np.ndarray) -> IsotonicRegression:
    model = IsotonicRegression(out_of_bounds="clip")
    model.fit(y_prob, y_true.astype(int))
    return model


def apply_calibrator(calibrator: Any, method: str, y_prob: np.ndarray) -> np.ndarray:
    if method == "platt":
        calibrated = calibrator.predict_proba(y_prob.reshape(-1, 1))[:, 1]
    elif method == "isotonic":
        calibrated = calibrator.predict(y_prob)
    else:
        calibrated = y_prob
    return np.clip(calibrated, 1e-6, 1 - 1e-6)


def pick_best_calibrator(
    valid_true: np.ndarray,
    valid_prob: np.ndarray,
    test_true: np.ndarray,
    test_prob: np.ndarray,
) -> tuple[str, Any, dict[str, float]]:
    candidates: list[tuple[str, Any, dict[str, float]]] = []

    try:
        platt = fit_platt(valid_prob, valid_true)
        platt_prob = apply_calibrator(platt, "platt", test_prob)
        candidates.append(
            (
                "platt",
                platt,
                {
                    "brier": safe_metric_brier(test_true, platt_prob),
                    "logloss": safe_metric_logloss(test_true, platt_prob),
                    "ece": expected_calibration_error(test_true, platt_prob),
                },
            )
        )
    except Exception:
        pass

    try:
        isotonic = fit_isotonic(valid_prob, valid_true)
        iso_prob = apply_calibrator(isotonic, "isotonic", test_prob)
        candidates.append(
            (
                "isotonic",
                isotonic,
                {
                    "brier": safe_metric_brier(test_true, iso_prob),
                    "logloss": safe_metric_logloss(test_true, iso_prob),
                    "ece": expected_calibration_error(test_true, iso_prob),
                },
            )
        )
    except Exception:
        pass

    if not candidates:
        return "none", None, {
            "brier": safe_metric_brier(test_true, test_prob),
            "logloss": safe_metric_logloss(test_true, test_prob),
            "ece": expected_calibration_error(test_true, test_prob),
        }

    best = sorted(candidates, key=lambda item: (item[2]["brier"], item[2]["logloss"]))[0]
    return best


def write_model_artifact(model: CatBoostClassifier, base_dir: Path, model_name: str, model_version: str, horizon: str) -> Path:
    model_dir = base_dir / "models" / model_name / model_version
    model_dir.mkdir(parents=True, exist_ok=True)
    model_path = model_dir / f"{horizon}.cbm"
    model.save_model(str(model_path))
    return model_path


def write_calibrator_artifact(calibrator: Any, method: str, base_dir: Path, model_name: str, model_version: str, horizon: str) -> Path | None:
    if calibrator is None or method == "none":
        return None
    cal_dir = base_dir / "calibrators" / model_name / model_version
    cal_dir.mkdir(parents=True, exist_ok=True)
    path = cal_dir / f"{horizon}_{method}.joblib"
    joblib.dump(calibrator, path)
    return path


def load_model_artifact(base_dir: Path, model_name: str, model_version: str, horizon: str) -> CatBoostClassifier:
    path = base_dir / "models" / model_name / model_version / f"{horizon}.cbm"
    if not path.exists():
        raise FileNotFoundError(f"Model artifact not found: {path}")
    model = CatBoostClassifier()
    model.load_model(str(path))
    return model


def load_calibrator_artifact(base_dir: Path, model_name: str, model_version: str, horizon: str) -> tuple[str, Any]:
    cal_dir = base_dir / "calibrators" / model_name / model_version
    if not cal_dir.exists():
        return "none", None

    isotonic_path = cal_dir / f"{horizon}_isotonic.joblib"
    if isotonic_path.exists():
        return "isotonic", joblib.load(isotonic_path)

    platt_path = cal_dir / f"{horizon}_platt.joblib"
    if platt_path.exists():
        return "platt", joblib.load(platt_path)

    return "none", None


def as_confidence_bucket(score: float) -> str:
    if score >= 0.75:
        return "high"
    if score >= 0.45:
        return "medium"
    return "low"


def get_training_readiness(conn: psycopg.Connection, region: str, surface_name: str, min_days: int) -> dict[str, Any]:
    return scalar_json(
        conn,
        "select public.dppi_training_readiness(%s,%s,%s)",
        [region, surface_name, min_days],
    )


def create_or_mark_training_run(
    conn: psycopg.Connection,
    run_id: int | None,
    *,
    task_type: str,
    model_name: str,
    model_version: str,
    payload: dict[str, Any],
) -> int:
    if run_id is not None:
        with conn.cursor() as cur:
            cur.execute(
                """
                update public.dppi_training_log
                   set status = 'running',
                       started_at = now(),
                       payload_json = coalesce(payload_json,'{}'::jsonb) || %s::jsonb,
                       updated_at = now()
                 where id = %s
                """,
                [json.dumps(payload), run_id],
            )
        conn.commit()
        return int(run_id)

    with conn.cursor() as cur:
        cur.execute(
            """
            insert into public.dppi_training_log (
              requested_at, started_at, status, model_name, model_version, task_type,
              requested_by, worker_host, payload_json, result_json, created_at, updated_at
            )
            values (
              now(), now(), 'running', %s, %s, %s,
              null, %s, %s::jsonb, '{}'::jsonb, now(), now()
            )
            returning id
            """,
            [model_name, model_version, task_type, os.getenv("HOSTNAME", "local-worker"), json.dumps(payload)],
        )
        new_id = cur.fetchone()[0]
    conn.commit()
    return int(new_id)


def finish_training_run(
    conn: psycopg.Connection,
    run_id: int,
    *,
    status: str,
    result_json: dict[str, Any] | None = None,
    error_text: str | None = None,
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            update public.dppi_training_log
               set status = %s,
                   ended_at = now(),
                   result_json = %s::jsonb,
                   error_text = %s,
                   updated_at = now()
             where id = %s
            """,
            [status, json.dumps(result_json or {}), error_text, run_id],
        )
    conn.commit()


def upsert_model_registry(
    conn: psycopg.Connection,
    *,
    model_name: str,
    model_version: str,
    task_type: str,
    status: str,
    metrics_json: dict[str, Any],
    artifacts_uri: str | None,
    set_trained_at: bool = False,
) -> None:
    trained_expr = "now()" if set_trained_at else "null"
    with conn.cursor() as cur:
        cur.execute(
            f"""
            insert into public.dppi_model_registry (
              model_name, model_version, task_type, status, metrics_json, artifacts_uri, trained_at, updated_at
            )
            values (%s, %s, %s, %s, %s::jsonb, %s, {trained_expr}, now())
            on conflict (model_name, model_version)
            do update set
              task_type = excluded.task_type,
              status = excluded.status,
              metrics_json = excluded.metrics_json,
              artifacts_uri = excluded.artifacts_uri,
              trained_at = case when {str(set_trained_at).lower()} then now() else public.dppi_model_registry.trained_at end,
              updated_at = now()
            """,
            [model_name, model_version, task_type, status, json.dumps(metrics_json), artifacts_uri],
        )
    conn.commit()


def load_entry_dataset(conn: psycopg.Connection, region: str, surface_name: str, lookback_days: int = 365) -> pd.DataFrame:
    return query_df(
        conn,
        """
        select
          h.as_of_bucket as ts,
          h.target_id::text as target_id,
          h.region,
          h.surface_name,
          h.panel_name,
          h.island_code,
          coalesce(h.ccu_avg, 0)::double precision as ccu_avg,
          coalesce(h.ccu_max, 0)::double precision as ccu_max,
          coalesce(h.entries_1h, 0)::double precision as entries_1h,
          coalesce(h.exits_1h, 0)::double precision as exits_1h,
          coalesce(h.replacements_1h, 0)::double precision as replacements_1h,
          coalesce(h.exposure_minutes_1h, 0)::double precision as exposure_minutes_1h,
          coalesce((s.payload_json ->> 'panel_avg_ccu')::double precision, 0) as panel_avg_ccu,
          coalesce((s.payload_json #>> '{keep_alive_targets,ccu_min}')::double precision, 0) as keep_alive_ccu_min,
          (l.enter_2h)::int as y_2h,
          (l.enter_5h)::int as y_5h,
          (l.enter_12h)::int as y_12h
        from public.dppi_feature_store_hourly h
        join public.dppi_labels_entry l
          on l.as_of_bucket = h.as_of_bucket
         and l.target_id = h.target_id
         and l.panel_name = h.panel_name
         and l.island_code = h.island_code
        left join public.discovery_panel_intel_snapshot s
          on s.target_id = h.target_id
         and s.panel_name = h.panel_name
         and s.window_days = 14
        where h.region = %s
          and h.surface_name = %s
          and h.as_of_bucket >= now() - (%s::text || ' days')::interval
        order by h.as_of_bucket asc
        """,
        [region, surface_name, lookback_days],
    )


def load_survival_dataset(conn: psycopg.Connection, region: str, surface_name: str, lookback_days: int = 365) -> pd.DataFrame:
    return query_df(
        conn,
        """
        select
          date_trunc('hour', l.stint_start) as ts,
          l.target_id::text as target_id,
          t.region,
          t.surface_name,
          l.panel_name,
          l.island_code,
          coalesce(h.ccu_avg, 0)::double precision as ccu_avg,
          coalesce(h.ccu_max, 0)::double precision as ccu_max,
          coalesce(h.entries_1h, 0)::double precision as entries_1h,
          coalesce(h.exits_1h, 0)::double precision as exits_1h,
          coalesce(h.replacements_1h, 0)::double precision as replacements_1h,
          coalesce(h.exposure_minutes_1h, 0)::double precision as exposure_minutes_1h,
          coalesce((s.payload_json ->> 'panel_avg_ccu')::double precision, 0) as panel_avg_ccu,
          coalesce((s.payload_json #>> '{keep_alive_targets,ccu_min}')::double precision, 0) as keep_alive_ccu_min,
          coalesce(l.duration_minutes, 0)::double precision as duration_minutes,
          (l.stay_30m)::int as y_30m,
          (l.stay_60m)::int as y_60m,
          (l.replaced_lt_30m)::int as y_replace_lt_30m
        from public.dppi_labels_survival l
        join public.discovery_exposure_targets t
          on t.id = l.target_id
        left join public.dppi_feature_store_hourly h
          on h.target_id = l.target_id
         and h.panel_name = l.panel_name
         and h.island_code = l.island_code
         and h.as_of_bucket = date_trunc('hour', l.stint_start)
        left join public.discovery_panel_intel_snapshot s
          on s.target_id = l.target_id
         and s.panel_name = l.panel_name
         and s.window_days = 14
        where t.region = %s
          and t.surface_name = %s
          and l.stint_start >= now() - (%s::text || ' days')::interval
        order by l.stint_start asc
        """,
        [region, surface_name, lookback_days],
    )


def upsert_dataset_meta(conn: psycopg.Connection, dataset_type: str, start_ts: datetime, end_ts: datetime, sample_count: int, status: str, metadata: dict[str, Any]) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into public.dppi_training_dataset_meta (
              dataset_type, range_start, range_end, sample_count, status, metadata_json, created_at, updated_at
            ) values (%s, %s, %s, %s, %s, %s::jsonb, now(), now())
            """,
            [dataset_type, start_ts, end_ts, int(sample_count), status, json.dumps(metadata)],
        )
    conn.commit()


def insert_calibration_metric(
    conn: psycopg.Connection,
    *,
    model_name: str,
    model_version: str,
    task_type: str,
    horizon: str,
    brier: float,
    logloss: float,
    ece: float,
    method: str,
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into public.dppi_calibration_metrics (
              measured_at, model_name, model_version, task_type, prediction_horizon, brier, logloss, ece, calibration_method, created_at
            ) values (now(), %s, %s, %s, %s, %s, %s, %s, %s, now())
            """,
            [model_name, model_version, task_type, horizon, brier, logloss, ece, method],
        )
    conn.commit()


def get_release_model(conn: psycopg.Connection, task_type: str, channel: str = "production") -> dict[str, Any] | None:
    df = query_df(
        conn,
        """
        select m.model_name, m.model_version, m.task_type, m.artifacts_uri
        from public.dppi_release_channels rc
        join public.dppi_model_registry m
          on m.model_name = rc.model_name
         and m.model_version = rc.model_version
        where rc.channel_name = %s
          and m.task_type = %s
        limit 1
        """,
        [channel, task_type],
    )
    if df.empty:
        return None
    return df.iloc[0].to_dict()


def load_inference_features(conn: psycopg.Connection, region: str, surface_name: str, as_of_bucket: datetime) -> pd.DataFrame:
    bucket = as_of_bucket.replace(minute=0, second=0, microsecond=0, tzinfo=timezone.utc)
    return query_df(
        conn,
        """
        select
          h.as_of_bucket,
          h.target_id::text as target_id,
          h.region,
          h.surface_name,
          h.panel_name,
          h.island_code,
          coalesce(h.ccu_avg, 0)::double precision as ccu_avg,
          coalesce(h.ccu_max, 0)::double precision as ccu_max,
          coalesce(h.entries_1h, 0)::double precision as entries_1h,
          coalesce(h.exits_1h, 0)::double precision as exits_1h,
          coalesce(h.replacements_1h, 0)::double precision as replacements_1h,
          coalesce(h.exposure_minutes_1h, 0)::double precision as exposure_minutes_1h,
          coalesce((s.payload_json ->> 'panel_avg_ccu')::double precision, 0) as panel_avg_ccu,
          coalesce((s.payload_json #>> '{keep_alive_targets,ccu_min}')::double precision, 0) as keep_alive_ccu_min
        from public.dppi_feature_store_hourly h
        left join public.discovery_panel_intel_snapshot s
          on s.target_id = h.target_id
         and s.panel_name = h.panel_name
         and s.window_days = 14
        where h.region = %s
          and h.surface_name = %s
          and h.as_of_bucket = %s
        order by h.panel_name, h.ccu_avg desc, h.island_code
        """,
        [region, surface_name, bucket],
    )


def insert_prediction_rows(
    conn: psycopg.Connection,
    table: str,
    rows: list[dict[str, Any]],
) -> int:
    if not rows:
        return 0

    if table not in {"dppi_predictions", "dppi_survival_predictions"}:
        raise ValueError(f"Unexpected prediction table: {table}")

    sql = f"""
    insert into public.{table} (
      generated_at, as_of_bucket, target_id, region, surface_name, panel_name, island_code,
      prediction_horizon, score, confidence_bucket, model_name, model_version, evidence_json, created_at
    ) values (
      %s, %s, %s::uuid, %s, %s, %s, %s,
      %s, %s, %s, %s, %s, %s::jsonb, now()
    )
    on conflict (target_id, panel_name, island_code, prediction_horizon, as_of_bucket)
    do update set
      generated_at = excluded.generated_at,
      score = excluded.score,
      confidence_bucket = excluded.confidence_bucket,
      model_name = excluded.model_name,
      model_version = excluded.model_version,
      evidence_json = excluded.evidence_json
    """

    values = [
        [
            row["generated_at"],
            row["as_of_bucket"],
            row["target_id"],
            row["region"],
            row["surface_name"],
            row["panel_name"],
            row["island_code"],
            row["prediction_horizon"],
            float(row["score"]),
            row["confidence_bucket"],
            row.get("model_name"),
            row.get("model_version"),
            json.dumps(row.get("evidence_json") or {}),
        ]
        for row in rows
    ]

    with conn.cursor() as cur:
        cur.executemany(sql, values)
    conn.commit()
    return len(rows)


def log_inference(
    conn: psycopg.Connection,
    *,
    mode: str,
    target_scope: dict[str, Any],
    processed_rows: int,
    failed_rows: int,
    model_name: str | None,
    model_version: str | None,
    error_text: str | None = None,
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into public.dppi_inference_log (
              ts, mode, target_scope, processed_rows, failed_rows, latency_ms,
              model_name, model_version, error_text, created_at
            ) values (
              now(), %s, %s::jsonb, %s, %s, null,
              %s, %s, %s, now()
            )
            """,
            [mode, json.dumps(target_scope), processed_rows, failed_rows, model_name, model_version, error_text],
        )
    conn.commit()


def call_materialize_opportunities(conn: psycopg.Connection, region: str, surface_name: str, as_of_bucket: datetime) -> dict[str, Any]:
    return scalar_json(
        conn,
        "select public.materialize_dppi_opportunities(NULL,%s,%s,NULL,%s)",
        [region, surface_name, as_of_bucket],
    )
