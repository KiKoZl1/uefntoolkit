-- Metrics v2 orchestration, queue RPCs and telemetry columns

-- Report telemetry for admin dashboard / orchestrator response
ALTER TABLE public.discover_reports
  ADD COLUMN IF NOT EXISTS pending_count INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS processing_count INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS done_count INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS workers_active INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS throughput_per_min DOUBLE PRECISION DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stale_requeued_count INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_metrics_tick_at TIMESTAMPTZ NULL;

-- Queue indexes for fast claim/requeue paths
CREATE INDEX IF NOT EXISTS idx_queue_claim_pending
  ON public.discover_report_queue (report_id, status, priority, id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_queue_claim_processing_locked
  ON public.discover_report_queue (report_id, status, locked_at)
  WHERE status = 'processing';

-- Requeue stale processing rows (lock recovery)
CREATE OR REPLACE FUNCTION public.requeue_stale_discover_queue(
  p_report_id UUID,
  p_stale_after_seconds INT DEFAULT 900,
  p_max_rows INT DEFAULT 5000
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT := 0;
BEGIN
  WITH stale_rows AS (
    SELECT q.id
    FROM public.discover_report_queue q
    WHERE q.report_id = p_report_id
      AND q.status = 'processing'
      AND q.locked_at IS NOT NULL
      AND q.locked_at < now() - make_interval(secs => GREATEST(p_stale_after_seconds, 60))
    ORDER BY q.locked_at ASC
    LIMIT GREATEST(p_max_rows, 1)
  )
  UPDATE public.discover_report_queue q
  SET status = 'pending',
      locked_at = NULL,
      updated_at = now()
  FROM stale_rows s
  WHERE q.id = s.id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN COALESCE(v_count, 0);
END;
$$;

-- Atomic claim with SKIP LOCKED
CREATE OR REPLACE FUNCTION public.claim_discover_report_queue(
  p_report_id UUID,
  p_take INT DEFAULT 250,
  p_stale_after_seconds INT DEFAULT 900
)
RETURNS TABLE (
  id UUID,
  island_code TEXT,
  priority INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.requeue_stale_discover_queue(p_report_id, p_stale_after_seconds, GREATEST(p_take * 2, 200));

  RETURN QUERY
  WITH picked AS (
    SELECT q.id
    FROM public.discover_report_queue q
    WHERE q.report_id = p_report_id
      AND q.status = 'pending'
    ORDER BY q.priority ASC NULLS LAST, q.id ASC
    FOR UPDATE SKIP LOCKED
    LIMIT GREATEST(p_take, 1)
  )
  UPDATE public.discover_report_queue q
  SET status = 'processing',
      locked_at = now(),
      attempts = COALESCE(q.attempts, 0) + 1,
      updated_at = now()
  FROM picked p
  WHERE q.id = p.id
  RETURNING q.id, q.island_code, COALESCE(q.priority, 50);
END;
$$;

-- Batch status apply from JSON payload
CREATE OR REPLACE FUNCTION public.apply_discover_queue_results(
  p_report_id UUID,
  p_results JSONB
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT := 0;
BEGIN
  WITH payload AS (
    SELECT
      (r->>'id')::UUID AS id,
      CASE
        WHEN r->>'status' IN ('pending', 'processing', 'done', 'error')
          THEN r->>'status'
        ELSE NULL
      END AS status,
      NULLIF(r->>'last_error', '') AS last_error
    FROM jsonb_array_elements(COALESCE(p_results, '[]'::jsonb)) r
  )
  UPDATE public.discover_report_queue q
  SET status = p.status,
      last_error = CASE WHEN p.status = 'error' THEN p.last_error ELSE NULL END,
      locked_at = CASE WHEN p.status IN ('pending', 'done', 'error') THEN NULL ELSE q.locked_at END,
      updated_at = now()
  FROM payload p
  WHERE q.report_id = p_report_id
    AND q.id = p.id
    AND p.status IS NOT NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN COALESCE(v_count, 0);
END;
$$;

-- Operational repair helper for pre-existing stuck queues/counters
CREATE OR REPLACE FUNCTION public.repair_discover_report_state(
  p_report_id UUID,
  p_stale_after_seconds INT DEFAULT 900
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requeued INT := 0;
  v_pending INT := 0;
  v_processing INT := 0;
  v_done INT := 0;
  v_error INT := 0;
  v_reported INT := 0;
  v_suppressed INT := 0;
  v_total INT := 0;
  v_phase TEXT := 'metrics';
  v_progress INT := 10;
BEGIN
  v_requeued := public.requeue_stale_discover_queue(p_report_id, p_stale_after_seconds, 100000);

  SELECT
    COUNT(*) FILTER (WHERE status = 'pending'),
    COUNT(*) FILTER (WHERE status = 'processing'),
    COUNT(*) FILTER (WHERE status = 'done'),
    COUNT(*) FILTER (WHERE status = 'error'),
    COUNT(*)
  INTO v_pending, v_processing, v_done, v_error, v_total
  FROM public.discover_report_queue
  WHERE report_id = p_report_id;

  SELECT
    COUNT(*) FILTER (WHERE status = 'reported'),
    COUNT(*) FILTER (WHERE status = 'suppressed')
  INTO v_reported, v_suppressed
  FROM public.discover_report_islands
  WHERE report_id = p_report_id;

  IF v_pending = 0 AND v_processing = 0 THEN
    v_phase := 'finalize';
    v_progress := 95;
  ELSIF v_total > 0 THEN
    v_progress := LEAST(95, 10 + FLOOR(((v_done + v_error)::DOUBLE PRECISION / v_total::DOUBLE PRECISION) * 85));
  END IF;

  UPDATE public.discover_reports
  SET queue_total = NULLIF(v_total, 0),
      metrics_done_count = v_done + v_error,
      reported_count = v_reported,
      suppressed_count = v_suppressed,
      error_count = v_error,
      pending_count = v_pending,
      processing_count = v_processing,
      done_count = v_done,
      stale_requeued_count = COALESCE(stale_requeued_count, 0) + v_requeued,
      phase = v_phase,
      progress_pct = v_progress,
      updated_at = now()
  WHERE id = p_report_id;

  RETURN jsonb_build_object(
    'report_id', p_report_id,
    'requeued', v_requeued,
    'pending', v_pending,
    'processing', v_processing,
    'done', v_done,
    'error', v_error,
    'reported', v_reported,
    'suppressed', v_suppressed,
    'phase', v_phase,
    'progress_pct', v_progress
  );
END;
$$;

-- Ensure scheduler exists: tick orchestrator each minute
DO $$
DECLARE
  v_job_id BIGINT;
BEGIN
  SELECT jobid INTO v_job_id
  FROM cron.job
  WHERE jobname = 'discover-collector-orchestrate-minute'
  LIMIT 1;

  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_job_id);
  END IF;

  PERFORM cron.schedule(
    'discover-collector-orchestrate-minute',
    '* * * * *',
    $job$
      SELECT
        net.http_post(
          url := current_setting('app.settings.supabase_url') || '/functions/v1/discover-collector',
          headers := '{"Content-Type":"application/json"}'::jsonb,
          body := '{"mode":"orchestrate"}'::jsonb
        );
    $job$
  );
END
$$;
