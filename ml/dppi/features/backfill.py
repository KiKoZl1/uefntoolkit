#!/usr/bin/env python3
"""Backfill DPPI feature stores and labels for a historical window."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from runtime import open_db, parse_args_with_common


def _extra_args(parser) -> None:
    parser.add_argument("--since", required=True, help="UTC ISO start, ex: 2026-02-20T00:00:00Z")
    parser.add_argument("--until", default=None, help="UTC ISO end, default now")
    parser.add_argument("--target-id", default=None, help="Optional target UUID")
    parser.add_argument("--panel-name", default=None, help="Optional panel filter")
    parser.add_argument("--skip-daily", action="store_true")
    parser.add_argument("--skip-labels", action="store_true")


def _parse_iso(value: str | None) -> datetime:
    if not value:
        return datetime.now(timezone.utc)
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _iter_hours(start: datetime, end: datetime):
    current = start.replace(minute=0, second=0, microsecond=0)
    end_h = end.replace(minute=0, second=0, microsecond=0)
    while current <= end_h:
        yield current
        current += timedelta(hours=1)


def _iter_days(start: datetime, end: datetime):
    current = start.date()
    end_d = end.date()
    while current <= end_d:
        yield current
        current = current + timedelta(days=1)


def main() -> None:
    args = parse_args_with_common("Backfill DPPI feature stores and labels", extra_args=_extra_args)
    since = _parse_iso(args.since)
    until = _parse_iso(args.until)
    if since > until:
        raise SystemExit("since must be <= until")

    hourly_calls = 0
    daily_calls = 0

    with open_db() as conn:
        with conn.cursor() as cur:
            for bucket in _iter_hours(since, until):
                cur.execute(
                    """
                    select public.compute_dppi_feature_store_hourly(
                      %s::uuid, %s, %s, %s, %s::timestamptz
                    )
                    """,
                    [
                        args.target_id,
                        args.region,
                        args.surface_name,
                        args.panel_name,
                        bucket.isoformat(),
                    ],
                )
                hourly_calls += 1
                if hourly_calls % 24 == 0:
                    print(f"[DPPI] hourly backfill progress: {hourly_calls} buckets")

            if not args.skip_daily:
                for day in _iter_days(since, until):
                    cur.execute(
                        """
                        select public.compute_dppi_feature_store_daily(
                          %s::uuid, %s, %s, %s, %s::date
                        )
                        """,
                        [
                            args.target_id,
                            args.region,
                            args.surface_name,
                            args.panel_name,
                            str(day),
                        ],
                    )
                    daily_calls += 1

            if not args.skip_labels:
                last_bucket = until.replace(minute=0, second=0, microsecond=0)
                cur.execute(
                    """
                    select public.compute_dppi_labels_entry(%s::uuid, %s::timestamptz)
                    """,
                    [args.target_id, last_bucket.isoformat()],
                )
                cur.execute(
                    """
                    select public.compute_dppi_labels_survival(%s::uuid, %s::timestamptz)
                    """,
                    [args.target_id, since.isoformat()],
                )

        conn.commit()

    print("[DPPI] backfill complete")
    print("hourly_calls:", hourly_calls)
    print("daily_calls:", daily_calls)
    print("labels:", "done" if not args.skip_labels else "skipped")


if __name__ == "__main__":
    main()
