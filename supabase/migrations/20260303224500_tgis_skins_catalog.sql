BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS public.tgis_skins_catalog (
  skin_id text PRIMARY KEY,
  name text NOT NULL,
  rarity text NOT NULL DEFAULT 'unknown',
  image_url text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  sync_batch_id text NULL,
  source text NOT NULL DEFAULT 'fortnite_api',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tgis_skins_catalog_active_name
  ON public.tgis_skins_catalog (is_active, name);

CREATE INDEX IF NOT EXISTS idx_tgis_skins_catalog_updated_at
  ON public.tgis_skins_catalog (updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_tgis_skins_catalog_name_trgm
  ON public.tgis_skins_catalog
  USING gin (name gin_trgm_ops);

ALTER TABLE public.tgis_skins_catalog ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tgis_skins_catalog_service_all ON public.tgis_skins_catalog;
CREATE POLICY tgis_skins_catalog_service_all
  ON public.tgis_skins_catalog FOR ALL
  TO public
  USING ((auth.jwt() ->> 'role') = 'service_role')
  WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

DROP POLICY IF EXISTS tgis_skins_catalog_admin_select ON public.tgis_skins_catalog;
CREATE POLICY tgis_skins_catalog_admin_select
  ON public.tgis_skins_catalog FOR SELECT
  TO authenticated
  USING (public.is_admin_or_editor());

CREATE OR REPLACE FUNCTION public.tgis_get_top_skins(
  p_query text DEFAULT NULL,
  p_limit int DEFAULT 100,
  p_offset int DEFAULT 0,
  p_days int DEFAULT 30
)
RETURNS TABLE (
  skin_id text,
  name text,
  rarity text,
  image_url text,
  usage_30d bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH usage_agg AS (
    SELECT
      u.skin_id,
      SUM(u.count)::bigint AS usage_30d
    FROM public.tgis_skin_usage_daily u
    WHERE u.date >= (CURRENT_DATE - (GREATEST(1, COALESCE(p_days, 30)) - 1))
    GROUP BY u.skin_id
  ),
  base AS (
    SELECT
      c.skin_id,
      c.name,
      c.rarity,
      c.image_url,
      COALESCE(u.usage_30d, 0)::bigint AS usage_30d,
      lower(c.name) AS name_lc,
      lower(COALESCE(NULLIF(btrim(p_query), ''), '')) AS q_lc
    FROM public.tgis_skins_catalog c
    LEFT JOIN usage_agg u ON u.skin_id = c.skin_id
    WHERE c.is_active = true
      AND (
        COALESCE(NULLIF(btrim(p_query), ''), '') = ''
        OR c.name ILIKE ('%' || btrim(p_query) || '%')
        OR c.skin_id ILIKE ('%' || btrim(p_query) || '%')
      )
  )
  SELECT
    b.skin_id,
    b.name,
    b.rarity,
    b.image_url,
    b.usage_30d
  FROM base b
  ORDER BY
    CASE
      WHEN b.q_lc = '' THEN 10
      WHEN b.name_lc = b.q_lc THEN 0
      WHEN b.name_lc LIKE (b.q_lc || '%') THEN 1
      WHEN b.name_lc LIKE ('% ' || b.q_lc || '%') THEN 2
      ELSE 3
    END ASC,
    CASE WHEN b.q_lc = '' THEN 0 ELSE similarity(b.name_lc, b.q_lc) END DESC,
    b.usage_30d DESC,
    b.name ASC
  LIMIT LEAST(200, GREATEST(1, COALESCE(p_limit, 100)))
  OFFSET GREATEST(0, COALESCE(p_offset, 0));
$$;

CREATE OR REPLACE FUNCTION public.tgis_count_skins(
  p_query text DEFAULT NULL
)
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::bigint
  FROM public.tgis_skins_catalog c
  WHERE c.is_active = true
    AND (
      COALESCE(NULLIF(btrim(p_query), ''), '') = ''
      OR c.name ILIKE ('%' || btrim(p_query) || '%')
      OR c.skin_id ILIKE ('%' || btrim(p_query) || '%')
    );
$$;

GRANT EXECUTE ON FUNCTION public.tgis_get_top_skins(text, int, int, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.tgis_count_skins(text) TO service_role;

DO $$
DECLARE
  v_url text := current_setting('app.settings.supabase_url', true);
  v_key text := current_setting('app.settings.service_role_key', true);
  v_jobid bigint;
BEGIN
  IF v_url IS NULL OR v_url = '' OR v_key IS NULL OR v_key = '' THEN
    RAISE NOTICE 'Skipping tgis-skins-sync cron setup: missing app.settings.supabase_url/service_role_key';
    RETURN;
  END IF;

  SELECT jobid INTO v_jobid
  FROM cron.job
  WHERE jobname = 'tgis-skins-sync-daily-22-brt'
  LIMIT 1;

  IF v_jobid IS NOT NULL THEN
    BEGIN
      PERFORM cron.unschedule(v_jobid);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Could not unschedule tgis-skins-sync-daily-22-brt: %', SQLERRM;
    END;
  END IF;

  -- 22:00 America/Sao_Paulo ~= 01:00 UTC
  PERFORM cron.schedule(
    'tgis-skins-sync-daily-22-brt',
    '0 1 * * *',
    format($job$
      SELECT net.http_post(
        url := %L || '/functions/v1/tgis-skins-sync',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || %L
        ),
        body := '{"mode":"sync","source":"cron_22_brt"}'::jsonb
      ) AS request_id;
    $job$, v_url, v_key)
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Skipping tgis-skins-sync cron setup due to error: %', SQLERRM;
END $$;

COMMIT;
