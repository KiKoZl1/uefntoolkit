
-- Allow admins to manage panel tiers
CREATE POLICY "admin_manage_panel_tiers"
ON public.discovery_panel_tiers
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Also allow service role
CREATE POLICY "service_role_manage_panel_tiers"
ON public.discovery_panel_tiers
FOR ALL
USING ((auth.jwt() ->> 'role') = 'service_role')
WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

-- Helper function to get panel display name
CREATE OR REPLACE FUNCTION public.get_panel_display_name(p_panel_name text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT label FROM discovery_panel_tiers WHERE panel_name = p_panel_name LIMIT 1),
    -- Auto-clean common patterns
    CASE
      WHEN p_panel_name LIKE 'Nested_%' THEN
        REPLACE(SUBSTRING(p_panel_name FROM 8), '_', ' ')
      WHEN p_panel_name LIKE 'ForYou_%' THEN 'For You'
      WHEN p_panel_name LIKE 'Browse_%' THEN
        REPLACE(SUBSTRING(p_panel_name FROM 8), '_', ' ')
      WHEN p_panel_name LIKE 'GameCollections_%' THEN
        'Game Collections ' || REPLACE(SUBSTRING(p_panel_name FROM 17), '_', ' ')
      ELSE REPLACE(REPLACE(p_panel_name, '_', ' '), 'Default', '')
    END
  );
$$;

-- Update report_finalize_exposure_analysis to filter Browse and use labels
CREATE OR REPLACE FUNCTION public.report_finalize_exposure_analysis(p_report_id text, p_days int DEFAULT 7)
RETURNS json
LANGUAGE plpgsql
SET search_path = public
SET statement_timeout = '120s'
AS $$
DECLARE
  v_week_start date;
  v_week_end   date;
  v_result     json;
BEGIN
  SELECT week_start, week_end INTO v_week_start, v_week_end
  FROM discover_reports WHERE id = p_report_id::uuid;
  IF v_week_start IS NULL THEN
    RETURN json_build_object('error', 'report not found');
  END IF;

  WITH rollup AS (
    SELECT
      r.link_code,
      r.link_code_type,
      COUNT(DISTINCT r.panel_name) AS panels_distinct,
      SUM(r.minutes_exposed) AS total_minutes,
      SUM(r.appearances) AS total_appearances,
      MIN(r.best_rank) AS best_rank
    FROM discovery_exposure_rollup_daily r
    WHERE r.date >= v_week_start::text::date
      AND r.date < v_week_end::text::date
      AND r.panel_name NOT LIKE 'Browse%'
    GROUP BY r.link_code, r.link_code_type
  ),
  multi_panel AS (
    SELECT
      ro.link_code,
      ro.link_code_type,
      ro.panels_distinct,
      ro.total_minutes,
      ro.total_appearances,
      ro.best_rank,
      COALESCE(dlm.title, dic.title, ro.link_code) AS title,
      COALESCE(dlm.support_code, dic.creator_code) AS creator_code,
      COALESCE(dlm.image_url, dic.image_url) AS image_url,
      (
        SELECT json_agg(sub ORDER BY sub.minutes DESC)
        FROM (
          SELECT
            public.get_panel_display_name(rd.panel_name) AS panel,
            rd.panel_name AS panel_raw,
            SUM(rd.minutes_exposed) AS minutes,
            SUM(rd.appearances) AS appearances,
            MIN(rd.best_rank) AS best_rank
          FROM discovery_exposure_rollup_daily rd
          WHERE rd.link_code = ro.link_code
            AND rd.date >= v_week_start::text::date
            AND rd.date < v_week_end::text::date
            AND rd.panel_name NOT LIKE 'Browse%'
          GROUP BY rd.panel_name
        ) sub
      ) AS panel_breakdown
    FROM rollup ro
    LEFT JOIN discover_link_metadata dlm ON dlm.link_code = ro.link_code
    LEFT JOIN discover_islands_cache dic ON dic.island_code = ro.link_code
    ORDER BY ro.panels_distinct DESC, ro.total_minutes DESC
    LIMIT 20
  ),
  loyalty AS (
    SELECT
      r.link_code,
      r.link_code_type,
      r.panel_name,
      public.get_panel_display_name(r.panel_name) AS panel_display,
      SUM(r.minutes_exposed) AS total_minutes_in_panel,
      SUM(r.appearances) AS total_appearances,
      MIN(r.best_rank) AS best_rank,
      COALESCE(dlm.title, dic.title, r.link_code) AS title,
      COALESCE(dlm.support_code, dic.creator_code) AS creator_code,
      COALESCE(dlm.image_url, dic.image_url) AS image_url
    FROM discovery_exposure_rollup_daily r
    LEFT JOIN discover_link_metadata dlm ON dlm.link_code = r.link_code
    LEFT JOIN discover_islands_cache dic ON dic.island_code = r.link_code
    WHERE r.date >= v_week_start::text::date
      AND r.date < v_week_end::text::date
      AND r.panel_name NOT LIKE 'Browse%'
    GROUP BY r.link_code, r.link_code_type, r.panel_name, dlm.title, dic.title, dlm.support_code, dic.creator_code, dlm.image_url, dic.image_url
    ORDER BY total_minutes_in_panel DESC
    LIMIT 20
  )
  SELECT json_build_object(
    'multiPanelPresence', (SELECT COALESCE(json_agg(row_to_json(mp)), '[]'::json) FROM multi_panel mp),
    'panelLoyalty', (SELECT COALESCE(json_agg(row_to_json(l)), '[]'::json) FROM loyalty l)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- Update report_finalize_exposure_efficiency to filter Browse and use labels
CREATE OR REPLACE FUNCTION public.report_finalize_exposure_efficiency(p_report_id text, p_limit int DEFAULT 10)
RETURNS json
LANGUAGE plpgsql
SET search_path = public
SET statement_timeout = '120s'
AS $$
DECLARE
  v_week_start date;
  v_week_end   date;
  v_result     json;
BEGIN
  SELECT week_start, week_end INTO v_week_start, v_week_end
  FROM discover_reports WHERE id = p_report_id::uuid;
  IF v_week_start IS NULL THEN
    RETURN json_build_object('error','report not found');
  END IF;

  WITH exposure AS (
    SELECT
      r.link_code,
      SUM(r.minutes_exposed)  AS total_minutes_exposed,
      COUNT(DISTINCT r.panel_name) AS distinct_panels,
      SUM(r.appearances) AS total_appearances
    FROM discovery_exposure_rollup_daily r
    WHERE r.date >= v_week_start::text::date
      AND r.date < v_week_end::text::date
      AND r.panel_name NOT LIKE 'Browse%'
    GROUP BY r.link_code
    HAVING SUM(r.minutes_exposed) > 0
  ),
  panel_detail AS (
    SELECT
      r.link_code,
      public.get_panel_display_name(r.panel_name) AS panel_name,
      r.panel_name AS panel_raw,
      SUM(r.minutes_exposed) AS minutes,
      SUM(r.appearances) AS appearances,
      MIN(r.best_rank) AS best_rank
    FROM discovery_exposure_rollup_daily r
    WHERE r.date >= v_week_start::text::date
      AND r.date < v_week_end::text::date
      AND r.panel_name NOT LIKE 'Browse%'
    GROUP BY r.link_code, r.panel_name
  ),
  panel_breakdown_json AS (
    SELECT link_code, json_agg(
      json_build_object('panel', panel_name, 'panel_raw', panel_raw, 'minutes', minutes, 'appearances', appearances, 'best_rank', best_rank)
      ORDER BY minutes DESC
    ) AS panel_breakdown
    FROM panel_detail
    GROUP BY link_code
  ),
  joined AS (
    SELECT
      e.link_code,
      COALESCE(dlm.title, dic.title, e.link_code) AS title,
      COALESCE(dlm.support_code, dic.creator_code) AS creator_code,
      COALESCE(dlm.image_url, dic.image_url) AS image_url,
      e.total_minutes_exposed,
      e.distinct_panels,
      e.total_appearances,
      COALESCE(dri.week_plays, 0) AS week_plays,
      CASE WHEN e.total_minutes_exposed > 0
        THEN ROUND(COALESCE(dri.week_plays,0)::numeric / e.total_minutes_exposed, 2)
        ELSE 0 END AS plays_per_min_exposed,
      pb.panel_breakdown
    FROM exposure e
    LEFT JOIN discover_link_metadata dlm ON dlm.link_code = e.link_code
    LEFT JOIN discover_islands_cache dic ON dic.island_code = e.link_code
    LEFT JOIN discover_report_islands dri ON dri.report_id = p_report_id::uuid AND dri.island_code = e.link_code
    LEFT JOIN panel_breakdown_json pb ON pb.link_code = e.link_code
  ),
  stats AS (
    SELECT
      COUNT(*) AS total_islands_with_exposure,
      ROUND(AVG(plays_per_min_exposed)::numeric, 2) AS avg_plays_per_min,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY plays_per_min_exposed) AS median_plays_per_min
    FROM joined
  )
  SELECT json_build_object(
    'topExposureEfficiency', (SELECT COALESCE(json_agg(row_to_json(j)), '[]'::json) FROM (SELECT * FROM joined ORDER BY plays_per_min_exposed DESC LIMIT p_limit) j),
    'worstExposureEfficiency', (SELECT COALESCE(json_agg(row_to_json(j)), '[]'::json) FROM (SELECT * FROM joined WHERE week_plays > 0 ORDER BY plays_per_min_exposed ASC LIMIT p_limit) j),
    'exposureEfficiencyStats', (SELECT row_to_json(s) FROM stats s)
  ) INTO v_result;

  RETURN v_result;
END;
$$;
