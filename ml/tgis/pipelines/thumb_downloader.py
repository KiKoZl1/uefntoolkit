from __future__ import annotations

import argparse
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import pandas as pd
import requests

from ml.tgis.runtime import load_yaml, utc_now_iso, write_json
from ml.tgis.pipelines._thumb_naming import build_thumb_file_name


@dataclass
class Task:
    cluster_id: int
    link_code: str
    image_url: str
    target_path: Path


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Download curated TGIS thumbnails by cluster")
    p.add_argument("--config", default="ml/tgis/configs/base.yaml")
    p.add_argument("--input", default=None, help="clusters csv path")
    p.add_argument("--output-dir", default="ml/tgis/artifacts/thumbs")
    p.add_argument("--max-total", type=int, default=10000)
    p.add_argument("--max-per-cluster", type=int, default=1500)
    p.add_argument("--workers", type=int, default=12)
    p.add_argument("--timeout-sec", type=int, default=25)
    p.add_argument("--overwrite", action="store_true")
    p.add_argument("--report-path", default="ml/tgis/artifacts/thumb_download_report.json")
    return p.parse_args()

def build_tasks(
    rows: Iterable[tuple[int, str, str]],
    output_dir: Path,
    max_total: int,
    max_per_cluster: int,
    overwrite: bool,
) -> list[Task]:
    tasks: list[Task] = []
    per_cluster: dict[int, int] = {}

    for cluster_id, link_code, image_url in rows:
        if len(tasks) >= max_total:
            break
        cur = per_cluster.get(cluster_id, 0)
        if cur >= max_per_cluster:
            continue
        cluster_dir = output_dir / f"cluster_{cluster_id:02d}"
        target = cluster_dir / build_thumb_file_name(link_code, image_url)
        if target.exists() and not overwrite:
            continue
        tasks.append(Task(cluster_id=cluster_id, link_code=link_code, image_url=image_url, target_path=target))
        per_cluster[cluster_id] = cur + 1
    return tasks


def fetch_one(task: Task, timeout_sec: int) -> tuple[str, Task, str | None]:
    try:
        task.target_path.parent.mkdir(parents=True, exist_ok=True)
        with requests.get(task.image_url, stream=True, timeout=timeout_sec) as r:
            if r.status_code != 200:
                return "failed", task, f"http_{r.status_code}"
            content_type = str(r.headers.get("content-type", "")).lower()
            if "image" not in content_type:
                return "failed", task, f"invalid_content_type:{content_type or 'unknown'}"
            with task.target_path.open("wb") as f:
                for chunk in r.iter_content(chunk_size=1024 * 64):
                    if chunk:
                        f.write(chunk)
        return "downloaded", task, None
    except Exception as e:
        return "failed", task, str(e)


def main() -> None:
    args = parse_args()
    cfg = load_yaml(args.config)
    input_csv = Path(args.input or cfg.get("paths", {}).get("clusters_csv", "ml/tgis/artifacts/clusters.csv"))
    output_dir = Path(args.output_dir)
    report_path = Path(args.report_path)

    if not input_csv.exists():
        raise FileNotFoundError(f"clusters csv not found: {input_csv}")

    df = pd.read_csv(input_csv)
    if df.empty:
        payload = {"generated_at": utc_now_iso(), "status": "empty_input", "input": str(input_csv)}
        write_json(report_path, payload)
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return

    required = {"cluster_id", "link_code", "image_url"}
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise RuntimeError(f"missing required columns in {input_csv}: {', '.join(missing)}")

    df = df[df["image_url"].astype(str).str.startswith("http")].copy()
    df["quality_score"] = pd.to_numeric(df.get("quality_score", 0), errors="coerce").fillna(0)
    df = df.sort_values(["cluster_id", "quality_score"], ascending=[True, False])

    rows = [
        (int(r.cluster_id), str(r.link_code), str(r.image_url))
        for r in df.itertuples(index=False)
    ]
    tasks = build_tasks(
        rows=rows,
        output_dir=output_dir,
        max_total=max(1, int(args.max_total)),
        max_per_cluster=max(1, int(args.max_per_cluster)),
        overwrite=bool(args.overwrite),
    )

    downloaded = 0
    failed = 0
    errors: list[dict[str, str]] = []
    per_cluster_downloaded: dict[int, int] = {}

    with ThreadPoolExecutor(max_workers=max(1, int(args.workers))) as ex:
        futures = [ex.submit(fetch_one, t, int(args.timeout_sec)) for t in tasks]
        for f in as_completed(futures):
            status, task, err = f.result()
            if status == "downloaded":
                downloaded += 1
                per_cluster_downloaded[task.cluster_id] = per_cluster_downloaded.get(task.cluster_id, 0) + 1
            else:
                failed += 1
                errors.append(
                    {
                        "cluster_id": str(task.cluster_id),
                        "link_code": task.link_code,
                        "image_url": task.image_url,
                        "error": err or "unknown",
                    }
                )

    payload = {
        "generated_at": utc_now_iso(),
        "input": str(input_csv),
        "output_dir": str(output_dir),
        "attempted": int(len(tasks)),
        "downloaded": int(downloaded),
        "failed": int(failed),
        "max_total": int(args.max_total),
        "max_per_cluster": int(args.max_per_cluster),
        "workers": int(args.workers),
        "per_cluster_downloaded": {str(k): int(v) for k, v in sorted(per_cluster_downloaded.items())},
        "errors_sample": errors[:100],
    }
    write_json(report_path, payload)
    print(json.dumps(payload, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
