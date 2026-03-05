BEGIN;

-- Runtime config for Nano Banana generation flow.
ALTER TABLE public.tgis_runtime_config
  ADD COLUMN IF NOT EXISTS generate_provider text NOT NULL DEFAULT 'fal-nano-banana-2',
  ADD COLUMN IF NOT EXISTS nano_model text NOT NULL DEFAULT 'fal-ai/nano-banana-2/edit',
  ADD COLUMN IF NOT EXISTS context_boost_default boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS max_skin_refs int NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS max_total_refs int NOT NULL DEFAULT 14;

UPDATE public.tgis_runtime_config
SET
  generate_provider = COALESCE(NULLIF(generate_provider, ''), 'fal-nano-banana-2'),
  nano_model = COALESCE(NULLIF(nano_model, ''), 'fal-ai/nano-banana-2/edit'),
  context_boost_default = COALESCE(context_boost_default, true),
  max_skin_refs = LEAST(4, GREATEST(0, COALESCE(max_skin_refs, 2))),
  max_total_refs = LEAST(14, GREATEST(1, COALESCE(max_total_refs, 14))),
  updated_at = now()
WHERE config_key = 'default';

-- Generation log expansion for Nano observability.
ALTER TABLE public.tgis_generation_log
  ADD COLUMN IF NOT EXISTS provider_model text NULL,
  ADD COLUMN IF NOT EXISTS context_boost boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS slots_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS normalized_image_url text NULL,
  ADD COLUMN IF NOT EXISTS normalized_width int NULL,
  ADD COLUMN IF NOT EXISTS normalized_height int NULL,
  ADD COLUMN IF NOT EXISTS skin_ids text[] NOT NULL DEFAULT '{}'::text[];

UPDATE public.tgis_generation_log
SET provider_model = COALESCE(NULLIF(provider_model, ''), model_name)
WHERE provider_model IS NULL OR provider_model = '';

CREATE INDEX IF NOT EXISTS idx_tgis_generation_log_provider_model_created
  ON public.tgis_generation_log (provider_model, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tgis_generation_log_context_boost_created
  ON public.tgis_generation_log (context_boost, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tgis_generation_log_skin_ids_gin
  ON public.tgis_generation_log
  USING gin (skin_ids);

-- Aggregated skin usage counter (no full skin catalog storage).
CREATE TABLE IF NOT EXISTS public.tgis_skin_usage_daily (
  date date NOT NULL,
  skin_id text NOT NULL,
  count bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (date, skin_id)
);

CREATE INDEX IF NOT EXISTS idx_tgis_skin_usage_daily_skin_id_date
  ON public.tgis_skin_usage_daily (skin_id, date DESC);

ALTER TABLE public.tgis_skin_usage_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tgis_skin_usage_daily_service_all ON public.tgis_skin_usage_daily;
CREATE POLICY tgis_skin_usage_daily_service_all
  ON public.tgis_skin_usage_daily FOR ALL
  TO public
  USING ((auth.jwt() ->> 'role') = 'service_role')
  WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

DROP POLICY IF EXISTS tgis_skin_usage_daily_admin_select ON public.tgis_skin_usage_daily;
CREATE POLICY tgis_skin_usage_daily_admin_select
  ON public.tgis_skin_usage_daily FOR SELECT
  TO authenticated
  USING (public.is_admin_or_editor());

CREATE OR REPLACE FUNCTION public.tgis_increment_skin_usage(
  p_skin_id text,
  p_day date DEFAULT now()::date,
  p_inc int DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._tgis_require_service_role();
  IF p_skin_id IS NULL OR btrim(p_skin_id) = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_skin_id');
  END IF;

  INSERT INTO public.tgis_skin_usage_daily (date, skin_id, count, updated_at)
  VALUES (
    COALESCE(p_day, now()::date),
    btrim(p_skin_id),
    GREATEST(1, COALESCE(p_inc, 1)),
    now()
  )
  ON CONFLICT (date, skin_id)
  DO UPDATE
    SET count = public.tgis_skin_usage_daily.count + EXCLUDED.count,
        updated_at = now();

  RETURN jsonb_build_object('ok', true, 'skin_id', btrim(p_skin_id));
END;
$$;

GRANT EXECUTE ON FUNCTION public.tgis_increment_skin_usage(text, date, int) TO service_role;

-- Optional prompt template table by cluster slug.
CREATE TABLE IF NOT EXISTS public.tgis_prompt_templates (
  cluster_slug text PRIMARY KEY,
  template_text text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  updated_by uuid NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tgis_prompt_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tgis_prompt_templates_service_all ON public.tgis_prompt_templates;
CREATE POLICY tgis_prompt_templates_service_all
  ON public.tgis_prompt_templates FOR ALL
  TO public
  USING ((auth.jwt() ->> 'role') = 'service_role')
  WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

DROP POLICY IF EXISTS tgis_prompt_templates_admin_select ON public.tgis_prompt_templates;
CREATE POLICY tgis_prompt_templates_admin_select
  ON public.tgis_prompt_templates FOR SELECT
  TO authenticated
  USING (public.is_admin_or_editor());

-- Bucket for final normalized outputs (always 1920x1080).
INSERT INTO storage.buckets (id, name, public)
VALUES ('tgis-generated', 'tgis-generated', true)
ON CONFLICT (id) DO NOTHING;

-- Retention function: keep only last 30 days of generation/rewrite logs.
CREATE OR REPLACE FUNCTION public.tgis_cleanup_logs_30d()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted_generation bigint := 0;
  v_deleted_rewrite bigint := 0;
BEGIN
  PERFORM public._tgis_require_service_role();

  DELETE FROM public.tgis_prompt_rewrite_log
  WHERE created_at < now() - interval '30 days';
  GET DIAGNOSTICS v_deleted_rewrite = ROW_COUNT;

  DELETE FROM public.tgis_generation_log
  WHERE created_at < now() - interval '30 days';
  GET DIAGNOSTICS v_deleted_generation = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'deleted_generation_log', v_deleted_generation,
    'deleted_prompt_rewrite_log', v_deleted_rewrite
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.tgis_cleanup_logs_30d() TO service_role;

DO $$
DECLARE
  v_jobid bigint;
BEGIN
  BEGIN
    SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'tgis-log-retention-30d' LIMIT 1;
    IF v_jobid IS NOT NULL THEN
      PERFORM cron.unschedule(v_jobid);
    END IF;
    PERFORM cron.schedule(
      'tgis-log-retention-30d',
      '40 3 * * *',
      $cron$SELECT public.tgis_cleanup_logs_30d();$cron$
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Skipping tgis-log-retention-30d cron setup: %', SQLERRM;
  END;
END $$;

COMMIT;
