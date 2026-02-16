
-- =====================================================
-- V1.1 Migration: discover_link_edges + cleanup + command center stats/alerts
-- =====================================================

-- 1) discover_link_edges table
CREATE TABLE IF NOT EXISTS public.discover_link_edges (
  parent_link_code TEXT NOT NULL,
  child_link_code TEXT NOT NULL,
  edge_type TEXT NOT NULL DEFAULT 'related_link',
  sort_order INTEGER,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (parent_link_code, child_link_code, edge_type)
);

CREATE INDEX IF NOT EXISTS idx_discover_link_edges_parent ON public.discover_link_edges (parent_link_code);
CREATE INDEX IF NOT EXISTS idx_discover_link_edges_child ON public.discover_link_edges (child_link_code);
CREATE INDEX IF NOT EXISTS idx_discover_link_edges_last_seen ON public.discover_link_edges (last_seen_at);

ALTER TABLE public.discover_link_edges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_discover_link_edges_public"
  ON public.discover_link_edges FOR SELECT
  USING (true);

CREATE POLICY "all_discover_link_edges_service_role"
  ON public.discover_link_edges FOR ALL
  USING ((auth.jwt() ->> 'role'::text) = 'service_role'::text)
  WITH CHECK ((auth.jwt() ->> 'role'::text) = 'service_role'::text);

-- 2) cleanup_discover_link_edges function
CREATE OR REPLACE FUNCTION public.cleanup_discover_link_edges(
  p_days INTEGER DEFAULT 60,
  p_delete_batch INTEGER DEFAULT 200000
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_deleted INT := 0;
BEGIN
  IF current_user NOT IN ('postgres', 'supabase_admin')
     AND (auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  WITH todel AS (
    SELECT parent_link_code, child_link_code, edge_type
    FROM public.discover_link_edges
    WHERE last_seen_at < now() - make_interval(days => GREATEST(p_days, 1))
    ORDER BY last_seen_at ASC
    LIMIT GREATEST(p_delete_batch, 1)
  )
  DELETE FROM public.discover_link_edges e
  USING todel d
  WHERE e.parent_link_code = d.parent_link_code
    AND e.child_link_code = d.child_link_code
    AND e.edge_type = d.edge_type;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN jsonb_build_object('deleted', v_deleted, 'days', p_days);
END;
$function$;

-- 3) get_link_graph_stats RPC
CREATE OR REPLACE FUNCTION public.get_link_graph_stats()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'total_edges',       count(*),
    'distinct_parents',  count(DISTINCT parent_link_code),
    'distinct_children', count(DISTINCT child_link_code),
    'stale_60d',         count(*) FILTER (WHERE last_seen_at < now() - interval '60 days'),
    'collections_due',   (SELECT count(*) FROM discover_link_metadata WHERE link_code_type = 'collection' AND next_due_at <= now() AND locked_at IS NULL)
  )
  FROM discover_link_edges;
$function$;

-- 4) Update compute_system_alerts to include link_edges alerts
CREATE OR REPLACE FUNCTION public.compute_system_alerts()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_exposure_stale INT := 0;
  v_meta_due INT := 0;
  v_intel_age_seconds INT := NULL;
  v_intel_as_of TIMESTAMPTZ := NULL;
  v_edges_total INT := 0;
  v_edges_parents INT := 0;
  v_collections_total INT := 0;
  v_edges_stale INT := 0;
BEGIN
  IF current_user NOT IN ('postgres', 'supabase_admin')
     AND (auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
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

  -- Link edges stats
  SELECT COUNT(*)::int, COUNT(DISTINCT parent_link_code)::int
  INTO v_edges_total, v_edges_parents
  FROM public.discover_link_edges;

  SELECT COUNT(*)::int INTO v_collections_total
  FROM public.discover_link_metadata WHERE link_code_type = 'collection';

  SELECT COUNT(*)::int INTO v_edges_stale
  FROM public.discover_link_edges WHERE last_seen_at < now() - interval '60 days';

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
        WHEN v_collections_total = 0 THEN 'ok'
        WHEN v_edges_parents = 0 THEN 'error'
        WHEN v_edges_parents::float / GREATEST(v_collections_total, 1) < 0.3 THEN 'warn'
        ELSE 'ok'
      END,
      CASE
        WHEN v_edges_parents = 0 AND v_collections_total > 0 THEN 'No link edges resolved'
        ELSE 'Link edges coverage'
      END,
      jsonb_build_object('edges_total', v_edges_total, 'parents_resolved', v_edges_parents, 'collections_total', v_collections_total),
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
      CASE
        WHEN v_edges_stale > 0 THEN 'Stale link edges detected'
        ELSE 'Link edges freshness OK'
      END,
      jsonb_build_object('stale_60d', v_edges_stale, 'total', v_edges_total),
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
    'edges_total', v_edges_total,
    'edges_parents', v_edges_parents,
    'collections_total', v_collections_total,
    'edges_stale', v_edges_stale
  );
END;
$function$;
