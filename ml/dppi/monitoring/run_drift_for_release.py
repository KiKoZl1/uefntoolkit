#!/usr/bin/env python3
"""Run drift computation for release-channel models."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from runtime import open_db, parse_args_with_common, query_df


def _extra_args(parser) -> None:
    parser.add_argument("--channels", default="production,candidate", help="Comma-separated release channels")
    parser.add_argument("--region", default="NAE")
    parser.add_argument("--surface-name", default="CreativeDiscoverySurface_Frontend")
    parser.add_argument("--window-hours", type=int, default=24)
    parser.add_argument("--baseline-shift-hours", type=int, default=168)
    parser.add_argument("--strict", action="store_true", help="Fail tick if any drift subcommand fails")


def main() -> None:
    args = parse_args_with_common("Compute drift for release models", extra_args=_extra_args)
    channels = [c.strip() for c in str(args.channels).split(",") if c.strip()]
    if not channels:
        channels = ["production"]

    with open_db() as conn:
        rows = query_df(
            conn,
            """
            select rc.channel_name, mr.model_name, mr.model_version, mr.task_type
            from public.dppi_release_channels rc
            join public.dppi_model_registry mr
              on mr.model_name = rc.model_name
             and mr.model_version = rc.model_version
            where rc.channel_name = any(%s)
              and rc.model_name is not null
              and rc.model_version is not null
            order by rc.channel_name asc
            """,
            [channels],
        )

    if rows.empty:
        print("[DPPI] no release models found for drift")
        return

    failures = 0
    for row in rows.to_dict(orient="records"):
        cmd = [
            sys.executable,
            str(ROOT / "monitoring" / "compute_drift.py"),
            "--model-name",
            str(row["model_name"]),
            "--model-version",
            str(row["model_version"]),
            "--region",
            str(args.region),
            "--surface-name",
            str(args.surface_name),
            "--window-hours",
            str(args.window_hours),
            "--baseline-shift-hours",
            str(args.baseline_shift_hours),
        ]
        print("[DPPI] drift run:", row["channel_name"], row["model_name"], row["model_version"])
        rc = subprocess.call(cmd, cwd=str(ROOT.parents[1]))
        if rc != 0:
            failures += 1
            print("[DPPI] drift command failed:", row["model_name"], row["model_version"], "rc=", rc)

    if failures and args.strict:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
