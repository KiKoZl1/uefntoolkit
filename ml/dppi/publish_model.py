#!/usr/bin/env python3
"""Promote a DPPI model version to release channel with quality gates."""

from __future__ import annotations

import json
from typing import Any

from runtime import RuntimeConfig, open_db, parse_args_with_common, exec_sql, query_df


def _extra_args(parser) -> None:
    parser.add_argument("--channel", choices=["shadow", "candidate", "limited", "production"], required=True)
    parser.add_argument("--model-name", required=True)
    parser.add_argument("--model-version", required=True)
    parser.add_argument("--notes", default="")
    parser.add_argument("--force", action="store_true")


def _as_float(v: Any) -> float | None:
    try:
        n = float(v)
    except Exception:
        return None
    return n if n == n else None


def _metrics_by_horizon(metrics_json: Any) -> dict[str, dict[str, float]]:
    if not isinstance(metrics_json, dict):
        return {}
    raw = metrics_json.get("metrics_by_horizon")
    if not isinstance(raw, dict):
        return {}
    out: dict[str, dict[str, float]] = {}
    for horizon, values in raw.items():
        if not isinstance(values, dict):
            continue
        out[str(horizon)] = {str(k): float(v) for k, v in values.items() if _as_float(v) is not None}
    return out


def _max_calibration_ece(conn, model_name: str, model_version: str, task_type: str) -> tuple[float | None, int]:
    rows = query_df(
        conn,
        """
        select ece
        from public.dppi_calibration_metrics
        where model_name = %s
          and model_version = %s
          and task_type = %s
        """,
        [model_name, model_version, task_type],
    )
    if rows.empty:
        return None, 0
    values = [_as_float(v) for v in rows["ece"].tolist()]
    values = [v for v in values if v is not None]
    if not values:
        return None, 0
    return max(values), len(values)


def _recent_max_psi(conn, model_name: str, model_version: str, days: int = 7) -> tuple[float | None, int]:
    rows = query_df(
        conn,
        """
        select psi
        from public.dppi_drift_metrics
        where model_name = %s
          and model_version = %s
          and measured_at >= now() - (%s::text || ' days')::interval
        """,
        [model_name, model_version, days],
    )
    if rows.empty:
        return None, 0
    values = [_as_float(v) for v in rows["psi"].tolist()]
    values = [v for v in values if v is not None]
    if not values:
        return None, 0
    return max(values), len(values)


def _evaluate_relative_gates(
    candidate: dict[str, dict[str, float]],
    baseline: dict[str, dict[str, float]],
    *,
    pr_auc_drop_max_pct: float,
    precision20_drop_max_pct: float,
    brier_worse_max_pct: float,
) -> list[str]:
    errors: list[str] = []
    if not baseline:
        return errors

    for horizon, cand_metrics in candidate.items():
        base_metrics = baseline.get(horizon)
        if not base_metrics:
            continue

        c_auc = _as_float(cand_metrics.get("test_auc_pr"))
        b_auc = _as_float(base_metrics.get("test_auc_pr"))
        if c_auc is not None and b_auc is not None and b_auc > 0:
            min_auc = b_auc * (1.0 - pr_auc_drop_max_pct / 100.0)
            if c_auc < min_auc:
                errors.append(
                    f"{horizon}: test_auc_pr={c_auc:.4f} below min={min_auc:.4f} (baseline={b_auc:.4f})"
                )

        c_p20 = _as_float(cand_metrics.get("test_precision_at_20"))
        b_p20 = _as_float(base_metrics.get("test_precision_at_20"))
        if c_p20 is not None and b_p20 is not None and b_p20 > 0:
            min_p20 = b_p20 * (1.0 - precision20_drop_max_pct / 100.0)
            if c_p20 < min_p20:
                errors.append(
                    f"{horizon}: precision@20={c_p20:.4f} below min={min_p20:.4f} (baseline={b_p20:.4f})"
                )

        c_brier = _as_float(cand_metrics.get("test_brier"))
        b_brier = _as_float(base_metrics.get("test_brier"))
        if c_brier is not None and b_brier is not None and b_brier > 0:
            max_brier = b_brier * (1.0 + brier_worse_max_pct / 100.0)
            if c_brier > max_brier:
                errors.append(
                    f"{horizon}: test_brier={c_brier:.4f} above max={max_brier:.4f} (baseline={b_brier:.4f})"
                )

    return errors


def main() -> None:
    args = parse_args_with_common("Publish DPPI model", extra_args=_extra_args)
    cfg = RuntimeConfig.load(args.config, region=args.region, surface_name=args.surface_name, artifacts_dir=args.artifacts_dir)

    with open_db() as conn:
        model_rows = query_df(
            conn,
            """
            select model_name, model_version, task_type, status, metrics_json
            from public.dppi_model_registry
            where model_name = %s
              and model_version = %s
            limit 1
            """,
            [args.model_name, args.model_version],
        )
        if model_rows.empty:
            raise RuntimeError("model_not_found")

        model_row = model_rows.iloc[0].to_dict()
        task_type = str(model_row.get("task_type") or "")
        model_status = str(model_row.get("status") or "")
        candidate_metrics = _metrics_by_horizon(model_row.get("metrics_json"))

        baseline_rows = query_df(
            conn,
            """
            select mr.metrics_json
            from public.dppi_release_channels rc
            join public.dppi_model_registry mr
              on mr.model_name = rc.model_name
             and mr.model_version = rc.model_version
            where rc.channel_name = 'production'
              and mr.task_type = %s
              and not (mr.model_name = %s and mr.model_version = %s)
            limit 1
            """,
            [task_type, args.model_name, args.model_version],
        )
        baseline_metrics = {}
        if not baseline_rows.empty:
            baseline_metrics = _metrics_by_horizon(baseline_rows.iloc[0].to_dict().get("metrics_json"))

        gate_errors: list[str] = []
        if args.channel in {"candidate", "limited", "production"}:
            if not candidate_metrics:
                gate_errors.append("missing metrics_by_horizon")

            if args.channel == "production" and model_status not in {"production_candidate", "candidate", "limited", "production"}:
                gate_errors.append(f"invalid model status for production promote: {model_status}")

            gate_errors.extend(
                _evaluate_relative_gates(
                    candidate_metrics,
                    baseline_metrics,
                    pr_auc_drop_max_pct=cfg.gates["pr_auc_drop_max_pct"],
                    precision20_drop_max_pct=cfg.gates["precision_at_20_drop_max_pct"],
                    brier_worse_max_pct=cfg.gates["brier_worse_max_pct"],
                )
            )

            max_ece, cal_count = _max_calibration_ece(conn, args.model_name, args.model_version, task_type)
            if cal_count == 0:
                gate_errors.append("missing calibration metrics")
            elif max_ece is not None and max_ece > cfg.gates["ece_max"]:
                gate_errors.append(f"ece above max: {max_ece:.4f} > {cfg.gates['ece_max']:.4f}")

            max_psi, psi_count = _recent_max_psi(conn, args.model_name, args.model_version, days=7)
            if psi_count > 0 and max_psi is not None and max_psi > cfg.gates["psi_max"]:
                gate_errors.append(f"psi above max: {max_psi:.4f} > {cfg.gates['psi_max']:.4f}")

        if gate_errors and not args.force:
            raise RuntimeError("promotion_gates_failed: " + "; ".join(gate_errors))

        exec_sql(
            conn,
            """
            insert into public.dppi_release_channels (
              channel_name, model_name, model_version, notes, updated_at
            ) values (%s, %s, %s, %s, now())
            on conflict (channel_name)
            do update set
              model_name = excluded.model_name,
              model_version = excluded.model_version,
              notes = excluded.notes,
              updated_at = now()
            """,
            [args.channel, args.model_name, args.model_version, args.notes],
        )

        status = (
            "production"
            if args.channel == "production"
            else "production_candidate"
            if args.channel == "candidate"
            else args.channel
        )
        exec_sql(
            conn,
            """
            update public.dppi_model_registry
               set status = %s,
                   published_at = case when %s = 'production' then now() else published_at end,
                   updated_at = now()
             where model_name = %s
               and model_version = %s
            """,
            [status, args.channel, args.model_name, args.model_version],
        )

        exec_sql(
            conn,
            """
            insert into public.dppi_feedback_events (
              source, event_type, region, surface_name, event_value
            ) values (
              'dppi_publish_script', 'release_channel_update', %s, %s, %s::jsonb
            )
            """,
            [
                cfg.region,
                cfg.surface_name,
                json.dumps(
                    {
                        "channel": args.channel,
                        "model_name": args.model_name,
                        "model_version": args.model_version,
                        "force": bool(args.force),
                        "notes": args.notes,
                        "gate_errors": gate_errors,
                    }
                ),
            ],
        )

    print("[DPPI] model promoted")
    print("channel:", args.channel)
    print("model:", args.model_name, args.model_version)
    if args.force:
        print("force:", True)


if __name__ == "__main__":
    main()
