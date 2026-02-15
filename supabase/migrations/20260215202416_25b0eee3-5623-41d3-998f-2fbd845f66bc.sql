
-- =============================================
-- Migration: discover_link_metadata + RPCs + cron + intel update + rebuild helpers
-- =============================================

-- 1) discover_link_metadata table
CREATE TABLE IF NOT EXISTS public.discover_link_metadata (
  link_code TEXT PRIMARY KEY,
  link_code_type TEXT NOT NULL DEFAULT 'island',
  namespace TEXT,
  link_type TEXT,
  account_id TEXT,
  creator_name TEXT,
  support_code TEXT,
  title TEXT,
  tagline TEXT,
  introduction TEXT,
  locale TEXT,
  image_url TEXT,
  image_urls JSONB,
  extra_image_urls JSONB,
  video_vuid TEXT,
  max_players INT,
  min_players INT,
  max_social_party_size INT,
  ratings JSONB,
  version INT,
  created_at_epic TIMESTAMPTZ,
  published_at_epic TIMESTAMPTZ,
  updated_at_epic TIMESTAMPTZ,
  last_activated_at_epic TIMESTAMPTZ,
  moderation_status TEXT,
  link_state TEXT,
  discovery_intent TEXT,
  active BOOLEAN,
  disabled BOOLEAN,
  raw JSONB,
  last_fetched_at TIMESTAMPTZ,
  next_due_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error TEXT,
  locked_at TIMESTAMPTZ,
  lock_id UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.discover_link_metadata ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage link metadata"
  ON public.discover_link_metadata FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role')
  WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

CREATE POLICY "Authenticated can view link metadata"
  ON public.discover_link_metadata FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_link_metadata_next_due ON public.discover_link_metadata (next_due_at ASC) WHERE locked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_link_metadata_title ON public.discover_link_metadata (link_code) WHERE title IS NOT NULL;

-- 2) discover_link_metadata_events table
CREATE TABLE IF NOT EXISTS public.discover_link_metadata_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  link_code TEXT NOT NULL,
  event_type TEXT NOT NULL,
  old_value JSONB,
  new_value JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.discover_link_metadata_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage link metadata events"
  ON public.discover_link_metadata_events FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role')
  WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

CREATE POLICY "Authenticated can view link metadata events"
  ON public.discover_link_metadata_events FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_link_metadata_events_code ON public.discover_link_metadata_events (link_code, created_at DESC);

-- 3) RPC: enqueue_discover_link_metadata
CREATE OR REPLACE FUNCTION public.enqueue_discover_link_metadata(p_link_codes TEXT[])
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_count INT := 0;
BEGIN
  INSERT INTO public.discover_link_metadata (link_code, link_code_type, next_due_at)
  SELECT unnest(p_link_codes),
         CASE WHEN unnest(p_link_codes) ~ '^\d{4}-\d{4}-\d{4}$' THEN 'island' ELSE 'collection' END,
         now()
  ON CONFLICT (link_code) DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- 4) RPC: claim_discover_link_metadata
CREATE OR REPLACE FUNCTION public.claim_discover_link_metadata(p_take INT DEFAULT 100, p_stale_after_seconds INT DEFAULT 180)
RETURNS TABLE(link_code TEXT, lock_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_lock UUID := gen_random_uuid();
BEGIN
  -- Unstale stuck rows
  UPDATE public.discover_link_metadata
  SET locked_at = NULL, lock_id = NULL
  WHERE locked_at IS NOT NULL
    AND locked_at < now() - make_interval(secs => GREATEST(p_stale_after_seconds, 60));

  RETURN QUERY
  WITH picked AS (
    SELECT m.link_code
    FROM public.discover_link_metadata m
    WHERE m.next_due_at <= now()
      AND m.locked_at IS NULL
    ORDER BY m.next_due_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT GREATEST(p_take, 1)
  )
  UPDATE public.discover_link_metadata m
  SET locked_at = now(), lock_id = v_lock
  FROM picked p
  WHERE m.link_code = p.link_code
  RETURNING m.link_code, v_lock;
END;
$$;

-- 5) Update compute_discovery_public_intel to use discover_link_metadata
CREATE OR REPLACE FUNCTION public.compute_discovery_public_intel(p_as_of timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '30s'
SET lock_timeout TO '2s'
AS $$
DECLARE v_premium INT:=0; v_emerging INT:=0; v_pollution INT:=0;
BEGIN
  IF (auth.jwt()->>'role') IS DISTINCT FROM 'service_role' 
     AND current_user NOT IN ('postgres', 'supabase_admin') THEN 
    RAISE EXCEPTION 'forbidden'; 
  END IF;

  TRUNCATE discovery_public_premium_now;
  INSERT INTO discovery_public_premium_now(as_of,region,surface_name,panel_name,panel_display_name,panel_type,link_code,link_code_type,rank,ccu,title,creator_code)
  SELECT DISTINCT ON (t.region, ps.surface_name, ps.panel_name, COALESCE(ps.best_rank,999))
    p_as_of,t.region,ps.surface_name,ps.panel_name,ps.panel_display_name,ps.panel_type,ps.link_code,ps.link_code_type,
    COALESCE(ps.best_rank,999),ps.ccu_end,
    COALESCE(lm.title, c.title),
    COALESCE(lm.creator_name, lm.support_code, c.creator_code)
  FROM discovery_exposure_presence_segments ps
  JOIN discovery_exposure_targets t ON t.id=ps.target_id
  JOIN discovery_panel_tiers pt ON pt.panel_name=ps.panel_name AND pt.tier=1
  LEFT JOIN discover_link_metadata lm ON lm.link_code=ps.link_code
  LEFT JOIN discover_islands_cache c ON c.island_code=ps.link_code
  WHERE ps.end_ts IS NULL AND t.last_ok_tick_at IS NOT NULL
  ORDER BY t.region, ps.surface_name, ps.panel_name, COALESCE(ps.best_rank,999), ps.ccu_end DESC NULLS LAST;
  GET DIAGNOSTICS v_premium=ROW_COUNT;

  TRUNCATE discovery_public_emerging_now;
  INSERT INTO discovery_public_emerging_now(as_of,region,surface_name,link_code,link_code_type,first_seen_at,panels_24h,premium_panels_24h,minutes_24h,minutes_6h,best_rank_24h,reentries_24h,score,title,creator_code)
  SELECT p_as_of,t.region,ps.surface_name,ps.link_code,MAX(ps.link_code_type),MIN(ps.start_ts),
    COUNT(DISTINCT ps.panel_name)::int,
    COUNT(DISTINCT CASE WHEN pt.tier=1 THEN ps.panel_name END)::int,
    COALESCE(SUM(EXTRACT(EPOCH FROM(COALESCE(ps.end_ts,p_as_of)-ps.start_ts))/60.0)::int,0),
    COALESCE(SUM(CASE WHEN ps.start_ts>=p_as_of-interval'6h' THEN EXTRACT(EPOCH FROM(COALESCE(ps.end_ts,p_as_of)-ps.start_ts))/60.0 ELSE 0 END)::int,0),
    MIN(ps.best_rank),
    COUNT(*)::int,
    (COUNT(DISTINCT ps.panel_name)*10+COUNT(DISTINCT CASE WHEN pt.tier=1 THEN ps.panel_name END)*50+COALESCE(SUM(EXTRACT(EPOCH FROM(COALESCE(ps.end_ts,p_as_of)-ps.start_ts))/60.0),0))::float8,
    MAX(COALESCE(lm.title, c.title)),
    MAX(COALESCE(lm.creator_name, lm.support_code, c.creator_code))
  FROM discovery_exposure_presence_segments ps
  JOIN discovery_exposure_targets t ON t.id=ps.target_id
  LEFT JOIN discovery_panel_tiers pt ON pt.panel_name=ps.panel_name
  LEFT JOIN discover_link_metadata lm ON lm.link_code=ps.link_code
  LEFT JOIN discover_islands_cache c ON c.island_code=ps.link_code
  WHERE ps.start_ts>=p_as_of-interval'24h' AND ps.link_code_type='island' AND t.last_ok_tick_at IS NOT NULL
  GROUP BY t.region,ps.surface_name,ps.link_code
  HAVING MIN(ps.start_ts)>=p_as_of-interval'24h';
  GET DIAGNOSTICS v_emerging=ROW_COUNT;

  TRUNCATE discovery_public_pollution_creators_now;
  WITH ip AS(
    SELECT c.creator_code,ps.link_code,COALESCE(lm.title, c.title) AS title,ps.panel_name 
    FROM discovery_exposure_presence_segments ps 
    JOIN discover_islands_cache c ON c.island_code=ps.link_code 
    LEFT JOIN discover_link_metadata lm ON lm.link_code=ps.link_code
    JOIN discovery_exposure_targets t ON t.id=ps.target_id 
    WHERE ps.start_ts>=p_as_of-interval'7d' AND ps.link_code_type='island' AND c.creator_code IS NOT NULL AND t.last_ok_tick_at IS NOT NULL
  ),
  cs AS(
    SELECT creator_code,COUNT(DISTINCT link_code)::int ti,COUNT(DISTINCT panel_name)::int tp,
           array_agg(DISTINCT title ORDER BY title)FILTER(WHERE title IS NOT NULL)tt 
    FROM ip GROUP BY creator_code HAVING COUNT(DISTINCT link_code)>=3
  )
  INSERT INTO discovery_public_pollution_creators_now(as_of,creator_code,duplicate_islands_7d,duplicate_clusters_7d,duplicates_over_min,spam_score,sample_titles)
  SELECT p_as_of,cs.creator_code,cs.ti,GREATEST(cs.ti/3,1),GREATEST(cs.ti-2,0),(cs.ti*cs.tp)::float8,cs.tt[1:5] 
  FROM cs WHERE cs.ti>=5 ORDER BY(cs.ti*cs.tp)DESC LIMIT 50;
  GET DIAGNOSTICS v_pollution=ROW_COUNT;

  RETURN jsonb_build_object('as_of',p_as_of,'premium_rows',v_premium,'emerging_rows',v_emerging,'pollution_rows',v_pollution);
END;
$$;

-- 6) Rebuild helper RPCs

CREATE OR REPLACE FUNCTION public.report_link_metadata_coverage(p_report_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  WITH codes AS (
    SELECT DISTINCT island_code FROM discover_report_islands WHERE report_id = p_report_id AND status = 'reported'
  ),
  matched AS (
    SELECT COUNT(*) FILTER (WHERE lm.title IS NOT NULL) AS with_title,
           COUNT(*) AS total
    FROM codes c
    LEFT JOIN discover_link_metadata lm ON lm.link_code = c.island_code
  )
  SELECT jsonb_build_object('total', total, 'withTitle', with_title, 'coverage', CASE WHEN total > 0 THEN ROUND(with_title::numeric / total * 100, 1) ELSE 0 END)
  FROM matched;
$$;

CREATE OR REPLACE FUNCTION public.report_new_islands_by_launch(p_report_id UUID, p_week_start DATE, p_week_end DATE, p_limit INT DEFAULT 10)
RETURNS TABLE(island_code TEXT, title TEXT, creator_code TEXT, category TEXT, week_plays INT, week_unique INT, published_at TIMESTAMPTZ)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT ri.island_code, COALESCE(lm.title, ri.title), COALESCE(lm.creator_name, ri.creator_code), ri.category,
         ri.week_plays, ri.week_unique, lm.published_at_epic
  FROM discover_report_islands ri
  LEFT JOIN discover_link_metadata lm ON lm.link_code = ri.island_code
  WHERE ri.report_id = p_report_id AND ri.status = 'reported'
    AND lm.published_at_epic IS NOT NULL
    AND lm.published_at_epic >= p_week_start::timestamptz
    AND lm.published_at_epic < (p_week_end + 1)::timestamptz
  ORDER BY ri.week_plays DESC NULLS LAST
  LIMIT GREATEST(p_limit, 1);
$$;

CREATE OR REPLACE FUNCTION public.report_new_islands_by_launch_count(p_report_id UUID, p_week_start DATE, p_week_end DATE)
RETURNS INT
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT COUNT(*)::int
  FROM discover_report_islands ri
  JOIN discover_link_metadata lm ON lm.link_code = ri.island_code
  WHERE ri.report_id = p_report_id AND ri.status = 'reported'
    AND lm.published_at_epic IS NOT NULL
    AND lm.published_at_epic >= p_week_start::timestamptz
    AND lm.published_at_epic < (p_week_end + 1)::timestamptz;
$$;

CREATE OR REPLACE FUNCTION public.report_most_updated_islands(p_report_id UUID, p_week_start DATE, p_week_end DATE, p_limit INT DEFAULT 10)
RETURNS TABLE(island_code TEXT, title TEXT, creator_code TEXT, category TEXT, week_plays INT, week_unique INT, updated_at_epic TIMESTAMPTZ)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT ri.island_code, COALESCE(lm.title, ri.title), COALESCE(lm.creator_name, ri.creator_code), ri.category,
         ri.week_plays, ri.week_unique, lm.updated_at_epic
  FROM discover_report_islands ri
  JOIN discover_link_metadata lm ON lm.link_code = ri.island_code
  WHERE ri.report_id = p_report_id AND ri.status = 'reported'
    AND lm.updated_at_epic IS NOT NULL
    AND lm.updated_at_epic >= p_week_start::timestamptz
    AND lm.updated_at_epic < (p_week_end + 1)::timestamptz
    AND (lm.published_at_epic IS NULL OR lm.published_at_epic < p_week_start::timestamptz)
  ORDER BY ri.week_plays DESC NULLS LAST
  LIMIT GREATEST(p_limit, 1);
$$;

CREATE OR REPLACE FUNCTION public.report_dead_islands_by_unique_drop(p_report_id UUID, p_prev_report_id UUID, p_limit INT DEFAULT 10)
RETURNS TABLE(island_code TEXT, title TEXT, creator_code TEXT, prev_unique INT, curr_unique INT, drop_pct FLOAT)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT
    ri.island_code,
    COALESCE(lm.title, ri.title),
    COALESCE(lm.creator_name, ri.creator_code),
    prev.week_unique AS prev_unique,
    ri.week_unique AS curr_unique,
    CASE WHEN prev.week_unique > 0 THEN ROUND(((ri.week_unique - prev.week_unique)::numeric / prev.week_unique * 100)::numeric, 1)::float ELSE 0 END AS drop_pct
  FROM discover_report_islands ri
  JOIN discover_report_islands prev ON prev.report_id = p_prev_report_id AND prev.island_code = ri.island_code AND prev.status = 'reported'
  LEFT JOIN discover_link_metadata lm ON lm.link_code = ri.island_code
  WHERE ri.report_id = p_report_id AND ri.status = 'reported'
    AND ri.week_unique < prev.week_unique
  ORDER BY (prev.week_unique - ri.week_unique) DESC
  LIMIT GREATEST(p_limit, 1);
$$;

-- 7) Cron job for metadata collector (1/min)
SELECT cron.schedule(
  'discover-links-metadata-orchestrate-minute',
  '* * * * *',
  $$
  SELECT net.http_post(
    url:='https://turezrchetxoluznjtdi.supabase.co/functions/v1/discover-links-metadata-collector',
    headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR1cmV6cmNoZXR4b2x1em5qdGRpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDc3ODU1MSwiZXhwIjoyMDg2MzU0NTUxfQ.SERVICE_ROLE_PLACEHOLDER"}'::jsonb,
    body:='{"mode":"orchestrate"}'::jsonb
  ) AS request_id;
  $$
);
