from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd

from ml.tgis.runtime import connect_db, load_runtime, load_yaml, utc_now_iso


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Build TGIS candidate dataset from Supabase RPC")
    p.add_argument("--config", default="ml/tgis/configs/base.yaml")
    p.add_argument("--min-score", type=float, default=None)
    p.add_argument("--limit", type=int, default=15000)
    p.add_argument("--window-days", type=int, default=None)
    return p.parse_args()


def main() -> None:
    args = parse_args()
    cfg = load_yaml(args.config)
    runtime = load_runtime(args.config)

    min_score = args.min_score if args.min_score is not None else float(cfg.get("scoring", {}).get("min_score", runtime.score_threshold))
    window_days = int(args.window_days if args.window_days is not None else cfg.get("scoring", {}).get("window_days", 14))
    window_days = max(1, min(365, window_days))
    dataset_csv = Path(cfg.get("paths", {}).get("dataset_csv", "ml/tgis/artifacts/dataset_candidates.csv"))

    with connect_db(runtime) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select *
                from public.get_tgis_training_candidates(%s::numeric, %s::int, %s::int)
                """,
                (min_score, args.limit, window_days),
            )
            rows = cur.fetchall()
            cols = [d.name for d in cur.description]

            df = pd.DataFrame(rows, columns=cols)
            if not df.empty:
                df["collected_at"] = utc_now_iso()
            dataset_csv.parent.mkdir(parents=True, exist_ok=True)
            df.to_csv(dataset_csv, index=False)

            summary = {
                "rows": int(len(df)),
                "min_score": float(min_score),
                "limit": int(args.limit),
                "window_days": int(window_days),
                "output": str(dataset_csv),
                "collected_at": utc_now_iso(),
            }
            cur.execute(
                """
                insert into public.tgis_dataset_runs(run_type, status, summary_json, started_at, ended_at)
                values ('daily_refresh', 'success', %s::jsonb, now(), now())
                """,
                (json.dumps(summary),),
            )
        conn.commit()

    print(f"[TGIS] dataset rows={len(rows)} saved={dataset_csv}")


if __name__ == "__main__":
    main()
