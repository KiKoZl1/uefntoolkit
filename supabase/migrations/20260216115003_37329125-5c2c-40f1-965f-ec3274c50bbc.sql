
CREATE OR REPLACE FUNCTION public.compute_system_alerts()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exposure_stale INT := 0;
  v_meta_due INT := 0;
  v_intel_age_seconds INT := NULL;
  v_intel_as_of TIMESTAMPTZ := NULL;
  v_edges_total INT := 0;
  v_edges_parents INT := 0;
  v_collections_total INT := 0;
  v_edges_stale INT := 0;
  v_last_exposure_tick TIMESTAMPTZ := NULL;
  v_exposure_ticks_1h INT := 0;
  v_last_metadata_fetch TIMESTAMPTZ := NULL;
  v_metadata_fetched_1h INT := 0;
  v_collector_phase TEXT := NULL;
  v_collector_updated TIMESTAMPTZ := NULL;
  v_collector_age_seconds INT := NULL;
BEGIN
  IF current_user NOT IN ('postgres', 'supabase_admin')
     AND (auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT COUNT(*)::int INTO v_exposure_stale
  FROM public.discovery_exposure_targets t
  WHERE t.last_ok_tick_at IS NULL
     OR t.last_ok_tick_at < now() - make_interval(mins => GREATEST(1, (t.interval_minutes * 2)));

  SELECT COUNT(*)::int INTO v_meta_due
  FROM public.discover_link_metadata m
  WHERE m.next_due_at <= now()
    AND (m.locked_at IS NULL OR m.locked_at < now() - interval '5 minutes');

  SELECT MAX(as_of) INTO v_intel_as_of FROM public.discovery_public_premium_now;
  IF v_intel_as_of IS NOT NULL THEN
    v_intel_age_seconds := EXTRACT(epoch FROM (now() - v_intel_as_of))::int;
  END IF;

  SELECT COUNT(*)::int, COUNT(DISTINCT parent_link_code)::int
  INTO v_edges_total, v_edges_parents
  FROM public.discover_link_edges;

  -- Only count set_* collections as resolvable (playlist_*, reference_*, tournament_* don't return children from Epic API)
  SELECT COUNT(DISTINCT rs.link_code)::int INTO v_collections_total
  FROM public.discovery_exposure_rank_segments rs
  WHERE rs.link_code_type = 'collection'
    AND rs.end_ts IS NULL
    AND rs.link_code LIKE 'set_%';

  SELECT COUNT(*)::int INTO v_edges_stale
  FROM public.discover_link_edges WHERE last_seen_at < now() - interval '60 days';

  SELECT MAX(ts_start) INTO v_last_exposure_tick
  FROM public.discovery_exposure_ticks WHERE status = 'ok';
  
  SELECT COUNT(*)::int INTO v_exposure_ticks_1h
  FROM public.discovery_exposure_ticks
  WHERE status = 'ok' AND ts_start > now() - interval '1 hour';

  SELECT MAX(last_fetched_at) INTO v_last_metadata_fetch
  FROM public.discover_link_metadata WHERE last_fetched_at IS NOT NULL;
  
  SELECT COUNT(*)::int INTO v_metadata_fetched_1h
  FROM public.discover_link_metadata
  WHERE last_fetched_at > now() - interval '1 hour';

  SELECT phase, updated_at INTO v_collector_phase, v_collector_updated
  FROM public.discover_reports
  ORDER BY created_at DESC LIMIT 1;
  
  IF v_collector_updated IS NOT NULL THEN
    v_collector_age_seconds := EXTRACT(epoch FROM (now() - v_collector_updated))::int;
  END IF;

  INSERT INTO public.system_alerts_current(alert_key, severity, message, details, updated_at)
  VALUES
    (
      'exposure_stale',
      CASE WHEN v_exposure_stale = 0 THEN 'ok' WHEN v_exposure_stale <= 1 THEN 'warn' ELSE 'error' END,
      CASE WHEN v_exposure_stale = 0 THEN 'Exposure OK' ELSE 'Exposure stale targets detected' END,
      jsonb_build_object('stale_targets', v_exposure_stale),
      now()
    ),
    (
      'metadata_backlog',
      CASE WHEN v_meta_due < 500 THEN 'ok' WHEN v_meta_due < 5000 THEN 'warn' ELSE 'error' END,
      CASE WHEN v_meta_due < 500 THEN 'Metadata backlog OK' ELSE 'Metadata backlog growing' END,
      jsonb_build_object('due_now', v_meta_due),
      now()
    ),
    (
      'intel_freshness',
      CASE
        WHEN v_intel_as_of IS NULL THEN 'warn'
        WHEN v_intel_age_seconds <= 600 THEN 'ok'
        WHEN v_intel_age_seconds <= 1800 THEN 'warn'
        ELSE 'error'
      END,
      CASE WHEN v_intel_as_of IS NULL THEN 'Intel has not run yet' ELSE 'Intel freshness' END,
      jsonb_build_object('as_of', v_intel_as_of, 'age_seconds', v_intel_age_seconds),
      now()
    ),
    (
      'link_edges_coverage',
      CASE
        WHEN v_collections_total = 0 THEN 'ok'
        WHEN v_edges_parents = 0 THEN 'error'
        WHEN v_edges_parents::float / GREATEST(v_collections_total, 1) < 0.3 THEN 'warn'
        ELSE 'ok'
      END,
      CASE WHEN v_edges_parents = 0 AND v_collections_total > 0 THEN 'No link edges resolved' ELSE 'Link edges coverage' END,
      jsonb_build_object('edges_total', v_edges_total, 'parents_resolved', v_edges_parents, 'collections_resolvable', v_collections_total),
      now()
    ),
    (
      'link_edges_freshness',
      CASE
        WHEN v_edges_total = 0 THEN 'ok'
        WHEN v_edges_stale > v_edges_total * 0.5 THEN 'error'
        WHEN v_edges_stale > v_edges_total * 0.2 THEN 'warn'
        ELSE 'ok'
      END,
      CASE WHEN v_edges_stale > 0 THEN 'Stale link edges detected' ELSE 'Link edges freshness OK' END,
      jsonb_build_object('stale_60d', v_edges_stale, 'total', v_edges_total),
      now()
    ),
    (
      'exposure_data_flow',
      CASE
        WHEN v_exposure_ticks_1h = 0 THEN 'error'
        WHEN v_exposure_ticks_1h < 3 THEN 'warn'
        ELSE 'ok'
      END,
      CASE
        WHEN v_exposure_ticks_1h = 0 THEN 'Exposure collector stopped'
        WHEN v_exposure_ticks_1h < 3 THEN 'Exposure collector slow'
        ELSE 'Exposure data flow OK'
      END,
      jsonb_build_object('last_tick', v_last_exposure_tick, 'ticks_1h', v_exposure_ticks_1h),
      now()
    ),
    (
      'metadata_data_flow',
      CASE
        WHEN v_metadata_fetched_1h = 0 THEN 'error'
        WHEN v_metadata_fetched_1h < 10 THEN 'warn'
        ELSE 'ok'
      END,
      CASE
        WHEN v_metadata_fetched_1h = 0 THEN 'Metadata collector stopped'
        WHEN v_metadata_fetched_1h < 10 THEN 'Metadata collector slow'
        ELSE 'Metadata data flow OK'
      END,
      jsonb_build_object('last_fetch', v_last_metadata_fetch, 'fetched_1h', v_metadata_fetched_1h),
      now()
    ),
    (
      'collector_pipeline',
      CASE
        WHEN v_collector_phase IS NULL THEN 'ok'
        WHEN v_collector_phase IN ('catalog', 'metrics') AND v_collector_age_seconds > 3600 THEN 'warn'
        ELSE 'ok'
      END,
      CASE
        WHEN v_collector_phase IS NULL THEN 'No active collector run'
        WHEN v_collector_phase = 'done' THEN 'Collector pipeline idle'
        ELSE 'Collector running: ' || v_collector_phase
      END,
      jsonb_build_object('phase', v_collector_phase, 'updated_at', v_collector_updated, 'age_seconds', v_collector_age_seconds),
      now()
    )
  ON CONFLICT (alert_key) DO UPDATE SET
    severity = EXCLUDED.severity,
    message = EXCLUDED.message,
    details = EXCLUDED.details,
    updated_at = EXCLUDED.updated_at;

  RETURN jsonb_build_object('ok', true, 'alerts_upserted', 8);
END;
$$;
