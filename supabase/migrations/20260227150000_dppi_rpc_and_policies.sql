-- DPPI RPCs, policies and operational helpers

CREATE OR REPLACE FUNCTION public.is_admin_or_editor()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role IN ('admin', 'editor')
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin_or_editor() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin_or_editor() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public._dppi_require_service_role()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text := COALESCE(auth.jwt() ->> 'role', current_setting('request.jwt.claim.role', true));
BEGIN
  IF v_role IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._dppi_require_service_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._dppi_require_service_role() TO service_role;

DO $$
DECLARE
  v_tables text[] := ARRAY[
    'dppi_training_dataset_meta',
    'dppi_feature_store_daily',
    'dppi_feature_store_hourly',
    'dppi_labels_entry',
    'dppi_labels_survival',
    'dppi_predictions',
    'dppi_survival_predictions',
    'dppi_opportunities',
    'dppi_model_registry',
    'dppi_training_log',
    'dppi_inference_log',
    'dppi_drift_metrics',
    'dppi_calibration_metrics',
    'dppi_release_channels',
    'dppi_feedback_events',
    'dppi_panel_families'
  ];
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = v_table AND policyname = v_table || '_service_all'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO public USING ((auth.jwt() ->> ''role'') = ''service_role'') WITH CHECK ((auth.jwt() ->> ''role'') = ''service_role'')',
        v_table || '_service_all',
        v_table
      );
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = v_table AND policyname = v_table || '_admin_select'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_admin_or_editor())',
        v_table || '_admin_select',
        v_table
      );
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.compute_dppi_feature_store_hourly(
  p_target_id uuid DEFAULT NULL,
  p_region text DEFAULT NULL,
  p_surface_name text DEFAULT NULL,
  p_panel_name text DEFAULT NULL,
  p_as_of timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bucket timestamptz := date_trunc('hour', COALESCE(p_as_of, now()));
  v_start timestamptz := v_bucket;
  v_end timestamptz := v_bucket + interval '1 hour';
  v_rows int := 0;
BEGIN
  PERFORM public._dppi_require_service_role();

  WITH target_scope AS (
    SELECT t.id AS target_id, t.region, t.surface_name
    FROM public.discovery_exposure_targets t
    WHERE (p_target_id IS NULL OR t.id = p_target_id)
      AND (p_region IS NULL OR t.region = p_region)
      AND (p_surface_name IS NULL OR t.surface_name = p_surface_name)
  ),
  seg AS (
    SELECT
      ts.target_id,
      ts.region,
      ts.surface_name,
      r.panel_name,
      r.link_code AS island_code,
      GREATEST(r.start_ts, v_start) AS s_start,
      LEAST(COALESCE(r.end_ts, r.last_seen_ts, v_end), v_end) AS s_end,
      COALESCE(r.ccu_end, r.ccu_max, r.ccu_start, 0)::double precision AS ccu_value
    FROM public.discovery_exposure_rank_segments r
    JOIN target_scope ts ON ts.target_id = r.target_id
    WHERE r.link_code_type = 'island'
      AND r.start_ts < v_end
      AND COALESCE(r.end_ts, r.last_seen_ts, v_end) > v_start
      AND (p_panel_name IS NULL OR r.panel_name = p_panel_name)
  ),
  seg_agg AS (
    SELECT
      target_id,
      region,
      surface_name,
      panel_name,
      island_code,
      ROUND(SUM(ccu_value * GREATEST(EXTRACT(epoch FROM (s_end - s_start)) / 60.0, 0)) / NULLIF(SUM(GREATEST(EXTRACT(epoch FROM (s_end - s_start)) / 60.0, 0)), 0), 4) AS ccu_avg,
      MAX(ccu_value)::int AS ccu_max,
      ROUND(SUM(GREATEST(EXTRACT(epoch FROM (s_end - s_start)) / 60.0, 0)), 2) AS exposure_minutes_1h
    FROM seg
    GROUP BY target_id, region, surface_name, panel_name, island_code
  ),
  event_agg AS (
    SELECT
      ts.id AS target_id,
      ts.region,
      ts.surface_name,
      e.panel_name,
      e.link_code AS island_code,
      COUNT(*) FILTER (WHERE e.event_type = 'enter')::int AS entries_1h,
      COUNT(*) FILTER (WHERE e.event_type = 'exit')::int AS exits_1h
    FROM public.discovery_exposure_presence_events e
    JOIN public.discovery_exposure_targets ts ON ts.id = e.target_id
    WHERE e.link_code_type = 'island'
      AND e.ts >= v_start
      AND e.ts < v_end
      AND (p_target_id IS NULL OR e.target_id = p_target_id)
      AND (p_region IS NULL OR ts.region = p_region)
      AND (p_surface_name IS NULL OR ts.surface_name = p_surface_name)
      AND (p_panel_name IS NULL OR e.panel_name = p_panel_name)
    GROUP BY ts.id, ts.region, ts.surface_name, e.panel_name, e.link_code
  ),
  repl_agg AS (
    SELECT
      ts.id AS target_id,
      ts.region,
      ts.surface_name,
      r.panel_name,
      r.link_code AS island_code,
      COUNT(*)::int AS replacements_1h
    FROM public.discovery_exposure_rank_segments r
    JOIN public.discovery_exposure_targets ts ON ts.id = r.target_id
    WHERE r.link_code_type = 'island'
      AND r.closed_reason = 'replaced'
      AND r.end_ts >= v_start
      AND r.end_ts < v_end
      AND (p_target_id IS NULL OR r.target_id = p_target_id)
      AND (p_region IS NULL OR ts.region = p_region)
      AND (p_surface_name IS NULL OR ts.surface_name = p_surface_name)
      AND (p_panel_name IS NULL OR r.panel_name = p_panel_name)
    GROUP BY ts.id, ts.region, ts.surface_name, r.panel_name, r.link_code
  ),
  full_rows AS (
    SELECT
      COALESCE(sa.target_id, ea.target_id, ra.target_id) AS target_id,
      COALESCE(sa.region, ea.region, ra.region) AS region,
      COALESCE(sa.surface_name, ea.surface_name, ra.surface_name) AS surface_name,
      COALESCE(sa.panel_name, ea.panel_name, ra.panel_name) AS panel_name,
      COALESCE(sa.island_code, ea.island_code, ra.island_code) AS island_code,
      COALESCE(sa.ccu_avg, 0) AS ccu_avg,
      COALESCE(sa.ccu_max, 0) AS ccu_max,
      COALESCE(ea.entries_1h, 0) AS entries_1h,
      COALESCE(ea.exits_1h, 0) AS exits_1h,
      COALESCE(ra.replacements_1h, 0) AS replacements_1h,
      COALESCE(sa.exposure_minutes_1h, 0) AS exposure_minutes_1h
    FROM seg_agg sa
    FULL OUTER JOIN event_agg ea
      ON ea.target_id = sa.target_id
     AND ea.panel_name = sa.panel_name
     AND ea.island_code = sa.island_code
    FULL OUTER JOIN repl_agg ra
      ON ra.target_id = COALESCE(sa.target_id, ea.target_id)
     AND ra.panel_name = COALESCE(sa.panel_name, ea.panel_name)
     AND ra.island_code = COALESCE(sa.island_code, ea.island_code)
  )
  INSERT INTO public.dppi_feature_store_hourly (
    as_of_bucket, target_id, region, surface_name, panel_name, island_code,
    ccu_avg, ccu_max, entries_1h, exits_1h, replacements_1h, exposure_minutes_1h, features_json, updated_at
  )
  SELECT
    v_bucket,
    fr.target_id,
    fr.region,
    fr.surface_name,
    fr.panel_name,
    fr.island_code,
    fr.ccu_avg,
    fr.ccu_max,
    fr.entries_1h,
    fr.exits_1h,
    fr.replacements_1h,
    fr.exposure_minutes_1h,
    jsonb_build_object(
      'ccu_avg', fr.ccu_avg,
      'ccu_max', fr.ccu_max,
      'entries_1h', fr.entries_1h,
      'exits_1h', fr.exits_1h,
      'replacements_1h', fr.replacements_1h,
      'exposure_minutes_1h', fr.exposure_minutes_1h
    ),
    now()
  FROM full_rows fr
  WHERE fr.target_id IS NOT NULL AND fr.panel_name IS NOT NULL AND fr.island_code IS NOT NULL
  ON CONFLICT (as_of_bucket, target_id, panel_name, island_code)
  DO UPDATE SET
    region = EXCLUDED.region,
    surface_name = EXCLUDED.surface_name,
    ccu_avg = EXCLUDED.ccu_avg,
    ccu_max = EXCLUDED.ccu_max,
    entries_1h = EXCLUDED.entries_1h,
    exits_1h = EXCLUDED.exits_1h,
    replacements_1h = EXCLUDED.replacements_1h,
    exposure_minutes_1h = EXCLUDED.exposure_minutes_1h,
    features_json = EXCLUDED.features_json,
    updated_at = now();

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN jsonb_build_object('as_of_bucket', v_bucket, 'rows_upserted', v_rows);
END;
$$;

CREATE OR REPLACE FUNCTION public.compute_dppi_feature_store_daily(
  p_target_id uuid DEFAULT NULL,
  p_region text DEFAULT NULL,
  p_surface_name text DEFAULT NULL,
  p_panel_name text DEFAULT NULL,
  p_as_of date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_day date := COALESCE(p_as_of, CURRENT_DATE);
  v_start timestamptz := (v_day::timestamptz);
  v_end timestamptz := ((v_day + 1)::timestamptz);
  v_rows int := 0;
BEGIN
  PERFORM public._dppi_require_service_role();

  WITH hourly AS (
    SELECT *
    FROM public.dppi_feature_store_hourly h
    WHERE h.as_of_bucket >= date_trunc('hour', v_start)
      AND h.as_of_bucket < date_trunc('hour', v_end)
      AND (p_target_id IS NULL OR h.target_id = p_target_id)
      AND (p_region IS NULL OR h.region = p_region)
      AND (p_surface_name IS NULL OR h.surface_name = p_surface_name)
      AND (p_panel_name IS NULL OR h.panel_name = p_panel_name)
  ),
  panel_uniques_7d AS (
    SELECT
      r.target_id,
      r.link_code AS island_code,
      COUNT(DISTINCT r.panel_name)::int AS feature_unique_panels_7d
    FROM public.discovery_exposure_rank_segments r
    WHERE r.link_code_type = 'island'
      AND r.start_ts < v_end
      AND COALESCE(r.end_ts, r.last_seen_ts, v_end) >= (v_end - interval '7 days')
      AND (p_target_id IS NULL OR r.target_id = p_target_id)
      AND (p_panel_name IS NULL OR r.panel_name = p_panel_name)
    GROUP BY r.target_id, r.link_code
  ),
  cache_meta AS (
    SELECT
      c.island_code,
      COALESCE(c.last_week_favorites, 0)::int AS feature_favorites_7d,
      COALESCE(c.last_week_recommends, 0)::int AS feature_recommends_7d
    FROM public.discover_islands_cache c
  )
  INSERT INTO public.dppi_feature_store_daily (
    as_of, target_id, region, surface_name, panel_name, island_code,
    feature_ccu_avg, feature_minutes_exposed, feature_appearances, feature_entries_24h, feature_exits_24h,
    feature_replacements_24h, feature_unique_panels_7d, feature_favorites_7d, feature_recommends_7d,
    features_json, updated_at
  )
  SELECT
    v_day,
    h.target_id,
    h.region,
    h.surface_name,
    h.panel_name,
    h.island_code,
    ROUND(AVG(h.ccu_avg), 4) AS feature_ccu_avg,
    COALESCE(SUM(h.exposure_minutes_1h), 0)::int AS feature_minutes_exposed,
    COUNT(*)::int AS feature_appearances,
    COALESCE(SUM(h.entries_1h), 0)::int AS feature_entries_24h,
    COALESCE(SUM(h.exits_1h), 0)::int AS feature_exits_24h,
    COALESCE(SUM(h.replacements_1h), 0)::int AS feature_replacements_24h,
    COALESCE(MAX(pu.feature_unique_panels_7d), 0)::int AS feature_unique_panels_7d,
    COALESCE(MAX(cm.feature_favorites_7d), 0)::int AS feature_favorites_7d,
    COALESCE(MAX(cm.feature_recommends_7d), 0)::int AS feature_recommends_7d,
    jsonb_build_object(
      'feature_ccu_avg', ROUND(AVG(h.ccu_avg), 4),
      'feature_minutes_exposed', COALESCE(SUM(h.exposure_minutes_1h), 0)::int,
      'feature_entries_24h', COALESCE(SUM(h.entries_1h), 0)::int,
      'feature_exits_24h', COALESCE(SUM(h.exits_1h), 0)::int
    ),
    now()
  FROM hourly h
  LEFT JOIN panel_uniques_7d pu ON pu.target_id = h.target_id AND pu.island_code = h.island_code
  LEFT JOIN cache_meta cm ON cm.island_code = h.island_code
  GROUP BY h.target_id, h.region, h.surface_name, h.panel_name, h.island_code
  ON CONFLICT (as_of, target_id, panel_name, island_code)
  DO UPDATE SET
    region = EXCLUDED.region,
    surface_name = EXCLUDED.surface_name,
    feature_ccu_avg = EXCLUDED.feature_ccu_avg,
    feature_minutes_exposed = EXCLUDED.feature_minutes_exposed,
    feature_appearances = EXCLUDED.feature_appearances,
    feature_entries_24h = EXCLUDED.feature_entries_24h,
    feature_exits_24h = EXCLUDED.feature_exits_24h,
    feature_replacements_24h = EXCLUDED.feature_replacements_24h,
    feature_unique_panels_7d = EXCLUDED.feature_unique_panels_7d,
    feature_favorites_7d = EXCLUDED.feature_favorites_7d,
    feature_recommends_7d = EXCLUDED.feature_recommends_7d,
    features_json = EXCLUDED.features_json,
    updated_at = now();

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN jsonb_build_object('as_of', v_day, 'rows_upserted', v_rows);
END;
$$;

CREATE OR REPLACE FUNCTION public.compute_dppi_labels_entry(
  p_target_id uuid DEFAULT NULL,
  p_as_of_bucket timestamptz DEFAULT date_trunc('hour', now())
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows int := 0;
BEGIN
  PERFORM public._dppi_require_service_role();

  WITH anchors AS (
    SELECT h.as_of_bucket, h.target_id, h.panel_name, h.island_code
    FROM public.dppi_feature_store_hourly h
    WHERE h.as_of_bucket = date_trunc('hour', p_as_of_bucket)
      AND (p_target_id IS NULL OR h.target_id = p_target_id)
  ),
  enters AS (
    SELECT
      a.as_of_bucket,
      a.target_id,
      a.panel_name,
      a.island_code,
      MIN(e.ts) FILTER (WHERE e.ts > a.as_of_bucket AND e.ts <= a.as_of_bucket + interval '2 hour') AS entered_2h_at,
      MIN(e.ts) FILTER (WHERE e.ts > a.as_of_bucket AND e.ts <= a.as_of_bucket + interval '5 hour') AS entered_5h_at,
      MIN(e.ts) FILTER (WHERE e.ts > a.as_of_bucket AND e.ts <= a.as_of_bucket + interval '12 hour') AS entered_12h_at
    FROM anchors a
    LEFT JOIN public.discovery_exposure_presence_events e
      ON e.target_id = a.target_id
     AND e.panel_name = a.panel_name
     AND e.link_code = a.island_code
     AND e.link_code_type = 'island'
     AND e.event_type = 'enter'
     AND e.ts > a.as_of_bucket
     AND e.ts <= a.as_of_bucket + interval '12 hour'
    GROUP BY a.as_of_bucket, a.target_id, a.panel_name, a.island_code
  )
  INSERT INTO public.dppi_labels_entry (
    as_of_bucket, target_id, panel_name, island_code, enter_2h, enter_5h, enter_12h, entered_at, updated_at
  )
  SELECT
    e.as_of_bucket,
    e.target_id,
    e.panel_name,
    e.island_code,
    e.entered_2h_at IS NOT NULL,
    e.entered_5h_at IS NOT NULL,
    e.entered_12h_at IS NOT NULL,
    COALESCE(e.entered_2h_at, e.entered_5h_at, e.entered_12h_at),
    now()
  FROM enters e
  ON CONFLICT (as_of_bucket, target_id, panel_name, island_code)
  DO UPDATE SET
    enter_2h = EXCLUDED.enter_2h,
    enter_5h = EXCLUDED.enter_5h,
    enter_12h = EXCLUDED.enter_12h,
    entered_at = EXCLUDED.entered_at,
    updated_at = now();

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN jsonb_build_object('as_of_bucket', date_trunc('hour', p_as_of_bucket), 'rows_upserted', v_rows);
END;
$$;

CREATE OR REPLACE FUNCTION public.compute_dppi_labels_survival(
  p_target_id uuid DEFAULT NULL,
  p_since timestamptz DEFAULT now() - interval '7 days'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows int := 0;
BEGIN
  PERFORM public._dppi_require_service_role();

  INSERT INTO public.dppi_labels_survival (
    stint_id,
    target_id,
    panel_name,
    island_code,
    stint_start,
    stint_end,
    duration_minutes,
    stay_30m,
    stay_60m,
    replaced_lt_30m,
    updated_at
  )
  SELECT
    s.id,
    s.target_id,
    s.panel_name,
    s.link_code,
    s.start_ts,
    COALESCE(s.end_ts, s.last_seen_ts, now()) AS stint_end,
    GREATEST(EXTRACT(epoch FROM (COALESCE(s.end_ts, s.last_seen_ts, now()) - s.start_ts)) / 60.0, 0) AS duration_minutes,
    GREATEST(EXTRACT(epoch FROM (COALESCE(s.end_ts, s.last_seen_ts, now()) - s.start_ts)) / 60.0, 0) >= 30 AS stay_30m,
    GREATEST(EXTRACT(epoch FROM (COALESCE(s.end_ts, s.last_seen_ts, now()) - s.start_ts)) / 60.0, 0) >= 60 AS stay_60m,
    (s.closed_reason = 'replaced' AND GREATEST(EXTRACT(epoch FROM (COALESCE(s.end_ts, s.last_seen_ts, now()) - s.start_ts)) / 60.0, 0) < 30) AS replaced_lt_30m,
    now()
  FROM public.discovery_exposure_presence_segments s
  WHERE s.link_code_type = 'island'
    AND s.end_ts IS NOT NULL
    AND s.start_ts >= p_since
    AND (p_target_id IS NULL OR s.target_id = p_target_id)
  ON CONFLICT (stint_id)
  DO UPDATE SET
    target_id = EXCLUDED.target_id,
    panel_name = EXCLUDED.panel_name,
    island_code = EXCLUDED.island_code,
    stint_start = EXCLUDED.stint_start,
    stint_end = EXCLUDED.stint_end,
    duration_minutes = EXCLUDED.duration_minutes,
    stay_30m = EXCLUDED.stay_30m,
    stay_60m = EXCLUDED.stay_60m,
    replaced_lt_30m = EXCLUDED.replaced_lt_30m,
    updated_at = now();

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN jsonb_build_object('since', p_since, 'rows_upserted', v_rows);
END;
$$;

CREATE OR REPLACE FUNCTION public.dppi_get_latest_model(
  p_task_type text DEFAULT NULL,
  p_channel text DEFAULT 'production'
)
RETURNS TABLE(
  model_name text,
  model_version text,
  task_type text,
  status text,
  metrics_json jsonb,
  trained_at timestamptz,
  published_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH from_channel AS (
    SELECT r.model_name, r.model_version
    FROM public.dppi_release_channels r
    WHERE r.channel_name = p_channel
      AND r.model_name IS NOT NULL
      AND r.model_version IS NOT NULL
    LIMIT 1
  )
  SELECT m.model_name, m.model_version, m.task_type, m.status, m.metrics_json, m.trained_at, m.published_at
  FROM public.dppi_model_registry m
  WHERE
    (p_task_type IS NULL OR m.task_type = p_task_type)
    AND (
      (EXISTS (SELECT 1 FROM from_channel) AND (m.model_name, m.model_version) IN (SELECT model_name, model_version FROM from_channel))
      OR
      (NOT EXISTS (SELECT 1 FROM from_channel) AND m.status IN ('production', 'production_candidate', 'shadow'))
    )
  ORDER BY
    CASE m.status WHEN 'production' THEN 0 WHEN 'production_candidate' THEN 1 WHEN 'shadow' THEN 2 ELSE 3 END,
    m.published_at DESC NULLS LAST,
    m.updated_at DESC
  LIMIT 1;
$$;

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
BEGIN
  PERFORM public._dppi_require_service_role();

  SELECT lm.model_name, lm.model_version
    INTO v_model_name, v_model_version
  FROM public.dppi_get_latest_model('entry', 'production') lm
  LIMIT 1;

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
    v_model_name,
    v_model_version,
    jsonb_build_object(
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

  INSERT INTO public.dppi_inference_log (
    ts, mode, target_scope, processed_rows, failed_rows, latency_ms, model_name, model_version, created_at
  )
  VALUES (
    now(),
    'opportunity_batch',
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
    'model_version', v_model_version
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.dppi_cleanup_old_data(
  p_keep_days integer DEFAULT 90
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff timestamptz := now() - make_interval(days => GREATEST(COALESCE(p_keep_days, 90), 7));
  v_deleted_predictions int := 0;
  v_deleted_survival_predictions int := 0;
  v_deleted_inference_logs int := 0;
  v_deleted_training_logs int := 0;
  v_deleted_feedback int := 0;
BEGIN
  PERFORM public._dppi_require_service_role();

  DELETE FROM public.dppi_predictions WHERE generated_at < v_cutoff;
  GET DIAGNOSTICS v_deleted_predictions = ROW_COUNT;

  DELETE FROM public.dppi_survival_predictions WHERE generated_at < v_cutoff;
  GET DIAGNOSTICS v_deleted_survival_predictions = ROW_COUNT;

  DELETE FROM public.dppi_inference_log WHERE ts < v_cutoff;
  GET DIAGNOSTICS v_deleted_inference_logs = ROW_COUNT;

  DELETE FROM public.dppi_training_log WHERE requested_at < v_cutoff;
  GET DIAGNOSTICS v_deleted_training_logs = ROW_COUNT;

  DELETE FROM public.dppi_feedback_events WHERE created_at < v_cutoff;
  GET DIAGNOSTICS v_deleted_feedback = ROW_COUNT;

  RETURN jsonb_build_object(
    'cutoff', v_cutoff,
    'deleted_predictions', v_deleted_predictions,
    'deleted_survival_predictions', v_deleted_survival_predictions,
    'deleted_inference_logs', v_deleted_inference_logs,
    'deleted_training_logs', v_deleted_training_logs,
    'deleted_feedback_events', v_deleted_feedback
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_dppi_overview()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin boolean := public.is_admin_or_editor();
BEGIN
  IF NOT v_is_admin AND (auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN jsonb_build_object(
    'coverage', jsonb_build_object(
      'hourly_rows_24h', (SELECT COUNT(*) FROM public.dppi_feature_store_hourly WHERE as_of_bucket >= now() - interval '24 hours'),
      'daily_rows_30d', (SELECT COUNT(*) FROM public.dppi_feature_store_daily WHERE as_of >= current_date - 30),
      'labels_entry_7d', (SELECT COUNT(*) FROM public.dppi_labels_entry WHERE as_of_bucket >= now() - interval '7 days'),
      'labels_survival_7d', (SELECT COUNT(*) FROM public.dppi_labels_survival WHERE stint_start >= now() - interval '7 days')
    ),
    'training', jsonb_build_object(
      'last_status', (SELECT status FROM public.dppi_training_log ORDER BY requested_at DESC LIMIT 1),
      'last_requested_at', (SELECT requested_at FROM public.dppi_training_log ORDER BY requested_at DESC LIMIT 1),
      'queued', (SELECT COUNT(*) FROM public.dppi_training_log WHERE status = 'queued'),
      'running', (SELECT COUNT(*) FROM public.dppi_training_log WHERE status = 'running')
    ),
    'inference', jsonb_build_object(
      'last_generated_at', (SELECT MAX(generated_at) FROM public.dppi_opportunities),
      'rows_now', (SELECT COUNT(*) FROM public.dppi_opportunities),
      'errors_24h', (SELECT COUNT(*) FROM public.dppi_inference_log WHERE ts >= now() - interval '24 hours' AND failed_rows > 0)
    ),
    'models', jsonb_build_object(
      'registered', (SELECT COUNT(*) FROM public.dppi_model_registry),
      'production', (SELECT COUNT(*) FROM public.dppi_model_registry WHERE status = 'production'),
      'candidate', (SELECT COUNT(*) FROM public.dppi_model_registry WHERE status = 'production_candidate'),
      'shadow', (SELECT COUNT(*) FROM public.dppi_model_registry WHERE status = 'shadow')
    ),
    'releases', (SELECT jsonb_object_agg(channel_name, jsonb_build_object('model_name', model_name, 'model_version', model_version, 'updated_at', updated_at)) FROM public.dppi_release_channels),
    'drift', jsonb_build_object(
      'rows_7d', (SELECT COUNT(*) FROM public.dppi_drift_metrics WHERE measured_at >= now() - interval '7 days'),
      'high_7d', (SELECT COUNT(*) FROM public.dppi_drift_metrics WHERE measured_at >= now() - interval '7 days' AND drift_level = 'high')
    ),
    'calibration', jsonb_build_object(
      'rows_30d', (SELECT COUNT(*) FROM public.dppi_calibration_metrics WHERE measured_at >= now() - interval '30 days')
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.compute_dppi_feature_store_hourly(uuid, text, text, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.compute_dppi_feature_store_daily(uuid, text, text, text, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.compute_dppi_labels_entry(uuid, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.compute_dppi_labels_survival(uuid, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.dppi_get_latest_model(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.materialize_dppi_opportunities(uuid, text, text, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.dppi_cleanup_old_data(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_dppi_overview() TO authenticated, service_role;
