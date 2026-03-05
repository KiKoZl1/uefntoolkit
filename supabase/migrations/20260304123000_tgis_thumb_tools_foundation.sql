BEGIN;

ALTER TABLE public.tgis_generation_log
  ADD COLUMN IF NOT EXISTS asset_id uuid NULL;

CREATE TABLE IF NOT EXISTS public.tgis_thumb_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  source_generation_id uuid NULL REFERENCES public.tgis_generation_log(id) ON DELETE SET NULL,
  parent_asset_id uuid NULL REFERENCES public.tgis_thumb_assets(id) ON DELETE SET NULL,
  origin_tool text NOT NULL,
  image_url text NOT NULL,
  width int NOT NULL,
  height int NOT NULL,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tgis_thumb_assets_origin_tool_chk CHECK (origin_tool IN ('generate', 'edit_studio', 'camera_control', 'layer_decomposition'))
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tgis_generation_log_asset_id_fkey'
  ) THEN
    ALTER TABLE public.tgis_generation_log
      ADD CONSTRAINT tgis_generation_log_asset_id_fkey
      FOREIGN KEY (asset_id) REFERENCES public.tgis_thumb_assets(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tgis_thumb_assets_user_created
  ON public.tgis_thumb_assets (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tgis_thumb_assets_parent
  ON public.tgis_thumb_assets (parent_asset_id);

CREATE TABLE IF NOT EXISTS public.tgis_thumb_tool_runs (
  id bigserial PRIMARY KEY,
  asset_id uuid NULL REFERENCES public.tgis_thumb_assets(id) ON DELETE SET NULL,
  user_id uuid NOT NULL,
  tool_name text NOT NULL,
  mode text NULL,
  status text NOT NULL DEFAULT 'queued',
  provider text NOT NULL DEFAULT 'fal',
  provider_model text NULL,
  input_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  latency_ms int NULL,
  cost_usd numeric NULL,
  error_text text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz NULL,
  ended_at timestamptz NULL,
  CONSTRAINT tgis_thumb_tool_runs_tool_name_chk CHECK (tool_name IN ('generate', 'edit_studio', 'camera_control', 'layer_decomposition')),
  CONSTRAINT tgis_thumb_tool_runs_status_chk CHECK (status IN ('queued', 'running', 'success', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_tgis_thumb_tool_runs_tool_created
  ON public.tgis_thumb_tool_runs (tool_name, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tgis_thumb_tool_runs_status_created
  ON public.tgis_thumb_tool_runs (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tgis_thumb_tool_runs_input_gin
  ON public.tgis_thumb_tool_runs USING gin (input_json);

CREATE INDEX IF NOT EXISTS idx_tgis_thumb_tool_runs_output_gin
  ON public.tgis_thumb_tool_runs USING gin (output_json);

ALTER TABLE public.tgis_thumb_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tgis_thumb_tool_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tgis_thumb_assets_service_all ON public.tgis_thumb_assets;
CREATE POLICY tgis_thumb_assets_service_all
  ON public.tgis_thumb_assets FOR ALL
  TO public
  USING ((auth.jwt() ->> 'role') = 'service_role')
  WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

DROP POLICY IF EXISTS tgis_thumb_assets_user_select ON public.tgis_thumb_assets;
CREATE POLICY tgis_thumb_assets_user_select
  ON public.tgis_thumb_assets FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id OR public.is_admin_or_editor());

DROP POLICY IF EXISTS tgis_thumb_tool_runs_service_all ON public.tgis_thumb_tool_runs;
CREATE POLICY tgis_thumb_tool_runs_service_all
  ON public.tgis_thumb_tool_runs FOR ALL
  TO public
  USING ((auth.jwt() ->> 'role') = 'service_role')
  WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

DROP POLICY IF EXISTS tgis_thumb_tool_runs_user_select ON public.tgis_thumb_tool_runs;
CREATE POLICY tgis_thumb_tool_runs_user_select
  ON public.tgis_thumb_tool_runs FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id OR public.is_admin_or_editor());

ALTER TABLE public.tgis_runtime_config
  ADD COLUMN IF NOT EXISTS camera_model text NOT NULL DEFAULT 'fal-ai/qwen-image-edit-2511-multiple-angles',
  ADD COLUMN IF NOT EXISTS camera_steps int NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS layer_model text NOT NULL DEFAULT 'fal-ai/qwen-image-layered',
  ADD COLUMN IF NOT EXISTS layer_default_count int NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS layer_min_count int NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS layer_max_count int NOT NULL DEFAULT 10;

UPDATE public.tgis_runtime_config
SET
  camera_model = COALESCE(NULLIF(camera_model, ''), 'fal-ai/qwen-image-edit-2511-multiple-angles'),
  camera_steps = LEAST(32, GREATEST(1, COALESCE(camera_steps, 8))),
  layer_model = COALESCE(NULLIF(layer_model, ''), 'fal-ai/qwen-image-layered'),
  layer_default_count = LEAST(10, GREATEST(2, COALESCE(layer_default_count, 4))),
  layer_min_count = LEAST(10, GREATEST(2, COALESCE(layer_min_count, 2))),
  layer_max_count = LEAST(10, GREATEST(2, COALESCE(layer_max_count, 10))),
  updated_at = now()
WHERE config_key = 'default';

INSERT INTO storage.buckets (id, name, public)
VALUES ('tgis-tool-temp', 'tgis-tool-temp', false)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.tgis_cleanup_tool_temp_storage_48h()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted bigint := 0;
BEGIN
  PERFORM public._tgis_require_service_role();

  DELETE FROM storage.objects
  WHERE bucket_id = 'tgis-tool-temp'
    AND created_at < now() - interval '48 hours';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'deleted_objects', v_deleted);
END;
$$;

GRANT EXECUTE ON FUNCTION public.tgis_cleanup_tool_temp_storage_48h() TO service_role;

DO $$
DECLARE
  v_jobid bigint;
BEGIN
  BEGIN
    SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'tgis-tool-temp-retention-48h' LIMIT 1;
    IF v_jobid IS NOT NULL THEN
      PERFORM cron.unschedule(v_jobid);
    END IF;

    PERFORM cron.schedule(
      'tgis-tool-temp-retention-48h',
      '5 * * * *',
      $cron$SELECT public.tgis_cleanup_tool_temp_storage_48h();$cron$
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Skipping tgis-tool-temp-retention-48h cron setup: %', SQLERRM;
  END;
END $$;

COMMIT;
