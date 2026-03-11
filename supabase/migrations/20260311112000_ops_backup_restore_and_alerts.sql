-- Operational hardening for Data environment:
-- 1) Weekly backup/restore drill register
-- 2) Consolidated operational alerts in system_alerts_current
-- 3) Scheduled refresh for compute_system_alerts + ops alerts
--
-- Rollback:
-- - Disable jobs:
--   SELECT cron.alter_job(jobid, NULL, NULL, NULL, NULL, false)
--   FROM cron.job
--   WHERE jobname IN ('ops-compute-system-alerts-10min', 'ops-refresh-operational-alerts-10min');
-- - Optionally drop functions/table if needed:
--   DROP FUNCTION IF EXISTS public.ops_refresh_operational_alerts();
--   DROP FUNCTION IF EXISTS public.ops_record_backup_restore_drill(text, integer, integer, text);
--   DROP TABLE IF EXISTS public.ops_backup_restore_drills;

CREATE TABLE IF NOT EXISTS public.ops_backup_restore_drills (
  id BIGSERIAL PRIMARY KEY,
  environment TEXT NOT NULL DEFAULT 'data',
  result TEXT NOT NULL CHECK (result IN ('success', 'partial', 'failed')),
  rpo_minutes INTEGER,
  rto_minutes INTEGER,
  notes TEXT,
  performed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ops_backup_restore_drills_performed_at
  ON public.ops_backup_restore_drills (performed_at DESC);

ALTER TABLE public.ops_backup_restore_drills ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'ops_backup_restore_drills'
      AND policyname = 'select_ops_backup_restore_authenticated'
  ) THEN
    CREATE POLICY select_ops_backup_restore_authenticated
    ON public.ops_backup_restore_drills
    FOR SELECT
    TO authenticated
    USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'ops_backup_restore_drills'
      AND policyname = 'all_ops_backup_restore_service_role'
  ) THEN
    CREATE POLICY all_ops_backup_restore_service_role
    ON public.ops_backup_restore_drills
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.ops_record_backup_restore_drill(
  p_result TEXT,
  p_rpo_minutes INTEGER DEFAULT NULL,
  p_rto_minutes INTEGER DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS public.ops_backup_restore_drills
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.ops_backup_restore_drills;
  v_result TEXT := lower(trim(coalesce(p_result, '')));
BEGIN
  PERFORM public._assert_discover_cron_admin_access();

  IF v_result NOT IN ('success', 'partial', 'failed') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'result must be success|partial|failed';
  END IF;

  INSERT INTO public.ops_backup_restore_drills (
    environment,
    result,
    rpo_minutes,
    rto_minutes,
    notes
  )
  VALUES (
    'data',
    v_result,
    CASE WHEN p_rpo_minutes IS NULL THEN NULL ELSE GREATEST(0, p_rpo_minutes) END,
    CASE WHEN p_rto_minutes IS NULL THEN NULL ELSE GREATEST(0, p_rto_minutes) END,
    NULLIF(trim(coalesce(p_notes, '')), '')
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.ops_refresh_operational_alerts()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_last_success TIMESTAMPTZ;
  v_backup_age_hours INTEGER;
  v_backup_severity TEXT;
  v_backup_message TEXT;
  v_failed_jobs_24h INTEGER := 0;
  v_last_failed_at TIMESTAMPTZ;
  v_cron_severity TEXT;
  v_cron_message TEXT;
BEGIN
  IF current_user NOT IN ('postgres', 'supabase_admin')
     AND (auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT max(performed_at)
  INTO v_last_success
  FROM public.ops_backup_restore_drills
  WHERE result = 'success';

  v_backup_age_hours := CASE
    WHEN v_last_success IS NULL THEN NULL
    ELSE EXTRACT(EPOCH FROM (now() - v_last_success))::INTEGER / 3600
  END;

  IF v_last_success IS NULL THEN
    v_backup_severity := 'error';
    v_backup_message := 'No successful backup/restore drill registered';
  ELSIF v_backup_age_hours > 8 * 24 THEN
    v_backup_severity := 'error';
    v_backup_message := 'Backup/restore drill overdue (>8 days)';
  ELSIF v_backup_age_hours > 6 * 24 THEN
    v_backup_severity := 'warn';
    v_backup_message := 'Backup/restore drill nearing deadline (>6 days)';
  ELSE
    v_backup_severity := 'ok';
    v_backup_message := 'Backup/restore drill within weekly SLA';
  END IF;

  INSERT INTO public.system_alerts_current(alert_key, severity, message, details, updated_at)
  VALUES (
    'ops_backup_restore_weekly',
    v_backup_severity,
    v_backup_message,
    jsonb_build_object(
      'last_success_at', v_last_success,
      'age_hours', v_backup_age_hours,
      'sla_hours', 168
    ),
    now()
  )
  ON CONFLICT (alert_key) DO UPDATE
  SET severity = EXCLUDED.severity,
      message = EXCLUDED.message,
      details = EXCLUDED.details,
      updated_at = EXCLUDED.updated_at;

  SELECT
    count(*)::INTEGER,
    max(d.start_time)
  INTO v_failed_jobs_24h, v_last_failed_at
  FROM cron.job_run_details d
  JOIN cron.job j ON j.jobid = d.jobid
  WHERE j.jobname ~ '^(discover|dppi)-'
    AND d.start_time > now() - interval '24 hours'
    AND d.status <> 'succeeded';

  IF v_failed_jobs_24h >= 3 THEN
    v_cron_severity := 'error';
    v_cron_message := 'Multiple discover/dppi cron failures in last 24h';
  ELSIF v_failed_jobs_24h > 0 THEN
    v_cron_severity := 'warn';
    v_cron_message := 'Discover/dppi cron failures detected in last 24h';
  ELSE
    v_cron_severity := 'ok';
    v_cron_message := 'Discover/dppi cron execution healthy (24h)';
  END IF;

  INSERT INTO public.system_alerts_current(alert_key, severity, message, details, updated_at)
  VALUES (
    'ops_discover_dppi_cron_failures_24h',
    v_cron_severity,
    v_cron_message,
    jsonb_build_object(
      'failed_jobs_24h', v_failed_jobs_24h,
      'last_failed_at', v_last_failed_at
    ),
    now()
  )
  ON CONFLICT (alert_key) DO UPDATE
  SET severity = EXCLUDED.severity,
      message = EXCLUDED.message,
      details = EXCLUDED.details,
      updated_at = EXCLUDED.updated_at;

  RETURN jsonb_build_object(
    'ok', true,
    'backup_restore', jsonb_build_object(
      'last_success_at', v_last_success,
      'age_hours', v_backup_age_hours,
      'severity', v_backup_severity
    ),
    'cron_failures_24h', jsonb_build_object(
      'failed_jobs', v_failed_jobs_24h,
      'last_failed_at', v_last_failed_at,
      'severity', v_cron_severity
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.ops_record_backup_restore_drill(text, integer, integer, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ops_refresh_operational_alerts()
  TO service_role;

DO $$
DECLARE
  v_jobid BIGINT;
BEGIN
  SELECT jobid INTO v_jobid
  FROM cron.job
  WHERE jobname = 'ops-compute-system-alerts-10min'
  LIMIT 1;

  IF v_jobid IS NULL THEN
    PERFORM cron.schedule(
      'ops-compute-system-alerts-10min',
      '*/10 * * * *',
      $cmd$SELECT public.compute_system_alerts();$cmd$
    );
  ELSE
    PERFORM cron.alter_job(
      v_jobid,
      '*/10 * * * *',
      $cmd$SELECT public.compute_system_alerts();$cmd$,
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
  WHERE jobname = 'ops-refresh-operational-alerts-10min'
  LIMIT 1;

  IF v_jobid IS NULL THEN
    PERFORM cron.schedule(
      'ops-refresh-operational-alerts-10min',
      '*/10 * * * *',
      $cmd$SELECT public.ops_refresh_operational_alerts();$cmd$
    );
  ELSE
    PERFORM cron.alter_job(
      v_jobid,
      '*/10 * * * *',
      $cmd$SELECT public.ops_refresh_operational_alerts();$cmd$,
      NULL,
      NULL,
      true
    );
  END IF;
END $$;
