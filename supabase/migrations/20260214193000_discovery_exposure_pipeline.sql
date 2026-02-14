-- Discovery Exposure 24/7 pipeline (Frontend + Browse) with segments + rollups
-- - Targets: NAE/EU x Frontend/Browse
-- - Tick every 10 minutes per target (orchestrated via 1/min cron)
-- - Raw snapshots retained short-term, segments retained 30d, daily rollups retained forever

-- ============================================================
-- 1) Targets
-- ============================================================
CREATE TABLE IF NOT EXISTS public.discovery_exposure_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  region TEXT NOT NULL,
  surface_name TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'Windows',
  locale TEXT NOT NULL DEFAULT 'en',
  interval_minutes INT NOT NULL DEFAULT 10,
  next_due_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at TIMESTAMPTZ NULL,
  lock_id UUID NULL,
  last_ok_tick_at TIMESTAMPTZ NULL,
  last_failed_tick_at TIMESTAMPTZ NULL,
  last_status TEXT NOT NULL DEFAULT 'idle',
  last_error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (region, surface_name, platform, locale)
);

CREATE INDEX IF NOT EXISTS idx_exposure_targets_next_due
  ON public.discovery_exposure_targets (next_due_at ASC, id ASC);

CREATE INDEX IF NOT EXISTS idx_exposure_targets_region_surface
  ON public.discovery_exposure_targets (region, surface_name);

CREATE INDEX IF NOT EXISTS idx_exposure_targets_locked_at
  ON public.discovery_exposure_targets (locked_at)
  WHERE last_status = 'processing';

ALTER TABLE public.discovery_exposure_targets ENABLE ROW LEVEL SECURITY;

-- Read: admin/editor only
CREATE POLICY "Admins/editors can view exposure targets"
  ON public.discovery_exposure_targets FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'));

-- Write: service_role only
CREATE POLICY "Service role can insert exposure targets"
  ON public.discovery_exposure_targets FOR INSERT
  TO authenticated
  WITH CHECK ((auth.jwt() ->> 'role'::text) = 'service_role'::text);

CREATE POLICY "Service role can update exposure targets"
  ON public.discovery_exposure_targets FOR UPDATE
  TO authenticated
  USING ((auth.jwt() ->> 'role'::text) = 'service_role'::text);

CREATE POLICY "Service role can delete exposure targets"
  ON public.discovery_exposure_targets FOR DELETE
  TO authenticated
  USING ((auth.jwt() ->> 'role'::text) = 'service_role'::text);

CREATE TRIGGER update_discovery_exposure_targets_updated_at
  BEFORE UPDATE ON public.discovery_exposure_targets
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Seed MVP targets
INSERT INTO public.discovery_exposure_targets (region, surface_name, platform, locale, interval_minutes, next_due_at, last_status)
VALUES
  ('NAE', 'CreativeDiscoverySurface_Frontend', 'Windows', 'en', 10, now(), 'idle'),
  ('NAE', 'CreativeDiscoverySurface_Browse',   'Windows', 'en', 10, now(), 'idle'),
  ('EU',  'CreativeDiscoverySurface_Frontend', 'Windows', 'en', 10, now(), 'idle'),
  ('EU',  'CreativeDiscoverySurface_Browse',   'Windows', 'en', 10, now(), 'idle')
ON CONFLICT (region, surface_name, platform, locale)
DO UPDATE SET interval_minutes = EXCLUDED.interval_minutes;

-- ============================================================
-- 2) Tick Telemetry
-- ============================================================
CREATE TABLE IF NOT EXISTS public.discovery_exposure_ticks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_id UUID NOT NULL REFERENCES public.discovery_exposure_targets(id) ON DELETE CASCADE,
  ts_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  ts_end TIMESTAMPTZ NULL,
  status TEXT NOT NULL DEFAULT 'running', -- running|ok|failed
  branch TEXT NULL,
  test_variant_name TEXT NULL,
  test_name TEXT NULL,
  test_analytics_id TEXT NULL,
  panels_count INT NOT NULL DEFAULT 0,
  entries_count INT NOT NULL DEFAULT 0,
  duration_ms INT NULL,
  error_code TEXT NULL,
  error_message TEXT NULL,
  correlation_id TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exposure_ticks_target_ts
  ON public.discovery_exposure_ticks (target_id, ts_start DESC);

CREATE INDEX IF NOT EXISTS idx_exposure_ticks_status_ts
  ON public.discovery_exposure_ticks (status, ts_start DESC);

ALTER TABLE public.discovery_exposure_ticks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins/editors can view exposure ticks"
  ON public.discovery_exposure_ticks FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'));

CREATE POLICY "Service role can insert exposure ticks"
  ON public.discovery_exposure_ticks FOR INSERT
  TO authenticated
  WITH CHECK ((auth.jwt() ->> 'role'::text) = 'service_role'::text);

CREATE POLICY "Service role can update exposure ticks"
  ON public.discovery_exposure_ticks FOR UPDATE
  TO authenticated
  USING ((auth.jwt() ->> 'role'::text) = 'service_role'::text);

CREATE POLICY "Service role can delete exposure ticks"
  ON public.discovery_exposure_ticks FOR DELETE
  TO authenticated
  USING ((auth.jwt() ->> 'role'::text) = 'service_role'::text);

-- ============================================================
-- 3) Raw Entries (short retention)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.discovery_exposure_entries_raw (
  id BIGSERIAL PRIMARY KEY,
  tick_id UUID NOT NULL REFERENCES public.discovery_exposure_ticks(id) ON DELETE CASCADE,
  target_id UUID NOT NULL REFERENCES public.discovery_exposure_targets(id) ON DELETE CASCADE,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  surface_name TEXT NOT NULL,
  panel_name TEXT NOT NULL,
  panel_display_name TEXT NULL,
  panel_type TEXT NULL,
  feature_tags TEXT[] NULL,
  page_index INT NOT NULL DEFAULT 0,
  rank INT NOT NULL,
  link_code TEXT NOT NULL,
  link_code_type TEXT NOT NULL, -- island|collection
  global_ccu INT NULL,
  is_visible BOOLEAN NULL,
  lock_status TEXT NULL,
  lock_status_reason TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_exposure_raw_target_ts
  ON public.discovery_exposure_entries_raw (target_id, ts DESC);

CREATE INDEX IF NOT EXISTS idx_exposure_raw_target_panel_ts
  ON public.discovery_exposure_entries_raw (target_id, surface_name, panel_name, ts DESC);

CREATE INDEX IF NOT EXISTS idx_exposure_raw_link_ts
  ON public.discovery_exposure_entries_raw (link_code, ts DESC);

ALTER TABLE public.discovery_exposure_entries_raw ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins/editors can view exposure raw"
  ON public.discovery_exposure_entries_raw FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'));

CREATE POLICY "Service role can insert exposure raw"
  ON public.discovery_exposure_entries_raw FOR INSERT
  TO authenticated
  WITH CHECK ((auth.jwt() ->> 'role'::text) = 'service_role'::text);

CREATE POLICY "Service role can delete exposure raw"
  ON public.discovery_exposure_entries_raw FOR DELETE
  TO authenticated
  USING ((auth.jwt() ->> 'role'::text) = 'service_role'::text);

-- ============================================================
-- 4) Presence Segments (30d retention)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.discovery_exposure_presence_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_id UUID NOT NULL REFERENCES public.discovery_exposure_targets(id) ON DELETE CASCADE,
  surface_name TEXT NOT NULL,
  panel_name TEXT NOT NULL,
  panel_display_name TEXT NULL,
  panel_type TEXT NULL,
  feature_tags TEXT[] NULL,
  link_code TEXT NOT NULL,
  link_code_type TEXT NOT NULL, -- island|collection
  start_ts TIMESTAMPTZ NOT NULL,
  last_seen_ts TIMESTAMPTZ NOT NULL,
  end_ts TIMESTAMPTZ NULL,
  best_rank INT NULL,
  rank_sum INT NOT NULL DEFAULT 0,
  rank_samples INT NOT NULL DEFAULT 0,
  end_rank INT NULL,
  ccu_start INT NULL,
  ccu_max INT NULL,
  ccu_end INT NULL,
  closed_reason TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_exposure_presence_open
  ON public.discovery_exposure_presence_segments (target_id, panel_name, link_code)
  WHERE end_ts IS NULL;

CREATE INDEX IF NOT EXISTS idx_exposure_presence_target_panel_start
  ON public.discovery_exposure_presence_segments (target_id, panel_name, start_ts DESC);

CREATE INDEX IF NOT EXISTS idx_exposure_presence_link_start
  ON public.discovery_exposure_presence_segments (link_code, start_ts DESC);

CREATE INDEX IF NOT EXISTS idx_exposure_presence_end_ts
  ON public.discovery_exposure_presence_segments (end_ts);

ALTER TABLE public.discovery_exposure_presence_segments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins/editors can view presence segments"
  ON public.discovery_exposure_presence_segments FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'));

CREATE POLICY "Service role can insert presence segments"
  ON public.discovery_exposure_presence_segments FOR INSERT
  TO authenticated
  WITH CHECK ((auth.jwt() ->> 'role'::text) = 'service_role'::text);

CREATE POLICY "Service role can update presence segments"
  ON public.discovery_exposure_presence_segments FOR UPDATE
  TO authenticated
  USING ((auth.jwt() ->> 'role'::text) = 'service_role'::text);

CREATE TRIGGER update_discovery_exposure_presence_segments_updated_at
  BEFORE UPDATE ON public.discovery_exposure_presence_segments
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 5) Rank Segments (30d retention)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.discovery_exposure_rank_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_id UUID NOT NULL REFERENCES public.discovery_exposure_targets(id) ON DELETE CASCADE,
  surface_name TEXT NOT NULL,
  panel_name TEXT NOT NULL,
  panel_display_name TEXT NULL,
  panel_type TEXT NULL,
  feature_tags TEXT[] NULL,
  rank INT NOT NULL,
  link_code TEXT NOT NULL,
  link_code_type TEXT NOT NULL, -- island|collection
  start_ts TIMESTAMPTZ NOT NULL,
  last_seen_ts TIMESTAMPTZ NOT NULL,
  end_ts TIMESTAMPTZ NULL,
  ccu_start INT NULL,
  ccu_max INT NULL,
  ccu_end INT NULL,
  closed_reason TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_exposure_rank_open
  ON public.discovery_exposure_rank_segments (target_id, panel_name, rank)
  WHERE end_ts IS NULL;

CREATE INDEX IF NOT EXISTS idx_exposure_rank_target_panel_rank_start
  ON public.discovery_exposure_rank_segments (target_id, panel_name, rank, start_ts DESC);

CREATE INDEX IF NOT EXISTS idx_exposure_rank_link_start
  ON public.discovery_exposure_rank_segments (link_code, start_ts DESC);

CREATE INDEX IF NOT EXISTS idx_exposure_rank_end_ts
  ON public.discovery_exposure_rank_segments (end_ts);

ALTER TABLE public.discovery_exposure_rank_segments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins/editors can view rank segments"
  ON public.discovery_exposure_rank_segments FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'));

CREATE POLICY "Service role can insert rank segments"
  ON public.discovery_exposure_rank_segments FOR INSERT
  TO authenticated
  WITH CHECK ((auth.jwt() ->> 'role'::text) = 'service_role'::text);

CREATE POLICY "Service role can update rank segments"
  ON public.discovery_exposure_rank_segments FOR UPDATE
  TO authenticated
  USING ((auth.jwt() ->> 'role'::text) = 'service_role'::text);

CREATE TRIGGER update_discovery_exposure_rank_segments_updated_at
  BEFORE UPDATE ON public.discovery_exposure_rank_segments
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 6) Daily Rollup (forever)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.discovery_exposure_rollup_daily (
  date DATE NOT NULL,
  target_id UUID NOT NULL REFERENCES public.discovery_exposure_targets(id) ON DELETE CASCADE,
  surface_name TEXT NOT NULL,
  panel_name TEXT NOT NULL,
  link_code TEXT NOT NULL,
  link_code_type TEXT NOT NULL, -- island|collection
  minutes_exposed INT NOT NULL DEFAULT 0,
  appearances INT NOT NULL DEFAULT 0,
  best_rank INT NULL,
  avg_rank DOUBLE PRECISION NULL,
  ccu_max_seen INT NULL,
  distinct_creators INT NULL,
  PRIMARY KEY (date, target_id, panel_name, link_code)
);

CREATE INDEX IF NOT EXISTS idx_exposure_rollup_date_target
  ON public.discovery_exposure_rollup_daily (date DESC, target_id);

CREATE INDEX IF NOT EXISTS idx_exposure_rollup_date_panel
  ON public.discovery_exposure_rollup_daily (date DESC, panel_name);

CREATE INDEX IF NOT EXISTS idx_exposure_rollup_link_date
  ON public.discovery_exposure_rollup_daily (link_code, date DESC);

ALTER TABLE public.discovery_exposure_rollup_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins/editors can view exposure rollup"
  ON public.discovery_exposure_rollup_daily FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'));

CREATE POLICY "Service role can upsert exposure rollup"
  ON public.discovery_exposure_rollup_daily FOR ALL
  TO authenticated
  USING ((auth.jwt() ->> 'role'::text) = 'service_role'::text)
  WITH CHECK ((auth.jwt() ->> 'role'::text) = 'service_role'::text);

-- ============================================================
-- 7) RPC: claim next due target atomically (SKIP LOCKED)
-- ============================================================
CREATE OR REPLACE FUNCTION public.claim_discovery_exposure_target(
  p_stale_after_seconds INT DEFAULT 180
)
RETURNS TABLE (
  id UUID,
  region TEXT,
  surface_name TEXT,
  platform TEXT,
  locale TEXT,
  interval_minutes INT,
  lock_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lock UUID := gen_random_uuid();
BEGIN
  -- Only service_role can claim targets
  IF (auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Requeue stale "processing" targets (lock recovery)
  UPDATE public.discovery_exposure_targets t
  SET last_status = 'idle',
      locked_at = NULL,
      lock_id = NULL,
      updated_at = now()
  WHERE t.last_status = 'processing'
    AND t.locked_at IS NOT NULL
    AND t.locked_at < now() - make_interval(secs => GREATEST(p_stale_after_seconds, 60));

  RETURN QUERY
  WITH picked AS (
    SELECT t.id
    FROM public.discovery_exposure_targets t
    WHERE t.next_due_at <= now()
      AND t.last_status <> 'processing'
    ORDER BY t.next_due_at ASC, t.id ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  UPDATE public.discovery_exposure_targets t
  SET last_status = 'processing',
      locked_at = now(),
      lock_id = v_lock,
      last_error = NULL,
      next_due_at = now() + make_interval(mins => GREATEST(t.interval_minutes, 1)),
      updated_at = now()
  FROM picked p
  WHERE t.id = p.id
  RETURNING t.id, t.region, t.surface_name, t.platform, t.locale, t.interval_minutes, v_lock;
END;
$$;

-- ============================================================
-- 8) Cron jobs
-- ============================================================
-- Orchestrate collector each minute (targets run every 10 minutes via next_due_at)
DO $$
DECLARE
  v_job_id BIGINT;
BEGIN
  SELECT jobid INTO v_job_id
  FROM cron.job
  WHERE jobname = 'discover-exposure-collector-orchestrate-minute'
  LIMIT 1;

  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_job_id);
  END IF;

  PERFORM cron.schedule(
    'discover-exposure-collector-orchestrate-minute',
    '* * * * *',
    $job$
      SELECT
        net.http_post(
          url := current_setting('app.settings.supabase_url') || '/functions/v1/discover-exposure-collector',
          headers := '{"Content-Type":"application/json"}'::jsonb,
          body := '{"mode":"orchestrate"}'::jsonb
        );
    $job$
  );
END
$$;

-- Daily maintenance (raw cleanup + segment retention + rollup)
DO $$
DECLARE
  v_job_id BIGINT;
BEGIN
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
          body := '{"mode":"maintenance"}'::jsonb
        );
    $job$
  );
END
$$;

