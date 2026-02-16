
-- V1 close: schema additions (safe, additive)

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

-- ===========================
-- FUNCTIONS
-- ===========================

-- 1) enqueue_discover_link_metadata (bump-controlled)
DROP FUNCTION IF EXISTS public.enqueue_discover_link_metadata(TEXT[]);
DROP FUNCTION IF EXISTS public.enqueue_discover_link_metadata(TEXT[], INTEGER);

CREATE OR REPLACE FUNCTION public.enqueue_discover_link_metadata(
  p_link_codes TEXT[],
  p_due_within_minutes INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted INT := 0;
  v_updated INT := 0;
  v_due TIMESTAMPTZ := now();
BEGIN
  IF (auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF COALESCE(p_due_within_minutes, 0) > 0 THEN
    v_due := now() + make_interval(mins => p_due_within_minutes);
  END IF;

  WITH input AS (
    SELECT DISTINCT trim(x) AS link_code
    FROM unnest(COALESCE(p_link_codes, '{}'::text[])) AS x
    WHERE x IS NOT NULL AND trim(x) <> ''
  ),
  ins AS (
    INSERT INTO public.discover_link_metadata (link_code, link_code_type, next_due_at)
    SELECT
      i.link_code,
      CASE WHEN i.link_code ~ '^[0-9]{4}-[0-9]{4}-[0-9]{4}$' THEN 'island' ELSE 'collection' END,
      now()
    FROM input i
    ON CONFLICT (link_code) DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_inserted FROM ins;

  UPDATE public.discover_link_metadata m
  SET next_due_at = LEAST(m.next_due_at, v_due),
      updated_at = now()
  WHERE m.link_code = ANY(COALESCE(p_link_codes, '{}'::text[]));
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN jsonb_build_object('inserted', v_inserted, 'updated', v_updated, 'due_cap_minutes', COALESCE(p_due_within_minutes,0));
END;
$$;

-- 2) Canonical read RPCs
CREATE OR REPLACE FUNCTION public.get_link_card(p_link_code TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'linkCode', m.link_code,
    'linkCodeType', m.link_code_type,
    'title', m.title,
    'imageUrl', m.image_url,
    'creatorCode', m.support_code,
    'creatorName', m.creator_name,
    'linkType', m.link_type,
    'publishedAtEpic', m.published_at_epic,
    'updatedAtEpic', m.updated_at_epic,
    'moderationStatus', m.moderation_status,
    'linkState', m.link_state
  )
  FROM public.discover_link_metadata m
  WHERE m.link_code = p_link_code;
$$;

CREATE OR REPLACE FUNCTION public.get_island_card(
  p_island_code TEXT,
  p_window_hours INT DEFAULT 24
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH win AS (
    SELECT (now() - make_interval(hours => GREATEST(COALESCE(p_window_hours,24),1)))::date AS d_from,
           (now() + interval '1 day')::date AS d_to
  ),
  roll AS (
    SELECT
      SUM(r.minutes_exposed)::int AS minutes_exposed,
      MIN(r.best_rank)::int AS best_rank,
      COUNT(DISTINCT r.panel_name)::int AS panels_distinct
    FROM public.discovery_exposure_rollup_daily r, win
    WHERE r.link_code = p_island_code
      AND r.link_code_type = 'island'
      AND r.date >= win.d_from AND r.date < win.d_to
  )
  SELECT jsonb_build_object(
    'islandCode', c.island_code,
    'category', c.category,
    'tags', c.tags,
    'creatorCode', c.creator_code,
    'title', COALESCE(m.title, c.title),
    'imageUrl', COALESCE(m.image_url, c.image_url),
    'publishedAtEpic', COALESCE(m.published_at_epic, c.published_at_epic),
    'updatedAtEpic', COALESCE(m.updated_at_epic, c.updated_at_epic),
    'moderationStatus', COALESCE(m.moderation_status, c.moderation_status),
    'linkState', COALESCE(m.link_state, c.link_state),
    'maxPlayers', COALESCE(m.max_players, c.max_players),
    'minPlayers', COALESCE(m.min_players, c.min_players),
    'exposure', (SELECT jsonb_build_object(
      'minutesExposed', roll.minutes_exposed,
      'bestRank', roll.best_rank,
      'panelsDistinct', roll.panels_distinct
    ) FROM roll)
  )
  FROM public.discover_islands_cache c
  LEFT JOIN public.discover_link_metadata m ON m.link_code = c.island_code
  WHERE c.island_code = p_island_code;
$$;

-- 3) Report helper RPCs
CREATE OR REPLACE FUNCTION public.report_low_perf_histogram(p_report_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'lt50',  (SELECT COUNT(*) FROM public.discover_report_islands WHERE report_id=p_report_id AND status='reported' AND COALESCE(week_unique,0) < 50),
    'lt100', (SELECT COUNT(*) FROM public.discover_report_islands WHERE report_id=p_report_id AND status='reported' AND COALESCE(week_unique,0) >= 50  AND COALESCE(week_unique,0) < 100),
    'lt500', (SELECT COUNT(*) FROM public.discover_report_islands WHERE report_id=p_report_id AND status='reported' AND COALESCE(week_unique,0) >= 100 AND COALESCE(week_unique,0) < 500),
    'gte500',(SELECT COUNT(*) FROM public.discover_report_islands WHERE report_id=p_report_id AND status='reported' AND COALESCE(week_unique,0) >= 500)
  );
$$;

CREATE OR REPLACE FUNCTION public.report_exposure_coverage(p_weekly_report_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from DATE;
  v_to DATE;
  v_targets_total INT;
  v_targets_with_data INT;
BEGIN
  SELECT date_from::date, date_to::date INTO v_from, v_to
  FROM public.weekly_reports
  WHERE id = p_weekly_report_id;

  IF v_from IS NULL OR v_to IS NULL THEN
    RETURN jsonb_build_object('targets_total', 0, 'targets_with_data', 0);
  END IF;

  SELECT COUNT(*)::int INTO v_targets_total
  FROM public.discovery_exposure_targets;

  SELECT COUNT(DISTINCT r.target_id)::int INTO v_targets_with_data
  FROM public.discovery_exposure_rollup_daily r
  WHERE r.date >= v_from AND r.date < v_to;

  RETURN jsonb_build_object(
    'date_from', v_from,
    'date_to', v_to,
    'targets_total', COALESCE(v_targets_total,0),
    'targets_with_data', COALESCE(v_targets_with_data,0)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.discovery_exposure_top_panels(
  p_date_from DATE,
  p_date_to DATE,
  p_limit INT DEFAULT 20
)
RETURNS TABLE (
  target_id UUID,
  surface_name TEXT,
  panel_name TEXT,
  minutes_exposed BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    r.target_id,
    r.surface_name,
    r.panel_name,
    SUM(r.minutes_exposed)::bigint AS minutes_exposed
  FROM public.discovery_exposure_rollup_daily r
  WHERE r.date >= p_date_from AND r.date < p_date_to
  GROUP BY r.target_id, r.surface_name, r.panel_name
  ORDER BY SUM(r.minutes_exposed) DESC NULLS LAST
  LIMIT GREATEST(p_limit, 1);
$$;

CREATE OR REPLACE FUNCTION public.discovery_exposure_breadth_top(
  p_date_from DATE,
  p_date_to DATE,
  p_limit INT DEFAULT 20
)
RETURNS TABLE (
  link_code TEXT,
  link_code_type TEXT,
  panels_distinct INT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    r.link_code,
    r.link_code_type,
    COUNT(DISTINCT r.panel_name)::int AS panels_distinct
  FROM public.discovery_exposure_rollup_daily r
  WHERE r.date >= p_date_from AND r.date < p_date_to
  GROUP BY r.link_code, r.link_code_type
  ORDER BY COUNT(DISTINCT r.panel_name) DESC NULLS LAST
  LIMIT GREATEST(p_limit, 1);
$$;

-- 4) compute_discovery_public_intel (final override w/ image_url)
CREATE OR REPLACE FUNCTION public.compute_discovery_public_intel(p_as_of TIMESTAMPTZ DEFAULT now())
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_as_of TIMESTAMPTZ := COALESCE(p_as_of, now());
  v_premium_rows INT := 0;
  v_emerging_rows INT := 0;
  v_pollution_rows INT := 0;
BEGIN
  IF (auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  PERFORM set_config('statement_timeout', '30s', true);
  PERFORM set_config('lock_timeout', '2s', true);

  TRUNCATE TABLE public.discovery_public_premium_now;
  TRUNCATE TABLE public.discovery_public_emerging_now;
  TRUNCATE TABLE public.discovery_public_pollution_creators_now;

  -- Premium "now" (Tier 1 panels, open rank segments)
  INSERT INTO public.discovery_public_premium_now (
    as_of, region, surface_name, panel_name, panel_display_name, panel_type,
    rank, link_code, link_code_type, ccu, title, creator_code, image_url
  )
  SELECT
    v_as_of,
    t.region,
    t.surface_name,
    s.panel_name,
    s.panel_display_name,
    s.panel_type,
    s.rank,
    s.link_code,
    s.link_code_type,
    COALESCE(s.ccu_end, s.ccu_max, s.ccu_start) AS ccu,
    COALESCE(m.title, c.title) AS title,
    COALESCE(m.support_code, c.creator_code) AS creator_code,
    m.image_url AS image_url
  FROM public.discovery_exposure_rank_segments s
  JOIN public.discovery_exposure_targets t ON t.id = s.target_id
  JOIN public.discovery_panel_tiers pt ON pt.panel_name = s.panel_name AND pt.tier = 1
  LEFT JOIN public.discover_link_metadata m ON m.link_code = s.link_code
  LEFT JOIN public.discover_islands_cache c
    ON c.island_code = s.link_code AND s.link_code_type = 'island'
  WHERE s.end_ts IS NULL;
  GET DIAGNOSTICS v_premium_rows = ROW_COUNT;

  -- Emerging "now"
  WITH candidates AS (
    SELECT
      ls.target_id,
      t.region,
      t.surface_name,
      ls.link_code,
      ls.link_code_type,
      ls.first_seen_at
    FROM public.discovery_exposure_link_state ls
    JOIN public.discovery_exposure_targets t ON t.id = ls.target_id
    WHERE ls.first_seen_at >= v_as_of - interval '24 hours'
      AND ls.link_code_type = 'island'
  ),
  seg_24h AS (
    SELECT
      c.target_id,
      c.region,
      c.surface_name,
      c.link_code,
      MIN(c.first_seen_at) AS first_seen_at,
      SUM(
        GREATEST(
          0,
          EXTRACT(epoch FROM (LEAST(COALESCE(s.end_ts, v_as_of), v_as_of) - GREATEST(s.start_ts, v_as_of - interval '24 hours')))
        ) / 60
      )::int AS minutes_24h,
      SUM(
        GREATEST(
          0,
          EXTRACT(epoch FROM (LEAST(COALESCE(s.end_ts, v_as_of), v_as_of) - GREATEST(s.start_ts, v_as_of - interval '6 hours')))
        ) / 60
      )::int AS minutes_6h,
      MIN(s.best_rank)::int AS best_rank_24h,
      COUNT(DISTINCT s.panel_name)::int AS panels_24h,
      COUNT(DISTINCT CASE WHEN pt.tier = 1 THEN s.panel_name END)::int AS premium_panels_24h
    FROM candidates c
    JOIN public.discovery_exposure_presence_segments s
      ON s.target_id = c.target_id AND s.link_code = c.link_code
    LEFT JOIN public.discovery_panel_tiers pt ON pt.panel_name = s.panel_name
    WHERE s.last_seen_ts >= v_as_of - interval '24 hours'
    GROUP BY c.target_id, c.region, c.surface_name, c.link_code
  ),
  churn AS (
    SELECT
      e.target_id,
      e.link_code,
      COUNT(*) FILTER (WHERE e.event_type = 'enter')::int AS reentries_24h
    FROM public.discovery_exposure_presence_events e
    WHERE e.ts >= v_as_of - interval '24 hours'
    GROUP BY e.target_id, e.link_code
  ),
  scored AS (
    SELECT
      s.target_id,
      s.region,
      s.surface_name,
      s.link_code,
      'island'::text AS link_code_type,
      s.first_seen_at,
      s.minutes_6h,
      s.minutes_24h,
      s.best_rank_24h,
      s.panels_24h,
      s.premium_panels_24h,
      COALESCE(c.reentries_24h, 0) AS reentries_24h,
      (
        s.minutes_24h
        + (s.premium_panels_24h * 30)
        + (CASE WHEN s.best_rank_24h IS NULL THEN 0 ELSE (100.0 / GREATEST(1, s.best_rank_24h)) END)
        + (COALESCE(c.reentries_24h, 0) * 5)
      )::double precision AS score
    FROM seg_24h s
    LEFT JOIN churn c ON c.target_id = s.target_id AND c.link_code = s.link_code
  )
  INSERT INTO public.discovery_public_emerging_now (
    as_of, region, surface_name, link_code, link_code_type,
    first_seen_at, minutes_6h, minutes_24h, best_rank_24h, panels_24h,
    premium_panels_24h, reentries_24h, score, title, creator_code, image_url
  )
  SELECT
    v_as_of,
    s.region,
    s.surface_name,
    s.link_code,
    s.link_code_type,
    s.first_seen_at,
    s.minutes_6h,
    s.minutes_24h,
    s.best_rank_24h,
    s.panels_24h,
    s.premium_panels_24h,
    s.reentries_24h,
    s.score,
    COALESCE(m.title, c.title) AS title,
    COALESCE(m.support_code, c.creator_code) AS creator_code,
    m.image_url AS image_url
  FROM scored s
  LEFT JOIN public.discover_link_metadata m ON m.link_code = s.link_code
  LEFT JOIN public.discover_islands_cache c ON c.island_code = s.link_code
  ORDER BY s.score DESC
  LIMIT 200;
  GET DIAGNOSTICS v_emerging_rows = ROW_COUNT;

  -- Pollution creators
  WITH recent AS (
    SELECT
      ps.link_code,
      COALESCE(m.support_code, c.creator_code) AS creator_code,
      COALESCE(m.title, c.title) AS title,
      m.image_url AS image_url
    FROM public.discovery_exposure_presence_segments ps
    JOIN public.discovery_exposure_targets t ON t.id = ps.target_id
    LEFT JOIN public.discover_link_metadata m ON m.link_code = ps.link_code
    LEFT JOIN public.discover_islands_cache c ON c.island_code = ps.link_code
    WHERE ps.start_ts >= v_as_of - interval '7 days'
      AND ps.link_code_type = 'island'
      AND t.last_ok_tick_at IS NOT NULL
  ),
  keyed AS (
    SELECT
      creator_code,
      normalize_island_title_for_dup(title) AS norm_title,
      image_url,
      link_code,
      title
    FROM recent
    WHERE creator_code IS NOT NULL
  ),
  clusters AS (
    SELECT
      creator_code,
      norm_title,
      image_url,
      COUNT(DISTINCT link_code)::int AS islands
    FROM keyed
    WHERE norm_title IS NOT NULL
    GROUP BY creator_code, norm_title, image_url
    HAVING COUNT(DISTINCT link_code) >= 2
  ),
  per_creator AS (
    SELECT
      creator_code,
      COUNT(*)::int AS duplicate_clusters_7d,
      SUM(islands)::int AS duplicate_islands_7d,
      SUM(GREATEST(0, islands - 2))::int AS duplicates_over_min,
      (
        COUNT(*) * 2.0
        + SUM(islands) * 1.0
        + SUM(GREATEST(0, islands - 2)) * 1.5
      )::double precision AS spam_score
    FROM clusters
    GROUP BY creator_code
    ORDER BY spam_score DESC
    LIMIT 200
  )
  INSERT INTO public.discovery_public_pollution_creators_now (
    as_of, creator_code, duplicate_clusters_7d, duplicate_islands_7d, duplicates_over_min, spam_score, sample_titles
  )
  SELECT
    v_as_of,
    p.creator_code,
    p.duplicate_clusters_7d,
    p.duplicate_islands_7d,
    p.duplicates_over_min,
    p.spam_score,
    (
      SELECT array_agg(DISTINCT k.title ORDER BY k.title) FILTER (WHERE k.title IS NOT NULL)
      FROM keyed k
      WHERE k.creator_code = p.creator_code
      LIMIT 10
    ) AS sample_titles
  FROM per_creator p;
  GET DIAGNOSTICS v_pollution_rows = ROW_COUNT;

  RETURN jsonb_build_object(
    'as_of', v_as_of,
    'premium_rows', v_premium_rows,
    'emerging_rows', v_emerging_rows,
    'pollution_rows', v_pollution_rows
  );
END;
$$;

-- 5) system alerts compute
CREATE OR REPLACE FUNCTION public.compute_system_alerts()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exposure_stale INT := 0;
  v_meta_due INT := 0;
  v_intel_age_seconds INT := NULL;
  v_intel_as_of TIMESTAMPTZ := NULL;
BEGIN
  IF (auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT COUNT(*)::int
  INTO v_exposure_stale
  FROM public.discovery_exposure_targets t
  WHERE t.last_ok_tick_at IS NULL
     OR t.last_ok_tick_at < now() - make_interval(mins => GREATEST(1, (t.interval_minutes * 2)));

  SELECT COUNT(*)::int
  INTO v_meta_due
  FROM public.discover_link_metadata m
  WHERE m.next_due_at <= now()
    AND (m.locked_at IS NULL OR m.locked_at < now() - interval '5 minutes');

  SELECT MAX(as_of) INTO v_intel_as_of FROM public.discovery_public_premium_now;
  IF v_intel_as_of IS NOT NULL THEN
    v_intel_age_seconds := EXTRACT(epoch FROM (now() - v_intel_as_of))::int;
  END IF;

  INSERT INTO public.system_alerts_current(alert_key, severity, message, details, updated_at)
  VALUES
    (
      'exposure_stale',
      CASE WHEN v_exposure_stale = 0 THEN 'ok' WHEN v_exposure_stale <= 1 THEN 'warn' ELSE 'error' END,
      CASE WHEN v_exposure_stale = 0 THEN 'Exposure OK' ELSE 'Exposure stale targets detected' END,
      jsonb_build_object('stale_targets', v_exposure_stale),
      now()
    ),
    (
      'metadata_backlog',
      CASE WHEN v_meta_due < 500 THEN 'ok' WHEN v_meta_due < 5000 THEN 'warn' ELSE 'error' END,
      CASE WHEN v_meta_due < 500 THEN 'Metadata backlog OK' ELSE 'Metadata backlog growing' END,
      jsonb_build_object('due_now', v_meta_due),
      now()
    ),
    (
      'intel_freshness',
      CASE
        WHEN v_intel_as_of IS NULL THEN 'warn'
        WHEN v_intel_age_seconds <= 600 THEN 'ok'
        WHEN v_intel_age_seconds <= 1800 THEN 'warn'
        ELSE 'error'
      END,
      CASE
        WHEN v_intel_as_of IS NULL THEN 'Intel has not run yet'
        ELSE 'Intel freshness'
      END,
      jsonb_build_object('as_of', v_intel_as_of, 'age_seconds', v_intel_age_seconds),
      now()
    )
  ON CONFLICT (alert_key) DO UPDATE
  SET severity = EXCLUDED.severity,
      message = EXCLUDED.message,
      details = EXCLUDED.details,
      updated_at = EXCLUDED.updated_at;

  RETURN jsonb_build_object(
    'exposure_stale_targets', v_exposure_stale,
    'metadata_due_now', v_meta_due,
    'intel_as_of', v_intel_as_of,
    'intel_age_seconds', v_intel_age_seconds
  );
END;
$$;

-- ===========================
-- POLICIES
-- ===========================

-- RLS for rebuild runs
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='discover_report_rebuild_runs'
      AND policyname='select_rebuild_runs_authenticated'
  ) THEN
    CREATE POLICY select_rebuild_runs_authenticated
      ON public.discover_report_rebuild_runs FOR SELECT
      TO authenticated
      USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='discover_report_rebuild_runs'
      AND policyname='all_rebuild_runs_service_role'
  ) THEN
    CREATE POLICY all_rebuild_runs_service_role
      ON public.discover_report_rebuild_runs FOR ALL
      TO public
      USING ((auth.jwt() ->> 'role') = 'service_role')
      WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');
  END IF;
END $$;

-- RLS for system_alerts_current
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='system_alerts_current'
      AND policyname='select_system_alerts_authenticated'
  ) THEN
    CREATE POLICY select_system_alerts_authenticated
      ON public.system_alerts_current FOR SELECT
      TO authenticated
      USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='system_alerts_current'
      AND policyname='all_system_alerts_service_role'
  ) THEN
    CREATE POLICY all_system_alerts_service_role
      ON public.system_alerts_current FOR ALL
      TO public
      USING ((auth.jwt() ->> 'role') = 'service_role')
      WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');
  END IF;
END $$;

-- Cleanup helper: link metadata events retention (default 90 days)
CREATE OR REPLACE FUNCTION public.cleanup_discover_link_metadata_events(
  p_days integer DEFAULT 90,
  p_delete_batch integer DEFAULT 200000
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_deleted int := 0;
BEGIN
  IF (auth.jwt()->>'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  WITH todel AS (
    SELECT id
    FROM public.discover_link_metadata_events
    WHERE created_at < now() - make_interval(days => GREATEST(p_days,1))
    ORDER BY created_at ASC
    LIMIT GREATEST(p_delete_batch,1)
  )
  DELETE FROM public.discover_link_metadata_events e
  USING todel d
  WHERE e.id = d.id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN jsonb_build_object('deleted', v_deleted, 'days', p_days);
END;
$function$;
