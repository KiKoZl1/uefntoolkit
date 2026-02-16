-- V1 close: schema additions (safe, additive)
-- - write-back columns on discover_islands_cache for Links metadata
-- - add image_url to public intel snapshot tables
-- - report rebuild auditing/versioning columns
-- - system alerts materialization table

-- 1) Write-back columns (islands only) - additive
ALTER TABLE public.discover_islands_cache
  ADD COLUMN IF NOT EXISTS image_url TEXT NULL,
  ADD COLUMN IF NOT EXISTS published_at_epic TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS updated_at_epic TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS moderation_status TEXT NULL,
  ADD COLUMN IF NOT EXISTS link_state TEXT NULL,
  ADD COLUMN IF NOT EXISTS max_players INT NULL,
  ADD COLUMN IF NOT EXISTS min_players INT NULL,
  ADD COLUMN IF NOT EXISTS last_metadata_fetch_at TIMESTAMPTZ NULL;

-- 2) Standardize discover_link_metadata_events timestamp column name
-- Some earlier migrations used ts, others used created_at. We standardize on created_at.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='discover_link_metadata_events' AND column_name='created_at'
  ) THEN
    ALTER TABLE public.discover_link_metadata_events
      ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now();
  END IF;
END $$;

-- 3) Intel public tables: add image_url so public pages can render thumbs
ALTER TABLE public.discovery_public_premium_now
  ADD COLUMN IF NOT EXISTS image_url TEXT NULL;

ALTER TABLE public.discovery_public_emerging_now
  ADD COLUMN IF NOT EXISTS image_url TEXT NULL;

-- 4) Weekly report rebuild versioning
ALTER TABLE public.weekly_reports
  ADD COLUMN IF NOT EXISTS rebuild_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_rebuilt_at TIMESTAMPTZ NULL;

-- 5) Rebuild audit log (admin/editor readable; service_role writes)
CREATE TABLE IF NOT EXISTS public.discover_report_rebuild_runs (
  id BIGSERIAL PRIMARY KEY,
  weekly_report_id UUID NOT NULL REFERENCES public.weekly_reports(id) ON DELETE CASCADE,
  report_id UUID NULL REFERENCES public.discover_reports(id) ON DELETE SET NULL,
  user_id UUID NULL,
  ts_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  ts_end TIMESTAMPTZ NULL,
  ok BOOLEAN NOT NULL DEFAULT false,
  summary_json JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS discover_report_rebuild_runs_weekly_ts_idx
  ON public.discover_report_rebuild_runs (weekly_report_id, ts_start DESC);

ALTER TABLE public.discover_report_rebuild_runs ENABLE ROW LEVEL SECURITY;

-- 6) Materialized system alerts (single source for admin UI)
CREATE TABLE IF NOT EXISTS public.system_alerts_current (
  alert_key TEXT PRIMARY KEY,
  severity TEXT NOT NULL CHECK (severity IN ('ok','warn','error')),
  message TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.system_alerts_current ENABLE ROW LEVEL SECURITY;

