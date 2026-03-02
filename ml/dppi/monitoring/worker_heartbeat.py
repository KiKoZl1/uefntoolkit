#!/usr/bin/env python3
"""Send worker heartbeat metrics to Supabase edge dppi-worker-heartbeat."""

from __future__ import annotations

import os
import socket
import shutil
from datetime import datetime, timezone

import requests


def _read_loadavg_pct() -> float | None:
    try:
        load1, _load5, _load15 = os.getloadavg()
        cores = os.cpu_count() or 1
        return max(0.0, min(100.0, (load1 / cores) * 100.0))
    except Exception:
        return None


def _read_mem_stats() -> tuple[float | None, int | None, int | None]:
    try:
        with open("/proc/meminfo", "r", encoding="utf-8") as handle:
            rows = {}
            for line in handle:
                parts = line.split(":")
                if len(parts) != 2:
                    continue
                key = parts[0].strip()
                value = parts[1].strip().split()[0]
                rows[key] = int(value)
        total_kb = rows.get("MemTotal")
        avail_kb = rows.get("MemAvailable")
        if not total_kb or avail_kb is None:
            return None, None, None
        used_kb = total_kb - avail_kb
        pct = (used_kb / total_kb) * 100.0
        return pct, int(used_kb / 1024), int(total_kb / 1024)
    except Exception:
        return None, None, None


def _read_disk_pct() -> float | None:
    try:
        usage = shutil.disk_usage("/")
        return (usage.used / usage.total) * 100.0 if usage.total else None
    except Exception:
        return None


def main() -> None:
    supabase_url = os.getenv("SUPABASE_URL")
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")

    endpoint = f"{supabase_url.rstrip('/')}/functions/v1/dppi-worker-heartbeat"
    worker_host = os.getenv("DPPI_WORKER_HOST") or socket.gethostname()
    source = os.getenv("DPPI_WORKER_SOURCE", "hetzner-cx22")

    cpu_pct = _read_loadavg_pct()
    mem_pct, mem_used_mb, mem_total_mb = _read_mem_stats()
    disk_pct = _read_disk_pct()
    queue_depth = int(os.getenv("DPPI_QUEUE_DEPTH", "0"))
    training_running = os.getenv("DPPI_TRAINING_RUNNING", "0") in {"1", "true", "TRUE"}
    inference_running = os.getenv("DPPI_INFERENCE_RUNNING", "0") in {"1", "true", "TRUE"}

    payload = {
        "worker_host": worker_host,
        "source": source,
        "cpu_pct": cpu_pct,
        "mem_pct": mem_pct,
        "mem_used_mb": mem_used_mb,
        "mem_total_mb": mem_total_mb,
        "disk_pct": disk_pct,
        "queue_depth": queue_depth,
        "training_running": training_running,
        "inference_running": inference_running,
        "extra_json": {
            "sent_at": datetime.now(timezone.utc).isoformat(),
        },
    }

    response = requests.post(
        endpoint,
        headers={
            "Authorization": f"Bearer {service_key}",
            "apikey": service_key,
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=20,
    )
    response.raise_for_status()
    print("[DPPI] heartbeat sent:", response.json())


if __name__ == "__main__":
    main()
