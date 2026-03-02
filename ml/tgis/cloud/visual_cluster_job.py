from __future__ import annotations

import argparse
import concurrent.futures as cf
import io
import json
from pathlib import Path
from typing import Dict, List, Tuple

import numpy as np
import pandas as pd
import requests
from PIL import Image

from ml.tgis.pipelines._category_map import CATEGORY_TO_CLUSTER_ID, FIXED_CATEGORIES, normalize_tag_group


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Cloud visual clustering job (RunPod)")
    p.add_argument("--input", required=True, help="CSV produced by export_cloud_manifest.py")
    p.add_argument("--output", default="visual_clusters.csv")
    p.add_argument("--report", default="visual_cluster_report.json")
    p.add_argument("--model", default="openai/clip-vit-base-patch32")
    p.add_argument("--batch-size", type=int, default=32)
    p.add_argument("--seed-min-score", type=float, default=0.25)
    p.add_argument("--min-seeds-per-category", type=int, default=20)
    p.add_argument("--min-sim", type=float, default=0.16)
    p.add_argument("--min-margin", type=float, default=0.006)
    p.add_argument("--timeout-sec", type=int, default=8)
    p.add_argument("--download-workers", type=int, default=32)
    p.add_argument("--log-every-batches", type=int, default=10)
    return p.parse_args()


def _load_clip(model_name: str):
    import torch
    from transformers import CLIPModel, CLIPProcessor

    device = "cuda" if torch.cuda.is_available() else "cpu"
    # Force safetensors to avoid torch.load restrictions with older Torch runtimes.
    model = CLIPModel.from_pretrained(model_name, use_safetensors=True).to(device)
    processor = CLIPProcessor.from_pretrained(model_name)
    model.eval()
    return model, processor, device


def _fetch_image(url: str, timeout_sec: int) -> Image.Image | None:
    try:
        r = requests.get(url, timeout=timeout_sec)
        r.raise_for_status()
        return Image.open(io.BytesIO(r.content)).convert("RGB")
    except Exception:
        return None


def _fetch_images_parallel(urls: List[str], timeout_sec: int, workers: int) -> Tuple[List[Image.Image], List[bool]]:
    n = len(urls)
    images: List[Image.Image | None] = [None] * n
    ok_flags: List[bool] = [False] * n

    with cf.ThreadPoolExecutor(max_workers=max(1, workers)) as ex:
        fut_to_idx = {ex.submit(_fetch_image, url, timeout_sec): idx for idx, url in enumerate(urls)}
        for fut in cf.as_completed(fut_to_idx):
            idx = fut_to_idx[fut]
            try:
                img = fut.result()
            except Exception:
                img = None
            if img is None:
                images[idx] = Image.new("RGB", (224, 224), color=(0, 0, 0))
                ok_flags[idx] = False
            else:
                images[idx] = img
                ok_flags[idx] = True

    return [img if img is not None else Image.new("RGB", (224, 224), color=(0, 0, 0)) for img in images], ok_flags


def _coerce_to_tensor_features(feats, model):
    import torch

    if isinstance(feats, torch.Tensor):
        return feats

    if hasattr(feats, "pooler_output") and feats.pooler_output is not None:
        pooled = feats.pooler_output
        if hasattr(model, "visual_projection"):
            in_features = getattr(model.visual_projection, "in_features", None)
            if in_features is not None and pooled.shape[-1] == int(in_features):
                return model.visual_projection(pooled)
        return pooled

    if isinstance(feats, tuple) and len(feats) > 0:
        return feats[0]

    raise RuntimeError(f"Unexpected image feature output type: {type(feats)}")


def _embed_batch(
    model,
    processor,
    device: str,
    urls: List[str],
    timeout_sec: int,
    download_workers: int,
) -> Tuple[np.ndarray, List[bool]]:
    import torch

    images, ok_flags = _fetch_images_parallel(urls, timeout_sec=timeout_sec, workers=download_workers)

    inputs = processor(images=images, return_tensors="pt", padding=True)
    inputs = {k: v.to(device) for k, v in inputs.items()}
    with torch.no_grad():
        feats = model.get_image_features(**inputs)
        feats = _coerce_to_tensor_features(feats, model)
        feats = torch.nn.functional.normalize(feats, dim=-1)
    emb = feats.detach().cpu().numpy().astype(np.float32)
    return emb, ok_flags


def _compute_centroids(
    emb: np.ndarray,
    seed_cat: np.ndarray,
    quality: np.ndarray,
    min_score: float,
    min_seeds_per_category: int,
) -> Dict[str, np.ndarray]:
    centroids: Dict[str, np.ndarray] = {}
    for cat in FIXED_CATEGORIES:
        if cat == "misc":
            continue
        mask = (seed_cat == cat) & (quality >= min_score)
        if int(mask.sum()) < min_seeds_per_category:
            mask = seed_cat == cat
        if int(mask.sum()) == 0:
            continue
        c = emb[mask].mean(axis=0)
        n = np.linalg.norm(c)
        if n > 0:
            c = c / n
        centroids[cat] = c.astype(np.float32)
    return centroids


def _assign_categories(
    emb: np.ndarray,
    centroids: Dict[str, np.ndarray],
    min_sim: float,
    min_margin: float,
) -> Tuple[List[str], List[float], List[float], List[float]]:
    cats = list(centroids.keys())
    if not cats:
        n = emb.shape[0]
        return ["misc"] * n, [0.0] * n, [0.0] * n, [0.0] * n

    cmat = np.stack([centroids[c] for c in cats], axis=0)  # (C, D)
    sims = emb @ cmat.T  # (N, C)
    top_idx = np.argmax(sims, axis=1)
    top_sim = sims[np.arange(sims.shape[0]), top_idx]
    if sims.shape[1] > 1:
        part = np.partition(sims, -2, axis=1)
        second_sim = part[:, -2]
    else:
        second_sim = np.zeros_like(top_sim)
    margin = top_sim - second_sim

    assigned: List[str] = []
    for i in range(len(top_sim)):
        if float(top_sim[i]) < min_sim or float(margin[i]) < min_margin:
            assigned.append("misc")
        else:
            assigned.append(cats[int(top_idx[i])])
    return assigned, top_sim.tolist(), second_sim.tolist(), margin.tolist()


def main() -> None:
    args = parse_args()
    input_csv = Path(args.input)
    output_csv = Path(args.output)
    report_json = Path(args.report)

    if not input_csv.exists():
        raise FileNotFoundError(f"input csv not found: {input_csv}")

    df = pd.read_csv(input_csv)
    if df.empty:
        raise RuntimeError("input csv empty")

    required = ["link_code", "image_url", "seed_category", "quality_score"]
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise RuntimeError(f"input missing columns: {missing}")

    model, processor, device = _load_clip(args.model)

    all_emb: List[np.ndarray] = []
    ok_all: List[bool] = []
    urls = df["image_url"].astype(str).tolist()
    batch_size = max(1, int(args.batch_size))
    total_batches = (len(urls) + batch_size - 1) // batch_size
    for batch_idx, i in enumerate(range(0, len(urls), batch_size), start=1):
        batch_urls = urls[i : i + int(args.batch_size)]
        emb, ok = _embed_batch(
            model,
            processor,
            device=device,
            urls=batch_urls,
            timeout_sec=int(args.timeout_sec),
            download_workers=int(args.download_workers),
        )
        all_emb.append(emb)
        ok_all.extend(ok)
        if batch_idx == 1 or batch_idx % max(1, int(args.log_every_batches)) == 0 or batch_idx == total_batches:
            ok_count = int(np.sum(np.array(ok_all, dtype=bool)))
            print(
                f"[TGIS][progress] batch={batch_idx}/{total_batches} processed={len(ok_all)}/{len(urls)} "
                f"image_ok={ok_count} image_fail={len(ok_all)-ok_count}",
                flush=True,
            )
    emb_all = np.concatenate(all_emb, axis=0)

    # Failed downloads get forced to misc by zeroing vector.
    ok_mask = np.array(ok_all, dtype=bool)
    emb_all[~ok_mask] = 0.0

    seed_cat = np.array([normalize_tag_group(v) for v in df["seed_category"].astype(str).tolist()])
    quality = pd.to_numeric(df["quality_score"], errors="coerce").fillna(0.0).astype(float).to_numpy()

    centroids = _compute_centroids(
        emb=emb_all,
        seed_cat=seed_cat,
        quality=quality,
        min_score=float(args.seed_min_score),
        min_seeds_per_category=int(args.min_seeds_per_category),
    )

    assigned, top_sim, second_sim, margin = _assign_categories(
        emb=emb_all,
        centroids=centroids,
        min_sim=float(args.min_sim),
        min_margin=float(args.min_margin),
    )

    out = df.copy()
    out["assigned_category"] = assigned
    out["cluster_id"] = out["assigned_category"].map(CATEGORY_TO_CLUSTER_ID).astype(int)
    out["cluster_name"] = out["assigned_category"].map(lambda c: f"cluster_{c}")
    out["sim_top1"] = top_sim
    out["sim_top2"] = second_sim
    out["confidence_margin"] = margin
    out["embedding_model"] = args.model
    out["image_ok"] = ok_all

    output_csv.parent.mkdir(parents=True, exist_ok=True)
    out.to_csv(output_csv, index=False)

    # Report
    counts = out["assigned_category"].value_counts().to_dict()
    seed_counts = pd.Series(seed_cat).value_counts().to_dict()
    report = {
        "input_rows": int(len(df)),
        "image_ok_rows": int(np.sum(ok_mask)),
        "image_failed_rows": int(len(df) - int(np.sum(ok_mask))),
        "embedding_model": args.model,
        "categories_assigned": counts,
        "seed_category_counts": seed_counts,
        "centroids_built": sorted(list(centroids.keys())),
        "params": {
            "seed_min_score": float(args.seed_min_score),
            "min_seeds_per_category": int(args.min_seeds_per_category),
            "min_sim": float(args.min_sim),
            "min_margin": float(args.min_margin),
        },
    }
    report_json.parent.mkdir(parents=True, exist_ok=True)
    report_json.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    print(json.dumps(report, ensure_ascii=False))
    print(f"[TGIS] visual clustering output={output_csv} report={report_json}")


if __name__ == "__main__":
    main()
