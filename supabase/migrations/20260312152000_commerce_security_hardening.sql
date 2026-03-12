BEGIN;

-- Operational guardrails for index creation in production windows.
-- Keep lock wait bounded to avoid long blocking chains.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '3min';

CREATE TABLE IF NOT EXISTS public.commerce_request_rate_limits (
  scope text NOT NULL,
  subject_key text NOT NULL,
  window_start timestamptz NOT NULL,
  window_seconds int NOT NULL CHECK (window_seconds > 0),
  request_count int NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, subject_key, window_start, window_seconds)
);

CREATE INDEX IF NOT EXISTS commerce_request_rate_limits_updated_idx
ON public.commerce_request_rate_limits(updated_at DESC);

ALTER TABLE public.commerce_request_rate_limits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS commerce_request_rate_limits_service_all ON public.commerce_request_rate_limits;
CREATE POLICY commerce_request_rate_limits_service_all
ON public.commerce_request_rate_limits
FOR ALL
TO public
USING ((auth.jwt() ->> 'role') = 'service_role')
WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

DROP POLICY IF EXISTS commerce_request_rate_limits_admin_read ON public.commerce_request_rate_limits;
CREATE POLICY commerce_request_rate_limits_admin_read
ON public.commerce_request_rate_limits
FOR SELECT
TO authenticated
USING (public.is_admin_or_editor());

CREATE OR REPLACE FUNCTION public.commerce_check_rate_limit(
  p_scope text,
  p_subject_key text,
  p_limit int,
  p_window_seconds int,
  p_now timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scope text := NULLIF(trim(COALESCE(p_scope, '')), '');
  v_subject_key text := NULLIF(trim(COALESCE(p_subject_key, '')), '');
  v_limit int := GREATEST(COALESCE(p_limit, 1), 1);
  v_window_seconds int := GREATEST(COALESCE(p_window_seconds, 60), 1);
  v_now timestamptz := COALESCE(p_now, now());
  v_window_start timestamptz;
  v_count int := 0;
  v_allowed boolean := false;
  v_remaining int := 0;
  v_retry_after_seconds int := 0;
BEGIN
  IF v_scope IS NULL THEN
    RAISE EXCEPTION 'missing_scope';
  END IF;
  IF v_subject_key IS NULL THEN
    v_subject_key := 'unknown';
  END IF;

  v_window_start := to_timestamp(
    floor(extract(epoch FROM v_now) / v_window_seconds) * v_window_seconds
  );

  INSERT INTO public.commerce_request_rate_limits(scope, subject_key, window_start, window_seconds, request_count, updated_at)
  VALUES (v_scope, v_subject_key, v_window_start, v_window_seconds, 1, now())
  ON CONFLICT (scope, subject_key, window_start, window_seconds)
  DO UPDATE
  SET request_count = public.commerce_request_rate_limits.request_count + 1,
      updated_at = now()
  RETURNING request_count INTO v_count;

  v_allowed := v_count <= v_limit;
  v_remaining := GREATEST(v_limit - v_count, 0);
  v_retry_after_seconds := CASE
    WHEN v_allowed THEN 0
    ELSE GREATEST(
      1,
      v_window_seconds - floor(extract(epoch FROM (v_now - v_window_start)))::int
    )
  END;

  RETURN jsonb_build_object(
    'allowed', v_allowed,
    'count', v_count,
    'limit', v_limit,
    'remaining', v_remaining,
    'retry_after_seconds', v_retry_after_seconds,
    'window_start', v_window_start,
    'window_seconds', v_window_seconds
  );
END;
$$;

REVOKE ALL ON FUNCTION public.commerce_check_rate_limit(text,text,int,int,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commerce_check_rate_limit(text,text,int,int,timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.commerce_prune_rate_limits(p_keep_interval interval DEFAULT interval '7 days')
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted int := 0;
BEGIN
  DELETE FROM public.commerce_request_rate_limits
  WHERE updated_at < now() - p_keep_interval;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.commerce_prune_rate_limits(interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commerce_prune_rate_limits(interval) TO service_role;

DO $$
DECLARE
  v_jobid BIGINT;
BEGIN
  SELECT jobid INTO v_jobid
  FROM cron.job
  WHERE jobname = 'commerce-weekly-release-hourly'
  LIMIT 1;

  IF v_jobid IS NULL THEN
    PERFORM cron.schedule(
      'commerce-weekly-release-hourly',
      '5 * * * *',
      $cmd$SELECT public.commerce_weekly_release_job(now(), 1000);$cmd$
    );
  ELSE
    PERFORM cron.alter_job(
      v_jobid,
      '5 * * * *',
      $cmd$SELECT public.commerce_weekly_release_job(now(), 1000);$cmd$,
      NULL,
      NULL,
      true
    );
  END IF;
END $$;

DO $$
DECLARE
  v_jobid BIGINT;
BEGIN
  SELECT jobid INTO v_jobid
  FROM cron.job
  WHERE jobname = 'commerce-reconcile-daily'
  LIMIT 1;

  IF v_jobid IS NULL THEN
    PERFORM cron.schedule(
      'commerce-reconcile-daily',
      '20 3 * * *',
      $cmd$SELECT public.commerce_reconcile_job(2000);$cmd$
    );
  ELSE
    PERFORM cron.alter_job(
      v_jobid,
      '20 3 * * *',
      $cmd$SELECT public.commerce_reconcile_job(2000);$cmd$,
      NULL,
      NULL,
      true
    );
  END IF;
END $$;

DO $$
DECLARE
  v_jobid BIGINT;
BEGIN
  SELECT jobid INTO v_jobid
  FROM cron.job
  WHERE jobname = 'commerce-rate-limit-prune-daily'
  LIMIT 1;

  IF v_jobid IS NULL THEN
    PERFORM cron.schedule(
      'commerce-rate-limit-prune-daily',
      '40 3 * * *',
      $cmd$SELECT public.commerce_prune_rate_limits(interval '7 days');$cmd$
    );
  ELSE
    PERFORM cron.alter_job(
      v_jobid,
      '40 3 * * *',
      $cmd$SELECT public.commerce_prune_rate_limits(interval '7 days');$cmd$,
      NULL,
      NULL,
      true
    );
  END IF;
END $$;

COMMIT;

