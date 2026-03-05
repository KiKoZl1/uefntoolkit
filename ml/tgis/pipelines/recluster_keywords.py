from __future__ import annotations

import argparse
import ast
import json
import re
from collections import Counter
from pathlib import Path
from typing import Any

import pandas as pd

from ml.tgis.runtime import connect_db, load_runtime, load_yaml, utc_now_iso


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="TGIS V2 keyword-first reclustering")
    p.add_argument("--config", default="ml/tgis/configs/base.yaml")
    p.add_argument("--input", default=None, help="dataset csv (defaults to paths.dataset_csv)")
    p.add_argument("--output", default="ml/tgis/artifacts/clusters_v2_keyword.csv")
    p.add_argument("--purity-report", default="ml/tgis/artifacts/cluster_purity_report_v2_keyword.json")
    p.add_argument("--size-report", default="ml/tgis/artifacts/cluster_size_report_v2_keyword.json")
    p.add_argument("--conflicts-output", default="ml/tgis/artifacts/cluster_conflicts_v2_keyword.csv")
    p.add_argument("--chunk-size", type=int, default=2000)
    p.add_argument("--limit", type=int, default=None)
    p.add_argument("--use-taxonomy-rules", action="store_true", default=False)
    p.add_argument("--min-cluster-size", type=int, default=20)
    return p.parse_args()


def _norm_text(v: Any) -> str:
    if v is None:
        return ""
    s = str(v).lower().strip()
    s = re.sub(r"\s+", " ", s)
    return s


def _slug(v: str) -> str:
    s = _norm_text(v).replace(" ", "_").replace("-", "_")
    s = re.sub(r"[^a-z0-9_]+", "", s)
    s = re.sub(r"_+", "_", s).strip("_")
    return s


GENERIC_LABELS = {
    "",
    "general",
    "misc",
    "variety",
    "fun",
    "just_for_fun",
    "practice",
    "creative",
    "fortnite",
    "map",
    "maps",
    "island",
    "game",
    "games",
    "new",
    "updated",
}


TITLE_STOPWORDS = {
    "the",
    "and",
    "for",
    "with",
    "your",
    "this",
    "that",
    "from",
    "into",
    "only",
    "best",
    "super",
    "ultra",
    "map",
    "maps",
    "fortnite",
    "creative",
}


def _clean_label(v: Any) -> str:
    s = _slug(str(v or ""))
    if not s or s in GENERIC_LABELS:
        return ""
    if len(s) < 3:
        return ""
    return s


def _parse_tags(value: Any) -> list[str]:
    if isinstance(value, list):
        return [_norm_text(v) for v in value if _norm_text(v)]
    if value is None:
        return []
    s = str(value).strip()
    if not s:
        return []
    if s.startswith("[") and s.endswith("]"):
        try:
            arr = ast.literal_eval(s)
            if isinstance(arr, list):
                return [_norm_text(v) for v in arr if _norm_text(v)]
        except Exception:
            pass
    # fallback split
    tokens = re.split(r"[,\|;/]+", s)
    return [_norm_text(t) for t in tokens if _norm_text(t)]


def _title_candidates(title: str) -> list[str]:
    words = [w for w in re.split(r"[^a-z0-9]+", _norm_text(title)) if w]
    words = [w for w in words if len(w) >= 3 and w not in TITLE_STOPWORDS]
    cands: list[str] = []
    for w in words:
        s = _clean_label(w)
        if s:
            cands.append(s)
    for i in range(len(words) - 1):
        bi = _clean_label(f"{words[i]}_{words[i + 1]}")
        if bi:
            cands.append(bi)
    return cands[:20]


def _fetch_metadata_map(runtime, link_codes: list[str], chunk_size: int) -> dict[str, dict[str, Any]]:
    if not link_codes:
        return {}
    out: dict[str, dict[str, Any]] = {}
    with connect_db(runtime) as conn:
        with conn.cursor() as cur:
            cur.execute("set statement_timeout = 0")
            cur.execute(
                """
                with req as (
                  select unnest(%s::text[]) as link_code
                )
                select
                  m.link_code,
                  m.title,
                  m.description,
                  m.introduction,
                  m.tags,
                  m.map_type,
                  m.image_url
                from public.tgis_island_metadata_latest m
                join req on req.link_code = m.link_code
                """,
                (link_codes,),
            )
            for row in cur.fetchall():
                out[str(row[0])] = {
                    "title": str(row[1] or ""),
                    "description": str(row[2] or ""),
                    "introduction": str(row[3] or ""),
                    "tags": row[4] if row[4] is not None else [],
                    "map_type": str(row[5] or ""),
                    "meta_image_url": str(row[6] or ""),
                }
        conn.commit()
    return out


def _load_rules(runtime) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with connect_db(runtime) as conn:
        with conn.cursor() as cur:
            cur.execute("set statement_timeout = 0")
            cur.execute(
                """
                select
                  rule_id,
                  cluster_slug,
                  cluster_family,
                  priority,
                  include_any,
                  include_all,
                  exclude_any
                from public.tgis_cluster_taxonomy_rules
                where is_active = true
                order by priority asc, rule_id asc
                """
            )
            for r in cur.fetchall():
                rows.append(
                    {
                        "rule_id": int(r[0]),
                        "cluster_slug": _slug(str(r[1] or "")),
                        "cluster_family": _slug(str(r[2] or "")),
                        "priority": int(r[3]),
                        "include_any": [_norm_text(x) for x in (r[4] or []) if _norm_text(x)],
                        "include_all": [_norm_text(x) for x in (r[5] or []) if _norm_text(x)],
                        "exclude_any": [_norm_text(x) for x in (r[6] or []) if _norm_text(x)],
                    }
                )
        conn.commit()
    return rows


def _match_rule(rule: dict[str, Any], text: str) -> tuple[bool, float]:
    include_all = list(rule.get("include_all") or [])
    include_any = list(rule.get("include_any") or [])
    exclude_any = list(rule.get("exclude_any") or [])

    for t in exclude_any:
        if t and t in text:
            return False, 0.0

    for t in include_all:
        if t and t not in text:
            return False, 0.0

    any_hits = 0
    if include_any:
        for t in include_any:
            if t and t in text:
                any_hits += 1
        if any_hits <= 0:
            return False, 0.0
    else:
        any_hits = 1

    all_hits = sum(1 for t in include_all if t and t in text)
    score = 0.50 + min(0.30, any_hits * 0.08) + min(0.20, all_hits * 0.10)
    return True, min(0.99, max(0.05, score))


def _derive_slug_from_metadata(
    *,
    title: str,
    tags: list[str],
    description: str,
    introduction: str,
    map_type: str,
    seed_tag_group: str,
) -> tuple[str, float]:
    scores: dict[str, float] = {}

    for idx, raw in enumerate(tags):
        s = _clean_label(raw)
        if not s:
            continue
        scores[s] = scores.get(s, 0.0) + max(10.0, 80.0 - (idx * 5.0))

    mt = _clean_label(map_type)
    if mt:
        scores[mt] = scores.get(mt, 0.0) + 18.0

    for i, c in enumerate(_title_candidates(title)):
        scores[c] = scores.get(c, 0.0) + max(1.0, 8.0 - i)

    # Extra signal from short keyword-like description snippets.
    desc_tokens = _title_candidates(" ".join([description[:120], introduction[:120]]))
    for i, c in enumerate(desc_tokens[:8]):
        scores[c] = scores.get(c, 0.0) + max(0.5, 4.0 - (i * 0.3))

    seed = _clean_label(seed_tag_group)
    if seed and seed not in {"general", "misc", "variety"}:
        scores[seed] = scores.get(seed, 0.0) + 6.0

    if not scores:
        return "misc_unclassified", 0.15

    best_slug, best_score = max(scores.items(), key=lambda kv: kv[1])
    score_vals = sorted(scores.values(), reverse=True)
    gap = (score_vals[0] - score_vals[1]) if len(score_vals) > 1 else score_vals[0]
    confidence = min(0.95, max(0.20, 0.35 + (gap / 80.0)))
    return best_slug, round(float(confidence), 4)


def _family_from_cluster_rows(slug: str, seeds: list[str]) -> str:
    s = _slug(slug)
    if s == "misc_unclassified":
        return "misc"
    seed_counts = Counter(_slug(x) for x in seeds if _slug(x))
    if seed_counts:
        top_seed, _ = seed_counts.most_common(1)[0]
        if top_seed and top_seed not in {"general", "misc", "variety"}:
            return top_seed
    if "_" in s:
        return s.split("_", 1)[0]
    return s or "misc"


def main() -> None:
    args = parse_args()
    cfg = load_yaml(args.config)
    runtime = load_runtime(args.config)
    input_csv = Path(args.input or cfg.get("paths", {}).get("dataset_csv", "ml/tgis/artifacts/dataset_candidates.csv"))
    output_csv = Path(args.output)
    purity_report = Path(args.purity_report)
    size_report = Path(args.size_report)
    conflicts_output = Path(args.conflicts_output)

    if not input_csv.exists():
        raise FileNotFoundError(f"dataset csv not found: {input_csv}")

    df = pd.read_csv(input_csv)
    if args.limit:
        df = df.head(int(args.limit))
    if df.empty:
        raise RuntimeError("empty input dataset")

    needed = {"link_code", "image_url", "quality_score", "tag_group"}
    missing = [c for c in needed if c not in df.columns]
    if missing:
        raise RuntimeError(f"missing required columns in input: {missing}")

    # De-duplicate by exact pair; keep best quality row.
    df["quality_score"] = pd.to_numeric(df["quality_score"], errors="coerce").fillna(0.0)
    df = df.sort_values(by=["quality_score"], ascending=False).drop_duplicates(subset=["link_code", "image_url"], keep="first")

    link_codes = sorted(set(df["link_code"].astype(str).tolist()))
    meta_map = _fetch_metadata_map(runtime, link_codes, chunk_size=args.chunk_size)
    rules = _load_rules(runtime) if args.use_taxonomy_rules else []

    rows: list[dict[str, Any]] = []
    for row in df.itertuples(index=False):
        link_code = str(getattr(row, "link_code", "") or "").strip()
        image_url = str(getattr(row, "image_url", "") or "").strip()
        quality_score = float(getattr(row, "quality_score", 0.0) or 0.0)
        seed_tag_group = _slug(str(getattr(row, "tag_group", "general") or "general"))
        meta = meta_map.get(link_code, {})

        title = str(meta.get("title") or "")
        description = str(meta.get("description") or "")
        introduction = str(meta.get("introduction") or "")
        tags = _parse_tags(meta.get("tags"))
        map_type = str(meta.get("map_type") or "")

        text_blob = " ".join(
            x
            for x in [
                seed_tag_group,
                title,
                description,
                introduction,
                " ".join(tags),
                map_type,
            ]
            if x
        )
        text_blob = _norm_text(text_blob)

        assigned_slug = ""
        confidence = 0.15
        matched_rule_id = None

        if rules:
            for r in rules:
                matched, score = _match_rule(r, text_blob)
                if matched:
                    assigned_slug = r["cluster_slug"]
                    confidence = score
                    matched_rule_id = int(r["rule_id"])
                    break

        if not assigned_slug:
            assigned_slug, confidence = _derive_slug_from_metadata(
                title=title,
                tags=tags,
                description=description,
                introduction=introduction,
                map_type=map_type,
                seed_tag_group=seed_tag_group,
            )

        rows.append(
            {
                "link_code": link_code,
                "image_url": image_url,
                "quality_score": round(float(quality_score), 6),
                "seed_tag_group": seed_tag_group,
                "title": title,
                "tags": tags,
                "description": description,
                "introduction": introduction,
                "map_type": map_type,
                "cluster_slug": assigned_slug,
                "cluster_family": "",
                "cluster_confidence": round(float(confidence), 4),
                "phase": "keyword",
                "matched_rule_id": matched_rule_id,
                "classified_at": utc_now_iso(),
            }
        )

    out = pd.DataFrame(rows)
    out["cluster_slug"] = out["cluster_slug"].astype(str).map(_slug)

    # Collapse tiny buckets to misc for stability.
    min_size = max(1, int(args.min_cluster_size))
    counts = out["cluster_slug"].value_counts()
    small = {str(k) for k, v in counts.items() if int(v) < min_size and str(k) != "misc_unclassified"}
    if small:
        out.loc[out["cluster_slug"].isin(small), "cluster_slug"] = "misc_unclassified"
        out.loc[out["cluster_slug"].eq("misc_unclassified"), "cluster_confidence"] = out["cluster_confidence"].clip(upper=0.4)

    # Compute family dynamically from dominant seed tag per final slug.
    family_map: dict[str, str] = {}
    for slug, g in out.groupby("cluster_slug", dropna=False):
        family_map[str(slug)] = _family_from_cluster_rows(str(slug), g["seed_tag_group"].astype(str).tolist())
    out["cluster_family"] = out["cluster_slug"].astype(str).map(lambda s: family_map.get(str(s), "misc")).map(_slug)

    # Guard rails.
    if out["cluster_slug"].eq("").any():
        bad = out[out["cluster_slug"].eq("")]
        conflicts_output.parent.mkdir(parents=True, exist_ok=True)
        bad.to_csv(conflicts_output, index=False)
        raise RuntimeError(f"empty cluster_slug detected rows={len(bad)} output={conflicts_output}")

    uniq = out.groupby(["link_code", "image_url"])["cluster_slug"].nunique().reset_index(name="slug_n")
    conflicts = uniq[uniq["slug_n"] > 1]
    if not conflicts.empty:
        conflict_rows = out.merge(conflicts[["link_code", "image_url"]], on=["link_code", "image_url"], how="inner")
        conflicts_output.parent.mkdir(parents=True, exist_ok=True)
        conflict_rows.to_csv(conflicts_output, index=False)
        raise RuntimeError(f"pair assigned to multiple cluster_slugs rows={len(conflict_rows)} output={conflicts_output}")

    output_csv.parent.mkdir(parents=True, exist_ok=True)
    out.to_csv(output_csv, index=False)

    # Size report.
    family_counts = out["cluster_family"].value_counts().to_dict()
    slug_counts = out["cluster_slug"].value_counts().to_dict()
    size_payload = {
        "generated_at": utc_now_iso(),
        "rows_total": int(len(out)),
        "clusters_total": int(out["cluster_slug"].nunique()),
        "families_total": int(out["cluster_family"].nunique()),
        "counts_by_cluster_slug": {str(k): int(v) for k, v in slug_counts.items()},
        "counts_by_cluster_family": {str(k): int(v) for k, v in family_counts.items()},
        "output": str(output_csv),
    }
    size_report.parent.mkdir(parents=True, exist_ok=True)
    size_report.write_text(json.dumps(size_payload, ensure_ascii=False, indent=2), encoding="utf-8")

    # Purity report against dominant seed_tag_group (dynamic, no fixed taxonomy in code).
    purity_rows = []
    for cluster_slug, g in out.groupby("cluster_slug", dropna=False):
        family = str(g["cluster_family"].iloc[0] or "misc")
        seed_counter = Counter(g["seed_tag_group"].astype(str).tolist())
        top_seed, top_seed_n = seed_counter.most_common(1)[0] if seed_counter else ("unknown", 0)
        purity = float(top_seed_n) / float(max(1, len(g)))
        purity_rows.append(
            {
                "cluster_slug": str(cluster_slug),
                "cluster_family": family,
                "rows": int(len(g)),
                "purity_against_seed_tag_group": round(purity, 4),
                "dominant_seed_tag_group": str(top_seed),
                "seed_tag_top": [f"{k}:{v}" for k, v in seed_counter.most_common(6)],
            }
        )
    purity_rows = sorted(purity_rows, key=lambda x: (-x["rows"], x["cluster_slug"]))
    misc_rows = int(out["cluster_slug"].astype(str).eq("misc_unclassified").sum())
    misc_rate = round(float(misc_rows) / float(max(1, len(out))), 4)
    purity_payload = {
        "generated_at": utc_now_iso(),
        "rows_total": int(len(out)),
        "clusters_total": int(out["cluster_slug"].nunique()),
        "purity_rows": purity_rows,
        "global_weighted_purity": round(
            sum(r["rows"] * r["purity_against_seed_tag_group"] for r in purity_rows) / max(1, len(out)),
            4,
        ),
        "misc_rows": misc_rows,
        "misc_rate": misc_rate,
        "target_gate": 0.90,
        "output": str(output_csv),
    }
    purity_report.parent.mkdir(parents=True, exist_ok=True)
    purity_report.write_text(json.dumps(purity_payload, ensure_ascii=False, indent=2), encoding="utf-8")

    # Persist clustering summary for admin observability.
    run_summary = {
        "type": "recluster_keywords_v2",
        "rows_total": int(len(out)),
        "clusters_total": int(out["cluster_slug"].nunique()),
        "global_weighted_purity": purity_payload["global_weighted_purity"],
        "misc_rows": misc_rows,
        "misc_rate": misc_rate,
        "output": str(output_csv),
    }
    try:
        with connect_db(runtime) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    insert into public.tgis_dataset_runs
                      (run_type, status, summary_json, started_at, ended_at)
                    values
                      ('clustering', 'success', %s::jsonb, now(), now())
                    """,
                    (json.dumps(run_summary),),
                )
            conn.commit()
    except Exception:
        # Keep file outputs as source of truth even if DB logging fails.
        pass

    print(
        f"[TGIS][recluster_keywords] rows={len(out)} clusters={out['cluster_slug'].nunique()} "
        f"output={output_csv} purity={purity_report} size={size_report}"
    )


if __name__ == "__main__":
    main()
