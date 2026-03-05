from __future__ import annotations

import argparse
import json
import os
import re
from pathlib import Path
from typing import Any

import requests

from ml.tgis.runtime import connect_db, load_runtime, utc_now_iso


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Generate prompt templates (v1) from top reference images via vision synthesis")
    p.add_argument("--config", default="ml/tgis/configs/base.yaml")
    p.add_argument("--targets", default="1v1,tycoon", help="comma-separated exact cluster_slug values")
    p.add_argument("--top-n", type=int, default=20)
    p.add_argument("--vision-model", default="openai/gpt-4o")
    p.add_argument("--synth-model", default="openai/gpt-4o")
    p.add_argument("--report", default="ml/tgis/artifacts/prompt_templates_v1_report.json")
    p.add_argument("--dry-run", action="store_true")
    return p.parse_args()


def _norm(v: Any) -> str:
    return re.sub(r"\s+", " ", str(v or "").strip().lower())


def _slug(v: Any) -> str:
    return re.sub(r"_+", "_", re.sub(r"[^a-z0-9_]+", "_", _norm(v))).strip("_")


def _call_openrouter(*, api_key: str, model: str, messages: list[dict[str, Any]], temperature: float, max_tokens: int) -> str:
    resp = requests.post(
        "https://openrouter.ai/api/v1/chat/completions",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": os.getenv("OPENROUTER_REFERER", "https://surpriseradar.app"),
            "X-Title": os.getenv("OPENROUTER_TITLE", "SurpriseRadar-TGIS"),
        },
        json={
            "model": model,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "messages": messages,
        },
        timeout=60,
    )
    resp.raise_for_status()
    payload = resp.json()
    return str(payload.get("choices", [{}])[0].get("message", {}).get("content", "")).strip()


def _vision_composition_description(*, api_key: str, model: str, image_url: str) -> str:
    text_prompt = (
        "Describe ONLY the composition and visual structure of this Fortnite Creative thumbnail. "
        "Focus on foreground, midground, background, color palette, camera angle, and composition style. "
        "Do NOT describe specific skin identities, text/logo overlays, or exact object names. "
        "Return 4-6 concise sentences with structural composition guidance."
    )
    return _call_openrouter(
        api_key=api_key,
        model=model,
        temperature=0.1,
        max_tokens=260,
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": text_prompt},
                    {"type": "image_url", "image_url": {"url": image_url}},
                ],
            }
        ],
    )


def _synthesize_base_direction(*, api_key: str, model: str, cluster_slug: str, descriptions: list[str]) -> str:
    joined = "\n\n".join([f"- {d}" for d in descriptions if d.strip()])
    slug = _slug(cluster_slug)
    cluster_guard = (
        "For tycoon clusters: enforce one dominant hero in foreground, progression-rich background, reward fantasy cues, and clean readability. "
        "Do NOT use split-screen composition. "
        if "tycoon" in slug
        else "For duel clusters: enforce confrontation line, dominant foreground subject, and readable opposing subject."
    )
    system = (
        "You synthesize thumbnail composition templates for Fortnite Creative. "
        "Output exactly one concise base direction in English (3-4 lines), focusing on composition and visual hierarchy. "
        "Never suggest text, letters, logos, numbers, symbols, or UI overlays as focal elements. "
        + cluster_guard
    )
    user = (
        f"Cluster slug: {cluster_slug}\n"
        "Below are composition descriptions extracted from top references:\n"
        f"{joined}\n\n"
        "Return only the final base direction text. No markdown, no labels."
    )
    return _call_openrouter(
        api_key=api_key,
        model=model,
        temperature=0.2,
        max_tokens=260,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    )


def _compose_template(cluster_slug: str, base_direction: str) -> str:
    slug = _slug(cluster_slug)
    base = re.sub(r"\s+", " ", (base_direction or "").strip())
    # Safety scrub in case synthesis suggests prohibited focal elements.
    base = re.sub(r"\b(text|letters?|numbers?|symbols?|logos?|ui overlays?)\b", "visual elements", base, flags=re.IGNORECASE)
    if "1v1" in slug or "boxfight" in slug or "zonewars" in slug:
        return (
            f"Fortnite Creative duel thumbnail. {base} "
            "Two opposing players with strong action readability and a clear confrontation line."
        )
    if "tycoon" in slug:
        # Manual template: validated structure for tycoon (no split composition, no text focal element).
        return (
            "Fortnite Creative tycoon thumbnail. A dominant hero character in the foreground with clear triumphant energy and strong silhouette readability. "
            "Background must show progression-rich tycoon environment (factories/shops/upgrades/reward ecosystem) with strong depth layering from foreground to horizon. "
            "Use bright saturated warm-gold palette balanced with clean sky/cool accents, cinematic contrast, and high visual clarity at thumbnail size. "
            "Prioritize reward fantasy, abundance cues, and a single clear focal hierarchy without split-screen layout or text-based focal elements."
        )
    return (
        f"Fortnite Creative gameplay thumbnail. {base} "
        "Maintain clear focal hierarchy, strong depth layering, and readable action."
    )


def main() -> None:
    args = parse_args()
    runtime = load_runtime(args.config)
    report_path = Path(args.report)
    api_key = os.getenv("OPENROUTER_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("OPENROUTER_API_KEY is required")

    targets = [_slug(x) for x in str(args.targets or "").split(",") if _slug(x)]
    if not targets:
        raise RuntimeError("no target cluster_slug values provided")

    results: list[dict[str, Any]] = []
    top_n = max(1, int(args.top_n))

    with connect_db(runtime) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select cluster_id, cluster_slug, cluster_family, cluster_name, routing_tags, categories_json
                from public.tgis_cluster_registry
                where is_active = true
                order by cluster_id asc
                """
            )
            rows = cur.fetchall()

            clusters = [
                {
                    "cluster_id": int(r[0]),
                    "cluster_slug": str(r[1] or ""),
                    "cluster_family": str(r[2] or ""),
                    "cluster_name": str(r[3] or ""),
                    "routing_tags": list(r[4] or []),
                    "categories_json": list(r[5] or []),
                }
                for r in rows
            ]
            by_slug = {_slug(c["cluster_slug"]): c for c in clusters}
            missing = [t for t in targets if t not in by_slug]
            if missing:
                available = sorted(by_slug.keys())
                raise RuntimeError(
                    f"target cluster_slug not found: {missing}. available_active_cluster_slugs={available}"
                )
            clusters = [by_slug[t] for t in targets]

            for c in clusters:
                cur.execute(
                    """
                    select image_url
                    from public.tgis_reference_images
                    where cluster_id = %s
                      and image_url is not null
                    order by quality_score desc nulls last, rank asc nulls last
                    limit %s
                    """,
                    (c["cluster_id"], top_n),
                )
                ref_rows = cur.fetchall()
                image_urls = [str(x[0] or "").strip() for x in ref_rows if str(x[0] or "").strip().startswith("http")]

                descriptions: list[str] = []
                for url in image_urls:
                    try:
                        d = _vision_composition_description(api_key=api_key, model=args.vision_model, image_url=url)
                        if d:
                            descriptions.append(d)
                    except Exception as e:
                        descriptions.append(f"vision_error:{e}")

                if not descriptions:
                    results.append(
                        {
                            "cluster_id": c["cluster_id"],
                            "cluster_slug": c["cluster_slug"],
                            "status": "skipped_no_descriptions",
                            "refs_considered": len(image_urls),
                        }
                    )
                    continue

                base_direction = _synthesize_base_direction(
                    api_key=api_key,
                    model=args.synth_model,
                    cluster_slug=c["cluster_slug"],
                    descriptions=descriptions[: top_n],
                )
                template_text = _compose_template(c["cluster_slug"], base_direction)

                if not args.dry_run:
                    cur.execute(
                        """
                        insert into public.tgis_prompt_templates
                          (cluster_slug, template_text, is_active, version, source, notes, updated_at)
                        values (%s, %s, true, 'v1_generated', 'vision_synth', %s, now())
                        on conflict (cluster_slug) do update
                        set template_text = excluded.template_text,
                            is_active = true,
                            version = excluded.version,
                            source = excluded.source,
                            notes = excluded.notes,
                            updated_at = now()
                        """,
                        (
                            _slug(c["cluster_slug"]),
                            template_text,
                            f"generated_at={utc_now_iso()} vision_model={args.vision_model} synth_model={args.synth_model} refs={len(image_urls)}",
                        ),
                    )

                results.append(
                    {
                        "cluster_id": c["cluster_id"],
                        "cluster_slug": _slug(c["cluster_slug"]),
                        "status": "ok",
                        "refs_considered": len(image_urls),
                        "descriptions_used": len(descriptions),
                        "template_preview": template_text[:220],
                    }
                )

        if not args.dry_run:
            conn.commit()

    payload = {
        "generated_at": utc_now_iso(),
        "targets": targets,
        "top_n": top_n,
        "vision_model": args.vision_model,
        "synth_model": args.synth_model,
        "dry_run": bool(args.dry_run),
        "clusters": results,
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    main()
