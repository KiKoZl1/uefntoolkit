from __future__ import annotations

import argparse
import json
import os
import re
from pathlib import Path
from typing import Any

import pandas as pd
import requests

from ml.tgis.runtime import load_yaml, utc_now_iso


def _slug(v: Any) -> str:
    return re.sub(r"_+", "_", re.sub(r"[^a-z0-9_]+", "_", _norm(v))).strip("_")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="TGIS V2 optional vision pass for misc clusters")
    p.add_argument("--config", default="ml/tgis/configs/base.yaml")
    p.add_argument("--input", default="ml/tgis/artifacts/clusters_v2_misc.csv")
    p.add_argument("--output", default="ml/tgis/artifacts/clusters_v2_misc_vision.csv")
    p.add_argument("--report", default="ml/tgis/artifacts/cluster_misc_vision_report.json")
    p.add_argument("--model", default=None, help="vision model (defaults to captioning.model)")
    p.add_argument("--max-images", type=int, default=250)
    p.add_argument("--apply-suggestions", action="store_true")
    return p.parse_args()


def _norm(v: Any) -> str:
    return re.sub(r"\s+", " ", str(v or "").strip().lower())


def _suggest_from_text(text: str, families: list[str]) -> str:
    t = _norm(text)
    for fam in families:
        token = _slug(fam).replace("_", " ")
        if token and token in t:
            return fam
    return "misc"


def _vision_call(image_url: str, model: str, api_key: str, families: list[str]) -> str:
    allowed = ", ".join(families + ["misc"])
    payload = {
        "model": model,
        "temperature": 0.0,
        "max_tokens": 180,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": (
                            "Classify this Fortnite Creative thumbnail into exactly one family from this list: "
                            f"{allowed}. "
                            "Ignore any text/logo/title in the image. Return JSON only: "
                            "{\"family\":\"...\",\"reason\":\"...\"}."
                        ),
                    },
                    {"type": "image_url", "image_url": {"url": image_url}},
                ],
            }
        ],
    }
    r = requests.post(
        "https://openrouter.ai/api/v1/chat/completions",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": os.getenv("OPENROUTER_REFERER", "https://surpriseradar.app"),
            "X-Title": os.getenv("OPENROUTER_TITLE", "SurpriseRadar-TGIS"),
        },
        json=payload,
        timeout=45,
    )
    r.raise_for_status()
    data = r.json()
    content = str(data.get("choices", [{}])[0].get("message", {}).get("content", "")).strip()
    return content


def _extract_family(content: str, families: list[str]) -> str:
    allowed = set([_slug(f) for f in families] + ["misc"])
    raw = _norm(content)
    # Try JSON first.
    try:
        parsed = json.loads(content)
        fam = _slug(parsed.get("family"))
        if fam in allowed:
            return fam
    except Exception:
        pass
    # Fallback regex pick.
    for fam in allowed:
        token = fam.replace("_", " ")
        if token and re.search(rf"\b{re.escape(token)}\b", raw):
            return fam
    return _suggest_from_text(raw, families=families)


def main() -> None:
    args = parse_args()
    cfg = load_yaml(args.config)
    input_csv = Path(args.input)
    output_csv = Path(args.output)
    report_json = Path(args.report)
    model = str(args.model or cfg.get("captioning", {}).get("model", "openai/gpt-4o-mini")).strip()
    api_key = os.getenv("OPENROUTER_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("OPENROUTER_API_KEY is required for misc vision pass")

    if not input_csv.exists():
        raise FileNotFoundError(f"input csv not found: {input_csv}")
    df = pd.read_csv(input_csv)
    if df.empty:
        raise RuntimeError("input csv is empty")

    if "cluster_slug" not in df.columns:
        raise RuntimeError("input csv missing cluster_slug")
    if "image_url" not in df.columns:
        raise RuntimeError("input csv missing image_url")

    families = sorted(
        {
            _slug(x)
            for x in df.get("cluster_family", pd.Series(dtype=str)).astype(str).tolist()
            if _slug(x) and _slug(x) != "misc"
        }
    )
    if not families:
        families = sorted(
            {
                _slug(x).split("_", 1)[0]
                for x in df["cluster_slug"].astype(str).tolist()
                if _slug(x) and _slug(x) != "misc_unclassified"
            }
        )

    misc_mask = df["cluster_slug"].astype(str).str.startswith("misc")
    idxs = df[misc_mask].index.tolist()[: max(0, int(args.max_images))]

    applied = 0
    failures = 0
    suggestions: list[dict[str, Any]] = []
    for idx in idxs:
        image_url = str(df.at[idx, "image_url"] or "").strip()
        if not image_url.startswith("http"):
            continue
        try:
            content = _vision_call(image_url=image_url, model=model, api_key=api_key, families=families)
            fam = _extract_family(content, families=families)
            if fam not in set(families + ["misc"]):
                fam = "misc"
            suggestions.append(
                {
                    "index": int(idx),
                    "image_url": image_url,
                    "suggested_family": fam,
                    "raw_response": content,
                }
            )
            df.at[idx, "vision_family_suggestion"] = fam
            df.at[idx, "vision_raw_response"] = content[:2000]
            if args.apply_suggestions and fam != "misc":
                df.at[idx, "cluster_family"] = fam
                df.at[idx, "cluster_slug"] = f"{fam}_vision"
                df.at[idx, "phase"] = "misc_vision"
                df.at[idx, "cluster_confidence"] = max(float(df.at[idx, "cluster_confidence"] or 0.0), 0.40)
                applied += 1
        except Exception as e:
            failures += 1
            df.at[idx, "vision_family_suggestion"] = "misc"
            df.at[idx, "vision_raw_response"] = f"error:{str(e)}"

    output_csv.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(output_csv, index=False)

    report = {
        "generated_at": utc_now_iso(),
        "rows_total": int(len(df)),
        "misc_rows_scanned": int(len(idxs)),
        "apply_suggestions": bool(args.apply_suggestions),
        "applied_count": int(applied),
        "failures": int(failures),
        "model": model,
        "output": str(output_csv),
        "sample_suggestions": suggestions[:20],
    }
    report_json.parent.mkdir(parents=True, exist_ok=True)
    report_json.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        f"[TGIS][recluster_misc_vision] scanned={len(idxs)} applied={applied} failures={failures} output={output_csv}"
    )


if __name__ == "__main__":
    main()
