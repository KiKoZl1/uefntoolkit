from __future__ import annotations

import argparse
import json
import os
import socket
from shutil import disk_usage

from ml.tgis.runtime import connect_db, load_runtime


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Emit TGIS worker heartbeat to Supabase")
    p.add_argument("--config", default="ml/tgis/configs/base.yaml")
    p.add_argument("--queue-depth", type=int, default=0)
    p.add_argument("--worker-source", default=os.getenv("TGIS_WORKER_SOURCE", "hetzner-cx22"))
    return p.parse_args()


def collect_metrics() -> tuple[float | None, float | None, float | None]:
    cpu = None
    mem = None
    try:
      import psutil  # type: ignore
      cpu = float(psutil.cpu_percent(interval=0.2))
      mem = float(psutil.virtual_memory().percent)
    except Exception:
      pass

    du = disk_usage("/")
    disk_pct = float((du.used / du.total) * 100.0) if du.total else None
    return cpu, mem, disk_pct


def main() -> None:
    args = parse_args()
    runtime = load_runtime(args.config)
    host = os.getenv("TGIS_WORKER_HOST") or socket.gethostname()
    cpu, mem, disk_pct = collect_metrics()

    with connect_db(runtime) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                insert into public.tgis_worker_heartbeat(worker_host, worker_source, cpu_pct, mem_pct, disk_pct, queue_depth, metadata_json)
                values (%s, %s, %s, %s, %s, %s, %s::jsonb)
                """,
                (
                    host,
                    args.worker_source,
                    cpu,
                    mem,
                    disk_pct,
                    max(0, int(args.queue_depth)),
                    json.dumps({"pid": os.getpid()}),
                ),
            )
        conn.commit()

    print(f"[TGIS] heartbeat host={host} queue={args.queue_depth} cpu={cpu} mem={mem} disk={disk_pct}")


if __name__ == "__main__":
    main()
