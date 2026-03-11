-- Wave 1 latency optimization
-- 1) Admin snapshot serving bundle (single read path for Admin Overview)
-- 2) Hot-cache prewarm scheduler for lookup + AI
-- 3) Additive indexes for common latency hotspots
--
-- Rollback notes:
-- - Disable jobs:
--   SELECT cron.alter_job(jobid, NULL, NULL, NULL, NULL, false)
--   FROM cron.job
--   WHERE jobname IN (
--     'discover-admin-overview-snapshot-1min',
--     'discover-hot-runtime-prewarm-3min',
--     'discover-island-page-cache-refresh-2min'
--   );
-- - Keep tables/functions in place (non-breaking), or drop if needed in a dedicated rollback migration.

CREATE TABLE IF NOT EXISTS public.discover_admin_overview_snapshot (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  as_of timestamptz NOT NULL DEFAULT now(),
  payload_json jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.discover_admin_overview_snapshot ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- Do not expose this snapshot to all authenticated users.
  -- Reads should stay behind discover-data-api admin checks.
  IF to_regclass('public.user_roles') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename = 'discover_admin_overview_snapshot'
         AND policyname = 'select_discover_admin_overview_snapshot_admin'
     ) THEN
    CREATE POLICY select_discover_admin_overview_snapshot_admin
      ON public.discover_admin_overview_snapshot
      FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.user_roles ur
          WHERE ur.user_id = auth.uid()
            AND ur.role IN ('admin', 'editor')
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'discover_admin_overview_snapshot'
      AND policyname = 'all_discover_admin_overview_snapshot_service_role'
  ) THEN
    CREATE POLICY all_discover_admin_overview_snapshot_service_role
      ON public.discover_admin_overview_snapshot
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.refresh_discover_admin_overview_snapshot()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_24h_ago timestamptz := now() - interval '24 hours';
  v_census jsonb := '{}'::jsonb;
  v_meta jsonb := '{}'::jsonb;
  v_lookup jsonb := '{}'::jsonb;
  v_lookup_errors jsonb := '[]'::jsonb;
  v_link jsonb := '{}'::jsonb;
  v_targets_total int := 0;
  v_targets_ok int := 0;
  v_ticks_24h int := 0;
  v_ticks_ok int := 0;
  v_ticks_failed int := 0;
  v_engine_reports int := 0;
  v_weekly_reports int := 0;
  v_weekly_published int := 0;
  v_exposure_tick_at timestamptz := NULL;
  v_metadata_event_at timestamptz := NULL;
  v_alerts jsonb := '[]'::jsonb;
  v_payload jsonb := '{}'::jsonb;
BEGIN
  IF current_user NOT IN ('postgres', 'supabase_admin')
     AND (auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT COALESCE(public.get_census_stats(), '{}'::jsonb) INTO v_census;
  SELECT COALESCE(public.get_metadata_pipeline_stats(), '{}'::jsonb) INTO v_meta;
  SELECT COALESCE(public.get_lookup_pipeline_stats(), '{}'::jsonb) INTO v_lookup;
  SELECT COALESCE(public.get_lookup_pipeline_error_breakdown(24, 8), '[]'::jsonb) INTO v_lookup_errors;
  SELECT COALESCE(public.get_link_graph_stats(), '{}'::jsonb) INTO v_link;

  SELECT COUNT(*)::int INTO v_engine_reports FROM public.discover_reports;
  SELECT COUNT(*)::int INTO v_weekly_reports FROM public.weekly_reports;
  SELECT COUNT(*)::int INTO v_weekly_published FROM public.weekly_reports WHERE published_at IS NOT NULL;

  SELECT COUNT(*)::int INTO v_targets_total FROM public.discovery_exposure_targets;
  SELECT COUNT(*)::int INTO v_targets_ok
  FROM public.discovery_exposure_targets
  WHERE last_ok_tick_at IS NOT NULL;

  SELECT COUNT(*)::int INTO v_ticks_24h
  FROM public.discovery_exposure_ticks
  WHERE ts_start >= v_24h_ago;

  SELECT COUNT(*)::int INTO v_ticks_ok
  FROM public.discovery_exposure_ticks
  WHERE ts_start >= v_24h_ago
    AND status = 'ok';

  SELECT COUNT(*)::int INTO v_ticks_failed
  FROM public.discovery_exposure_ticks
  WHERE ts_start >= v_24h_ago
    AND status = 'error';

  SELECT ts_start INTO v_exposure_tick_at
  FROM public.discovery_exposure_ticks
  ORDER BY ts_start DESC
  LIMIT 1;

  SELECT created_at INTO v_metadata_event_at
  FROM public.discover_link_metadata_events
  ORDER BY created_at DESC
  LIMIT 1;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'alert_key', a.alert_key,
        'severity', a.severity,
        'message', a.message,
        'details', a.details,
        'updated_at', a.updated_at
      )
      ORDER BY a.alert_key ASC
    ),
    '[]'::jsonb
  )
  INTO v_alerts
  FROM public.system_alerts_current a;

  v_payload := jsonb_build_object(
    'as_of', v_now,
    'census', jsonb_build_object(
      'totalIslands', COALESCE((v_census ->> 'total_islands')::int, 0),
      'reported', COALESCE((v_census ->> 'reported')::int, 0),
      'suppressed', COALESCE((v_census ->> 'suppressed')::int, 0),
      'otherStatus', GREATEST(
        0,
        COALESCE((v_census ->> 'total_islands')::int, 0)
        - COALESCE((v_census ->> 'reported')::int, 0)
        - COALESCE((v_census ->> 'suppressed')::int, 0)
      ),
      'withTitle', COALESCE((v_census ->> 'with_title')::int, 0),
      'uniqueCreators', COALESCE((v_census ->> 'unique_creators')::int, 0),
      'engineReports', v_engine_reports,
      'weeklyReports', v_weekly_reports,
      'weeklyPublished', v_weekly_published
    ),
    'meta', jsonb_build_object(
      'total', COALESCE((v_meta ->> 'total')::int, 0),
      'withTitle', COALESCE((v_meta ->> 'with_title')::int, 0),
      'withError', COALESCE((v_meta ->> 'with_error')::int, 0),
      'pendingNoData', COALESCE((v_meta ->> 'pending_no_data')::int, 0),
      'locked', COALESCE((v_meta ->> 'locked')::int, 0),
      'dueNow', COALESCE((v_meta ->> 'due_now')::int, 0),
      'islands', COALESCE((v_meta ->> 'islands')::int, 0),
      'collections', COALESCE((v_meta ->> 'collections')::int, 0)
    ),
    'exposure', jsonb_build_object(
      'targetsTotal', v_targets_total,
      'targetsOk', v_targets_ok,
      'ticks24h', v_ticks_24h,
      'ticksOk', v_ticks_ok,
      'ticksFailed', v_ticks_failed
    ),
    'linkGraph', jsonb_build_object(
      'edgesTotal', COALESCE((v_link ->> 'edges_total')::int, 0),
      'parentsTotal', COALESCE((v_link ->> 'parents_total')::int, 0),
      'childrenTotal', COALESCE((v_link ->> 'children_total')::int, 0),
      'collectionsSeen24h', COALESCE((v_link ->> 'collections_seen_24h')::int, 0),
      'collectionsResolved24h', COALESCE((v_link ->> 'collections_resolved_24h')::int, 0),
      'resolution24hPct', CASE WHEN v_link ? 'resolution_24h_pct' THEN (v_link ->> 'resolution_24h_pct')::numeric ELSE NULL END,
      'edgeAgeSeconds', CASE WHEN v_link ? 'edge_age_seconds' THEN (v_link ->> 'edge_age_seconds')::numeric ELSE NULL END,
      'staleEdges60d', COALESCE((v_link ->> 'stale_edges_60d')::int, 0),
      'collectionsDueNow', COALESCE((v_link ->> 'collections_due_now')::int, 0),
      'referenceCollections', COALESCE((v_link ->> 'reference_collections')::int, 0)
    ),
    'lookup', jsonb_build_object(
      'calls24h', COALESCE((v_lookup ->> 'calls_24h')::int, 0),
      'ok24h', COALESCE((v_lookup ->> 'ok_24h')::int, 0),
      'fail24h', COALESCE((v_lookup ->> 'fail_24h')::int, 0),
      'calls1h', COALESCE((v_lookup ->> 'calls_1h')::int, 0),
      'ok1h', COALESCE((v_lookup ->> 'ok_1h')::int, 0),
      'fail1h', COALESCE((v_lookup ->> 'fail_1h')::int, 0),
      'p95ms24h', CASE WHEN v_lookup ? 'p95_ms_24h' THEN (v_lookup ->> 'p95_ms_24h')::numeric ELSE NULL END,
      'avgMs24h', CASE WHEN v_lookup ? 'avg_ms_24h' THEN (v_lookup ->> 'avg_ms_24h')::numeric ELSE NULL END,
      'lastOkAt', v_lookup ->> 'last_ok_at',
      'lastErrorAt', v_lookup ->> 'last_error_at',
      'failRate24hPct', COALESCE((v_lookup ->> 'fail_rate_24h_pct')::numeric, 0),
      'coverageInternalCardPct', COALESCE((v_lookup ->> 'coverage_internal_card_pct')::numeric, 0),
      'coverageDiscoverySignalsPct', COALESCE((v_lookup ->> 'coverage_discovery_signals_pct')::numeric, 0),
      'coverageWeeklyPerfPct', COALESCE((v_lookup ->> 'coverage_weekly_perf_pct')::numeric, 0),
      'errorBreakdown', COALESCE(v_lookup_errors, '[]'::jsonb)
    ),
    'alerts', v_alerts,
    'monitorHeartbeat', jsonb_build_object(
      'exposureTickAt', v_exposure_tick_at,
      'metadataEventAt', v_metadata_event_at
    )
  );

  INSERT INTO public.discover_admin_overview_snapshot (id, as_of, payload_json, updated_at)
  VALUES (1, v_now, v_payload, now())
  ON CONFLICT (id) DO UPDATE
  SET as_of = EXCLUDED.as_of,
      payload_json = EXCLUDED.payload_json,
      updated_at = now();

  RETURN v_payload;
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_discover_admin_overview_snapshot() TO service_role;

CREATE OR REPLACE FUNCTION public.get_discover_hot_island_codes(
  p_limit integer DEFAULT 40,
  p_region text DEFAULT 'NAE',
  p_surface text DEFAULT 'CreativeDiscoverySurface_Frontend'
)
RETURNS TABLE (island_code text)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH ranked AS (
    SELECT
      link_code,
      MIN(rank)::numeric AS ord
    FROM public.discovery_public_premium_now
    WHERE link_code_type = 'island'
      AND region = COALESCE(p_region, 'NAE')
      AND surface_name = COALESCE(p_surface, 'CreativeDiscoverySurface_Frontend')
    GROUP BY link_code

    UNION ALL

    SELECT
      link_code,
      (1000000 - MAX(score))::numeric AS ord
    FROM public.discovery_public_emerging_now
    WHERE link_code_type = 'island'
      AND region = COALESCE(p_region, 'NAE')
      AND surface_name = COALESCE(p_surface, 'CreativeDiscoverySurface_Frontend')
    GROUP BY link_code
  ),
  dedup AS (
    SELECT
      link_code,
      MIN(ord) AS best_ord
    FROM ranked
    WHERE link_code ~ '^[0-9]{4}-[0-9]{4}-[0-9]{4}$'
    GROUP BY link_code
  )
  SELECT d.link_code
  FROM dedup d
  ORDER BY d.best_ord ASC
  LIMIT GREATEST(COALESCE(p_limit, 40), 1);
$$;

CREATE OR REPLACE FUNCTION public.refresh_discover_hot_runtime_caches(
  p_lookup_limit integer DEFAULT 40,
  p_ai_limit integer DEFAULT 20,
  p_region text DEFAULT 'NAE',
  p_surface text DEFAULT 'CreativeDiscoverySurface_Frontend'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text := current_setting('app.settings.supabase_url', true);
  v_key text := current_setting('app.settings.service_role_key', true);
  v_now_bucket text := to_char(date_trunc('hour', now()), 'YYYYMMDDHH24');
  v_lookup_sent int := 0;
  v_ai_sent int := 0;
  v_code text;
BEGIN
  IF current_user NOT IN ('postgres', 'supabase_admin')
     AND (auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF v_url IS NULL OR v_url = '' OR v_key IS NULL OR v_key = '' THEN
    RAISE EXCEPTION 'missing app.settings.supabase_url/service_role_key';
  END IF;

  FOR v_code IN
    SELECT island_code
    FROM public.get_discover_hot_island_codes(
      GREATEST(COALESCE(p_lookup_limit, 40), COALESCE(p_ai_limit, 20)),
      COALESCE(p_region, 'NAE'),
      COALESCE(p_surface, 'CreativeDiscoverySurface_Frontend')
    )
  LOOP
    PERFORM net.http_post(
      url := v_url || '/functions/v1/discover-island-lookup',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_key,
        'apikey', v_key
      ),
      body := jsonb_build_object(
        'islandCode', v_code,
        'compareCode', null
      )
    );
    v_lookup_sent := v_lookup_sent + 1;

    IF v_ai_sent < GREATEST(COALESCE(p_ai_limit, 20), 0) THEN
      PERFORM net.http_post(
        url := v_url || '/functions/v1/discover-island-lookup-ai',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || v_key,
          'apikey', v_key
        ),
        body := jsonb_build_object(
          'primaryCode', v_code,
          'compareCode', null,
          'locale', 'pt-BR',
          'windowDays', 7,
          'includeRecent', false,
          'payloadFingerprint', 'prewarm:' || v_code || ':' || v_now_bucket
        )
      );
      v_ai_sent := v_ai_sent + 1;
    END IF;

    EXIT WHEN v_lookup_sent >= GREATEST(COALESCE(p_lookup_limit, 40), 1);
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'region', COALESCE(p_region, 'NAE'),
    'surface_name', COALESCE(p_surface, 'CreativeDiscoverySurface_Frontend'),
    'lookup_sent', v_lookup_sent,
    'ai_sent', v_ai_sent
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_discover_hot_runtime_caches(integer, integer, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.get_discover_hot_island_codes(integer, text, text)
  TO authenticated, service_role;

DO $$
DECLARE
  v_jobid bigint;
BEGIN
  -- Keep admin snapshot fresh every minute (single fast read path for frontend admin widgets).
  SELECT jobid INTO v_jobid
  FROM cron.job
  WHERE jobname = 'discover-admin-overview-snapshot-1min'
  LIMIT 1;

  IF v_jobid IS NULL THEN
    PERFORM cron.schedule(
      'discover-admin-overview-snapshot-1min',
      '*/1 * * * *',
      $cmd$SELECT public.refresh_discover_admin_overview_snapshot();$cmd$
    );
  ELSE
    PERFORM cron.alter_job(
      v_jobid,
      '*/1 * * * *',
      $cmd$SELECT public.refresh_discover_admin_overview_snapshot();$cmd$,
      NULL,
      NULL,
      true
    );
  END IF;
END $$;

DO $$
DECLARE
  v_jobid bigint;
BEGIN
  -- Prewarm hot runtime caches for lookup + AI every 3 minutes.
  SELECT jobid INTO v_jobid
  FROM cron.job
  WHERE jobname = 'discover-hot-runtime-prewarm-3min'
  LIMIT 1;

  IF v_jobid IS NULL THEN
    PERFORM cron.schedule(
      'discover-hot-runtime-prewarm-3min',
      '*/3 * * * *',
      $cmd$SELECT public.refresh_discover_hot_runtime_caches(40, 20, 'NAE', 'CreativeDiscoverySurface_Frontend');$cmd$
    );
  ELSE
    PERFORM cron.alter_job(
      v_jobid,
      '*/3 * * * *',
      $cmd$SELECT public.refresh_discover_hot_runtime_caches(40, 20, 'NAE', 'CreativeDiscoverySurface_Frontend');$cmd$,
      NULL,
      NULL,
      true
    );
  END IF;
END $$;

DO $$
DECLARE
  v_jobid bigint;
  v_url text := current_setting('app.settings.supabase_url', true);
  v_key text := current_setting('app.settings.service_role_key', true);
BEGIN
  -- Tighten island-page prewarm cadence for first-hit latency.
  IF v_url IS NULL OR v_url = '' OR v_key IS NULL OR v_key = '' THEN
    RAISE NOTICE 'Skipping discover-island-page-cache-refresh-2min (missing app.settings keys)';
    RETURN;
  END IF;

  SELECT jobid INTO v_jobid
  FROM cron.job
  WHERE jobname = 'discover-island-page-cache-refresh-2min'
  LIMIT 1;

  IF v_jobid IS NULL THEN
    PERFORM cron.schedule(
      'discover-island-page-cache-refresh-2min',
      '*/2 * * * *',
      format($job$
        SELECT net.http_post(
          url := %L || '/functions/v1/discover-island-page',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || %L,
            'apikey', %L
          ),
          body := '{"mode":"refresh_cache","batchSize":80,"prewarmHot":true}'::jsonb
        ) AS request_id;
      $job$, v_url, v_key, v_key)
    );
  ELSE
    PERFORM cron.alter_job(
      v_jobid,
      '*/2 * * * *',
      format($job$
        SELECT net.http_post(
          url := %L || '/functions/v1/discover-island-page',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || %L,
            'apikey', %L
          ),
          body := '{"mode":"refresh_cache","batchSize":80,"prewarmHot":true}'::jsonb
        ) AS request_id;
      $job$, v_url, v_key, v_key),
      NULL,
      NULL,
      true
    );
  END IF;
END $$;

-- Additive indexes for frequent read paths observed in pg_stat snapshots.
-- Guardrails to avoid long blocking locks during deploy on growing tables.
SET lock_timeout = '5s';
SET statement_timeout = '15min';

CREATE INDEX IF NOT EXISTS idx_discovery_exposure_ticks_ts_status
  ON public.discovery_exposure_ticks (ts_start DESC, status);

CREATE INDEX IF NOT EXISTS idx_discover_link_metadata_events_created_at
  ON public.discover_link_metadata_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_discover_lookup_pipeline_runs_ts_status_duration
  ON public.discover_lookup_pipeline_runs (ts DESC, status, duration_ms);

CREATE INDEX IF NOT EXISTS idx_discovery_exposure_rank_segments_lookup_live
  ON public.discovery_exposure_rank_segments (target_id, link_code, link_code_type, end_ts, last_seen_ts DESC);

CREATE INDEX IF NOT EXISTS idx_discover_lookup_recent_primary_compare_access
  ON public.discover_lookup_recent (primary_code, compare_code, last_accessed_at DESC);

CREATE INDEX IF NOT EXISTS idx_discover_lookup_ai_recent_primary_compare_created
  ON public.discover_lookup_ai_recent (primary_code, compare_code, locale, window_days, created_at DESC);

RESET statement_timeout;
RESET lock_timeout;
