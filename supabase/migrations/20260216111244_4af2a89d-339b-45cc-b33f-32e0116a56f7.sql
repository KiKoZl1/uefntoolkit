
-- ============================================================
-- Lookup Pipeline: telemetry table + RPCs
-- ============================================================

CREATE TABLE IF NOT EXISTS public.discover_lookup_pipeline_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid,
  island_code text NOT NULL DEFAULT 'unknown',
  status text NOT NULL DEFAULT 'ok',
  duration_ms integer,
  error_type text,
  error_message text,
  has_internal_card boolean DEFAULT false,
  has_discovery_signals boolean DEFAULT false,
  has_weekly_performance boolean DEFAULT false,
  category_leaders_count integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lookup_runs_created ON public.discover_lookup_pipeline_runs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lookup_runs_status ON public.discover_lookup_pipeline_runs (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lookup_runs_error_type ON public.discover_lookup_pipeline_runs (error_type) WHERE error_type IS NOT NULL;

ALTER TABLE public.discover_lookup_pipeline_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on lookup runs"
  ON public.discover_lookup_pipeline_runs FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role')
  WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

CREATE POLICY "Admins can view lookup runs"
  ON public.discover_lookup_pipeline_runs FOR SELECT
  USING (has_role(auth.uid(), 'admin'));

-- ── RPC: get_lookup_pipeline_stats ──
CREATE OR REPLACE FUNCTION public.get_lookup_pipeline_stats()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result json;
BEGIN
  SET LOCAL statement_timeout = '5s';

  WITH
    h24 AS (
      SELECT * FROM discover_lookup_pipeline_runs
      WHERE created_at > now() - interval '24 hours'
    ),
    h1 AS (
      SELECT * FROM h24
      WHERE created_at > now() - interval '1 hour'
    ),
    stats_24h AS (
      SELECT
        count(*) AS calls_24h,
        count(*) FILTER (WHERE status = 'ok') AS ok_24h,
        count(*) FILTER (WHERE status = 'error') AS fail_24h,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) FILTER (WHERE duration_ms IS NOT NULL) AS p95_24h,
        avg(duration_ms) FILTER (WHERE duration_ms IS NOT NULL) AS avg_ms_24h,
        count(*) FILTER (WHERE has_internal_card = true AND status = 'ok') AS with_internal_card,
        count(*) FILTER (WHERE has_discovery_signals = true AND status = 'ok') AS with_discovery_signals,
        count(*) FILTER (WHERE has_weekly_performance = true AND status = 'ok') AS with_weekly_performance,
        count(*) FILTER (WHERE status = 'ok') AS ok_total_24h
      FROM h24
    ),
    stats_1h AS (
      SELECT
        count(*) AS calls_1h,
        count(*) FILTER (WHERE status = 'ok') AS ok_1h,
        count(*) FILTER (WHERE status = 'error') AS fail_1h
      FROM h1
    )
  SELECT json_build_object(
    'calls_24h', s24.calls_24h,
    'ok_24h', s24.ok_24h,
    'fail_24h', s24.fail_24h,
    'calls_1h', s1.calls_1h,
    'ok_1h', s1.ok_1h,
    'fail_1h', s1.fail_1h,
    'p95_ms', round(s24.p95_24h::numeric, 0),
    'avg_ms', round(s24.avg_ms_24h::numeric, 0),
    'fail_rate_pct', CASE WHEN s24.calls_24h > 0 THEN round((s24.fail_24h::numeric / s24.calls_24h) * 100, 1) ELSE 0 END,
    'coverage_internal_card_pct', CASE WHEN s24.ok_total_24h > 0 THEN round((s24.with_internal_card::numeric / s24.ok_total_24h) * 100, 1) ELSE NULL END,
    'coverage_discovery_signals_pct', CASE WHEN s24.ok_total_24h > 0 THEN round((s24.with_discovery_signals::numeric / s24.ok_total_24h) * 100, 1) ELSE NULL END,
    'coverage_weekly_performance_pct', CASE WHEN s24.ok_total_24h > 0 THEN round((s24.with_weekly_performance::numeric / s24.ok_total_24h) * 100, 1) ELSE NULL END
  ) INTO result
  FROM stats_24h s24, stats_1h s1;

  RETURN result;
END;
$$;

-- ── RPC: get_lookup_pipeline_error_breakdown ──
CREATE OR REPLACE FUNCTION public.get_lookup_pipeline_error_breakdown(
  p_hours integer DEFAULT 24,
  p_limit integer DEFAULT 10
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result json;
BEGIN
  SET LOCAL statement_timeout = '5s';

  SELECT json_agg(row_to_json(t)) INTO result
  FROM (
    SELECT error_type, count(*) AS cnt
    FROM discover_lookup_pipeline_runs
    WHERE status = 'error'
      AND created_at > now() - (p_hours || ' hours')::interval
      AND error_type IS NOT NULL
    GROUP BY error_type
    ORDER BY cnt DESC
    LIMIT p_limit
  ) t;

  RETURN COALESCE(result, '[]'::json);
END;
$$;

-- ── RPC: cleanup_discover_lookup_pipeline_runs ──
CREATE OR REPLACE FUNCTION public.cleanup_discover_lookup_pipeline_runs(
  p_days integer DEFAULT 30,
  p_delete_batch integer DEFAULT 5000
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count integer;
BEGIN
  SET LOCAL statement_timeout = '30s';

  DELETE FROM discover_lookup_pipeline_runs
  WHERE id IN (
    SELECT id FROM discover_lookup_pipeline_runs
    WHERE created_at < now() - (p_days || ' days')::interval
    LIMIT p_delete_batch
  );

  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  RETURN json_build_object('deleted', deleted_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_lookup_pipeline_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_lookup_pipeline_stats() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_lookup_pipeline_error_breakdown(integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_lookup_pipeline_error_breakdown(integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_discover_lookup_pipeline_runs(integer, integer) TO service_role;
