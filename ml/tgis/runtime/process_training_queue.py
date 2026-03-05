from __future__ import annotations

import argparse
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ml.tgis.runtime import connect_db, load_runtime, load_yaml
from ml.tgis.train.fal_trainer import poll_training_request, submit_cluster_training


DEFAULT_SECONDS_PER_STEP = 1.2
TRAIN_COST_PER_1000_STEPS_USD = 0.85
MAX_RUNNING_POLLS_PER_TICK = 20


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Process queued TGIS training runs")
    p.add_argument("--config", default="ml/tgis/configs/base.yaml")
    p.add_argument("--max-runs", type=int, default=1)
    p.add_argument("--loop", action="store_true", help="keep polling queue continuously")
    p.add_argument("--idle-sleep-seconds", type=int, default=20, help="sleep when idle in --loop mode")
    return p.parse_args()


def _safe_int(v: Any, default: int) -> int:
    try:
        return int(v)
    except Exception:
        return default


def _safe_float(v: Any, default: float) -> float:
    try:
        return float(v)
    except Exception:
        return default


def _load_training_enabled(runtime: dict[str, Any]) -> bool:
    with connect_db(runtime) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select training_enabled
                from public.tgis_runtime_config
                where config_key = 'default'
                limit 1
                """
            )
            row = cur.fetchone()
        conn.commit()
    return bool(row[0]) if row is not None else False


def _is_truthy(v: Any) -> bool:
    return str(v or "").strip().lower() in {"1", "true", "yes", "on"}


def _check_recluster_gate(train_cfg: dict[str, Any], run_payload: dict[str, Any]) -> tuple[bool, str]:
    if _is_truthy(os.getenv("TGIS_SKIP_RECLUSTER_GATE")):
        return True, "skipped_by_env"
    if _is_truthy(run_payload.get("skipReclusterGate")):
        return True, "skipped_by_run_payload"

    gate_enabled = bool(train_cfg.get("require_recluster_gate", True))
    if not gate_enabled:
        return True, "disabled_in_config"

    min_purity = float(train_cfg.get("recluster_min_purity", 0.90))
    max_misc_rate = float(train_cfg.get("recluster_max_misc_rate", 0.30))
    purity_report_path = Path(
        str(train_cfg.get("recluster_purity_report", "ml/tgis/artifacts/cluster_purity_report_v2_keyword.json"))
    )
    conflicts_path = Path(
        str(train_cfg.get("recluster_conflicts_csv", "ml/tgis/artifacts/cluster_conflicts_v2_keyword.csv"))
    )
    final_clusters_path = Path(str(train_cfg.get("recluster_final_csv", "ml/tgis/artifacts/clusters_v2.csv")))

    if not purity_report_path.exists():
        return False, f"missing_purity_report:{purity_report_path}"
    if not final_clusters_path.exists():
        return False, f"missing_final_clusters:{final_clusters_path}"

    try:
        payload = json.loads(purity_report_path.read_text(encoding="utf-8"))
    except Exception as e:
        return False, f"invalid_purity_report:{e}"

    purity_rows = list(payload.get("purity_rows") or [])
    if not purity_rows:
        return False, "empty_purity_rows"

    failing: list[str] = []
    for row in purity_rows:
        fam = str(row.get("cluster_family") or "misc").strip().lower()
        if fam == "misc":
            continue
        slug = str(row.get("cluster_slug") or fam or "unknown")
        purity = float(row.get("purity_against_seed_tag_group") or 0.0)
        if purity < min_purity:
            failing.append(f"{slug}:{purity:.3f}")
    if failing:
        return False, f"purity_below_gate(min={min_purity:.2f}):" + ",".join(failing[:12])

    global_purity = float(payload.get("global_weighted_purity") or 0.0)
    if global_purity < min_purity:
        return False, f"global_purity_below_gate:{global_purity:.3f}< {min_purity:.3f}"

    misc_rate = float(payload.get("misc_rate") or 0.0)
    if misc_rate > max_misc_rate:
        return False, f"misc_rate_above_gate:{misc_rate:.3f}> {max_misc_rate:.3f}"

    if conflicts_path.exists():
        try:
            lines = conflicts_path.read_text(encoding="utf-8", errors="ignore").splitlines()
            if len(lines) > 1:
                return False, f"conflicts_detected:{conflicts_path}"
        except Exception:
            return False, f"unable_to_read_conflicts:{conflicts_path}"

    return True, "ok"


def _estimate_seconds_per_step(runtime: dict[str, Any]) -> float:
    with connect_db(runtime) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select percentile_cont(0.5) within group (
                  order by (
                    extract(epoch from (ended_at - started_at))
                    / nullif((result_json->>'steps')::numeric, 0)
                  )
                ) as sec_per_step
                from public.tgis_training_runs
                where training_provider = 'fal'
                  and status = 'success'
                  and started_at is not null
                  and ended_at is not null
                  and (result_json->>'steps') ~ '^[0-9]+$'
                  and (result_json->>'steps')::int >= 10
                """
            )
            row = cur.fetchone()
        conn.commit()
    v = float(row[0]) if row and row[0] is not None else DEFAULT_SECONDS_PER_STEP
    if v <= 0 or v > 60:
        return DEFAULT_SECONDS_PER_STEP
    return v


def _poll_running_trainings(
    *,
    runtime: dict[str, Any],
    config_path: str,
    default_steps: int,
    default_trainer_model: str,
) -> int:
    with connect_db(runtime) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select id, cluster_id, status, target_version, fal_request_id, result_json, started_at
                from public.tgis_training_runs
                where status = 'running'
                  and training_provider = 'fal'
                  and fal_request_id is not null
                order by started_at asc nulls last, id asc
                limit %s
                """,
                (MAX_RUNNING_POLLS_PER_TICK,),
            )
            rows = cur.fetchall()
        conn.commit()

    if not rows:
        return 0

    sec_per_step = _estimate_seconds_per_step(runtime)
    now = datetime.now(timezone.utc)
    polled_count = 0

    for row in rows:
        run_id = int(row[0])
        cluster_id = int(row[1]) if row[1] is not None else None
        run_status = str(row[2] or "running")
        target_version = str(row[3] or "").strip()
        fal_request_id = str(row[4] or "").strip()
        result_json = dict(row[5] or {})
        started_at = row[6]

        if not fal_request_id:
            continue

        steps = _safe_int(result_json.get("steps"), default_steps)
        steps = max(1, steps)
        elapsed_seconds = 0
        if started_at is not None:
            try:
                elapsed_seconds = max(0, int((now - started_at).total_seconds()))
            except Exception:
                elapsed_seconds = 0

        expected_total_seconds = max(60, int(round(steps * sec_per_step)))
        estimated_cost_usd = round((steps * TRAIN_COST_PER_1000_STEPS_USD) / 1000.0, 6)
        trainer_model = str(
            result_json.get("trainer_model")
            or os.getenv("TGIS_FAL_TRAINER_MODEL")
            or default_trainer_model
        ).strip()

        poll_snapshot: dict[str, Any] = {"polled_at": now.isoformat()}
        provider_status = "POLL_ERROR"
        progress_pct = 0.0
        eta_seconds = max(0, expected_total_seconds - elapsed_seconds)
        provider_metrics: dict[str, Any] = {}

        try:
            polled = poll_training_request(trainer_model=trainer_model, request_id=fal_request_id)
            poll_snapshot.update(polled)
            provider_status = str(polled.get("provider_status") or "UNKNOWN").upper()
            provider_metrics = dict(polled.get("metrics") or {})

            if provider_status == "IN_QUEUE":
                queue_position = _safe_int(polled.get("queue_position"), 0)
                progress_pct = float(max(1, min(8, 8 - min(queue_position, 7))))
                eta_seconds = max(0, expected_total_seconds - elapsed_seconds)
            elif provider_status == "IN_PROGRESS":
                est = int(round((elapsed_seconds / max(1, expected_total_seconds)) * 100))
                progress_pct = float(max(5, min(98, est)))
                eta_seconds = max(0, expected_total_seconds - elapsed_seconds)
            elif provider_status == "COMPLETED":
                progress_pct = 100.0
                eta_seconds = 0
            elif provider_status in {"FAILED", "ERROR", "CANCELLED"}:
                progress_pct = 100.0
                eta_seconds = 0
            else:
                progress_pct = float(max(0, min(99, int(round((elapsed_seconds / max(1, expected_total_seconds)) * 100)))))
                eta_seconds = max(0, expected_total_seconds - elapsed_seconds)

            output_lora_url = str(polled.get("output_lora_url") or "").strip() or None
            poll_error = str(polled.get("error") or "")

            with connect_db(runtime) as conn:
                with conn.cursor() as cur:
                    if provider_status == "COMPLETED" and output_lora_url and run_status == "running":
                        cur.execute(
                            """
                            update public.tgis_training_runs
                            set status = 'success',
                                provider_status = %s,
                                progress_pct = %s,
                                eta_seconds = %s,
                                elapsed_seconds = %s,
                                estimated_cost_usd = %s,
                                provider_metrics_json = %s::jsonb,
                                status_polled_at = now(),
                                output_lora_url = %s,
                                result_json = coalesce(result_json, '{}'::jsonb) || %s::jsonb,
                                ended_at = now(),
                                updated_at = now(),
                                error_text = null
                            where id = %s
                              and status = 'running'
                            """,
                            (
                                provider_status,
                                progress_pct,
                                eta_seconds,
                                elapsed_seconds,
                                estimated_cost_usd,
                                json.dumps(provider_metrics),
                                output_lora_url,
                                json.dumps({"poll": poll_snapshot}),
                                run_id,
                            ),
                        )
                        if cluster_id is not None and target_version:
                            cur.execute(
                                """
                                insert into public.tgis_model_versions
                                (cluster_id, version, lora_fal_path, artifact_uri, status, quality_gate_json, updated_at)
                                values (%s, %s, %s, %s, 'candidate', '{}'::jsonb, now())
                                on conflict (cluster_id, version) do update
                                set lora_fal_path = excluded.lora_fal_path,
                                    artifact_uri = excluded.artifact_uri,
                                    status = 'candidate',
                                    updated_at = now()
                                """,
                                (cluster_id, target_version, output_lora_url, output_lora_url),
                            )
                    elif provider_status in {"FAILED", "ERROR", "CANCELLED"} and run_status == "running":
                        cur.execute(
                            """
                            update public.tgis_training_runs
                            set status = 'failed',
                                provider_status = %s,
                                progress_pct = %s,
                                eta_seconds = %s,
                                elapsed_seconds = %s,
                                estimated_cost_usd = %s,
                                provider_metrics_json = %s::jsonb,
                                status_polled_at = now(),
                                result_json = coalesce(result_json, '{}'::jsonb) || %s::jsonb,
                                ended_at = now(),
                                updated_at = now(),
                                error_text = %s
                            where id = %s
                              and status = 'running'
                            """,
                            (
                                provider_status,
                                progress_pct,
                                eta_seconds,
                                elapsed_seconds,
                                estimated_cost_usd,
                                json.dumps(provider_metrics),
                                json.dumps({"poll": poll_snapshot}),
                                poll_error or f"fal_provider_status_{provider_status.lower()}",
                                run_id,
                            ),
                        )
                    else:
                        cur.execute(
                            """
                            update public.tgis_training_runs
                            set provider_status = %s,
                                progress_pct = %s,
                                eta_seconds = %s,
                                elapsed_seconds = %s,
                                estimated_cost_usd = %s,
                                provider_metrics_json = %s::jsonb,
                                status_polled_at = now(),
                                result_json = coalesce(result_json, '{}'::jsonb) || %s::jsonb,
                                updated_at = now()
                            where id = %s
                            """,
                            (
                                provider_status,
                                progress_pct,
                                eta_seconds,
                                elapsed_seconds,
                                estimated_cost_usd,
                                json.dumps(provider_metrics),
                                json.dumps({"poll": poll_snapshot}),
                                run_id,
                            ),
                        )
                conn.commit()
        except Exception as e:
            with connect_db(runtime) as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        update public.tgis_training_runs
                        set provider_status = 'POLL_ERROR',
                            elapsed_seconds = %s,
                            estimated_cost_usd = %s,
                            status_polled_at = now(),
                            result_json = coalesce(result_json, '{}'::jsonb) || %s::jsonb,
                            updated_at = now()
                        where id = %s
                        """,
                        (
                            elapsed_seconds,
                            estimated_cost_usd,
                            json.dumps({"poll_error": str(e), "polled_at": now.isoformat()}),
                            run_id,
                        ),
                    )
                conn.commit()

        polled_count += 1

    return polled_count


def _run_tick(
    *,
    config_path: str,
    runtime: dict[str, Any],
    webhook_url: str,
    max_runs: int,
    default_steps: int,
    default_lr: float,
    default_trainer_model: str,
    train_cfg: dict[str, Any],
) -> tuple[int, int]:
    processed = 0
    training_enabled = _load_training_enabled(runtime)

    while processed < max_runs:
        with connect_db(runtime) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    select id, cluster_id, run_mode, target_version, result_json
                    from public.tgis_training_runs
                    where status = 'queued'
                      and cluster_id is not null
                    order by created_at asc, id asc
                    limit 1
                    """
                )
                job = cur.fetchone()
            conn.commit()

        if not job:
            break

        run_id = int(job[0])
        cluster_id = int(job[1])
        run_mode = str(job[2] or "manual")
        target_version = str(job[3] or "v_auto")
        run_payload: dict[str, Any] = dict(job[4] or {})
        steps = int(run_payload.get("stepsOverride") or default_steps)
        learning_rate = float(run_payload.get("learningRateOverride") or default_lr)
        max_images_override = run_payload.get("maxImagesOverride")
        max_images = int(max_images_override) if max_images_override is not None else None

        if run_mode != "dry_run" and not training_enabled:
            with connect_db(runtime) as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        update public.tgis_training_runs
                        set status = 'failed',
                            ended_at = now(),
                            updated_at = now(),
                            error_text = 'training_disabled_in_runtime_config'
                        where id = %s
                        """,
                        (run_id,),
                    )
                conn.commit()
            processed += 1
            continue

        if run_mode != "dry_run":
            gate_ok, gate_reason = _check_recluster_gate(train_cfg, run_payload)
            if not gate_ok:
                with connect_db(runtime) as conn:
                    with conn.cursor() as cur:
                        cur.execute(
                            """
                            update public.tgis_training_runs
                            set status = 'failed',
                                ended_at = now(),
                                updated_at = now(),
                                error_text = %s
                            where id = %s
                              and status = 'queued'
                            """,
                            (f"recluster_gate_failed:{gate_reason}", run_id),
                        )
                    conn.commit()
                processed += 1
                continue

        # Claim the queued row immediately so UI does not look stuck while we build ZIP/upload/submit.
        with connect_db(runtime) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    update public.tgis_training_runs
                    set status = 'running',
                        training_provider = 'fal',
                        provider_status = 'SUBMITTING',
                        progress_pct = 0,
                        eta_seconds = null,
                        elapsed_seconds = 0,
                        started_at = coalesce(started_at, now()),
                        status_polled_at = now(),
                        updated_at = now(),
                        error_text = null
                    where id = %s
                      and status = 'queued'
                    returning id
                    """,
                    (run_id,),
                )
                claimed = cur.fetchone()
            conn.commit()

        if not claimed:
            continue

        if run_mode == "dry_run":
            with connect_db(runtime) as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        update public.tgis_training_runs
                        set status = 'success',
                            training_provider = 'fal',
                            provider_status = 'DRY_RUN',
                            progress_pct = 100,
                            eta_seconds = 0,
                            elapsed_seconds = 0,
                            estimated_cost_usd = 0,
                            started_at = coalesce(started_at, now()),
                            ended_at = now(),
                            updated_at = now(),
                            error_text = null
                        where id = %s
                          and status = 'running'
                        """,
                        (run_id,),
                    )
                conn.commit()
            processed += 1
            continue

        if not webhook_url:
            with connect_db(runtime) as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        update public.tgis_training_runs
                        set status = 'failed',
                            training_provider = 'fal',
                            ended_at = now(),
                            updated_at = now(),
                            error_text = 'missing_tgis_webhook_url'
                        where id = %s
                          and status = 'running'
                        """,
                        (run_id,),
                    )
                conn.commit()
            processed += 1
            continue

        try:
            submit_result = submit_cluster_training(
                config_path=config_path,
                cluster_id=cluster_id,
                steps=steps,
                learning_rate=learning_rate,
                webhook_url=webhook_url,
                max_images_override=max_images,
            )
            with connect_db(runtime) as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        update public.tgis_training_runs
                        set status = 'running',
                            training_provider = 'fal',
                            provider_status = 'IN_QUEUE',
                            progress_pct = 1,
                            eta_seconds = null,
                            elapsed_seconds = 0,
                            estimated_cost_usd = %s,
                            fal_request_id = %s,
                            dataset_zip_url = %s,
                            dataset_images_count = %s,
                            result_json = coalesce(result_json, '{}'::jsonb) || %s::jsonb,
                            started_at = coalesce(started_at, now()),
                            status_polled_at = now(),
                            updated_at = now(),
                            error_text = null
                        where id = %s
                          and status = 'running'
                        """,
                        (
                            round((steps * TRAIN_COST_PER_1000_STEPS_USD) / 1000.0, 6),
                            submit_result.get("fal_request_id"),
                            submit_result.get("dataset_zip_url"),
                            submit_result.get("dataset_images_count"),
                            json.dumps(
                                {
                                    "source": "process_training_queue",
                                    "target_version": target_version,
                                    "steps": steps,
                                    "learning_rate": learning_rate,
                                    **submit_result,
                                }
                            ),
                            run_id,
                        ),
                    )
                conn.commit()
        except Exception as e:
            with connect_db(runtime) as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        update public.tgis_training_runs
                        set status = 'failed',
                            training_provider = 'fal',
                            ended_at = now(),
                            updated_at = now(),
                            error_text = %s
                        where id = %s
                          and status = 'running'
                        """,
                        (f"fal_train_submit_failed:{e}", run_id),
                    )
                conn.commit()

        processed += 1

    polled = _poll_running_trainings(
        runtime=runtime,
        config_path=config_path,
        default_steps=default_steps,
        default_trainer_model=default_trainer_model,
    )
    return processed, polled


def main() -> None:
    args = parse_args()
    runtime_file_cfg = load_yaml(args.config)
    train_cfg = runtime_file_cfg.get("train") or {}
    default_steps = int(train_cfg.get("steps", 2000))
    default_lr = float(train_cfg.get("learning_rate", 0.0005))
    default_trainer_model = str(train_cfg.get("fal_trainer_model") or "fal-ai/z-image-turbo-trainer-v2")

    webhook_url = os.getenv("TGIS_WEBHOOK_URL", "").strip()
    runtime = load_runtime(args.config)
    max_runs = max(1, int(args.max_runs))
    idle_sleep_seconds = max(5, int(args.idle_sleep_seconds))

    while True:
        processed, polled = _run_tick(
            config_path=args.config,
            runtime=runtime,
            webhook_url=webhook_url,
            max_runs=max_runs,
            default_steps=default_steps,
            default_lr=default_lr,
            default_trainer_model=default_trainer_model,
            train_cfg=train_cfg,
        )
        print(f"[TGIS] training queue processed={processed} polled_running={polled}")

        if not args.loop:
            break

        time.sleep(idle_sleep_seconds if processed == 0 and polled == 0 else 3)


if __name__ == "__main__":
    main()
