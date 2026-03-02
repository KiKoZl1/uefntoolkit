#!/usr/bin/env python3
"""Shared runtime helpers for DPPI ML scripts."""

from __future__ import annotations

import argparse
import json
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Sequence

import pandas as pd
import psycopg
import yaml


ROOT_DIR = Path(__file__).resolve().parent
DEFAULT_CONFIG_PATH = ROOT_DIR / "configs" / "base.yaml"
DEFAULT_ARTIFACTS_DIR = ROOT_DIR / "artifacts"


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def utc_now_iso() -> str:
    return utc_now().isoformat()


def parse_args_with_common(
    description: str,
    extra_args: callable | None = None,
) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument("--config", default=str(DEFAULT_CONFIG_PATH), help="Path to YAML config")
    parser.add_argument("--region", default=None, help="Override region")
    parser.add_argument("--surface-name", default=None, help="Override surface name")
    parser.add_argument("--artifacts-dir", default=None, help="Override artifacts output directory")
    if extra_args:
        extra_args(parser)
    return parser.parse_args()


@dataclass
class RuntimeConfig:
    project: str
    region: str
    surface_name: str
    min_days: int
    validation_days: int
    test_days: int
    random_seed: int
    optimize_for: str
    entry_horizons: list[str]
    survival_horizons: list[str]
    artifacts_dir: Path
    model_params: dict[str, Any]
    gates: dict[str, float]

    @staticmethod
    def load(config_path: str | Path, region: str | None = None, surface_name: str | None = None, artifacts_dir: str | None = None) -> "RuntimeConfig":
        with Path(config_path).open("r", encoding="utf-8") as handle:
            raw = yaml.safe_load(handle) or {}

        split = raw.get("split", {}) or {}
        models = raw.get("models", {}) or {}
        training = raw.get("training", {}) or {}
        gates = raw.get("gates", {}) or {}

        out_dir = Path(artifacts_dir or raw.get("artifacts_dir") or DEFAULT_ARTIFACTS_DIR).resolve()
        out_dir.mkdir(parents=True, exist_ok=True)

        return RuntimeConfig(
            project=str(raw.get("project", "dppi")),
            region=str(region or raw.get("region", "NAE")),
            surface_name=str(surface_name or raw.get("surface_name", "CreativeDiscoverySurface_Frontend")),
            min_days=int(split.get("min_days", 60)),
            validation_days=int(split.get("validation_days", 14)),
            test_days=int(split.get("test_days", 14)),
            random_seed=int(training.get("random_seed", 42)),
            optimize_for=str(training.get("optimize_for", "brier")),
            entry_horizons=[str(v) for v in (models.get("entry", {}) or {}).get("horizons", ["2h", "5h", "12h"])],
            survival_horizons=[str(v) for v in (models.get("survival", {}) or {}).get("horizons", ["30m", "60m", "replace_lt_30m"])],
            artifacts_dir=out_dir,
            model_params=dict(training.get("catboost_params", {})),
            gates={
                "pr_auc_drop_max_pct": float(gates.get("pr_auc_drop_max_pct", 5.0)),
                "precision_at_20_drop_max_pct": float(gates.get("precision_at_20_drop_max_pct", 10.0)),
                "brier_worse_max_pct": float(gates.get("brier_worse_max_pct", 15.0)),
                "ece_max": float(gates.get("ece_max", 0.15)),
                "psi_max": float(gates.get("psi_max", 0.25)),
            },
        )


def get_db_dsn() -> str:
    dsn = os.getenv("SUPABASE_DB_URL") or os.getenv("DATABASE_URL")
    if not dsn:
        raise RuntimeError("Missing SUPABASE_DB_URL or DATABASE_URL for DPPI scripts")
    return dsn


def open_db() -> psycopg.Connection:
    conn = psycopg.connect(get_db_dsn())
    assume_service = os.getenv("DPPI_DB_ASSUME_SERVICE_ROLE", "1").strip().lower() not in {"0", "false", "no"}
    if assume_service:
        with conn.cursor() as cur:
            cur.execute("select set_config('request.jwt.claim.role', 'service_role', false)")
    return conn


def query_df(conn: psycopg.Connection, sql: str, params: Sequence[Any] | None = None) -> pd.DataFrame:
    with conn.cursor() as cur:
        cur.execute(sql, params or [])
        rows = cur.fetchall()
        if cur.description is None:
            return pd.DataFrame()
        columns = [col.name for col in cur.description]
    return pd.DataFrame(rows, columns=columns)


def scalar_json(conn: psycopg.Connection, sql: str, params: Sequence[Any] | None = None) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute(sql, params or [])
        row = cur.fetchone()
    if not row:
        return {}
    value = row[0]
    return value if isinstance(value, dict) else {}


def exec_sql(conn: psycopg.Connection, sql: str, params: Sequence[Any] | None = None) -> None:
    with conn.cursor() as cur:
        cur.execute(sql, params or [])
    conn.commit()


def mkdir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path


def save_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=True, indent=2)


def bool_ratio(values: Iterable[bool]) -> float:
    values_list = list(values)
    if not values_list:
        return 0.0
    return float(sum(1 for v in values_list if v) / len(values_list))
