#!/usr/bin/env python3
"""Build DPPI survival dataset from feature store and survival labels."""

from __future__ import annotations

from pathlib import Path

from mlops import get_training_readiness, load_survival_dataset, upsert_dataset_meta
from runtime import RuntimeConfig, open_db, parse_args_with_common, utc_now, utc_now_iso


def _extra_args(parser) -> None:
    parser.add_argument("--lookback-days", type=int, default=365, help="Lookback range in days for dataset extraction")
    parser.add_argument("--output", default=None, help="Optional explicit output path (.parquet/.csv)")


def main() -> None:
    args = parse_args_with_common("Build DPPI survival dataset", extra_args=_extra_args)
    cfg = RuntimeConfig.load(args.config, region=args.region, surface_name=args.surface_name, artifacts_dir=args.artifacts_dir)

    with open_db() as conn:
        readiness = get_training_readiness(conn, cfg.region, cfg.surface_name, cfg.min_days)
        frame = load_survival_dataset(conn, cfg.region, cfg.surface_name, lookback_days=max(30, int(args.lookback_days)))

        if frame.empty:
            raise RuntimeError("Survival dataset is empty. Ensure feature and label cron jobs are running.")

        frame["ts"] = frame["ts"].astype("datetime64[ns, UTC]")
        start_ts = frame["ts"].min().to_pydatetime()
        end_ts = frame["ts"].max().to_pydatetime()

        out_path = Path(args.output) if args.output else (cfg.artifacts_dir / "datasets" / f"survival_{cfg.region}_{cfg.surface_name}.parquet")
        out_path.parent.mkdir(parents=True, exist_ok=True)
        frame.to_parquet(out_path, index=False)

        upsert_dataset_meta(
            conn,
            dataset_type="survival",
            start_ts=start_ts,
            end_ts=end_ts,
            sample_count=len(frame),
            status="ready",
            metadata={
                "region": cfg.region,
                "surface_name": cfg.surface_name,
                "columns": frame.columns.tolist(),
                "output_path": str(out_path),
                "readiness": readiness,
                "generated_at": utc_now_iso(),
            },
        )

    print("[DPPI] survival dataset built")
    print("rows:", len(frame))
    print("from:", start_ts.isoformat(), "to:", end_ts.isoformat())
    print("output:", out_path)
    print("timestamp:", utc_now().isoformat())


if __name__ == "__main__":
    main()
