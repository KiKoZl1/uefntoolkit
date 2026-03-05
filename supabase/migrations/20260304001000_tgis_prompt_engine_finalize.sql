BEGIN;

ALTER TABLE public.tgis_generation_log
  ADD COLUMN IF NOT EXISTS processed_intent_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS sanitization_report_json jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_tgis_generation_log_processed_intent_gin
  ON public.tgis_generation_log
  USING gin (processed_intent_json);

CREATE INDEX IF NOT EXISTS idx_tgis_generation_log_sanitization_gin
  ON public.tgis_generation_log
  USING gin (sanitization_report_json);

ALTER TABLE public.tgis_prompt_templates
  ADD COLUMN IF NOT EXISTS version text NOT NULL DEFAULT 'v1',
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS notes text NULL;

COMMIT;
