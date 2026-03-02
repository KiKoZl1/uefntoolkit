-- TGIS foundation schema, RPCs and cron orchestration

-- Service role guard helper (mirrors DPPI style)
CREATE OR REPLACE FUNCTION public._tgis_require_service_role()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text := COALESCE(auth.jwt() ->> 'role', current_setting('request.jwt.claim.role', true));
BEGIN
  IF v_role IS DISTINCT FROM 'service_role' AND current_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._tgis_require_service_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._tgis_require_service_role() TO service_role;

CREATE TABLE IF NOT EXISTS public.tgis_cluster_registry (
  cluster_id integer PRIMARY KEY,
  cluster_name text NOT NULL,
  trigger_word text NOT NULL,
  categories_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  lora_fal_path text NULL,
  lora_version text NULL,
  model_base text NOT NULL DEFAULT 'Tongyi-MAI/Z-Image-Turbo',
  is_active boolean NOT NULL DEFAULT true,
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tgis_model_versions (
  id bigserial PRIMARY KEY,
  cluster_id integer NOT NULL REFERENCES public.tgis_cluster_registry(cluster_id) ON DELETE CASCADE,
  version text NOT NULL,
  lora_fal_path text NOT NULL,
  artifact_uri text NULL,
  quality_gate_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','candidate','active','archived','failed')),
  promoted_by uuid NULL,
  promoted_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cluster_id, version)
);

CREATE TABLE IF NOT EXISTS public.tgis_generation_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NULL,
  prompt_raw text NOT NULL,
  prompt_rewritten text NULL,
  category text NOT NULL,
  cluster_id integer NULL REFERENCES public.tgis_cluster_registry(cluster_id) ON DELETE SET NULL,
  model_base text NULL,
  lora_version text NULL,
  fal_request_id text NULL,
  provider text NOT NULL DEFAULT 'fal.ai',
  model_name text NOT NULL DEFAULT 'fal-ai/z-image/turbo/lora',
  variants int NOT NULL DEFAULT 4,
  images_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  latency_ms int NULL,
  cost_usd numeric(12,6) NOT NULL DEFAULT 0,
  error_text text NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','success','failed','blocked','quota_exceeded')),
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tgis_prompt_rewrite_log (
  id bigserial PRIMARY KEY,
  generation_id uuid NULL REFERENCES public.tgis_generation_log(id) ON DELETE CASCADE,
  user_id uuid NULL,
  prompt_raw text NOT NULL,
  prompt_rewritten text NOT NULL,
  category text NOT NULL,
  cluster_id integer NULL,
  provider text NOT NULL DEFAULT 'openrouter',
  model_name text NOT NULL DEFAULT 'openai/gpt-4o-mini',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tgis_dataset_runs (
  id bigserial PRIMARY KEY,
  run_type text NOT NULL DEFAULT 'daily_refresh' CHECK (run_type IN ('daily_refresh','manual_refresh','clustering','captioning')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','success','failed')),
  summary_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_text text NULL,
  started_at timestamptz NULL,
  ended_at timestamptz NULL,
  requested_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tgis_training_runs (
  id bigserial PRIMARY KEY,
  cluster_id integer NULL REFERENCES public.tgis_cluster_registry(cluster_id) ON DELETE SET NULL,
  requested_by uuid NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','success','failed','cancelled')),
  run_mode text NOT NULL DEFAULT 'manual' CHECK (run_mode IN ('manual','scheduled','dry_run')),
  model_base text NOT NULL DEFAULT 'Tongyi-MAI/Z-Image-Turbo',
  target_version text NULL,
  quality_gate_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_text text NULL,
  started_at timestamptz NULL,
  ended_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tgis_cost_usage_daily (
  day date NOT NULL,
  provider text NOT NULL,
  model_name text NOT NULL,
  generations int NOT NULL DEFAULT 0,
  images_generated int NOT NULL DEFAULT 0,
  total_cost_usd numeric(14,6) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (day, provider, model_name)
);

CREATE TABLE IF NOT EXISTS public.tgis_beta_users (
  user_id uuid PRIMARY KEY,
  active boolean NOT NULL DEFAULT true,
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tgis_blocklist_terms (
  term text PRIMARY KEY,
  is_active boolean NOT NULL DEFAULT true,
  reason text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tgis_runtime_config (
  config_key text PRIMARY KEY,
  max_generations_per_user_per_day int NOT NULL DEFAULT 50,
  max_variants_per_generation int NOT NULL DEFAULT 4,
  global_daily_budget_usd numeric(12,2) NOT NULL DEFAULT 25.00,
  default_generation_cost_usd numeric(12,6) NOT NULL DEFAULT 0.007000,
  circuit_breaker_error_rate numeric(6,4) NOT NULL DEFAULT 0.3500,
  openrouter_model text NOT NULL DEFAULT 'openai/gpt-4o-mini',
  fal_model text NOT NULL DEFAULT 'fal-ai/z-image/turbo/lora',
  rewrite_temperature numeric(6,4) NOT NULL DEFAULT 0.40,
  rewrite_max_tokens int NOT NULL DEFAULT 220,
  beta_closed boolean NOT NULL DEFAULT true,
  training_enabled boolean NOT NULL DEFAULT false,
  updated_by uuid NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tgis_worker_heartbeat (
  id bigserial PRIMARY KEY,
  worker_host text NOT NULL,
  worker_source text NOT NULL DEFAULT 'hetzner-cx22',
  ts timestamptz NOT NULL DEFAULT now(),
  cpu_pct numeric(6,2) NULL,
  mem_pct numeric(6,2) NULL,
  disk_pct numeric(6,2) NULL,
  queue_depth int NOT NULL DEFAULT 0,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb
);

INSERT INTO public.tgis_runtime_config (config_key)
VALUES ('default')
ON CONFLICT (config_key) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('tgis', 'tgis', true)
ON CONFLICT (id) DO NOTHING;

CREATE INDEX IF NOT EXISTS tgis_generation_log_created_idx ON public.tgis_generation_log (created_at DESC);
CREATE INDEX IF NOT EXISTS tgis_generation_log_user_idx ON public.tgis_generation_log (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tgis_generation_log_cluster_idx ON public.tgis_generation_log (cluster_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tgis_generation_log_status_idx ON public.tgis_generation_log (status, created_at DESC);
CREATE INDEX IF NOT EXISTS tgis_model_versions_cluster_status_idx ON public.tgis_model_versions (cluster_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS tgis_training_runs_cluster_started_idx ON public.tgis_training_runs (cluster_id, started_at DESC);
CREATE INDEX IF NOT EXISTS tgis_cost_usage_daily_day_idx ON public.tgis_cost_usage_daily (day DESC, provider);
CREATE INDEX IF NOT EXISTS tgis_dataset_runs_created_idx ON public.tgis_dataset_runs (created_at DESC);
CREATE INDEX IF NOT EXISTS tgis_worker_heartbeat_ts_idx ON public.tgis_worker_heartbeat (ts DESC);

ALTER TABLE public.tgis_cluster_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tgis_model_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tgis_generation_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tgis_prompt_rewrite_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tgis_dataset_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tgis_training_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tgis_cost_usage_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tgis_beta_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tgis_blocklist_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tgis_runtime_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tgis_worker_heartbeat ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'tgis_cluster_registry',
    'tgis_model_versions',
    'tgis_generation_log',
    'tgis_prompt_rewrite_log',
    'tgis_dataset_runs',
    'tgis_training_runs',
    'tgis_cost_usage_daily',
    'tgis_beta_users',
    'tgis_blocklist_terms',
    'tgis_runtime_config',
    'tgis_worker_heartbeat'
  ])
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      t || '_service_all',
      t
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO public USING ((auth.jwt() ->> ''role'') = ''service_role'') WITH CHECK ((auth.jwt() ->> ''role'') = ''service_role'')',
      t || '_service_all',
      t
    );
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      t || '_admin_select',
      t
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_admin_or_editor())',
      t || '_admin_select',
      t
    );
  END LOOP;
END $$;

DROP POLICY IF EXISTS tgis_generation_log_user_select ON public.tgis_generation_log;
CREATE POLICY tgis_generation_log_user_select
  ON public.tgis_generation_log FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.compute_tgis_thumb_score(
  p_window_days int DEFAULT 14
)
RETURNS TABLE (
  link_code text,
  image_url text,
  tag_group text,
  ccu_percentile_within_tag numeric,
  avg_stint_minutes_normalized numeric,
  ab_winner_bonus numeric,
  panel_tier_score numeric,
  quality_score numeric
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
WITH window_cfg AS (
  SELECT now() - make_interval(days => LEAST(90, GREATEST(1, COALESCE(p_window_days, 14)))) AS dt_start
),
meta AS (
  SELECT
    m.link_code,
    m.image_url,
    COALESCE(
      NULLIF(m.raw -> 'feature_tags' ->> 0, ''),
      NULLIF(m.discovery_intent, ''),
      'general'
    ) AS tag_group
  FROM public.discover_link_metadata m
  WHERE m.link_code_type = 'island'
    AND m.image_url IS NOT NULL
),
presence AS (
  SELECT
    s.link_code,
    AVG(COALESCE(NULLIF(s.ccu_max, 0), NULLIF(s.ccu_end, 0), NULLIF(s.ccu_start, 0), 0)::numeric) AS ccu_avg,
    AVG(
      GREATEST(
        0,
        EXTRACT(
          epoch FROM (
            LEAST(COALESCE(s.end_ts, s.last_seen_ts, now()), now())
            - GREATEST(s.start_ts, (SELECT dt_start FROM window_cfg))
          )
        ) / 60.0
      )
    ) AS avg_stint_minutes,
    MAX(COALESCE(pt.tier, 3)) AS best_tier
  FROM public.discovery_exposure_presence_segments s
  LEFT JOIN public.discovery_panel_tiers pt ON pt.panel_name = s.panel_name
  WHERE s.link_code_type = 'island'
    AND s.start_ts < now()
    AND COALESCE(s.end_ts, s.last_seen_ts, now()) > (SELECT dt_start FROM window_cfg)
  GROUP BY s.link_code
),
ab AS (
  SELECT
    e.link_code,
    CASE
      WHEN COUNT(*) FILTER (WHERE e.event_type = 'thumb_changed') > 0 THEN 1.0
      ELSE 0.0
    END::numeric AS ab_winner_bonus
  FROM public.discover_link_metadata_events e
  WHERE e.ts >= (SELECT dt_start FROM window_cfg)
  GROUP BY e.link_code
),
base AS (
  SELECT
    m.link_code,
    m.image_url,
    m.tag_group,
    COALESCE(p.ccu_avg, 0)::numeric AS ccu_avg,
    COALESCE(p.avg_stint_minutes, 0)::numeric AS avg_stint_minutes,
    COALESCE(a.ab_winner_bonus, 0)::numeric AS ab_winner_bonus,
    CASE
      WHEN COALESCE(p.best_tier, 3) = 1 THEN 1.0
      WHEN COALESCE(p.best_tier, 3) = 2 THEN 0.65
      ELSE 0.3
    END::numeric AS panel_tier_score
  FROM meta m
  LEFT JOIN presence p ON p.link_code = m.link_code
  LEFT JOIN ab a ON a.link_code = m.link_code
),
ranked AS (
  SELECT
    b.*,
    COALESCE(PERCENT_RANK() OVER (PARTITION BY b.tag_group ORDER BY b.ccu_avg), 0)::numeric AS ccu_pct,
    CASE
      WHEN MAX(b.avg_stint_minutes) OVER (PARTITION BY b.tag_group) <= 0 THEN 0::numeric
      ELSE LEAST(1.0, b.avg_stint_minutes / NULLIF(MAX(b.avg_stint_minutes) OVER (PARTITION BY b.tag_group), 0))
    END::numeric AS stint_norm
  FROM base b
)
SELECT
  r.link_code,
  r.image_url,
  r.tag_group,
  ROUND(r.ccu_pct, 4) AS ccu_percentile_within_tag,
  ROUND(r.stint_norm, 4) AS avg_stint_minutes_normalized,
  ROUND(r.ab_winner_bonus, 4) AS ab_winner_bonus,
  ROUND(r.panel_tier_score, 4) AS panel_tier_score,
  ROUND(
    (r.ccu_pct * 0.40)
    + (r.stint_norm * 0.30)
    + (r.ab_winner_bonus * 0.20)
    + (r.panel_tier_score * 0.10),
    4
  ) AS quality_score
FROM ranked r;
$$;

CREATE OR REPLACE FUNCTION public.get_tgis_training_candidates(
  p_min_score numeric DEFAULT 0.45,
  p_limit int DEFAULT 5000
)
RETURNS TABLE (
  link_code text,
  image_url text,
  tag_group text,
  quality_score numeric
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
SELECT
  s.link_code,
  s.image_url,
  s.tag_group,
  s.quality_score
FROM public.compute_tgis_thumb_score(14) s
WHERE s.quality_score >= COALESCE(p_min_score, 0.45)
ORDER BY s.quality_score DESC
LIMIT LEAST(50000, GREATEST(1, COALESCE(p_limit, 5000)));
$$;

CREATE OR REPLACE FUNCTION public.tgis_can_generate(
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cfg record;
  v_is_beta boolean := false;
  v_used_today int := 0;
  v_cost_today numeric := 0;
  v_block_reason text := null;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'missing_user');
  END IF;

  SELECT *
  INTO v_cfg
  FROM public.tgis_runtime_config
  WHERE config_key = 'default'
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'missing_runtime_config');
  END IF;

  SELECT EXISTS(
    SELECT 1
    FROM public.tgis_beta_users b
    WHERE b.user_id = p_user_id
      AND b.active = true
  ) INTO v_is_beta;

  IF COALESCE(v_cfg.beta_closed, true) AND NOT v_is_beta THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'beta_closed');
  END IF;

  SELECT COUNT(*)::int
    INTO v_used_today
  FROM public.tgis_generation_log g
  WHERE g.user_id = p_user_id
    AND g.created_at >= date_trunc('day', now())
    AND g.status = 'success';

  IF v_used_today >= COALESCE(v_cfg.max_generations_per_user_per_day, 50) THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'quota_exceeded',
      'quota', COALESCE(v_cfg.max_generations_per_user_per_day, 50),
      'used_today', v_used_today
    );
  END IF;

  SELECT COALESCE(SUM(c.total_cost_usd), 0)
    INTO v_cost_today
  FROM public.tgis_cost_usage_daily c
  WHERE c.day = now()::date;

  IF v_cost_today >= COALESCE(v_cfg.global_daily_budget_usd, 25) THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'daily_budget_exceeded',
      'cost_today', v_cost_today,
      'budget', COALESCE(v_cfg.global_daily_budget_usd, 25)
    );
  END IF;

  RETURN jsonb_build_object(
    'allowed', true,
    'reason', 'ok',
    'quota', COALESCE(v_cfg.max_generations_per_user_per_day, 50),
    'used_today', v_used_today,
    'max_variants', COALESCE(v_cfg.max_variants_per_generation, 4),
    'cost_today', v_cost_today,
    'budget', COALESCE(v_cfg.global_daily_budget_usd, 25)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.tgis_record_generation_cost(
  p_generation_id uuid,
  p_provider text,
  p_model_name text,
  p_cost_usd numeric,
  p_images_generated int DEFAULT 0,
  p_day date DEFAULT now()::date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._tgis_require_service_role();

  UPDATE public.tgis_generation_log
  SET cost_usd = COALESCE(p_cost_usd, 0),
      updated_at = now()
  WHERE id = p_generation_id;

  INSERT INTO public.tgis_cost_usage_daily (
    day,
    provider,
    model_name,
    generations,
    images_generated,
    total_cost_usd,
    updated_at
  )
  VALUES (
    COALESCE(p_day, now()::date),
    COALESCE(NULLIF(trim(p_provider), ''), 'fal.ai'),
    COALESCE(NULLIF(trim(p_model_name), ''), 'fal-ai/z-image/turbo/lora'),
    1,
    GREATEST(0, COALESCE(p_images_generated, 0)),
    COALESCE(p_cost_usd, 0),
    now()
  )
  ON CONFLICT (day, provider, model_name)
  DO UPDATE
    SET generations = public.tgis_cost_usage_daily.generations + 1,
        images_generated = public.tgis_cost_usage_daily.images_generated + GREATEST(0, COALESCE(p_images_generated, 0)),
        total_cost_usd = public.tgis_cost_usage_daily.total_cost_usd + COALESCE(p_cost_usd, 0),
        updated_at = now();

  RETURN jsonb_build_object('ok', true, 'generation_id', p_generation_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.tgis_set_active_model(
  p_cluster_id int,
  p_version text,
  p_updated_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_allowed boolean := (COALESCE(auth.jwt() ->> 'role', current_setting('request.jwt.claim.role', true)) = 'service_role') OR public.is_admin_or_editor();
  v_model record;
BEGIN
  IF NOT v_is_allowed THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT *
    INTO v_model
  FROM public.tgis_model_versions
  WHERE cluster_id = p_cluster_id
    AND version = p_version
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'model_not_found';
  END IF;

  UPDATE public.tgis_model_versions
  SET status = CASE WHEN cluster_id = p_cluster_id AND version = p_version THEN 'active' ELSE 'archived' END,
      updated_at = now()
  WHERE cluster_id = p_cluster_id
    AND status IN ('active', 'candidate', 'draft', 'archived');

  UPDATE public.tgis_cluster_registry
  SET lora_fal_path = v_model.lora_fal_path,
      lora_version = v_model.version,
      is_active = true,
      updated_at = now()
  WHERE cluster_id = p_cluster_id;

  UPDATE public.tgis_runtime_config
  SET updated_by = COALESCE(p_updated_by, updated_by),
      updated_at = now()
  WHERE config_key = 'default';

  RETURN jsonb_build_object(
    'ok', true,
    'cluster_id', p_cluster_id,
    'version', p_version
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.tgis_rollback_model(
  p_cluster_id int,
  p_to_version text,
  p_updated_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.tgis_set_active_model(p_cluster_id, p_to_version, p_updated_by);
END;
$$;

CREATE OR REPLACE FUNCTION public.tgis_refresh_dataset_daily()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id bigint;
  v_count int;
BEGIN
  PERFORM public._tgis_require_service_role();

  INSERT INTO public.tgis_dataset_runs (run_type, status, started_at, summary_json)
  VALUES ('daily_refresh', 'running', now(), '{}'::jsonb)
  RETURNING id INTO v_run_id;

  SELECT COUNT(*)::int INTO v_count
  FROM public.get_tgis_training_candidates(0.45, 50000);

  UPDATE public.tgis_dataset_runs
  SET status = 'success',
      ended_at = now(),
      summary_json = jsonb_build_object('candidate_count', v_count),
      updated_at = now()
  WHERE id = v_run_id;

  RETURN jsonb_build_object('ok', true, 'run_id', v_run_id, 'candidate_count', v_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.tgis_sync_cost_usage_hourly()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows int;
BEGIN
  PERFORM public._tgis_require_service_role();

  WITH agg AS (
    SELECT
      date_trunc('day', g.created_at)::date AS day,
      COALESCE(NULLIF(g.provider, ''), 'fal.ai') AS provider,
      COALESCE(NULLIF(g.model_name, ''), 'fal-ai/z-image/turbo/lora') AS model_name,
      COUNT(*) FILTER (WHERE g.status = 'success')::int AS generations,
      COALESCE(SUM(jsonb_array_length(COALESCE(g.images_json, '[]'::jsonb))) FILTER (WHERE g.status = 'success'), 0)::int AS images_generated,
      COALESCE(SUM(g.cost_usd), 0)::numeric AS total_cost_usd
    FROM public.tgis_generation_log g
    WHERE g.created_at >= now() - interval '7 days'
    GROUP BY 1,2,3
  )
  INSERT INTO public.tgis_cost_usage_daily (
    day, provider, model_name, generations, images_generated, total_cost_usd, updated_at
  )
  SELECT
    a.day, a.provider, a.model_name, a.generations, a.images_generated, a.total_cost_usd, now()
  FROM agg a
  ON CONFLICT (day, provider, model_name)
  DO UPDATE
    SET generations = EXCLUDED.generations,
        images_generated = EXCLUDED.images_generated,
        total_cost_usd = EXCLUDED.total_cost_usd,
        updated_at = now();

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'rows', v_rows);
END;
$$;

CREATE OR REPLACE FUNCTION public.tgis_manifest_consistency_check()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_active int := 0;
  v_missing int := 0;
BEGIN
  PERFORM public._tgis_require_service_role();

  SELECT COUNT(*)::int
    INTO v_active
  FROM public.tgis_cluster_registry
  WHERE is_active = true;

  SELECT COUNT(*)::int
    INTO v_missing
  FROM public.tgis_cluster_registry
  WHERE is_active = true
    AND (lora_fal_path IS NULL OR lora_version IS NULL);

  RETURN jsonb_build_object(
    'ok', v_missing = 0,
    'active_clusters', v_active,
    'missing_model_clusters', v_missing
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.compute_tgis_thumb_score(int) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_tgis_training_candidates(numeric, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.tgis_can_generate(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tgis_record_generation_cost(uuid, text, text, numeric, int, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.tgis_set_active_model(int, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tgis_rollback_model(int, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tgis_refresh_dataset_daily() TO service_role;
GRANT EXECUTE ON FUNCTION public.tgis_sync_cost_usage_hourly() TO service_role;
GRANT EXECUTE ON FUNCTION public.tgis_manifest_consistency_check() TO service_role;

DO $$
DECLARE
  v_jobid bigint;
BEGIN
  BEGIN
    SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'tgis-dataset-refresh-daily' LIMIT 1;
    IF v_jobid IS NOT NULL THEN PERFORM cron.unschedule(v_jobid); END IF;
    PERFORM cron.schedule('tgis-dataset-refresh-daily', '30 2 * * *', $cron$SELECT public.tgis_refresh_dataset_daily();$cron$);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Skipping tgis-dataset-refresh-daily cron setup: %', SQLERRM;
  END;

  BEGIN
    SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'tgis-cost-sync-hourly' LIMIT 1;
    IF v_jobid IS NOT NULL THEN PERFORM cron.unschedule(v_jobid); END IF;
    PERFORM cron.schedule('tgis-cost-sync-hourly', '5 * * * *', $cron$SELECT public.tgis_sync_cost_usage_hourly();$cron$);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Skipping tgis-cost-sync-hourly cron setup: %', SQLERRM;
  END;

  BEGIN
    SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'tgis-manifest-consistency-check' LIMIT 1;
    IF v_jobid IS NOT NULL THEN PERFORM cron.unschedule(v_jobid); END IF;
    PERFORM cron.schedule('tgis-manifest-consistency-check', '*/30 * * * *', $cron$SELECT public.tgis_manifest_consistency_check();$cron$);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Skipping tgis-manifest-consistency-check cron setup: %', SQLERRM;
  END;
END $$;
