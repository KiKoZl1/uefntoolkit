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
    p = argparse.ArgumentParser(description="Validate curated clusters_v3 against manual curation rules")
    p.add_argument("--input", default="ml/tgis/artifacts/clusters_v3.csv")
    p.add_argument("--rules-yaml", default="ml/tgis/configs/cluster_curation_v3.yaml")
    p.add_argument("--min-cluster-size", type=int, default=14)
    p.add_argument("--report", default="ml/tgis/artifacts/cluster_curation_validation_v3.json")
    return p.parse_args()


def extract_code(value: Any) -> str:
    m = CODE_RE.search(str(value or ""))
    return m.group(0) if m else ""


def _slug(v: Any) -> str:
    s = str(v or "").strip().lower().replace("-", "_").replace(" ", "_")
    s = re.sub(r"[^a-z0-9_]+", "", s)
    return re.sub(r"_+", "_", s).strip("_")


def main() -> None:
    args = parse_args()
    input_csv = Path(args.input)
    rules_yaml = Path(args.rules_yaml)
    report_json = Path(args.report)

    if not input_csv.exists():
        raise FileNotFoundError(f"input csv not found: {input_csv}")
    if not rules_yaml.exists():
        raise FileNotFoundError(f"rules yaml not found: {rules_yaml}")

    df = pd.read_csv(input_csv)
    if df.empty:
        raise RuntimeError("input is empty")
    needed = {"link_code", "image_url", "cluster_slug"}
    missing = [c for c in needed if c not in df.columns]
    if missing:
        raise RuntimeError(f"missing required columns: {missing}")

    rules = yaml.safe_load(rules_yaml.read_text(encoding="utf-8")) or {}
    blacklist = {extract_code(x) for x in (rules.get("blacklist") or []) if extract_code(x)}
    overrides = {extract_code(k): _slug(v) for k, v in (rules.get("overrides") or {}).items() if extract_code(k) and _slug(v)}

    df = df.copy()
    df["link_code"] = df["link_code"].map(extract_code)
    df["cluster_slug"] = df["cluster_slug"].map(_slug)

    present_blacklist = sorted(set(df.loc[df["link_code"].isin(blacklist), "link_code"].tolist()))

    override_violations = []
    for code, target in overrides.items():
        rows = df[df["link_code"] == code]
        if rows.empty:
            continue
        bad = rows[rows["cluster_slug"] != target]
        if not bad.empty:
            override_violations.append(
                {
                    "link_code": code,
                    "expected": target,
                    "found": sorted(set(bad["cluster_slug"].astype(str).tolist())),
                    "rows": int(len(bad)),
                }
            )

    pair_conflicts = int(
        (df.groupby(["link_code", "image_url"])["cluster_slug"].nunique() > 1).sum()
    )

    counts = df["cluster_slug"].value_counts()
    small_clusters = {str(k): int(v) for k, v in counts.items() if int(v) < int(args.min_cluster_size)}

    ok = not present_blacklist and not override_violations and pair_conflicts == 0 and not small_clusters

    payload = {
        "generated_at": utc_now_iso(),
        "input": str(input_csv),
        "rules_yaml": str(rules_yaml),
        "ok": bool(ok),
        "rows": int(len(df)),
        "clusters": int(df["cluster_slug"].nunique()),
        "blacklist_present_count": int(len(present_blacklist)),
        "blacklist_present": present_blacklist,
        "override_violations_count": int(len(override_violations)),
        "override_violations": override_violations,
        "pair_conflicts": pair_conflicts,
        "small_clusters_count": int(len(small_clusters)),
        "small_clusters": small_clusters,
        "min_cluster_size": int(args.min_cluster_size),
    }
    report_json.parent.mkdir(parents=True, exist_ok=True)
    report_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    print(json.dumps(payload, ensure_ascii=False))
    if not ok:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
