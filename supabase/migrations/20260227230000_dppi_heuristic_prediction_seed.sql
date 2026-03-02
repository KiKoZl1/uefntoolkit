-- Seed heuristic predictions so DPPI tables stay populated before first trained model.

CREATE OR REPLACE FUNCTION public.seed_dppi_heuristic_predictions(
  p_target_id uuid DEFAULT NULL,
  p_region text DEFAULT NULL,
  p_surface_name text DEFAULT NULL,
  p_panel_name text DEFAULT NULL,
  p_as_of_bucket timestamptz DEFAULT date_trunc('hour', now())
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows_entry int := 0;
  v_rows_survival int := 0;
  v_bucket timestamptz := date_trunc('hour', p_as_of_bucket);
BEGIN
  PERFORM public._dppi_require_service_role();

  WITH base AS (
    SELECT
      h.as_of_bucket,
      h.target_id,
      h.region,
      h.surface_name,
      h.panel_name,
      h.island_code,
      COALESCE(h.ccu_avg, 0)::double precision AS ccu_avg,
      COALESCE(h.entries_1h, 0)::double precision AS entries_1h,
      COALESCE(h.exits_1h, 0)::double precision AS exits_1h,
      COALESCE(h.replacements_1h, 0)::double precision AS replacements_1h,
      COALESCE(h.exposure_minutes_1h, 0)::double precision AS exposure_minutes_1h,
      COALESCE((s.payload_json ->> 'panel_avg_ccu')::double precision, 0)::double precision AS panel_avg_ccu,
      COALESCE((s.payload_json #>> '{keep_alive_targets,ccu_min}')::double precision, 0)::double precision AS keep_alive_ccu_min
    FROM public.dppi_feature_store_hourly h
    LEFT JOIN public.discovery_panel_intel_snapshot s
      ON s.target_id = h.target_id
     AND s.panel_name = h.panel_name
     AND s.window_days = 14
    WHERE h.as_of_bucket = v_bucket
      AND (p_target_id IS NULL OR h.target_id = p_target_id)
      AND (p_region IS NULL OR h.region = p_region)
      AND (p_surface_name IS NULL OR h.surface_name = p_surface_name)
      AND (p_panel_name IS NULL OR h.panel_name = p_panel_name)
  ),
  scored AS (
    SELECT
      b.*,
      LEAST(0.99::double precision, GREATEST(0.01::double precision,
        (0.45::double precision * COALESCE(NULLIF(b.ccu_avg, 0) / NULLIF(NULLIF(b.panel_avg_ccu, 0), 0), 0)) +
        (0.25::double precision * COALESCE(NULLIF(b.ccu_avg, 0) / NULLIF(NULLIF(b.keep_alive_ccu_min, 0), 0), 0)) +
        (0.15::double precision * (1 - LEAST(1, COALESCE(b.replacements_1h, 0) / 5.0))) +
        (0.15::double precision * LEAST(1, COALESCE(b.exposure_minutes_1h, 0) / 60.0))
      )) AS score_2h
    FROM base b
  ),
  expanded AS (
    SELECT
      s.*,
      h.prediction_horizon,
      CASE h.prediction_horizon
        WHEN '2h' THEN s.score_2h
        WHEN '5h' THEN LEAST(0.99::double precision, GREATEST(0.01::double precision, s.score_2h * 0.92))
        ELSE LEAST(0.99::double precision, GREATEST(0.01::double precision, s.score_2h * 0.84))
      END AS score_h
    FROM scored s
    CROSS JOIN (VALUES ('2h'::text), ('5h'::text), ('12h'::text)) h(prediction_horizon)
  )
  INSERT INTO public.dppi_predictions (
    generated_at,
    as_of_bucket,
    target_id,
    region,
    surface_name,
    panel_name,
    island_code,
    prediction_horizon,
    score,
    confidence_bucket,
    model_name,
    model_version,
    evidence_json,
    created_at
  )
  SELECT
    now(),
    e.as_of_bucket,
    e.target_id,
    e.region,
    e.surface_name,
    e.panel_name,
    e.island_code,
    e.prediction_horizon,
    e.score_h,
    CASE
      WHEN e.score_h >= 0.75 THEN 'high'
      WHEN e.score_h >= 0.45 THEN 'medium'
      ELSE 'low'
    END AS confidence_bucket,
    'heuristic_bootstrap',
    'v0',
    jsonb_build_object(
      'mode', 'heuristic_bootstrap',
      'ccu_avg', e.ccu_avg,
      'panel_avg_ccu', e.panel_avg_ccu,
      'keep_alive_ccu_min', e.keep_alive_ccu_min,
      'entries_1h', e.entries_1h,
      'exits_1h', e.exits_1h,
      'replacements_1h', e.replacements_1h,
      'exposure_minutes_1h', e.exposure_minutes_1h
    ),
    now()
  FROM expanded e
  ON CONFLICT (target_id, panel_name, island_code, prediction_horizon, as_of_bucket)
  DO UPDATE SET
    generated_at = EXCLUDED.generated_at,
    region = EXCLUDED.region,
    surface_name = EXCLUDED.surface_name,
    score = EXCLUDED.score,
    confidence_bucket = EXCLUDED.confidence_bucket,
    model_name = EXCLUDED.model_name,
    model_version = EXCLUDED.model_version,
    evidence_json = EXCLUDED.evidence_json,
    created_at = now();

  GET DIAGNOSTICS v_rows_entry = ROW_COUNT;

  WITH base AS (
    SELECT
      h.as_of_bucket,
      h.target_id,
      h.region,
      h.surface_name,
      h.panel_name,
      h.island_code,
      COALESCE(h.ccu_avg, 0)::double precision AS ccu_avg,
      COALESCE(h.replacements_1h, 0)::double precision AS replacements_1h,
      COALESCE(h.exposure_minutes_1h, 0)::double precision AS exposure_minutes_1h,
      COALESCE((s.payload_json #>> '{keep_alive_targets,ccu_min}')::double precision, 0)::double precision AS keep_alive_ccu_min
    FROM public.dppi_feature_store_hourly h
    LEFT JOIN public.discovery_panel_intel_snapshot s
      ON s.target_id = h.target_id
     AND s.panel_name = h.panel_name
     AND s.window_days = 14
    WHERE h.as_of_bucket = v_bucket
      AND (p_target_id IS NULL OR h.target_id = p_target_id)
      AND (p_region IS NULL OR h.region = p_region)
      AND (p_surface_name IS NULL OR h.surface_name = p_surface_name)
      AND (p_panel_name IS NULL OR h.panel_name = p_panel_name)
  ),
  scored AS (
    SELECT
      b.*,
      LEAST(0.99::double precision, GREATEST(0.01::double precision,
        (0.55::double precision * LEAST(1, COALESCE(b.exposure_minutes_1h, 0) / 60.0)) +
        (0.25::double precision * (1 - LEAST(1, COALESCE(b.replacements_1h, 0) / 5.0))) +
        (0.20::double precision * COALESCE(NULLIF(b.ccu_avg, 0) / NULLIF(NULLIF(b.keep_alive_ccu_min, 0), 0), 0))
      )) AS stay_30m
    FROM base b
  ),
  expanded AS (
    SELECT
      s.*,
      h.prediction_horizon,
      CASE h.prediction_horizon
        WHEN '30m' THEN s.stay_30m
        WHEN '60m' THEN LEAST(0.99::double precision, GREATEST(0.01::double precision, s.stay_30m * 0.90))
        ELSE LEAST(0.99::double precision, GREATEST(0.01::double precision, 1 - s.stay_30m))
      END AS score_h
    FROM scored s
    CROSS JOIN (VALUES ('30m'::text), ('60m'::text), ('replace_lt_30m'::text)) h(prediction_horizon)
  )
  INSERT INTO public.dppi_survival_predictions (
    generated_at,
    as_of_bucket,
    target_id,
    region,
    surface_name,
    panel_name,
    island_code,
    prediction_horizon,
    score,
    confidence_bucket,
    model_name,
    model_version,
    evidence_json,
    created_at
  )
  SELECT
    now(),
    e.as_of_bucket,
    e.target_id,
    e.region,
    e.surface_name,
    e.panel_name,
    e.island_code,
    e.prediction_horizon,
    e.score_h,
    CASE
      WHEN e.score_h >= 0.75 THEN 'high'
      WHEN e.score_h >= 0.45 THEN 'medium'
      ELSE 'low'
    END AS confidence_bucket,
    'heuristic_bootstrap',
    'v0',
    jsonb_build_object(
      'mode', 'heuristic_bootstrap',
      'ccu_avg', e.ccu_avg,
      'keep_alive_ccu_min', e.keep_alive_ccu_min,
      'replacements_1h', e.replacements_1h,
      'exposure_minutes_1h', e.exposure_minutes_1h
    ),
    now()
  FROM expanded e
  ON CONFLICT (target_id, panel_name, island_code, prediction_horizon, as_of_bucket)
  DO UPDATE SET
    generated_at = EXCLUDED.generated_at,
    region = EXCLUDED.region,
    surface_name = EXCLUDED.surface_name,
    score = EXCLUDED.score,
    confidence_bucket = EXCLUDED.confidence_bucket,
    model_name = EXCLUDED.model_name,
    model_version = EXCLUDED.model_version,
    evidence_json = EXCLUDED.evidence_json,
    created_at = now();

  GET DIAGNOSTICS v_rows_survival = ROW_COUNT;

  RETURN jsonb_build_object(
    'as_of_bucket', v_bucket,
    'entry_rows_upserted', v_rows_entry,
    'survival_rows_upserted', v_rows_survival,
    'model_name', 'heuristic_bootstrap',
    'model_version', 'v0'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.seed_dppi_heuristic_predictions(uuid, text, text, text, timestamptz) TO service_role;
