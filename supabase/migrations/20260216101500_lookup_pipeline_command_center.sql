-- Lookup pipeline telemetry for Command Center

CREATE TABLE IF NOT EXISTS public.discover_lookup_pipeline_runs (
  id bigserial PRIMARY KEY,
  ts timestamptz NOT NULL DEFAULT now(),
  user_id uuid NULL,
  island_code text NOT NULL,
  status text NOT NULL CHECK (status IN ('ok', 'error')),
  duration_ms integer NOT NULL DEFAULT 0,
  error_type text NULL,
  error_message text NULL,
  has_internal_card boolean NOT NULL DEFAULT false,
  has_discovery_signals boolean NOT NULL DEFAULT false,
  has_weekly_performance boolean NOT NULL DEFAULT false,
  category_leaders_count integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS discover_lookup_pipeline_runs_ts_idx
  ON public.discover_lookup_pipeline_runs (ts DESC);

CREATE INDEX IF NOT EXISTS discover_lookup_pipeline_runs_status_idx
  ON public.discover_lookup_pipeline_runs (status, ts DESC);

CREATE INDEX IF NOT EXISTS discover_lookup_pipeline_runs_error_idx
  ON public.discover_lookup_pipeline_runs (error_type, ts DESC);

ALTER TABLE public.discover_lookup_pipeline_runs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public'
      AND tablename='discover_lookup_pipeline_runs'
      AND policyname='select_lookup_pipeline_runs_authenticated'
  ) THEN
    CREATE POLICY select_lookup_pipeline_runs_authenticated
      ON public.discover_lookup_pipeline_runs
      FOR SELECT
      TO authenticated
      USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public'
      AND tablename='discover_lookup_pipeline_runs'
      AND policyname='all_lookup_pipeline_runs_service_role'
  ) THEN
    CREATE POLICY all_lookup_pipeline_runs_service_role
      ON public.discover_lookup_pipeline_runs
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.get_lookup_pipeline_stats()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH w24 AS (
    SELECT *
    FROM public.discover_lookup_pipeline_runs
    WHERE ts >= now() - interval '24 hours'
  ),
  w1 AS (
    SELECT *
    FROM public.discover_lookup_pipeline_runs
    WHERE ts >= now() - interval '1 hour'
  )
  SELECT jsonb_build_object(
    'calls_24h', COALESCE((SELECT COUNT(*) FROM w24), 0),
    'ok_24h', COALESCE((SELECT COUNT(*) FROM w24 WHERE status='ok'), 0),
    'fail_24h', COALESCE((SELECT COUNT(*) FROM w24 WHERE status='error'), 0),
    'calls_1h', COALESCE((SELECT COUNT(*) FROM w1), 0),
    'ok_1h', COALESCE((SELECT COUNT(*) FROM w1 WHERE status='ok'), 0),
    'fail_1h', COALESCE((SELECT COUNT(*) FROM w1 WHERE status='error'), 0),
    'p95_ms_24h', (
      SELECT ROUND(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms))::int
      FROM w24
      WHERE duration_ms IS NOT NULL
    ),
    'avg_ms_24h', (
      SELECT ROUND(AVG(duration_ms))::int
      FROM w24
      WHERE duration_ms IS NOT NULL
    ),
    'last_ok_at', (
      SELECT MAX(ts) FROM public.discover_lookup_pipeline_runs WHERE status='ok'
    ),
    'last_error_at', (
      SELECT MAX(ts) FROM public.discover_lookup_pipeline_runs WHERE status='error'
    ),
    'fail_rate_24h_pct', (
      SELECT CASE WHEN COUNT(*) > 0
        THEN ROUND((COUNT(*) FILTER (WHERE status='error')::numeric * 100.0 / COUNT(*)), 2)
        ELSE 0 END
      FROM w24
    ),
    'coverage_internal_card_pct', (
      SELECT CASE WHEN COUNT(*) FILTER (WHERE status='ok') > 0
        THEN ROUND((COUNT(*) FILTER (WHERE status='ok' AND has_internal_card)::numeric * 100.0 /
             COUNT(*) FILTER (WHERE status='ok')), 2)
        ELSE 0 END
      FROM w24
    ),
    'coverage_discovery_signals_pct', (
      SELECT CASE WHEN COUNT(*) FILTER (WHERE status='ok') > 0
        THEN ROUND((COUNT(*) FILTER (WHERE status='ok' AND has_discovery_signals)::numeric * 100.0 /
             COUNT(*) FILTER (WHERE status='ok')), 2)
        ELSE 0 END
      FROM w24
    ),
    'coverage_weekly_perf_pct', (
      SELECT CASE WHEN COUNT(*) FILTER (WHERE status='ok') > 0
        THEN ROUND((COUNT(*) FILTER (WHERE status='ok' AND has_weekly_performance)::numeric * 100.0 /
             COUNT(*) FILTER (WHERE status='ok')), 2)
        ELSE 0 END
      FROM w24
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.get_lookup_pipeline_error_breakdown(
  p_hours integer DEFAULT 24,
  p_limit integer DEFAULT 8
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH rows AS (
    SELECT
      COALESCE(NULLIF(error_type, ''), 'unknown') AS error_type,
      COUNT(*)::int AS n
    FROM public.discover_lookup_pipeline_runs
    WHERE ts >= now() - make_interval(hours => GREATEST(COALESCE(p_hours, 24), 1))
      AND status = 'error'
    GROUP BY 1
    ORDER BY 2 DESC
    LIMIT GREATEST(COALESCE(p_limit, 8), 1)
  )
  SELECT COALESCE(
    jsonb_agg(jsonb_build_object('error_type', error_type, 'count', n) ORDER BY n DESC),
    '[]'::jsonb
  )
  FROM rows;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_discover_lookup_pipeline_runs(
  p_days integer DEFAULT 30,
  p_delete_batch integer DEFAULT 50000
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer := 0;
BEGIN
  IF COALESCE(p_days, 30) < 1 THEN
    RAISE EXCEPTION 'p_days must be >= 1';
  END IF;

  WITH doomed AS (
    SELECT id
    FROM public.discover_lookup_pipeline_runs
    WHERE ts < now() - make_interval(days => p_days)
    ORDER BY ts ASC
    LIMIT GREATEST(COALESCE(p_delete_batch, 50000), 1)
  )
  DELETE FROM public.discover_lookup_pipeline_runs r
  USING doomed d
  WHERE r.id = d.id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN jsonb_build_object('deleted', v_deleted, 'days', p_days);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_lookup_pipeline_stats() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_lookup_pipeline_error_breakdown(integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_discover_lookup_pipeline_runs(integer, integer) TO service_role;
