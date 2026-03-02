from __future__ import annotations

import argparse
import hashlib
import io
import json
from collections import Counter, defaultdict
from pathlib import Path
from urllib.parse import urlparse

import numpy as np
import pandas as pd
import requests
from PIL import Image
from sklearn.cluster import KMeans

from ml.tgis.runtime import connect_db, load_runtime, load_yaml, utc_now_iso


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Cluster TGIS thumbs into K groups")
    p.add_argument("--config", default="ml/tgis/configs/base.yaml")
    p.add_argument("--input", default=None)
    p.add_argument("--mode", choices=["taxonomy", "kmeans_visual"], default=None)
    p.add_argument("--k", type=int, default=None)
    p.add_argument("--min-cluster-size", type=int, default=None)
    p.add_argument("--thumb-cache-dir", default=None)
    p.add_argument("--download-missing", action="store_true")
    return p.parse_args()


FIXED_CATEGORIES = [
    "combat",
    "tycoon",
    "horror",
    "prop_hunt",
    "deathrun",
    "driving",
    "party_games",
    "roleplay",
    "fashion",
    "misc",
]


def normalize_to_fixed_category(tag_group: str) -> str:
    t = (tag_group or "").strip().lower()
    if t in {"combat", "zonewars", "build_fighting", "gun_game", "team_deathmatch", "box_fights"}:
        return "combat"
    if t == "tycoon":
        return "tycoon"
    if t == "horror":
        return "horror"
    if t == "prop_hunt":
        return "prop_hunt"
    if t == "deathrun":
        return "deathrun"
    if t == "driving":
        return "driving"
    if t == "party_games":
        return "party_games"
    if t == "roleplay":
        return "roleplay"
    if t == "fashion":
        return "fashion"
    return "misc"


def stable_vector(text: str, dim: int = 64) -> np.ndarray:
    out = np.zeros(dim, dtype=np.float32)
    token = text.encode("utf-8", errors="ignore")
    digest = hashlib.sha256(token).digest()
    for i in range(dim):
        out[i] = digest[i % len(digest)] / 255.0
    return out


def image_feature_from_pil(img: Image.Image) -> np.ndarray:
    # 16:9 thumbs -> keep wide resolution before statistics
    img = img.convert("RGB").resize((96, 54), Image.Resampling.BILINEAR)
    arr = np.asarray(img, dtype=np.float32) / 255.0  # (H, W, 3)

    # Base channel stats
    mean_rgb = arr.mean(axis=(0, 1))
    std_rgb = arr.std(axis=(0, 1))

    # Brightness / saturation proxies
    maxc = arr.max(axis=2)
    minc = arr.min(axis=2)
    v = maxc
    s = np.where(maxc > 1e-6, (maxc - minc) / np.maximum(maxc, 1e-6), 0.0)
    dark_ratio = float((v < 0.20).mean())
    bright_ratio = float((v > 0.80).mean())
    sat_mean = float(s.mean())
    sat_std = float(s.std())

    # Coarse color histograms (helps separate cartoon/realistic/horror palettes)
    hist_r, _ = np.histogram(arr[:, :, 0], bins=8, range=(0, 1), density=True)
    hist_g, _ = np.histogram(arr[:, :, 1], bins=8, range=(0, 1), density=True)
    hist_b, _ = np.histogram(arr[:, :, 2], bins=8, range=(0, 1), density=True)

    # Texture/edge density approximation
    gray = (0.299 * arr[:, :, 0]) + (0.587 * arr[:, :, 1]) + (0.114 * arr[:, :, 2])
    gx = np.abs(np.diff(gray, axis=1))
    gy = np.abs(np.diff(gray, axis=0))
    edge_density = float((gx > 0.08).mean() + (gy > 0.08).mean()) / 2.0
    edge_mean = float((gx.mean() + gy.mean()) / 2.0)

    return np.concatenate(
        [
            mean_rgb,
            std_rgb,
            np.array([dark_ratio, bright_ratio, sat_mean, sat_std, edge_density, edge_mean], dtype=np.float32),
            hist_r.astype(np.float32),
            hist_g.astype(np.float32),
            hist_b.astype(np.float32),
        ]
    ).astype(np.float32)


def resolve_local_image(link_code: str, cache_root: Path) -> Path | None:
    if not cache_root.exists():
        return None
    patterns = [f"{link_code}.jpg", f"{link_code}.jpeg", f"{link_code}.png", f"{link_code}.webp"]
    for p in patterns:
        direct = cache_root / p
        if direct.exists():
            return direct
    for p in patterns:
        hits = list(cache_root.rglob(p))
        if hits:
            return hits[0]
    return None


def feature_for_row(
    link_code: str,
    image_url: str,
    tag_group: str,
    quality_score: float,
    cache_root: Path,
    download_missing: bool,
) -> np.ndarray:
    local_path = resolve_local_image(link_code, cache_root)
    if local_path is not None:
        try:
            with Image.open(local_path) as img:
                visual = image_feature_from_pil(img)
        except Exception:
            visual = stable_vector(f"{image_url}|{tag_group}|{quality_score:.4f}", dim=36)
    elif download_missing and image_url.startswith("http"):
        try:
            r = requests.get(image_url, timeout=15)
            r.raise_for_status()
            with Image.open(io.BytesIO(r.content)) as img:
                visual = image_feature_from_pil(img)
        except Exception:
            visual = stable_vector(f"{image_url}|{tag_group}|{quality_score:.4f}", dim=36)
    else:
        # Fallback keeps item in clustering even when image is unavailable.
        path = urlparse(image_url).path.lower()
        ext = path.split(".")[-1] if "." in path else "img"
        visual = stable_vector(f"{tag_group}|{quality_score:.4f}|{ext}", dim=36)

    # Lightweight semantic anchor to reduce random mixing.
    tag_vec = stable_vector((tag_group or "general").lower().strip(), dim=16) * 0.20
    score_vec = np.array([float(quality_score or 0.0)], dtype=np.float32) * 0.05
    return np.concatenate([visual, tag_vec, score_vec]).astype(np.float32)


def merge_small_clusters(labels: np.ndarray, feats: np.ndarray, min_size: int) -> np.ndarray:
    if int(min_size) <= 1:
        return labels

    counts = Counter(labels.tolist())
    if not counts:
        return labels

    large_labels = [label for label, size in counts.items() if size >= min_size]
    if not large_labels:
        return labels

    merged = labels.copy()
    centroids = {label: feats[labels == label].mean(axis=0) for label in counts.keys()}
    for small_label, size in counts.items():
        if size >= min_size:
            continue
        # Assign each small cluster to nearest large centroid.
        small_centroid = centroids[small_label]
        best_large = min(
            large_labels,
            key=lambda ll: float(np.linalg.norm(small_centroid - centroids[ll])),
        )
        merged[merged == small_label] = best_large

    remap = {old: i for i, old in enumerate(sorted(set(merged.tolist())))}
    return np.array([remap[x] for x in merged], dtype=np.int32)


def choose_cluster_name(tags: pd.Series, cluster_id: int) -> str:
    counts = tags.fillna("general").astype(str).str.lower().value_counts()
    non_generic = counts.drop(labels=[t for t in counts.index if t in {"general", "unknown", "nan", "none"}], errors="ignore")
    if not non_generic.empty:
        primary = str(non_generic.index[0])
        primary_share = float(non_generic.iloc[0]) / float(max(1, counts.sum()))
        if primary_share >= 0.06:
            return f"cluster_{primary}_{cluster_id:02d}"
    return f"cluster_mixed_{cluster_id:02d}"


def choose_cluster_categories(tags: pd.Series) -> list[str]:
    counts = tags.fillna("general").astype(str).str.lower().value_counts()
    non_generic = [str(tag) for tag in counts.index if str(tag) not in {"general", "unknown", "nan", "none"}]
    if non_generic:
        return non_generic[:5]
    return [str(counts.index[0])]


def main() -> None:
    args = parse_args()
    cfg = load_yaml(args.config)
    runtime = load_runtime(args.config)
    input_csv = Path(args.input or cfg.get("paths", {}).get("dataset_csv", "ml/tgis/artifacts/dataset_candidates.csv"))
    output_csv = Path(cfg.get("paths", {}).get("clusters_csv", "ml/tgis/artifacts/clusters.csv"))
    mode = str(args.mode or cfg.get("clustering", {}).get("mode", "taxonomy")).strip().lower()
    k = int(args.k or cfg.get("clustering", {}).get("k", runtime.default_k))
    min_cluster_size = int(args.min_cluster_size or cfg.get("clustering", {}).get("min_cluster_size", runtime.min_cluster_size))
    thumb_cache_dir = Path(
        args.thumb_cache_dir
        or cfg.get("clustering", {}).get("thumb_cache_dir", "ml/tgis/artifacts/thumbs_clean_025")
    )
    download_missing = bool(args.download_missing or cfg.get("clustering", {}).get("download_missing", False))

    if not input_csv.exists():
        raise FileNotFoundError(f"dataset not found: {input_csv}")

    df = pd.read_csv(input_csv)
    if df.empty:
        print("[TGIS] empty dataset, skipping clustering")
        return

    if mode == "taxonomy":
        df["category"] = df["tag_group"].fillna("general").astype(str).map(normalize_to_fixed_category)
        cat_to_id = {cat: i + 1 for i, cat in enumerate(FIXED_CATEGORIES)}
        df["cluster_id"] = df["category"].map(cat_to_id).astype(int)
        df["cluster_name"] = df["category"].map(lambda c: f"cluster_{c}")
        clusters_final = int(df["cluster_id"].nunique())
    else:
        feats = np.stack(
            [
                feature_for_row(
                    link_code=str(getattr(row, "link_code", "") or ""),
                    image_url=str(getattr(row, "image_url", "") or ""),
                    tag_group=str(getattr(row, "tag_group", "general") or "general"),
                    quality_score=float(getattr(row, "quality_score", 0) or 0),
                    cache_root=thumb_cache_dir,
                    download_missing=download_missing,
                )
                for row in df.itertuples(index=False)
            ]
        )

        k = max(2, min(k, len(df)))
        km = KMeans(n_clusters=k, random_state=42, n_init=10)
        labels = km.fit_predict(feats)
        labels = merge_small_clusters(labels, feats=feats, min_size=min_cluster_size)

        df["cluster_id"] = labels
        cluster_name_map = {
            int(cluster_id): choose_cluster_name(group["tag_group"], int(cluster_id))
            for cluster_id, group in df.groupby("cluster_id")
        }
        df["cluster_name"] = df["cluster_id"].map(cluster_name_map)
        # keep DB ids 1-based in visual mode for compatibility
        df["cluster_id"] = df["cluster_id"].astype(int) + 1
        clusters_final = int(df["cluster_id"].nunique())

    df.to_csv(output_csv, index=False)

    cluster_categories: dict[int, list[str]] = defaultdict(list)
    for cluster_id, group in df.groupby("cluster_id"):
        if mode == "taxonomy":
            cat = str(group["category"].iloc[0])
            cluster_categories[int(cluster_id)] = [cat]
        else:
            cluster_categories[int(cluster_id)] = choose_cluster_categories(group["tag_group"])

    with connect_db(runtime) as conn:
        with conn.cursor() as cur:
            active_cluster_ids: list[int] = []
            for cluster_id in sorted(cluster_categories.keys()):
                categories = cluster_categories[cluster_id]
                if mode == "taxonomy":
                    cluster_name = f"cluster_{categories[0]}"
                else:
                    cluster_name = str(df[df["cluster_id"] == cluster_id]["cluster_name"].iloc[0])
                trigger_word = f"tgis_{cluster_name}"
                db_cluster_id = int(cluster_id)
                active_cluster_ids.append(db_cluster_id)
                cur.execute(
                    """
                    insert into public.tgis_cluster_registry(cluster_id, cluster_name, trigger_word, categories_json, is_active, updated_at)
                    values (%s, %s, %s, %s::jsonb, true, now())
                    on conflict (cluster_id) do update
                      set cluster_name = excluded.cluster_name,
                          trigger_word = excluded.trigger_word,
                          categories_json = excluded.categories_json,
                          is_active = true,
                          updated_at = now()
                    """,
                    (db_cluster_id, cluster_name, trigger_word, json.dumps(categories)),
                )

            if active_cluster_ids:
                cur.execute(
                    """
                    update public.tgis_cluster_registry
                    set is_active = false, updated_at = now()
                    where cluster_id <> all(%s)
                    """,
                    (active_cluster_ids,),
                )

            cur.execute(
                """
                insert into public.tgis_dataset_runs(run_type, status, summary_json, started_at, ended_at)
                values ('clustering', 'success', %s::jsonb, now(), now())
                """,
                (json.dumps({
                    "mode": mode,
                    "rows": int(len(df)),
                    "k_requested": int(k),
                    "clusters_final": clusters_final,
                    "min_cluster_size": int(min_cluster_size),
                    "output": str(output_csv),
                    "ts": utc_now_iso(),
                }),),
            )
        conn.commit()

    print(f"[TGIS] clustered mode={mode} rows={len(df)} clusters={clusters_final} output={output_csv}")


if __name__ == "__main__":
    main()
