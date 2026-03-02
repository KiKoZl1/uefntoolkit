#!/usr/bin/env python3
"""Audit DPPI label coverage, balance and freshness for pre-train readiness."""

from __future__ import annotations

import json
from pathlib import Path
import sys
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from runtime import RuntimeConfig, open_db, parse_args_with_common, query_df, save_json, utc_now_iso


def _extra_args(parser) -> None:
    parser.add_argument("--lookback-days", type=int, default=30)
    parser.add_argument("--min-entry-rows", type=int, default=5000)
    parser.add_argument("--min-survival-rows", type=int, default=3000)
    parser.add_argument("--min-positive-rate", type=float, default=0.002)
    parser.add_argument("--max-positive-rate", type=float, default=0.98)
    parser.add_argument("--output", default=None, help="Optional explicit output .json path")
    parser.add_argument("--fail-on-issues", action="store_true")


def _entry_stats(conn, region: str, surface_name: str, lookback_days: int):
    return query_df(
        conn,
        """
        with base as (
          select
            l.enter_2h::int as y_2h,
            l.enter_5h::int as y_5h,
            l.enter_12h::int as y_12h
          from public.dppi_labels_entry l
          join public.discovery_exposure_targets t on t.id = l.target_id
          where t.region = %s
            and t.surface_name = %s
            and l.as_of_bucket >= now() - (%s::text || ' days')::interval
        )
        select
          count(*)::bigint as rows,
          avg(y_2h)::double precision as pos_rate_2h,
          avg(y_5h)::double precision as pos_rate_5h,
          avg(y_12h)::double precision as pos_rate_12h
        from base
        """,
        [region, surface_name, lookback_days],
    )


def _survival_stats(conn, region: str, surface_name: str, lookback_days: int):
    return query_df(
        conn,
        """
        with base as (
          select
            l.stay_30m::int as y_30m,
            l.stay_60m::int as y_60m,
            l.replaced_lt_30m::int as y_replace_lt_30m
          from public.dppi_labels_survival l
          join public.discovery_exposure_targets t on t.id = l.target_id
          where t.region = %s
            and t.surface_name = %s
            and l.stint_start >= now() - (%s::text || ' days')::interval
        )
        select
          count(*)::bigint as rows,
          avg(y_30m)::double precision as pos_rate_30m,
          avg(y_60m)::double precision as pos_rate_60m,
          avg(y_replace_lt_30m)::double precision as pos_rate_replace_lt_30m
        from base
        """,
        [region, surface_name, lookback_days],
    )


def _freshness(conn, region: str, surface_name: str):
    return query_df(
        conn,
        """
        select
          (select max(as_of_bucket) from public.dppi_feature_store_hourly where region = %s and surface_name = %s) as hourly_max,
          (select max(as_of) from public.dppi_feature_store_daily where region = %s and surface_name = %s) as daily_max,
          (select max(as_of_bucket) from public.dppi_labels_entry le join public.discovery_exposure_targets t on t.id = le.target_id where t.region = %s and t.surface_name = %s) as entry_label_max,
          (select max(stint_start) from public.dppi_labels_survival ls join public.discovery_exposure_targets t on t.id = ls.target_id where t.region = %s and t.surface_name = %s) as survival_label_max
        """,
        [region, surface_name, region, surface_name, region, surface_name, region, surface_name],
    )


def _check_rate(name: str, value: float, lo: float, hi: float, issues: list[str]) -> None:
    if value < lo:
        issues.append(f"{name}: positive rate too low ({value:.4f} < {lo:.4f})")
    if value > hi:
        issues.append(f"{name}: positive rate too high ({value:.4f} > {hi:.4f})")


def _jsonable_row(row: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k, v in row.items():
        if hasattr(v, "isoformat"):
            try:
                out[str(k)] = v.isoformat()
                continue
            except Exception:
                pass
        out[str(k)] = v
    return out


def main() -> None:
    args = parse_args_with_common("Audit DPPI labels", extra_args=_extra_args)
    cfg = RuntimeConfig.load(args.config, region=args.region, surface_name=args.surface_name, artifacts_dir=args.artifacts_dir)

    lookback_days = max(7, int(args.lookback_days))
    issues: list[str] = []

    with open_db() as conn:
        entry = _entry_stats(conn, cfg.region, cfg.surface_name, lookback_days)
        survival = _survival_stats(conn, cfg.region, cfg.surface_name, lookback_days)
        fresh = _freshness(conn, cfg.region, cfg.surface_name)

    entry_row: dict[str, Any] = _jsonable_row(entry.iloc[0].to_dict() if not entry.empty else {})
    survival_row: dict[str, Any] = _jsonable_row(survival.iloc[0].to_dict() if not survival.empty else {})
    fresh_row: dict[str, Any] = _jsonable_row(fresh.iloc[0].to_dict() if not fresh.empty else {})

    entry_rows = int(entry_row.get("rows") or 0)
    survival_rows = int(survival_row.get("rows") or 0)
    if entry_rows < int(args.min_entry_rows):
        issues.append(f"entry labels rows below minimum ({entry_rows} < {int(args.min_entry_rows)})")
    if survival_rows < int(args.min_survival_rows):
        issues.append(f"survival labels rows below minimum ({survival_rows} < {int(args.min_survival_rows)})")

    lo = float(args.min_positive_rate)
    hi = float(args.max_positive_rate)
    _check_rate("entry_2h", float(entry_row.get("pos_rate_2h") or 0.0), lo, hi, issues)
    _check_rate("entry_5h", float(entry_row.get("pos_rate_5h") or 0.0), lo, hi, issues)
    _check_rate("entry_12h", float(entry_row.get("pos_rate_12h") or 0.0), lo, hi, issues)
    _check_rate("survival_30m", float(survival_row.get("pos_rate_30m") or 0.0), lo, hi, issues)
    _check_rate("survival_60m", float(survival_row.get("pos_rate_60m") or 0.0), lo, hi, issues)
    _check_rate("survival_replace_lt_30m", float(survival_row.get("pos_rate_replace_lt_30m") or 0.0), lo, hi, issues)

    payload = {
        "as_of": utc_now_iso(),
        "region": cfg.region,
        "surface_name": cfg.surface_name,
        "lookback_days": lookback_days,
        "entry": entry_row,
        "survival": survival_row,
        "freshness": fresh_row,
        "issues": issues,
        "ok": len(issues) == 0,
    }

    out_path = Path(args.output) if args.output else (cfg.artifacts_dir / "reports" / f"label_audit_{cfg.region}_{cfg.surface_name}.json")
    save_json(out_path, payload)

    print("[DPPI] label audit")
    print(json.dumps(payload, ensure_ascii=True, indent=2))
    print("output:", out_path)

    if args.fail_on_issues and issues:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
