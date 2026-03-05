from __future__ import annotations

import argparse
import csv
import json
from datetime import datetime, timezone
from pathlib import Path

from ml.tgis.runtime import connect_db, load_runtime, utc_now_iso


TABLES = [
    "tgis_cluster_registry",
    "tgis_model_versions",
    "tgis_training_runs",
]


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Snapshot TGIS DB state before destructive reset")
    p.add_argument("--config", default="ml/tgis/configs/base.yaml")
    p.add_argument("--output-dir", default="ml/tgis/artifacts/snapshots")
    p.add_argument("--generation-days", type=int, default=30)
    return p.parse_args()


def _write_csv(path: Path, columns: list[str], rows: list[tuple]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(columns)
        for r in rows:
            w.writerow(r)


def main() -> None:
    args = parse_args()
    runtime = load_runtime(args.config)
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    base = Path(args.output_dir) / f"tgis_state_{ts}"
    base.mkdir(parents=True, exist_ok=True)

    snapshot_meta: dict[str, object] = {
        "generated_at": utc_now_iso(),
        "output_dir": str(base),
        "tables": {},
    }

    with connect_db(runtime) as conn:
        with conn.cursor() as cur:
            for table in TABLES:
                cur.execute(f"select * from public.{table}")
                rows = cur.fetchall()
                cols = [d.name for d in cur.description]
                out_csv = base / f"{table}.csv"
                _write_csv(out_csv, cols, rows)
                snapshot_meta["tables"][table] = {"rows": int(len(rows)), "path": str(out_csv)}

            cur.execute(
                """
                select *
                from public.tgis_generation_log
                where created_at >= now() - make_interval(days => %s)
                order by created_at desc
                """,
                (max(1, int(args.generation_days)),),
            )
            gen_rows = cur.fetchall()
            gen_cols = [d.name for d in cur.description]
            gen_csv = base / "tgis_generation_log_recent.csv"
            _write_csv(gen_csv, gen_cols, gen_rows)
            snapshot_meta["tables"]["tgis_generation_log_recent"] = {
                "rows": int(len(gen_rows)),
                "path": str(gen_csv),
                "days": int(args.generation_days),
            }
        conn.commit()

    meta_path = base / "snapshot_meta.json"
    meta_path.write_text(json.dumps(snapshot_meta, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[TGIS][snapshot] wrote snapshot at {base}")


if __name__ == "__main__":
    main()
