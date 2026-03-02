from __future__ import annotations

import argparse
import json

from ml.tgis.runtime import connect_db, load_runtime


STRICT_THRESHOLDS = {
    "text_legibility": 0.80,
    "visual_adherence": 0.82,
    "artifact_free": 0.90,
    "non_regression": 0.85,
}


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Evaluate strict quality gate for TGIS model version")
    p.add_argument("--config", default="ml/tgis/configs/base.yaml")
    p.add_argument("--cluster-id", type=int, required=True)
    p.add_argument("--version", required=True)
    p.add_argument("--text-legibility", type=float, required=True)
    p.add_argument("--visual-adherence", type=float, required=True)
    p.add_argument("--artifact-free", type=float, required=True)
    p.add_argument("--non-regression", type=float, required=True)
    return p.parse_args()


def main() -> None:
    args = parse_args()
    runtime = load_runtime(args.config)

    scores = {
        "text_legibility": args.text_legibility,
        "visual_adherence": args.visual_adherence,
        "artifact_free": args.artifact_free,
        "non_regression": args.non_regression,
    }
    checks = {k: float(scores[k]) >= float(STRICT_THRESHOLDS[k]) for k in STRICT_THRESHOLDS}
    approved = all(checks.values())
    payload = {
        "gate": "strict",
        "scores": scores,
        "thresholds": STRICT_THRESHOLDS,
        "checks": checks,
        "approved": approved,
    }

    with connect_db(runtime) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                update public.tgis_model_versions
                set quality_gate_json = %s::jsonb,
                    status = case when %s then 'candidate' else 'failed' end,
                    updated_at = now()
                where cluster_id = %s and version = %s
                """,
                (json.dumps(payload), approved, args.cluster_id, args.version),
            )
        conn.commit()

    print(f"[TGIS] quality gate cluster={args.cluster_id} version={args.version} approved={approved}")


if __name__ == "__main__":
    main()
