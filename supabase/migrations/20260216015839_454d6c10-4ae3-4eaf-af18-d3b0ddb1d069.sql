
CREATE OR REPLACE FUNCTION public.compute_discovery_public_intel(p_as_of TIMESTAMPTZ DEFAULT NULL)
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
  IF current_user NOT IN ('postgres', 'supabase_admin')
     AND (auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  PERFORM set_config('statement_timeout', '30s', true);
  PERFORM set_config('lock_timeout', '2s', true);

  TRUNCATE TABLE public.discovery_public_premium_now;
  TRUNCATE TABLE public.discovery_public_emerging_now;
  TRUNCATE TABLE public.discovery_public_pollution_creators_now;

  -- Premium "now"
  INSERT INTO public.discovery_public_premium_now (
    as_of, region, surface_name, panel_name, panel_display_name, panel_type,
    rank, link_code, link_code_type, ccu, title, creator_code, image_url
  )
  SELECT
    v_as_of, t.region, t.surface_name, s.panel_name, s.panel_display_name, s.panel_type,
    s.rank, s.link_code, s.link_code_type,
    COALESCE(s.ccu_end, s.ccu_max, s.ccu_start),
    COALESCE(m.title, c.title),
    COALESCE(m.support_code, c.creator_code),
    m.image_url
  FROM discovery_exposure_rank_segments s
  JOIN discovery_exposure_targets t ON t.id = s.target_id
  JOIN discovery_panel_tiers pt ON pt.panel_name = s.panel_name AND pt.tier = 1
  LEFT JOIN discover_link_metadata m ON m.link_code = s.link_code
  LEFT JOIN discover_islands_cache c ON c.island_code = s.link_code AND s.link_code_type = 'island'
  WHERE s.end_ts IS NULL;
  GET DIAGNOSTICS v_premium_rows = ROW_COUNT;

  -- Emerging "now"
  WITH candidates AS (
    SELECT ls.target_id, t.region, t.surface_name, ls.link_code, ls.link_code_type, ls.first_seen_at
    FROM discovery_exposure_link_state ls
    JOIN discovery_exposure_targets t ON t.id = ls.target_id
    WHERE ls.first_seen_at >= v_as_of - interval '24 hours' AND ls.link_code_type = 'island'
  ),
  seg_24h AS (
    SELECT c.target_id, c.region, c.surface_name, c.link_code,
      MIN(c.first_seen_at) AS first_seen_at,
      SUM(GREATEST(0, EXTRACT(epoch FROM (LEAST(COALESCE(s.end_ts, v_as_of), v_as_of) - GREATEST(s.start_ts, v_as_of - interval '24 hours'))) / 60))::int AS minutes_24h,
      SUM(GREATEST(0, EXTRACT(epoch FROM (LEAST(COALESCE(s.end_ts, v_as_of), v_as_of) - GREATEST(s.start_ts, v_as_of - interval '6 hours'))) / 60))::int AS minutes_6h,
      MIN(s.best_rank)::int AS best_rank_24h,
      COUNT(DISTINCT s.panel_name)::int AS panels_24h,
      COUNT(DISTINCT CASE WHEN pt.tier = 1 THEN s.panel_name END)::int AS premium_panels_24h
    FROM candidates c
    JOIN discovery_exposure_presence_segments s ON s.target_id = c.target_id AND s.link_code = c.link_code
    LEFT JOIN discovery_panel_tiers pt ON pt.panel_name = s.panel_name
    WHERE s.last_seen_ts >= v_as_of - interval '24 hours'
    GROUP BY c.target_id, c.region, c.surface_name, c.link_code
  ),
  churn AS (
    SELECT e.target_id, e.link_code, COUNT(*) FILTER (WHERE e.event_type = 'enter')::int AS reentries_24h
    FROM discovery_exposure_presence_events e
    WHERE e.ts >= v_as_of - interval '24 hours'
    GROUP BY e.target_id, e.link_code
  ),
  scored AS (
    SELECT s.target_id, s.region, s.surface_name, s.link_code, 'island'::text AS link_code_type,
      s.first_seen_at, s.minutes_6h, s.minutes_24h, s.best_rank_24h, s.panels_24h, s.premium_panels_24h,
      COALESCE(c.reentries_24h, 0) AS reentries_24h,
      (s.minutes_24h + (s.premium_panels_24h * 30) + (CASE WHEN s.best_rank_24h IS NULL THEN 0 ELSE (100.0 / GREATEST(1, s.best_rank_24h)) END) + (COALESCE(c.reentries_24h, 0) * 5))::double precision AS score
    FROM seg_24h s
    LEFT JOIN churn c ON c.target_id = s.target_id AND c.link_code = s.link_code
  )
  INSERT INTO discovery_public_emerging_now (
    as_of, region, surface_name, link_code, link_code_type, first_seen_at,
    minutes_6h, minutes_24h, best_rank_24h, panels_24h, premium_panels_24h,
    reentries_24h, score, title, creator_code, image_url
  )
  SELECT v_as_of, s.region, s.surface_name, s.link_code, s.link_code_type,
    s.first_seen_at, s.minutes_6h, s.minutes_24h, s.best_rank_24h, s.panels_24h,
    s.premium_panels_24h, s.reentries_24h, s.score,
    COALESCE(m.title, ic.title), COALESCE(m.support_code, ic.creator_code), m.image_url
  FROM scored s
  LEFT JOIN discover_link_metadata m ON m.link_code = s.link_code
  LEFT JOIN discover_islands_cache ic ON ic.island_code = s.link_code
  ORDER BY s.score DESC LIMIT 50;
  GET DIAGNOSTICS v_emerging_rows = ROW_COUNT;

  -- Pollution "now" (FIXED: qualified ambiguous column references)
  INSERT INTO discovery_public_pollution_creators_now (
    as_of, creator_code, duplicate_clusters_7d, duplicate_islands_7d,
    duplicates_over_min, spam_score, sample_titles
  )
  WITH dup_titles AS (
    SELECT ps.link_code,
      COALESCE(m.support_code, ic.creator_code, 'unknown') AS resolved_creator,
      COALESCE(m.title, ic.title) AS resolved_title,
      normalize_island_title_for_dup(COALESCE(m.title, ic.title)) AS norm_title
    FROM discovery_exposure_presence_segments ps
    LEFT JOIN discover_link_metadata m ON m.link_code = ps.link_code
    LEFT JOIN discover_islands_cache ic ON ic.island_code = ps.link_code AND ps.link_code_type = 'island'
    WHERE ps.start_ts >= v_as_of - interval '7 days' AND ps.link_code_type = 'island'
    GROUP BY ps.link_code, resolved_creator, resolved_title, norm_title
  ),
  clusters AS (
    SELECT resolved_creator, norm_title, COUNT(DISTINCT link_code) AS island_count,
      array_agg(DISTINCT resolved_title ORDER BY resolved_title) AS titles
    FROM dup_titles WHERE norm_title IS NOT NULL AND norm_title <> ''
    GROUP BY resolved_creator, norm_title HAVING COUNT(DISTINCT link_code) >= 2
  ),
  per_creator AS (
    SELECT resolved_creator AS creator_code, COUNT(*)::int AS duplicate_clusters_7d,
      SUM(island_count)::int AS duplicate_islands_7d,
      SUM(GREATEST(0, island_count - 2))::int AS duplicates_over_min,
      (SUM(island_count) * 10 + SUM(GREATEST(0, island_count - 2)) * 25)::double precision AS spam_score,
      (array_agg(titles[1] ORDER BY island_count DESC))[1:5] AS sample_titles
    FROM clusters GROUP BY resolved_creator
  )
  SELECT v_as_of, creator_code, duplicate_clusters_7d, duplicate_islands_7d,
    duplicates_over_min, spam_score, sample_titles
  FROM per_creator WHERE spam_score >= 20
  ORDER BY spam_score DESC LIMIT 30;
  GET DIAGNOSTICS v_pollution_rows = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'as_of', v_as_of, 'premium', v_premium_rows, 'emerging', v_emerging_rows, 'pollution', v_pollution_rows);
END;
$$;
