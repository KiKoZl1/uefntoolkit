
-- Fix 1: report_finalize_categories - normalize category casing
CREATE OR REPLACE FUNCTION public.report_finalize_categories(p_report_id uuid, p_limit int DEFAULT 15)
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH cat_agg AS (
    SELECT
      COALESCE(NULLIF(INITCAP(LOWER(category)), ''), 'Fortnite UGC') AS cat_name,
      SUM(COALESCE(week_plays, 0))::bigint AS total_plays,
      SUM(COALESCE(week_unique, 0))::bigint AS unique_players,
      SUM(COALESCE(week_minutes, 0))::bigint AS minutes_played,
      MAX(COALESCE(week_peak_ccu_max, 0))::int AS peak_ccu,
      COUNT(*)::int AS maps
    FROM discover_report_islands
    WHERE report_id = p_report_id AND status = 'reported'
    GROUP BY COALESCE(NULLIF(INITCAP(LOWER(category)), ''), 'Fortnite UGC')
  ),
  tag_agg AS (
    SELECT tag, COUNT(*)::int AS cnt
    FROM discover_report_islands,
         LATERAL jsonb_array_elements_text(COALESCE(tags, '[]'::jsonb)) AS tag
    WHERE report_id = p_report_id AND status = 'reported'
    GROUP BY tag
    ORDER BY cnt DESC
    LIMIT 20
  )
  SELECT jsonb_build_object(
    'categoryShare', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'name', cat_name, 'title', cat_name, 'category', cat_name,
      'totalPlays', total_plays, 'uniquePlayers', unique_players, 'maps', maps,
      'value', total_plays
    ) ORDER BY total_plays DESC), '[]') FROM cat_agg LIMIT p_limit),
    'categoryPopularity', (SELECT COALESCE(jsonb_object_agg(cat_name, maps), '{}') FROM (SELECT * FROM cat_agg ORDER BY maps DESC LIMIT 10) t),
    'topCategoriesByPlays', (SELECT COALESCE(jsonb_agg(jsonb_build_object('name', cat_name, 'value', total_plays) ORDER BY total_plays DESC), '[]') FROM cat_agg LIMIT p_limit),
    'topTags', (SELECT COALESCE(jsonb_agg(jsonb_build_object('name', tag, 'tag', tag, 'value', cnt, 'count', cnt)), '[]') FROM tag_agg)
  );
$$;

-- Fix 2: report_finalize_exposure_analysis - fix date type casting
CREATE OR REPLACE FUNCTION public.report_finalize_exposure_analysis(p_report_id uuid, p_days int DEFAULT 7)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SET search_path = public
AS $$
DECLARE
  result jsonb;
  v_week_start date;
  v_week_end date;
BEGIN
  SELECT week_start, week_end INTO v_week_start, v_week_end
  FROM discover_reports WHERE id = p_report_id;

  SELECT jsonb_build_object(
    'multiPanelPresence', (
      SELECT jsonb_agg(row_to_json(mp))
      FROM (
        SELECT
          r.link_code,
          r.link_code_type,
          COUNT(DISTINCT r.panel_name)::int AS panels_distinct,
          array_agg(DISTINCT r.panel_name ORDER BY r.panel_name) AS panel_names,
          COALESCE(dic.title, r.link_code) AS title,
          dic.creator_code,
          dic.image_url
        FROM discovery_exposure_rollup_daily r
        JOIN discover_islands_cache dic ON dic.island_code = r.link_code
        WHERE r.date >= v_week_start
          AND r.date <= v_week_end
          AND r.link_code_type = 'island'
        GROUP BY r.link_code, r.link_code_type, dic.title, dic.creator_code, dic.image_url
        HAVING COUNT(DISTINCT r.panel_name) >= 2
        ORDER BY panels_distinct DESC
        LIMIT 10
      ) mp
    ),
    'panelLoyalty', (
      SELECT jsonb_agg(row_to_json(pl))
      FROM (
        SELECT
          r.link_code,
          r.panel_name,
          SUM(r.minutes_exposed)::int AS total_minutes_in_panel,
          COALESCE(dic.title, r.link_code) AS title,
          dic.creator_code,
          dic.image_url
        FROM discovery_exposure_rollup_daily r
        JOIN discover_islands_cache dic ON dic.island_code = r.link_code
        WHERE r.date >= v_week_start
          AND r.date <= v_week_end
          AND r.link_code_type = 'island'
        GROUP BY r.link_code, r.panel_name, dic.title, dic.creator_code, dic.image_url
        ORDER BY total_minutes_in_panel DESC
        LIMIT 10
      ) pl
    ),
    'versionEnrichment', (
      SELECT jsonb_build_object(
        'avgVersion', COALESCE(AVG(dlm.version), 0)::numeric(6,1),
        'islandsWithVersion5Plus', COUNT(*) FILTER (WHERE dlm.version >= 5)::int,
        'totalWithVersion', COUNT(*) FILTER (WHERE dlm.version IS NOT NULL)::int,
        'versionDistribution', (
          SELECT jsonb_agg(row_to_json(vd))
          FROM (
            SELECT
              CASE
                WHEN dlm2.version = 1 THEN 'v1'
                WHEN dlm2.version BETWEEN 2 AND 5 THEN 'v2-5'
                WHEN dlm2.version BETWEEN 6 AND 10 THEN 'v6-10'
                WHEN dlm2.version BETWEEN 11 AND 20 THEN 'v11-20'
                WHEN dlm2.version > 20 THEN 'v21+'
                ELSE 'unknown'
              END AS version_tier,
              COUNT(*)::int AS count
            FROM discover_report_islands ri2
            JOIN discover_link_metadata dlm2 ON dlm2.link_code = ri2.island_code
            WHERE ri2.report_id = p_report_id
              AND ri2.status = 'reported'
              AND dlm2.version IS NOT NULL
            GROUP BY version_tier
            ORDER BY count DESC
          ) vd
        )
      )
      FROM discover_report_islands ri
      JOIN discover_link_metadata dlm ON dlm.link_code = ri.island_code
      WHERE ri.report_id = p_report_id
        AND ri.status = 'reported'
    ),
    'sacCoverage', (
      SELECT jsonb_build_object(
        'totalWithSAC', COUNT(*) FILTER (WHERE dlm.support_code IS NOT NULL AND dlm.support_code != '')::int,
        'totalChecked', COUNT(*)::int,
        'sacPct', CASE WHEN COUNT(*) > 0 THEN (COUNT(*) FILTER (WHERE dlm.support_code IS NOT NULL AND dlm.support_code != '')::numeric / COUNT(*)::numeric * 100)::numeric(5,1) ELSE 0 END
      )
      FROM discover_report_islands ri
      JOIN discover_link_metadata dlm ON dlm.link_code = ri.island_code
      WHERE ri.report_id = p_report_id
        AND ri.status = 'reported'
    )
  ) INTO result;

  RETURN result;
END;
$$;
