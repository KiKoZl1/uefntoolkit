-- Allow explicit runtime credentials for hot prewarm jobs when ALTER DATABASE/ROLE settings are restricted.
-- This keeps the function portable while supporting managed environments that block app.settings.* GUC writes.

CREATE OR REPLACE FUNCTION public.refresh_discover_hot_runtime_caches(
  p_lookup_limit integer DEFAULT 40,
  p_ai_limit integer DEFAULT 20,
  p_region text DEFAULT 'NAE',
  p_surface text DEFAULT 'CreativeDiscoverySurface_Frontend',
  p_supabase_url text DEFAULT NULL,
  p_service_role_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text := COALESCE(NULLIF(p_supabase_url, ''), current_setting('app.settings.supabase_url', true));
  v_key text := COALESCE(NULLIF(p_service_role_key, ''), current_setting('app.settings.service_role_key', true));
  v_now_bucket text := to_char(date_trunc('hour', now()), 'YYYYMMDDHH24');
  v_lookup_sent int := 0;
  v_ai_sent int := 0;
  v_code text;
BEGIN
  IF current_user NOT IN ('postgres', 'supabase_admin')
     AND (auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF v_url IS NULL OR v_url = '' OR v_key IS NULL OR v_key = '' THEN
    RAISE EXCEPTION 'missing runtime credentials for prewarm';
  END IF;

  FOR v_code IN
    SELECT island_code
    FROM public.get_discover_hot_island_codes(
      GREATEST(COALESCE(p_lookup_limit, 40), COALESCE(p_ai_limit, 20)),
      COALESCE(p_region, 'NAE'),
      COALESCE(p_surface, 'CreativeDiscoverySurface_Frontend')
    )
  LOOP
    PERFORM net.http_post(
      url := v_url || '/functions/v1/discover-island-lookup',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_key,
        'apikey', v_key
      ),
      body := jsonb_build_object(
        'islandCode', v_code,
        'compareCode', NULL
      )
    );
    v_lookup_sent := v_lookup_sent + 1;

    IF v_ai_sent < GREATEST(COALESCE(p_ai_limit, 20), 0) THEN
      PERFORM net.http_post(
        url := v_url || '/functions/v1/discover-island-lookup-ai',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || v_key,
          'apikey', v_key
        ),
        body := jsonb_build_object(
          'primaryCode', v_code,
          'compareCode', NULL,
          'locale', 'pt-BR',
          'windowDays', 7,
          'includeRecent', false,
          'payloadFingerprint', 'prewarm:' || v_code || ':' || v_now_bucket
        )
      );
      v_ai_sent := v_ai_sent + 1;
    END IF;

    EXIT WHEN v_lookup_sent >= GREATEST(COALESCE(p_lookup_limit, 40), 1);
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'region', COALESCE(p_region, 'NAE'),
    'surface_name', COALESCE(p_surface, 'CreativeDiscoverySurface_Frontend'),
    'lookup_sent', v_lookup_sent,
    'ai_sent', v_ai_sent
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_discover_hot_runtime_caches(integer, integer, text, text, text, text)
  TO service_role;
