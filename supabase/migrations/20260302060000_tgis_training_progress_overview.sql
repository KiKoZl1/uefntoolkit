-- TGIS: real-time training progress fields for fal polling/overview

ALTER TABLE public.tgis_training_runs
  ADD COLUMN IF NOT EXISTS training_provider text NOT NULL DEFAULT 'fal',
  ADD COLUMN IF NOT EXISTS provider_status text NULL,
  ADD COLUMN IF NOT EXISTS progress_pct numeric(5,2) NULL,
  ADD COLUMN IF NOT EXISTS eta_seconds int NULL,
  ADD COLUMN IF NOT EXISTS elapsed_seconds int NULL,
  ADD COLUMN IF NOT EXISTS estimated_cost_usd numeric(12,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS status_polled_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS provider_metrics_json jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_tgis_training_runs_running_polled
  ON public.tgis_training_runs (status, training_provider, status_polled_at DESC);

CREATE INDEX IF NOT EXISTS idx_tgis_training_runs_provider_status
  ON public.tgis_training_runs (provider_status, created_at DESC);

