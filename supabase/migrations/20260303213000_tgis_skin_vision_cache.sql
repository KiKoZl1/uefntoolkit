BEGIN;

CREATE TABLE IF NOT EXISTS public.tgis_skin_vision_cache (
  skin_id text PRIMARY KEY,
  skin_name text NOT NULL,
  image_url text NOT NULL,
  vision_text text NOT NULL,
  model_name text NOT NULL DEFAULT 'openai/gpt-4o',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tgis_skin_vision_cache_updated_at
  ON public.tgis_skin_vision_cache (updated_at DESC);

ALTER TABLE public.tgis_skin_vision_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tgis_skin_vision_cache_service_all ON public.tgis_skin_vision_cache;
CREATE POLICY tgis_skin_vision_cache_service_all
  ON public.tgis_skin_vision_cache FOR ALL
  TO public
  USING ((auth.jwt() ->> 'role') = 'service_role')
  WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

DROP POLICY IF EXISTS tgis_skin_vision_cache_admin_select ON public.tgis_skin_vision_cache;
CREATE POLICY tgis_skin_vision_cache_admin_select
  ON public.tgis_skin_vision_cache FOR SELECT
  TO authenticated
  USING (public.is_admin_or_editor());

COMMIT;
