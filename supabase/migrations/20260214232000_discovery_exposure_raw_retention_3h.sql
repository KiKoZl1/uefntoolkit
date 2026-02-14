-- Reduce RAW retention to ~3h by running a lightweight maintenance more frequently.
-- Keep daily maintenance for segments retention + rollup.

-- 1) Add p_do_rollup flag so we can skip rollup for frequent raw cleanup.
CREATE OR REPLACE FUNCTION public.discovery_exposure_run_maintenance(
  p_raw_hours INT DEFAULT 48,
  p_segment_days INT DEFAULT 30,
  p_delete_batch INT DEFAULT 200000,
  p_do_rollup BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_raw_deleted INT := 0;
  v_presence_deleted INT := 0;
  v_rank_deleted INT := 0;
  v_presence_stale_closed INT := 0;
  v_rank_stale_closed INT := 0;
  v_rollup_rows INT := 0;
  v_rollup_date DATE := (CURRENT_DATE - 1);
BEGIN
  IF (auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Raw retention: delete in bounded batches
  WITH todel AS (
    SELECT id
    FROM public.discovery_exposure_entries_raw
    WHERE ts < now() - make_interval(hours => GREATEST(p_raw_hours, 1))
    ORDER BY ts ASC
    LIMIT GREATEST(p_delete_batch, 1)
  )
  DELETE FROM public.discovery_exposure_entries_raw r
  USING todel d
  WHERE r.id = d.id;
  GET DIAGNOSTICS v_raw_deleted = ROW_COUNT;

  -- Close stale open segments (should be rare)
  UPDATE public.discovery_exposure_presence_segments
  SET end_ts = last_seen_ts,
      closed_reason = COALESCE(closed_reason, 'stale_cleanup')
  WHERE end_ts IS NULL
    AND last_seen_ts < now() - make_interval(days => GREATEST(p_segment_days, 1));
  GET DIAGNOSTICS v_presence_stale_closed = ROW_COUNT;

  UPDATE public.discovery_exposure_rank_segments
  SET end_ts = last_seen_ts,
      closed_reason = COALESCE(closed_reason, 'stale_cleanup')
  WHERE end_ts IS NULL
    AND last_seen_ts < now() - make_interval(days => GREATEST(p_segment_days, 1));
  GET DIAGNOSTICS v_rank_stale_closed = ROW_COUNT;

  -- Segment retention: delete closed segments older than N days (bounded batches)
  WITH todel AS (
    SELECT id
    FROM public.discovery_exposure_presence_segments
    WHERE end_ts IS NOT NULL
      AND end_ts < now() - make_interval(days => GREATEST(p_segment_days, 1))
    ORDER BY end_ts ASC
    LIMIT GREATEST(p_delete_batch, 1)
  )
  DELETE FROM public.discovery_exposure_presence_segments s
  USING todel d
  WHERE s.id = d.id;
  GET DIAGNOSTICS v_presence_deleted = ROW_COUNT;

  WITH todel AS (
    SELECT id
    FROM public.discovery_exposure_rank_segments
    WHERE end_ts IS NOT NULL
      AND end_ts < now() - make_interval(days => GREATEST(p_segment_days, 1))
    ORDER BY end_ts ASC
    LIMIT GREATEST(p_delete_batch, 1)
  )
  DELETE FROM public.discovery_exposure_rank_segments s
  USING todel d
  WHERE s.id = d.id;
  GET DIAGNOSTICS v_rank_deleted = ROW_COUNT;

  -- Compute yesterday rollup (optional)
  IF p_do_rollup THEN
    v_rollup_rows := public.compute_discovery_exposure_rollup_daily(v_rollup_date);
  END IF;

  RETURN jsonb_build_object(
    'raw_deleted', v_raw_deleted,
    'presence_deleted', v_presence_deleted,
    'rank_deleted', v_rank_deleted,
    'presence_stale_closed', v_presence_stale_closed,
    'rank_stale_closed', v_rank_stale_closed,
    'rollup_date', v_rollup_date,
    'rollup_rows', v_rollup_rows
  );
END;
$$;

-- 2) Re-schedule maintenance jobs:
-- - keep daily: rollup + segments + raw sweep (with rawHours=3 for consistency)
-- - add hourly: raw cleanup only (no rollup) to keep raw around ~3h

DO $$
DECLARE
  v_job_id BIGINT;
BEGIN
  -- Daily maintenance (00:07 UTC)
  SELECT jobid INTO v_job_id
  FROM cron.job
  WHERE jobname = 'discover-exposure-maintenance-daily'
  LIMIT 1;

  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_job_id);
  END IF;

  PERFORM cron.schedule(
    'discover-exposure-maintenance-daily',
    '7 0 * * *',
    $job$
      SELECT
        net.http_post(
          url := current_setting('app.settings.supabase_url') || '/functions/v1/discover-exposure-collector',
          headers := '{"Content-Type":"application/json"}'::jsonb,
          body := '{"mode":"maintenance","rawHours":3,"segmentDays":30,"doRollup":true}'::jsonb
        );
    $job$
  );

  -- Hourly raw cleanup (skip rollup)
  SELECT jobid INTO v_job_id
  FROM cron.job
  WHERE jobname = 'discover-exposure-raw-cleanup-hourly'
  LIMIT 1;

  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_job_id);
  END IF;

  PERFORM cron.schedule(
    'discover-exposure-raw-cleanup-hourly',
    '5 * * * *',
    $job$
      SELECT
        net.http_post(
          url := current_setting('app.settings.supabase_url') || '/functions/v1/discover-exposure-collector',
          headers := '{"Content-Type":"application/json"}'::jsonb,
          body := '{"mode":"maintenance","rawHours":3,"segmentDays":30,"doRollup":false}'::jsonb
        );
    $job$
  );
END
$$;

