-- V1.1 Command Center: rails/link-graph stats + alerts

CREATE OR REPLACE FUNCTION public.get_link_graph_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_edges_total bigint := 0;
  v_parents_total bigint := 0;
  v_children_total bigint := 0;
  v_recent_collections bigint := 0;
  v_resolved_recent bigint := 0;
  v_resolution_pct numeric := null;
  v_last_edge_seen timestamptz := null;
  v_edge_age_seconds int := null;
  v_stale_edges_60d bigint := 0;
  v_collections_due_now bigint := 0;
BEGIN
  SELECT COUNT(*) INTO v_edges_total
  FROM public.discover_link_edges;

  SELECT COUNT(DISTINCT parent_link_code), COUNT(DISTINCT child_link_code)
  INTO v_parents_total, v_children_total
  FROM public.discover_link_edges;

  WITH recent_collections AS (
    SELECT DISTINCT link_code
    FROM public.discovery_exposure_rank_segments
    WHERE link_code_type = 'collection'
      AND last_seen_ts >= now() - interval '24 hours'
  ),
  resolved_recent AS (
    SELECT DISTINCT e.parent_link_code
    FROM public.discover_link_edges e
    JOIN recent_collections r
      ON r.link_code = e.parent_link_code
  )
  SELECT
    (SELECT COUNT(*) FROM recent_collections),
    (SELECT COUNT(*) FROM resolved_recent)
  INTO v_recent_collections, v_resolved_recent;

  IF v_recent_collections > 0 THEN
    v_resolution_pct := (v_resolved_recent::numeric / v_recent_collections::numeric);
  END IF;

  SELECT MAX(last_seen_at) INTO v_last_edge_seen
  FROM public.discover_link_edges;

  IF v_last_edge_seen IS NOT NULL THEN
    v_edge_age_seconds := EXTRACT(epoch FROM (now() - v_last_edge_seen))::int;
  END IF;

  SELECT COUNT(*) INTO v_stale_edges_60d
  FROM public.discover_link_edges
  WHERE last_seen_at < now() - interval '60 days';

  SELECT COUNT(*) INTO v_collections_due_now
  FROM public.discover_link_metadata
  WHERE link_code_type = 'collection'
    AND next_due_at <= now()
    AND (locked_at IS NULL OR locked_at < now() - interval '5 minutes');

  RETURN jsonb_build_object(
    'edges_total', v_edges_total,
    'parents_total', v_parents_total,
    'children_total', v_children_total,
    'collections_seen_24h', v_recent_collections,
    'collections_resolved_24h', v_resolved_recent,
    'resolution_24h_pct', v_resolution_pct,
    'last_edge_seen_at', v_last_edge_seen,
    'edge_age_seconds', v_edge_age_seconds,
    'stale_edges_60d', v_stale_edges_60d,
    'collections_due_now', v_collections_due_now
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_link_graph_stats() TO authenticated, service_role;

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

  v_recent_collections INT := 0;
  v_resolved_collections INT := 0;
  v_resolution_pct numeric := NULL;
  v_last_edge_seen TIMESTAMPTZ := NULL;
  v_edge_age_seconds INT := NULL;
  v_stale_edges_60d INT := 0;
BEGIN
  IF (auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT COUNT(*)::int
  INTO v_exposure_stale
  FROM public.discovery_exposure_targets t
  WHERE t.last_ok_tick_at IS NULL
     OR t.last_ok_tick_at < now() - make_interval(mins => GREATEST(1, (t.interval_minutes * 2)));

  SELECT COUNT(*)::int
  INTO v_meta_due
  FROM public.discover_link_metadata m
  WHERE m.next_due_at <= now()
    AND (m.locked_at IS NULL OR m.locked_at < now() - interval '5 minutes');

  SELECT MAX(as_of) INTO v_intel_as_of FROM public.discovery_public_premium_now;
  IF v_intel_as_of IS NOT NULL THEN
    v_intel_age_seconds := EXTRACT(epoch FROM (now() - v_intel_as_of))::int;
  END IF;

  WITH recent_collections AS (
    SELECT DISTINCT link_code
    FROM public.discovery_exposure_rank_segments
    WHERE link_code_type = 'collection'
      AND last_seen_ts >= now() - interval '24 hours'
  ),
  resolved_recent AS (
    SELECT DISTINCT e.parent_link_code
    FROM public.discover_link_edges e
    JOIN recent_collections r
      ON r.link_code = e.parent_link_code
  )
  SELECT
    (SELECT COUNT(*)::int FROM recent_collections),
    (SELECT COUNT(*)::int FROM resolved_recent)
  INTO v_recent_collections, v_resolved_collections;

  IF v_recent_collections > 0 THEN
    v_resolution_pct := (v_resolved_collections::numeric / v_recent_collections::numeric);
  END IF;

  SELECT MAX(last_seen_at) INTO v_last_edge_seen
  FROM public.discover_link_edges;

  IF v_last_edge_seen IS NOT NULL THEN
    v_edge_age_seconds := EXTRACT(epoch FROM (now() - v_last_edge_seen))::int;
  END IF;

  SELECT COUNT(*)::int INTO v_stale_edges_60d
  FROM public.discover_link_edges
  WHERE last_seen_at < now() - interval '60 days';

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
      CASE
        WHEN v_intel_as_of IS NULL THEN 'Intel has not run yet'
        ELSE 'Intel freshness'
      END,
      jsonb_build_object('as_of', v_intel_as_of, 'age_seconds', v_intel_age_seconds),
      now()
    ),
    (
      'link_edges_coverage',
      CASE
        WHEN v_recent_collections = 0 THEN 'ok'
        WHEN v_resolution_pct >= 0.85 THEN 'ok'
        WHEN v_resolution_pct >= 0.50 THEN 'warn'
        ELSE 'error'
      END,
      CASE
        WHEN v_recent_collections = 0 THEN 'No recent collection rails to resolve'
        WHEN v_resolution_pct >= 0.85 THEN 'Collection rails resolution healthy'
        ELSE 'Collection rails resolution needs attention'
      END,
      jsonb_build_object(
        'collections_seen_24h', v_recent_collections,
        'collections_resolved_24h', v_resolved_collections,
        'resolution_24h_pct', v_resolution_pct
      ),
      now()
    ),
    (
      'link_edges_freshness',
      CASE
        WHEN v_last_edge_seen IS NULL THEN 'warn'
        WHEN v_edge_age_seconds <= 3600 AND v_stale_edges_60d < 10000 THEN 'ok'
        WHEN v_edge_age_seconds <= 21600 AND v_stale_edges_60d < 50000 THEN 'warn'
        ELSE 'error'
      END,
      CASE
        WHEN v_last_edge_seen IS NULL THEN 'Link graph has no edges yet'
        ELSE 'Link graph freshness'
      END,
      jsonb_build_object(
        'last_edge_seen_at', v_last_edge_seen,
        'edge_age_seconds', v_edge_age_seconds,
        'stale_edges_60d', v_stale_edges_60d
      ),
      now()
    )
  ON CONFLICT (alert_key) DO UPDATE
  SET severity = EXCLUDED.severity,
      message = EXCLUDED.message,
      details = EXCLUDED.details,
      updated_at = EXCLUDED.updated_at;

  RETURN jsonb_build_object(
    'exposure_stale_targets', v_exposure_stale,
    'metadata_due_now', v_meta_due,
    'intel_as_of', v_intel_as_of,
    'intel_age_seconds', v_intel_age_seconds,
    'collections_seen_24h', v_recent_collections,
    'collections_resolved_24h', v_resolved_collections,
    'resolution_24h_pct', v_resolution_pct,
    'last_edge_seen_at', v_last_edge_seen,
    'edge_age_seconds', v_edge_age_seconds,
    'stale_edges_60d', v_stale_edges_60d
  );
END;
$$;
