from __future__ import annotations

import argparse
import json
import os
import re
import unicodedata
from pathlib import Path
from typing import Any

import pandas as pd
import requests

from ml.tgis.pipelines._thumb_naming import build_thumb_file_name
from ml.tgis.runtime import connect_db, load_runtime, load_yaml, utc_now_iso


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Generate EN training captions for TGIS LoRA datasets")
    p.add_argument("--config", default="ml/tgis/configs/base.yaml")
    p.add_argument("--input", default=None)
    p.add_argument("--output-csv", default=None)
    p.add_argument("--output-report", default=None)
    p.add_argument("--output-jsonl", default=None)
    p.add_argument("--dataset-dir", default=None, help="Output dir for per-cluster metadata.jsonl files")
    p.add_argument("--limit", type=int, default=None)
    p.add_argument("--exclude-misc", action="store_true", default=True)
    p.add_argument("--include-misc", action="store_true", help="Include misc cluster rows")
    p.add_argument("--chunk-size", type=int, default=2000)
    p.add_argument("--use-vision", action="store_true", help="Optional: enrich caption with vision model")
    return p.parse_args()


TAG_SYNONYMS = {
    "just for fun": "casual",
    "just_for_fun": "casual",
    "red vs blue": "red vs blue",
    "pvp": "pvp",
    "simulator": "simulator",
    "tycoon": "tycoon",
    "horror": "horror",
    "deathrun": "deathrun",
    "prop hunt": "prop hunt",
    "party games": "party games",
    "roleplay": "roleplay",
    "fashion": "fashion",
    "driving": "driving",
}

PHRASE_HINTS = (
    "red vs blue",
    "box fight",
    "zone wars",
    "gun game",
    "1v1",
    "2v2",
    "4v4",
    "prop hunt",
    "hide and seek",
    "parkour",
    "obby",
    "escape room",
    "murder mystery",
    "party royale",
    "rocket racing",
    "boss fight",
    "survival",
    "zombie",
    "roguelike",
    "simulator",
    "tycoon",
)


def _to_ascii_lower(text: str | None) -> str:
    if not text:
        return ""
    norm = unicodedata.normalize("NFKD", str(text))
    ascii_text = norm.encode("ascii", "ignore").decode("ascii")
    ascii_text = ascii_text.lower()
    ascii_text = re.sub(r"[^a-z0-9\\s]", " ", ascii_text)
    ascii_text = re.sub(r"\\s+", " ", ascii_text).strip()
    return ascii_text


def _normalize_tag(tag: str) -> str:
    t = _to_ascii_lower(tag).replace("_", " ").strip()
    if not t:
        return ""
    return TAG_SYNONYMS.get(t, t)


def _parse_rating_short(ratings: Any) -> str | None:
    if not isinstance(ratings, dict):
        return None
    boards = ratings.get("boards")
    if not isinstance(boards, dict):
        return None
    preferred_order = ("ESRB", "PEGI", "USK", "ClassInd", "Generic")
    board_item = None
    for name in preferred_order:
        if name in boards and isinstance(boards[name], dict):
            board_item = boards[name]
            break
    if board_item is None:
        for _, value in boards.items():
            if isinstance(value, dict):
                board_item = value
                break
    if not board_item:
        return None
    raw_rating = str(board_item.get("rating") or "").strip()
    if not raw_rating:
        return None
    raw_lower = raw_rating.lower()
    if "esrb_age_t" in raw_lower:
        return "teen"
    if "esrb_age_m" in raw_lower:
        return "mature"
    if "age_12" in raw_lower:
        return "12+"
    if "age_16" in raw_lower:
        return "16+"
    if "age_18" in raw_lower:
        return "18+"
    if "e10" in raw_lower:
        return "10+"
    if "age_e" in raw_lower:
        return "everyone"
    return raw_rating


def vision_caption(url: str, tag: str, model: str) -> str | None:
    key = os.getenv("OPENROUTER_API_KEY")
    if not key:
        return None
    payload = {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": f"Describe this Fortnite thumbnail style in one line for LoRA training. Tag: {tag}."},
                    {"type": "image_url", "image_url": {"url": url}},
                ],
            }
        ],
        "max_tokens": 120,
        "temperature": 0.2,
    }
    r = requests.post(
        "https://openrouter.ai/api/v1/chat/completions",
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "HTTP-Referer": os.getenv("OPENROUTER_REFERER", "https://surpriseradar.app"),
            "X-Title": os.getenv("OPENROUTER_TITLE", "SurpriseRadar-TGIS"),
        },
        json=payload,
        timeout=45,
    )
    if not r.ok:
        return None
    data = r.json()
    out = str(data.get("choices", [{}])[0].get("message", {}).get("content", "")).strip()
    return out or None


def _build_caption(
    cluster: str,
    title: str,
    tags: list[str],
    description: str,
    introduction: str,
    map_type: str,
    max_players: int | None,
    rating_short: str | None,
) -> str:
    cluster_norm = _normalize_tag(cluster) or "general"
    parts: list[str] = [f"{cluster_norm} thumbnail", "fortnite creative"]

    if map_type and _to_ascii_lower(map_type) in {"uefn", "fnc"}:
        parts.append(f"{_to_ascii_lower(map_type)} map")

    clean_tags: list[str] = []
    for t in tags:
        nt = _normalize_tag(t)
        if nt:
            clean_tags.append(nt)
    if clean_tags:
        parts.extend(clean_tags[:5])

    combined = " ".join([title or "", description or "", introduction or ""]).strip()
    lower_combined = _to_ascii_lower(combined)
    for phrase in PHRASE_HINTS:
        if phrase in lower_combined:
            parts.append(phrase)

    # Dynamic family phrase (no fixed cluster hardcode).
    if cluster_norm and cluster_norm not in {"general", "misc"}:
        parts.append(f"{cluster_norm.replace('_', ' ')} gameplay")

    if isinstance(max_players, int) and max_players > 0:
        parts.append(f"up to {max_players} players")
    if rating_short:
        parts.append(f"{rating_short} rated")

    # Deduplicate while preserving order.
    final: list[str] = []
    seen = set()
    for part in parts:
        p = _to_ascii_lower(part)
        if not p:
            continue
        if p in seen:
            continue
        seen.add(p)
        final.append(p)

    # Keep captions concise for LoRA.
    final = final[:16]
    return ", ".join(final)


def _fetch_metadata_map(runtime, link_codes: list[str], chunk_size: int) -> dict[str, dict[str, Any]]:
    if not link_codes:
        return {}
    chunk_size = max(200, int(chunk_size))
    meta_map: dict[str, dict[str, Any]] = {}
    with connect_db(runtime) as conn:
        with conn.cursor() as cur:
            for i in range(0, len(link_codes), chunk_size):
                chunk = link_codes[i : i + chunk_size]
                cur.execute(
                    """
                    with req as (
                      select unnest(%s::text[]) as link_code
                    ),
                    latest_report as (
                      select distinct on (r.island_code)
                        r.island_code,
                        r.title as report_title,
                        r.tags as report_tags,
                        r.created_in as map_type,
                        r.creator_code as report_creator_code,
                        r.updated_at as report_updated_at
                      from public.discover_report_islands r
                      join req q on q.link_code = r.island_code
                      order by r.island_code, r.updated_at desc nulls last
                    )
                    select
                      m.link_code,
                      m.title as meta_title,
                      m.tagline,
                      m.introduction,
                      m.support_code,
                      m.image_url as meta_image_url,
                      m.published_at_epic,
                      m.updated_at_epic,
                      m.version,
                      m.max_players,
                      m.min_players,
                      m.ratings,
                      lr.report_title,
                      lr.report_tags,
                      lr.map_type,
                      lr.report_creator_code
                    from public.discover_link_metadata m
                    join req q on q.link_code = m.link_code
                    left join latest_report lr on lr.island_code = m.link_code
                    where m.link_code_type = 'island'
                    """,
                    (chunk,),
                )
                for row in cur.fetchall():
                    (
                        link_code,
                        meta_title,
                        tagline,
                        introduction,
                        support_code,
                        meta_image_url,
                        published_at_epic,
                        updated_at_epic,
                        version,
                        max_players,
                        min_players,
                        ratings,
                        report_title,
                        report_tags,
                        map_type,
                        report_creator_code,
                    ) = row
                    tags_list: list[str] = []
                    if isinstance(report_tags, list):
                        tags_list = [str(t) for t in report_tags if t is not None]
                    meta_map[str(link_code)] = {
                        "title": report_title or meta_title or "",
                        "description": tagline or "",
                        "introduction": introduction or "",
                        "tags": tags_list,
                        "map_type": map_type or "",
                        "creator_code": support_code or report_creator_code or "",
                        "image_url": meta_image_url or "",
                        "published_at_epic": str(published_at_epic) if published_at_epic else "",
                        "updated_at_epic": str(updated_at_epic) if updated_at_epic else "",
                        "version": int(version) if version is not None else None,
                        "max_players": int(max_players) if max_players is not None else None,
                        "min_players": int(min_players) if min_players is not None else None,
                        "ratings": ratings if isinstance(ratings, dict) else {},
                    }
    return meta_map


def main() -> None:
    args = parse_args()
    cfg = load_yaml(args.config)
    runtime = load_runtime(args.config)
    input_path = Path(args.input or cfg.get("paths", {}).get("clusters_csv", "ml/tgis/artifacts/clusters.csv"))
    output_csv = Path(
        args.output_csv or cfg.get("paths", {}).get("training_metadata_csv", "ml/tgis/artifacts/training_metadata.csv")
    )
    output_report = Path(
        args.output_report
        or cfg.get("paths", {}).get("training_metadata_report", "ml/tgis/artifacts/training_metadata_report.json")
    )
    output_jsonl = Path(args.output_jsonl or cfg.get("paths", {}).get("captions_jsonl", "ml/tgis/artifacts/captions.jsonl"))
    dataset_dir = Path(
        args.dataset_dir or cfg.get("paths", {}).get("training_dataset_dir", "ml/tgis/artifacts/train_datasets")
    )
    thumbs_root = Path(cfg.get("paths", {}).get("artifacts", "ml/tgis/artifacts")) / "thumbs"
    model = str(cfg.get("captioning", {}).get("model", "openai/gpt-4o-mini"))
    use_vision = bool(args.use_vision or cfg.get("captioning", {}).get("use_vision", False))

    if not input_path.exists():
        raise FileNotFoundError(f"clusters file not found: {input_path}")

    df = pd.read_csv(input_path)
    if args.exclude_misc and not args.include_misc:
        if "cluster_slug" in df.columns:
            df = df[df["cluster_slug"].astype(str).str.lower() != "misc_unclassified"].copy()
        elif "cluster_name" in df.columns:
            df = df[df["cluster_name"].astype(str).str.lower() != "cluster_misc"].copy()
    if args.limit:
        df = df.head(args.limit)
    if df.empty:
        raise RuntimeError("No rows available for captioning after filters")

    link_codes = sorted(set(df["link_code"].astype(str).tolist()))
    meta_map = _fetch_metadata_map(runtime, link_codes=link_codes, chunk_size=args.chunk_size)

    # If cluster_id is not present (V2 pre-registry sync), assign stable local ids.
    has_cluster_id = "cluster_id" in df.columns
    slug_to_local_id: dict[str, int] = {}
    next_local_id = 1
    if not has_cluster_id:
        if "cluster_slug" in df.columns:
            for s in sorted(set(df["cluster_slug"].astype(str).tolist())):
                slug = _to_ascii_lower(s).replace(" ", "_")
                if slug and slug not in slug_to_local_id:
                    slug_to_local_id[slug] = next_local_id
                    next_local_id += 1
        elif "cluster_name" in df.columns:
            for s in sorted(set(df["cluster_name"].astype(str).tolist())):
                slug = _to_ascii_lower(str(s).replace("cluster_", "", 1)).replace(" ", "_")
                if slug and slug not in slug_to_local_id:
                    slug_to_local_id[slug] = next_local_id
                    next_local_id += 1

    rows_out: list[dict[str, Any]] = []
    coverage = {
        "has_tags": 0,
        "has_description": 0,
        "has_introduction": 0,
        "has_title": 0,
        "used_vision": 0,
        "meta_missing": 0,
    }

    for row in df.itertuples(index=False):
        link_code = str(getattr(row, "link_code", "") or "")
        cluster_slug_raw = str(getattr(row, "cluster_slug", "") or "").strip()
        cluster_family_raw = str(getattr(row, "cluster_family", "") or "").strip()
        cluster_name = str(getattr(row, "cluster_name", "") or "").strip()

        if cluster_slug_raw:
            cluster_slug = _to_ascii_lower(cluster_slug_raw).replace(" ", "_")
        elif cluster_name:
            cluster_slug = _to_ascii_lower(cluster_name.replace("cluster_", "", 1)).replace(" ", "_")
        else:
            cluster_slug = "general"

        if cluster_family_raw:
            cluster_family = _to_ascii_lower(cluster_family_raw).replace(" ", "_")
        elif cluster_slug.startswith("combat_"):
            cluster_family = "combat"
        elif "_" in cluster_slug:
            cluster_family = cluster_slug.split("_", 1)[0]
        else:
            cluster_family = cluster_slug

        if cluster_name:
            cluster_name_out = cluster_name
        else:
            cluster_name_out = f"cluster_{cluster_slug}"

        cluster_id_raw = getattr(row, "cluster_id", None)
        if cluster_id_raw is not None and str(cluster_id_raw).strip():
            cluster_id = int(cluster_id_raw)
        else:
            cluster_id = int(slug_to_local_id.get(cluster_slug, 0))

        cluster = cluster_family or "general"
        quality_score = float(getattr(row, "quality_score", 0.0) or 0.0)
        input_image_url = str(getattr(row, "image_url", "") or "")
        meta = meta_map.get(link_code, {})
        if not meta:
            coverage["meta_missing"] += 1

        title = str(meta.get("title") or "")
        description = str(meta.get("description") or "")
        introduction = str(meta.get("introduction") or "")
        tags = meta.get("tags") or []
        map_type = str(meta.get("map_type") or "")
        max_players = meta.get("max_players")
        ratings = meta.get("ratings") or {}

        if tags:
            coverage["has_tags"] += 1
        if description.strip():
            coverage["has_description"] += 1
        if introduction.strip():
            coverage["has_introduction"] += 1
        if title.strip():
            coverage["has_title"] += 1

        # Keep image URL from clustered row to avoid cross-row metadata contamination.
        image_url = str(input_image_url or meta.get("image_url") or "")
        rating_short = _parse_rating_short(ratings)

        cap = vision_caption(image_url, cluster, model) if use_vision and image_url.startswith("http") else None
        if cap:
            coverage["used_vision"] += 1
            caption = _to_ascii_lower(cap)
        else:
            caption = _build_caption(
                cluster=cluster,
                title=title,
                tags=list(tags) if isinstance(tags, list) else [],
                description=description,
                introduction=introduction,
                map_type=map_type,
                max_players=max_players if isinstance(max_players, int) else None,
                rating_short=rating_short,
            )

        file_name = build_thumb_file_name(link_code, image_url)

        rows_out.append(
            {
                "link_code": link_code,
                "image_url": image_url,
                "cluster_id": cluster_id,
                "cluster_name": cluster_name_out,
                "cluster_slug": cluster_slug,
                "cluster_family": cluster_family,
                "cluster": cluster,
                "quality_score": quality_score,
                "title": title,
                "tags": list(tags) if isinstance(tags, list) else [],
                "description": description,
                "introduction": introduction,
                "map_type": map_type,
                "creator_code": str(meta.get("creator_code") or ""),
                "published_at_epic": str(meta.get("published_at_epic") or ""),
                "updated_at_epic": str(meta.get("updated_at_epic") or ""),
                "version": meta.get("version"),
                "max_players": meta.get("max_players"),
                "age_rating": rating_short or "",
                "file_name": file_name,
                "caption": caption,
                "ts": utc_now_iso(),
            }
        )

    out_df = pd.DataFrame(rows_out)
    output_csv.parent.mkdir(parents=True, exist_ok=True)
    output_jsonl.parent.mkdir(parents=True, exist_ok=True)
    output_report.parent.mkdir(parents=True, exist_ok=True)
    dataset_dir.mkdir(parents=True, exist_ok=True)

    out_df.to_csv(output_csv, index=False)

    with output_jsonl.open("w", encoding="utf-8") as f:
        for rec in rows_out:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")

    by_cluster_counts = out_df.groupby("cluster", dropna=False)["link_code"].count().to_dict()
    examples_by_cluster = {}
    for cluster_name, group in out_df.groupby("cluster", dropna=False):
        examples_by_cluster[str(cluster_name)] = group["caption"].head(5).tolist()

    # Per-cluster metadata.jsonl for AI Toolkit datasets.
    for cluster_id, group in out_df.groupby("cluster_id", dropna=False):
        cluster_dir = dataset_dir / f"cluster_{int(cluster_id):02d}"
        cluster_dir.mkdir(parents=True, exist_ok=True)
        meta_jsonl = cluster_dir / "metadata.jsonl"
        with meta_jsonl.open("w", encoding="utf-8") as f:
            for g in group.itertuples(index=False):
                f.write(
                    json.dumps(
                        {
                            "file_name": str(g.file_name),
                            "text": str(g.caption),
                            "link_code": str(g.link_code),
                            "image_url": str(g.image_url),
                            "cluster": str(g.cluster),
                        },
                        ensure_ascii=False,
                    )
                    + "\n"
                )

    # AI Toolkit uses image sidecar text files when caption_ext=txt.
    # Keep these in thumbs/cluster_xx/<image_stem>.txt for direct training.
    txt_written = 0
    for rec in rows_out:
        cluster_id = int(rec.get("cluster_id") or 0)
        file_name = str(rec.get("file_name") or "").strip()
        caption = str(rec.get("caption") or "").strip()
        if cluster_id <= 0 or not file_name or not caption:
            continue
        cluster_thumb_dir = thumbs_root / f"cluster_{cluster_id:02d}"
        stem = Path(file_name).stem
        txt_path = cluster_thumb_dir / f"{stem}.txt"
        cluster_thumb_dir.mkdir(parents=True, exist_ok=True)
        txt_path.write_text(caption, encoding="utf-8")
        txt_written += 1

    report = {
        "generated_at": utc_now_iso(),
        "rows_total": int(len(out_df)),
        "clusters": int(out_df["cluster_id"].nunique()),
        "by_cluster": {str(k): int(v) for k, v in by_cluster_counts.items()},
        "caption_coverage": coverage,
        "examples_by_cluster": examples_by_cluster,
        "outputs": {
            "training_metadata_csv": str(output_csv),
            "training_metadata_jsonl": str(output_jsonl),
            "training_metadata_report": str(output_report),
            "training_dataset_dir": str(dataset_dir),
            "txt_sidecars_written": int(txt_written),
        },
        "language": "en",
        "use_vision": bool(use_vision),
    }
    with output_report.open("w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    print(
        f"[TGIS] training metadata rows={len(out_df)} csv={output_csv} report={output_report} dataset_dir={dataset_dir}"
    )


if __name__ == "__main__":
    main()
