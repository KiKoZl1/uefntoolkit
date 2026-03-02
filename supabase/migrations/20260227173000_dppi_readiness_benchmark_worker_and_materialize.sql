-- DPPI readiness/benchmark/worker heartbeat + prediction-first opportunity materialization

CREATE TABLE IF NOT EXISTS public.dppi_worker_heartbeat (
  id bigserial PRIMARY KEY,
  ts timestamptz NOT NULL DEFAULT now(),
  worker_host text NOT NULL,
  source text NOT NULL DEFAULT 'hetzner-cx22',
  cpu_pct double precision NULL,
  mem_pct double precision NULL,
  mem_used_mb integer NULL,
  mem_total_mb integer NULL,
  disk_pct double precision NULL,
  queue_depth integer NULL,
  training_running boolean NOT NULL DEFAULT false,
  inference_running boolean NOT NULL DEFAULT false,
  extra_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dppi_worker_heartbeat_ts_idx
  ON public.dppi_worker_heartbeat (ts DESC);

CREATE INDEX IF NOT EXISTS dppi_worker_heartbeat_host_idx
  ON public.dppi_worker_heartbeat (worker_host, ts DESC);

ALTER TABLE public.dppi_worker_heartbeat ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'dppi_worker_heartbeat' AND policyname = 'dppi_worker_heartbeat_service_all'
  ) THEN
    CREATE POLICY dppi_worker_heartbeat_service_all
      ON public.dppi_worker_heartbeat
      FOR ALL
      TO public
      USING ((auth.jwt() ->> 'role') = 'service_role')
      WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'dppi_worker_heartbeat' AND policyname = 'dppi_worker_heartbeat_admin_select'
  ) THEN
    CREATE POLICY dppi_worker_heartbeat_admin_select
      ON public.dppi_worker_heartbeat
      FOR SELECT
      TO authenticated
      USING (public.is_admin_or_editor());
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.dppi_report_worker_heartbeat(
  p_worker_host text,
  p_source text DEFAULT 'hetzner-cx22',
  p_cpu_pct double precision DEFAULT NULL,
  p_mem_pct double precision DEFAULT NULL,
  p_mem_used_mb integer DEFAULT NULL,
  p_mem_total_mb integer DEFAULT NULL,
  p_disk_pct double precision DEFAULT NULL,
  p_queue_depth integer DEFAULT NULL,
  p_training_running boolean DEFAULT false,
  p_inference_running boolean DEFAULT false,
  p_extra_json jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id bigint;
BEGIN
  PERFORM public._dppi_require_service_role();

  INSERT INTO public.dppi_worker_heartbeat (
    worker_host,
    source,
    cpu_pct,
    mem_pct,
    mem_used_mb,
    mem_total_mb,
    disk_pct,
    queue_depth,
    training_running,
    inference_running,
    extra_json,
    created_at
  )
  VALUES (
    COALESCE(NULLIF(trim(p_worker_host), ''), 'unknown-worker'),
    COALESCE(NULLIF(trim(p_source), ''), 'hetzner-cx22'),
    p_cpu_pct,
    p_mem_pct,
    p_mem_used_mb,
    p_mem_total_mb,
    p_disk_pct,
    p_queue_depth,
    COALESCE(p_training_running, false),
    COALESCE(p_inference_running, false),
    COALESCE(p_extra_json, '{}'::jsonb),
    now()
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'heartbeat_id', v_id,
    'worker_host', COALESCE(NULLIF(trim(p_worker_host), ''), 'unknown-worker'),
    'ts', now()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.dppi_get_panel_benchmark(
  p_target_id uuid,
  p_panel_name text,
  p_window_days integer DEFAULT 14
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_snapshot record;
  v_window_days integer := LEAST(60, GREATEST(1, COALESCE(p_window_days, 14)));
BEGIN
  SELECT
    s.target_id,
    s.panel_name,
    s.window_days,
    s.as_of,
    s.updated_at,
    s.sample_stints,
    s.sample_closed_stints,
    s.active_maps_now,
    s.confidence,
    s.payload_json,
    t.region,
    t.surface_name
  INTO v_snapshot
  FROM public.discovery_panel_intel_snapshot s
  JOIN public.discovery_exposure_targets t ON t.id = s.target_id
  WHERE s.target_id = p_target_id
    AND s.panel_name = p_panel_name
    AND s.window_days = v_window_days
  ORDER BY s.updated_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'available', false,
      'target_id', p_target_id,
      'panel_name', p_panel_name,
      'window_days', v_window_days
    );
  END IF;

  RETURN jsonb_build_object(
    'available', true,
    'target_id', v_snapshot.target_id,
    'region', v_snapshot.region,
    'surface_name', v_snapshot.surface_name,
    'panel_name', v_snapshot.panel_name,
    'window_days', v_snapshot.window_days,
    'as_of', v_snapshot.as_of,
    'updated_at', v_snapshot.updated_at,
    'sample_stints', v_snapshot.sample_stints,
    'sample_closed_stints', v_snapshot.sample_closed_stints,
    'active_maps_now', v_snapshot.active_maps_now,
    'confidence', v_snapshot.confidence,
    'panel_avg_ccu', (v_snapshot.payload_json ->> 'panel_avg_ccu')::double precision,
    'avg_exposure_minutes_per_stint', (v_snapshot.payload_json ->> 'avg_exposure_minutes_per_stint')::double precision,
    'avg_exposure_minutes_per_map', (v_snapshot.payload_json ->> 'avg_exposure_minutes_per_map')::double precision,
    'entries_24h', COALESCE((v_snapshot.payload_json ->> 'entries_24h')::integer, 0),
    'exits_24h', COALESCE((v_snapshot.payload_json ->> 'exits_24h')::integer, 0),
    'replacements_24h', COALESCE((v_snapshot.payload_json ->> 'replacements_24h')::integer, 0),
    'keep_alive_targets', COALESCE(v_snapshot.payload_json -> 'keep_alive_targets', '{}'::jsonb),
    'ccu_bands', COALESCE(v_snapshot.payload_json -> 'ccu_bands', '{}'::jsonb),
    'exposure_bands_minutes', COALESCE(v_snapshot.payload_json -> 'exposure_bands_minutes', '{}'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.dppi_training_readiness(
  p_region text DEFAULT 'NAE',
  p_surface_name text DEFAULT 'CreativeDiscoverySurface_Frontend',
  p_min_days integer DEFAULT 60
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text := COALESCE(auth.jwt() ->> 'role', current_setting('request.jwt.claim.role', true));
  v_target_id uuid;
  v_min_bucket timestamptz;
  v_max_bucket timestamptz;
  v_hourly_rows bigint := 0;
  v_daily_rows bigint := 0;
  v_entry_labels bigint := 0;
  v_survival_labels bigint := 0;
  v_coverage_days integer := 0;
  v_min_days integer := GREATEST(1, COALESCE(p_min_days, 60));
BEGIN
  IF v_role IS DISTINCT FROM 'service_role' AND NOT public.is_admin_or_editor() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT id
    INTO v_target_id
  FROM public.discovery_exposure_targets
  WHERE region = COALESCE(p_region, 'NAE')
    AND surface_name = COALESCE(p_surface_name, 'CreativeDiscoverySurface_Frontend')
  ORDER BY last_ok_tick_at DESC NULLS LAST
  LIMIT 1;

  IF v_target_id IS NULL THEN
    RETURN jsonb_build_object(
      'ready', false,
      'reason', 'target_not_found',
      'required_days', v_min_days,
      'coverage_days', 0,
      'region', COALESCE(p_region, 'NAE'),
      'surface_name', COALESCE(p_surface_name, 'CreativeDiscoverySurface_Frontend')
    );
  END IF;

  SELECT MIN(as_of_bucket), MAX(as_of_bucket), COUNT(*)
    INTO v_min_bucket, v_max_bucket, v_hourly_rows
  FROM public.dppi_feature_store_hourly
  WHERE target_id = v_target_id;

  SELECT COUNT(*)
    INTO v_daily_rows
  FROM public.dppi_feature_store_daily
  WHERE target_id = v_target_id;

  SELECT COUNT(*)
    INTO v_entry_labels
  FROM public.dppi_labels_entry
  WHERE target_id = v_target_id;

  SELECT COUNT(*)
    INTO v_survival_labels
  FROM public.dppi_labels_survival
  WHERE target_id = v_target_id;

  IF v_min_bucket IS NOT NULL AND v_max_bucket IS NOT NULL THEN
    v_coverage_days := GREATEST(1, FLOOR(EXTRACT(epoch FROM (v_max_bucket - v_min_bucket)) / 86400.0)::integer + 1);
  END IF;

  RETURN jsonb_build_object(
    'ready', (v_coverage_days >= v_min_days),
    'reason', CASE WHEN v_coverage_days >= v_min_days THEN 'ok' ELSE 'insufficient_days' END,
    'required_days', v_min_days,
    'coverage_days', v_coverage_days,
    'target_id', v_target_id,
    'region', COALESCE(p_region, 'NAE'),
    'surface_name', COALESCE(p_surface_name, 'CreativeDiscoverySurface_Frontend'),
    'feature_store_hourly_rows', v_hourly_rows,
    'feature_store_daily_rows', v_daily_rows,
    'entry_labels', v_entry_labels,
    'survival_labels', v_survival_labels,
    'first_bucket', v_min_bucket,
    'last_bucket', v_max_bucket
  );
END;
$$;

-- Prediction-first materialization of opportunities (fallback to heuristic when no predictions exist)
CREATE OR REPLACE FUNCTION public.materialize_dppi_opportunities(
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
  v_rows int := 0;
  v_model_name text := NULL;
  v_model_version text := NULL;
  v_has_predictions boolean := false;
BEGIN
  PERFORM public._dppi_require_service_role();

  SELECT EXISTS (
    SELECT 1
    FROM public.dppi_predictions p
    JOIN public.discovery_exposure_targets t ON t.id = p.target_id
    WHERE p.as_of_bucket = date_trunc('hour', p_as_of_bucket)
      AND (p_target_id IS NULL OR p.target_id = p_target_id)
      AND (p_region IS NULL OR p.region = p_region)
      AND (p_surface_name IS NULL OR p.surface_name = p_surface_name)
      AND (p_panel_name IS NULL OR p.panel_name = p_panel_name)
  ) INTO v_has_predictions;

  IF v_has_predictions THEN
    WITH pred AS (
      SELECT
        p.as_of_bucket,
        p.target_id,
        p.region,
        p.surface_name,
        p.panel_name,
        p.island_code,
        MAX(p.score) FILTER (WHERE p.prediction_horizon = '2h') AS enter_score_2h,
        MAX(p.score) FILTER (WHERE p.prediction_horizon = '5h') AS enter_score_5h,
        MAX(p.score) FILTER (WHERE p.prediction_horizon = '12h') AS enter_score_12h,
        MAX(p.generated_at) AS generated_at,
        (ARRAY_REMOVE(ARRAY_AGG(p.model_name ORDER BY p.generated_at DESC), NULL))[1] AS model_name,
        (ARRAY_REMOVE(ARRAY_AGG(p.model_version ORDER BY p.generated_at DESC), NULL))[1] AS model_version,
        MAX(
          CASE p.confidence_bucket
            WHEN 'high' THEN 3
            WHEN 'medium' THEN 2
            ELSE 1
          END
        ) AS confidence_rank,
        jsonb_object_agg(p.prediction_horizon, p.evidence_json) FILTER (WHERE p.prediction_horizon IS NOT NULL) AS evidence_json
      FROM public.dppi_predictions p
      WHERE p.as_of_bucket = date_trunc('hour', p_as_of_bucket)
        AND (p_target_id IS NULL OR p.target_id = p_target_id)
        AND (p_region IS NULL OR p.region = p_region)
        AND (p_surface_name IS NULL OR p.surface_name = p_surface_name)
        AND (p_panel_name IS NULL OR p.panel_name = p_panel_name)
      GROUP BY p.as_of_bucket, p.target_id, p.region, p.surface_name, p.panel_name, p.island_code
    ),
    feat AS (
      SELECT
        h.as_of_bucket,
        h.target_id,
        h.panel_name,
        h.island_code,
        COALESCE(h.entries_1h, 0) AS entries_1h,
        COALESCE(h.exits_1h, 0) AS exits_1h,
        COALESCE(h.replacements_1h, 0) AS replacements_1h,
        COALESCE(h.exposure_minutes_1h, 0) AS exposure_minutes_1h
      FROM public.dppi_feature_store_hourly h
      WHERE h.as_of_bucket = date_trunc('hour', p_as_of_bucket)
        AND (p_target_id IS NULL OR h.target_id = p_target_id)
        AND (p_region IS NULL OR h.region = p_region)
        AND (p_surface_name IS NULL OR h.surface_name = p_surface_name)
        AND (p_panel_name IS NULL OR h.panel_name = p_panel_name)
    ),
    merged AS (
      SELECT
        p.as_of_bucket,
        p.target_id,
        p.region,
        p.surface_name,
        p.panel_name,
        p.island_code,
        COALESCE(p.enter_score_2h, 0) AS enter_score_2h,
        COALESCE(p.enter_score_5h, COALESCE(p.enter_score_2h, 0)) AS enter_score_5h,
        COALESCE(p.enter_score_12h, COALESCE(p.enter_score_5h, COALESCE(p.enter_score_2h, 0))) AS enter_score_12h,
        LEAST(1.0, GREATEST(0.0,
          (COALESCE(f.entries_1h, 0)::double precision + 1.0)
          / (COALESCE(f.entries_1h, 0)::double precision + COALESCE(f.exits_1h, 0)::double precision + 2.0)
        )) AS opening_signal,
        CASE
          WHEN COALESCE(f.replacements_1h, 0) >= 4 THEN 'high'
          WHEN COALESCE(f.replacements_1h, 0) >= 2 THEN 'medium'
          ELSE 'low'
        END AS pressure_forecast,
        CASE COALESCE(p.confidence_rank, 1)
          WHEN 3 THEN 'high'
          WHEN 2 THEN 'medium'
          ELSE 'low'
        END AS confidence_bucket,
        p.model_name,
        p.model_version,
        COALESCE(p.evidence_json, '{}'::jsonb) AS evidence_json,
        p.generated_at
      FROM pred p
      LEFT JOIN feat f
        ON f.as_of_bucket = p.as_of_bucket
       AND f.target_id = p.target_id
       AND f.panel_name = p.panel_name
       AND f.island_code = p.island_code
    ),
    ranked AS (
      SELECT
        m.*,
        ROW_NUMBER() OVER (
          PARTITION BY m.target_id, m.panel_name
          ORDER BY m.enter_score_2h DESC, m.enter_score_5h DESC, m.enter_score_12h DESC, m.island_code
        ) AS opportunity_rank
      FROM merged m
    )
    INSERT INTO public.dppi_opportunities (
      generated_at,
      as_of_bucket,
      target_id,
      region,
      surface_name,
      panel_name,
      island_code,
      enter_score_2h,
      enter_score_5h,
      enter_score_12h,
      opening_signal,
      pressure_forecast,
      confidence_bucket,
      opportunity_rank,
      model_name,
      model_version,
      evidence_json,
      created_at
    )
    SELECT
      COALESCE(r.generated_at, now()),
      r.as_of_bucket,
      r.target_id,
      r.region,
      r.surface_name,
      r.panel_name,
      r.island_code,
      r.enter_score_2h,
      r.enter_score_5h,
      r.enter_score_12h,
      r.opening_signal,
      r.pressure_forecast,
      r.confidence_bucket,
      r.opportunity_rank,
      r.model_name,
      r.model_version,
      r.evidence_json,
      now()
    FROM ranked r
    ON CONFLICT (target_id, panel_name, island_code)
    DO UPDATE SET
      generated_at = EXCLUDED.generated_at,
      as_of_bucket = EXCLUDED.as_of_bucket,
      region = EXCLUDED.region,
      surface_name = EXCLUDED.surface_name,
      enter_score_2h = EXCLUDED.enter_score_2h,
      enter_score_5h = EXCLUDED.enter_score_5h,
      enter_score_12h = EXCLUDED.enter_score_12h,
      opening_signal = EXCLUDED.opening_signal,
      pressure_forecast = EXCLUDED.pressure_forecast,
      confidence_bucket = EXCLUDED.confidence_bucket,
      opportunity_rank = EXCLUDED.opportunity_rank,
      model_name = EXCLUDED.model_name,
      model_version = EXCLUDED.model_version,
      evidence_json = EXCLUDED.evidence_json,
      created_at = now();

    GET DIAGNOSTICS v_rows = ROW_COUNT;

    SELECT model_name, model_version
      INTO v_model_name, v_model_version
    FROM public.dppi_predictions p
    WHERE p.as_of_bucket = date_trunc('hour', p_as_of_bucket)
      AND p.model_name IS NOT NULL
      AND p.model_version IS NOT NULL
    ORDER BY p.generated_at DESC
    LIMIT 1;
  ELSE
    -- Fallback heuristic when model predictions are not available yet.
    WITH base AS (
      SELECT
        h.as_of_bucket,
        h.target_id,
        h.region,
        h.surface_name,
        h.panel_name,
        h.island_code,
        h.ccu_avg,
        h.entries_1h,
        h.exits_1h,
        h.replacements_1h,
        h.exposure_minutes_1h,
        COALESCE((s.payload_json ->> 'panel_avg_ccu')::double precision, 0) AS panel_avg_ccu,
        COALESCE((s.payload_json #>> '{keep_alive_targets,ccu_min}')::double precision, 0) AS keep_alive_ccu_min
      FROM public.dppi_feature_store_hourly h
      LEFT JOIN public.discovery_panel_intel_snapshot s
        ON s.target_id = h.target_id
       AND s.panel_name = h.panel_name
       AND s.window_days = 14
      WHERE h.as_of_bucket = date_trunc('hour', p_as_of_bucket)
        AND (p_target_id IS NULL OR h.target_id = p_target_id)
        AND (p_region IS NULL OR h.region = p_region)
        AND (p_surface_name IS NULL OR h.surface_name = p_surface_name)
        AND (p_panel_name IS NULL OR h.panel_name = p_panel_name)
    ),
    scored AS (
      SELECT
        b.*,
        LEAST(0.99, GREATEST(0.01,
          (0.45 * COALESCE(NULLIF(b.ccu_avg, 0) / NULLIF(NULLIF(b.panel_avg_ccu, 0), 0), 0)) +
          (0.25 * COALESCE(NULLIF(b.ccu_avg, 0) / NULLIF(NULLIF(b.keep_alive_ccu_min, 0), 0), 0)) +
          (0.15 * (1 - LEAST(1, COALESCE(b.replacements_1h, 0) / 5.0))) +
          (0.15 * LEAST(1, COALESCE(b.exposure_minutes_1h, 0) / 60.0))
        )) AS enter_score_2h
      FROM base b
    ),
    enriched AS (
      SELECT
        s.*,
        LEAST(0.99, GREATEST(0.01, s.enter_score_2h * 0.92)) AS enter_score_5h,
        LEAST(0.99, GREATEST(0.01, s.enter_score_2h * 0.84)) AS enter_score_12h,
        LEAST(1.0, GREATEST(0.0, (COALESCE(s.entries_1h, 0)::double precision + 1.0) / (COALESCE(s.entries_1h, 0)::double precision + COALESCE(s.exits_1h, 0)::double precision + 2.0))) AS opening_signal,
        CASE
          WHEN COALESCE(s.replacements_1h, 0) >= 4 THEN 'high'
          WHEN COALESCE(s.replacements_1h, 0) >= 2 THEN 'medium'
          ELSE 'low'
        END AS pressure_forecast,
        CASE
          WHEN s.exposure_minutes_1h >= 35 AND s.ccu_avg >= GREATEST(1, s.keep_alive_ccu_min) THEN 'high'
          WHEN s.exposure_minutes_1h >= 12 THEN 'medium'
          ELSE 'low'
        END AS confidence_bucket
      FROM scored s
    ),
    ranked AS (
      SELECT
        e.*,
        ROW_NUMBER() OVER (PARTITION BY e.target_id, e.panel_name ORDER BY e.enter_score_2h DESC, e.ccu_avg DESC, e.island_code) AS opportunity_rank
      FROM enriched e
    )
    INSERT INTO public.dppi_opportunities (
      generated_at, as_of_bucket, target_id, region, surface_name, panel_name, island_code,
      enter_score_2h, enter_score_5h, enter_score_12h, opening_signal, pressure_forecast,
      confidence_bucket, opportunity_rank, model_name, model_version, evidence_json, created_at
    )
    SELECT
      now(),
      r.as_of_bucket,
      r.target_id,
      r.region,
      r.surface_name,
      r.panel_name,
      r.island_code,
      r.enter_score_2h,
      r.enter_score_5h,
      r.enter_score_12h,
      r.opening_signal,
      r.pressure_forecast,
      r.confidence_bucket,
      r.opportunity_rank,
      NULL,
      NULL,
      jsonb_build_object(
        'mode', 'heuristic_fallback',
        'ccu_avg', r.ccu_avg,
        'panel_avg_ccu', r.panel_avg_ccu,
        'keep_alive_ccu_min', r.keep_alive_ccu_min,
        'entries_1h', r.entries_1h,
        'exits_1h', r.exits_1h,
        'replacements_1h', r.replacements_1h,
        'exposure_minutes_1h', r.exposure_minutes_1h
      ),
      now()
    FROM ranked r
    ON CONFLICT (target_id, panel_name, island_code)
    DO UPDATE SET
      generated_at = EXCLUDED.generated_at,
      as_of_bucket = EXCLUDED.as_of_bucket,
      region = EXCLUDED.region,
      surface_name = EXCLUDED.surface_name,
      enter_score_2h = EXCLUDED.enter_score_2h,
      enter_score_5h = EXCLUDED.enter_score_5h,
      enter_score_12h = EXCLUDED.enter_score_12h,
      opening_signal = EXCLUDED.opening_signal,
      pressure_forecast = EXCLUDED.pressure_forecast,
      confidence_bucket = EXCLUDED.confidence_bucket,
      opportunity_rank = EXCLUDED.opportunity_rank,
      model_name = EXCLUDED.model_name,
      model_version = EXCLUDED.model_version,
      evidence_json = EXCLUDED.evidence_json,
      created_at = now();

    GET DIAGNOSTICS v_rows = ROW_COUNT;
  END IF;

  INSERT INTO public.dppi_inference_log (
    ts,
    mode,
    target_scope,
    processed_rows,
    failed_rows,
    latency_ms,
    model_name,
    model_version,
    created_at
  )
  VALUES (
    now(),
    CASE WHEN v_has_predictions THEN 'opportunity_batch_model' ELSE 'opportunity_batch_heuristic' END,
    jsonb_build_object('target_id', p_target_id, 'region', p_region, 'surface_name', p_surface_name, 'panel_name', p_panel_name),
    v_rows,
    0,
    NULL,
    v_model_name,
    v_model_version,
    now()
  );

  RETURN jsonb_build_object(
    'as_of_bucket', date_trunc('hour', p_as_of_bucket),
    'rows_upserted', v_rows,
    'model_name', v_model_name,
    'model_version', v_model_version,
    'used_predictions', v_has_predictions
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.dppi_report_worker_heartbeat(text, text, double precision, double precision, integer, integer, double precision, integer, boolean, boolean, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.dppi_get_panel_benchmark(uuid, text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dppi_training_readiness(text, text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.materialize_dppi_opportunities(uuid, text, text, text, timestamptz) TO service_role;
