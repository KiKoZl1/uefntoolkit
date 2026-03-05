from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

import pandas as pd
import yaml

from ml.tgis.runtime import utc_now_iso


CODE_RE = re.compile(r"\d{4}-\d{4}-\d{4}")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Apply manual V3 curation (blacklist + overrides + merges)")
    p.add_argument("--input", default="ml/tgis/artifacts/clusters_v3.csv")
    p.add_argument("--output", default="ml/tgis/artifacts/clusters_v3.csv")
    p.add_argument("--rules-yaml", default="ml/tgis/configs/cluster_curation_v3.yaml")
    p.add_argument("--report", default="ml/tgis/artifacts/cluster_curation_report_v3.json")
    return p.parse_args()


def extract_code(value: Any) -> str:
    s = str(value or "").strip()
    m = CODE_RE.search(s)
    return m.group(0) if m else ""


def load_rules(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise FileNotFoundError(f"rules yaml not found: {path}")
    raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    if not isinstance(raw, dict):
        raise RuntimeError("rules-yaml must be a mapping")
    return raw


def slug(value: Any) -> str:
    s = str(value or "").strip().lower().replace("-", "_").replace(" ", "_")
    s = re.sub(r"[^a-z0-9_]+", "", s)
    s = re.sub(r"_+", "_", s).strip("_")
    return s


def mode_or_default(series: pd.Series, default: str) -> str:
    if series.empty:
        return default
    m = series.mode()
    if not m.empty:
        return str(m.iloc[0] or default)
    return default


def main() -> None:
    args = parse_args()
    input_csv = Path(args.input)
    output_csv = Path(args.output)
    report_json = Path(args.report)
    rules = load_rules(Path(args.rules_yaml))

    if not input_csv.exists():
        raise FileNotFoundError(f"input csv not found: {input_csv}")

    df = pd.read_csv(input_csv)
    if df.empty:
        raise RuntimeError("input is empty")
    required = {"link_code", "image_url", "cluster_slug"}
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise RuntimeError(f"missing required columns: {missing}")

    if "cluster_family" not in df.columns:
        df["cluster_family"] = "misc"

    df["link_code"] = df["link_code"].map(extract_code)
    df["cluster_slug"] = df["cluster_slug"].map(slug)
    df["cluster_family"] = df["cluster_family"].astype(str).map(slug)
    df = df[df["link_code"].astype(bool)].copy()

    rows_in = int(len(df))
    before_counts = {str(k): int(v) for k, v in df["cluster_slug"].value_counts().to_dict().items()}

    blacklist_raw = rules.get("blacklist") or []
    blacklist = {extract_code(x) for x in blacklist_raw if extract_code(x)}
    blacklist_matched = sorted(set(df.loc[df["link_code"].isin(blacklist), "link_code"].tolist()))
    rows_before_blacklist = int(len(df))
    df = df[~df["link_code"].isin(blacklist)].copy()
    rows_removed_blacklist = int(rows_before_blacklist - len(df))

    merges_raw = rules.get("cluster_merges") or {}
    cluster_merges = {slug(k): slug(v) for k, v in merges_raw.items() if slug(k) and slug(v)}
    merge_rows_by_source: dict[str, int] = {}
    if cluster_merges:
        src_counts = df["cluster_slug"].value_counts().to_dict()
        merge_rows_by_source = {k: int(src_counts.get(k, 0)) for k in cluster_merges.keys()}
        df["cluster_slug"] = df["cluster_slug"].map(lambda x: cluster_merges.get(x, x))

    overrides_raw = rules.get("overrides") or {}
    overrides = {extract_code(k): slug(v) for k, v in overrides_raw.items() if extract_code(k) and slug(v)}
    override_matched = sorted(set(df.loc[df["link_code"].isin(set(overrides.keys())), "link_code"].tolist()))
    if overrides:
        df["cluster_slug"] = df.apply(
            lambda r: overrides.get(str(r["link_code"]), str(r["cluster_slug"])),
            axis=1,
        )

    family_overrides_raw = rules.get("family_overrides") or {}
    family_overrides = {slug(k): slug(v) for k, v in family_overrides_raw.items() if slug(k) and slug(v)}

    inferred_family = (
        df.groupby("cluster_slug", dropna=False)["cluster_family"]
        .agg(lambda x: mode_or_default(x.astype(str), "misc"))
        .to_dict()
    )
    inferred_family.update(family_overrides)
    df["cluster_family"] = df["cluster_slug"].map(lambda s: inferred_family.get(str(s), "misc"))

    # Guard rail: one pair cannot map to multiple clusters.
    uniq = df.groupby(["link_code", "image_url"])["cluster_slug"].nunique().reset_index(name="slug_n")
    conflicts = uniq[uniq["slug_n"] > 1]
    if not conflicts.empty:
        raise RuntimeError(f"pair conflict after curation: {len(conflicts)}")

    # Stable ordering.
    if "quality_score" in df.columns:
        df["quality_score"] = pd.to_numeric(df["quality_score"], errors="coerce").fillna(0)
        df = df.sort_values(by=["quality_score"], ascending=False)

    output_csv.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(output_csv, index=False)

    after_counts = {str(k): int(v) for k, v in df["cluster_slug"].value_counts().to_dict().items()}
    report = {
        "generated_at": utc_now_iso(),
        "input": str(input_csv),
        "output": str(output_csv),
        "rows_input": rows_in,
        "rows_output": int(len(df)),
        "rows_removed_blacklist": rows_removed_blacklist,
        "blacklist_total": int(len(blacklist)),
        "blacklist_matched": int(len(blacklist_matched)),
        "blacklist_unmatched": sorted(list(blacklist - set(blacklist_matched))),
        "cluster_merges_total": int(len(cluster_merges)),
        "cluster_merges_rows_by_source": merge_rows_by_source,
        "overrides_total": int(len(overrides)),
        "overrides_matched": int(len(override_matched)),
        "overrides_unmatched": sorted(list(set(overrides.keys()) - set(override_matched))),
        "clusters_before": before_counts,
        "clusters_after": after_counts,
    }
    report_json.parent.mkdir(parents=True, exist_ok=True)
    report_json.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    print(
        f"[TGIS][apply_manual_curation_v3] rows_in={rows_in} rows_out={len(df)} "
        f"blacklist_matched={len(blacklist_matched)} overrides_matched={len(override_matched)} "
        f"clusters={df['cluster_slug'].nunique()} output={output_csv}"
    )


if __name__ == "__main__":
    main()
