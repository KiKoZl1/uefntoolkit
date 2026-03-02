BEGIN;

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
  SELECT now() - make_interval(days => LEAST(365, GREATEST(1, COALESCE(p_window_days, 14)))) AS dt_start
),
panel_hint AS (
  SELECT
    s.link_code,
    (ARRAY_AGG(
      s.panel_name
      ORDER BY COALESCE(NULLIF(s.ccu_max, 0), NULLIF(s.ccu_end, 0), NULLIF(s.ccu_start, 0), 0) DESC
    ))[1] AS top_panel
  FROM public.discovery_exposure_presence_segments s
  WHERE s.link_code_type = 'island'
    AND s.start_ts < now()
    AND COALESCE(s.end_ts, s.last_seen_ts, now()) > (SELECT dt_start FROM window_cfg)
  GROUP BY s.link_code
),
meta AS (
  SELECT
    m.link_code,
    m.image_url,
    COALESCE(NULLIF(LOWER(COALESCE(m.title, '')), ''), '') AS title_l,
    COALESCE(NULLIF(LOWER(COALESCE(m.tagline, '')), ''), '') AS tagline_l,
    COALESCE(NULLIF(LOWER(COALESCE(m.introduction, '')), ''), '') AS intro_l,
    LOWER(
      COALESCE(
        NULLIF(m.raw -> 'feature_tags' ->> 0, ''),
        NULLIF(m.raw -> 'featureTags' ->> 0, ''),
        NULLIF(m.raw -> 'tags' ->> 0, ''),
        NULLIF(m.raw -> 'categories' ->> 0, ''),
        NULLIF(m.discovery_intent, ''),
        ''
      )
    ) AS explicit_tag,
    LOWER(COALESCE(ph.top_panel, '')) AS top_panel_l
  FROM public.discover_link_metadata m
  LEFT JOIN panel_hint ph ON ph.link_code = m.link_code
  WHERE m.link_code_type = 'island'
    AND m.image_url IS NOT NULL
),
meta_tagged AS (
  SELECT
    x.link_code,
    x.image_url,
    CASE
      WHEN x.explicit_tag ~ '(tycoon|simulator|idle)' OR (x.title_l || ' ' || x.tagline_l || ' ' || x.intro_l) ~ '(tycoon|simulator|idle)' OR x.top_panel_l LIKE '%tycoon%' THEN 'tycoon'
      WHEN x.explicit_tag ~ '(horror|scary|backroom|fnaf|haunted|creepy|zombie)' OR (x.title_l || ' ' || x.tagline_l || ' ' || x.intro_l) ~ '(horror|scary|backroom|fnaf|haunted|creepy|zombie)' OR x.top_panel_l LIKE '%horror%' THEN 'horror'
      WHEN x.explicit_tag ~ '(prop|hide|seek)' OR (x.title_l || ' ' || x.tagline_l || ' ' || x.intro_l) ~ '(prop ?hunt|hide ?and ?seek|hide ?n ?seek)' OR x.top_panel_l LIKE '%prophunt%' OR x.top_panel_l LIKE '%prop%' THEN 'prop_hunt'
      WHEN x.explicit_tag ~ '(driv|race|racing|drift|car|vehicle|rocket racing)' OR (x.title_l || ' ' || x.tagline_l || ' ' || x.intro_l) ~ '(driv|race|racing|drift|car|vehicle|rocket racing)' OR x.top_panel_l LIKE '%driving%' THEN 'driving'
      WHEN x.explicit_tag ~ '(deathrun|parkour|obby|only up)' OR (x.title_l || ' ' || x.tagline_l || ' ' || x.intro_l) ~ '(deathrun|parkour|obby|only up)' OR x.top_panel_l LIKE '%deathrun%' THEN 'deathrun'
      WHEN x.explicit_tag ~ '(zone ?wars|box ?fight|build ?fight|1v1|red vs blue|team deathmatch|gun game|ffa|combat|battle)' OR (x.title_l || ' ' || x.tagline_l || ' ' || x.intro_l) ~ '(zone ?wars|box ?fight|build ?fight|1v1|red ?vs ?blue|team deathmatch|gun game|ffa|combat|battle)' OR x.top_panel_l LIKE '%zonewars%' OR x.top_panel_l LIKE '%combat%' OR x.top_panel_l LIKE '%teamdeathmatch%' OR x.top_panel_l LIKE '%buildfighting%' OR x.top_panel_l LIKE '%boxfights%' THEN 'combat'
      WHEN x.explicit_tag ~ '(fashion|skin contest|dress)' OR (x.title_l || ' ' || x.tagline_l || ' ' || x.intro_l) ~ '(fashion|skin contest|dress)' OR x.top_panel_l LIKE '%fashion%' THEN 'fashion'
      WHEN x.explicit_tag ~ '(party|minigame|murder mystery|impostor|golf)' OR (x.title_l || ' ' || x.tagline_l || ' ' || x.intro_l) ~ '(party|minigame|murder mystery|impostor|golf)' OR x.top_panel_l LIKE '%partygames%' THEN 'party_games'
      WHEN x.explicit_tag ~ '(roleplay|rp)' OR (x.title_l || ' ' || x.tagline_l || ' ' || x.intro_l) ~ '(^|[^a-z])rp([^a-z]|$)|roleplay' OR x.top_panel_l LIKE '%roleplay%' THEN 'roleplay'
      WHEN x.explicit_tag ~ '(pve|roguelike|boss|adventure|survival|dungeon)' OR (x.title_l || ' ' || x.tagline_l || ' ' || x.intro_l) ~ '(pve|roguelike|boss|adventure|survival|dungeon)' OR x.top_panel_l LIKE '%pve%' OR x.top_panel_l LIKE '%roguelike%' THEN 'pve'
      WHEN x.top_panel_l LIKE '%popular%' OR x.top_panel_l LIKE '%variety%' OR x.top_panel_l LIKE '%new%' OR x.top_panel_l LIKE '%engaging%' OR x.top_panel_l LIKE '%toprated%' THEN 'variety'
      ELSE 'general'
    END AS tag_group
  FROM meta x
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
  FROM meta_tagged m
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

GRANT EXECUTE ON FUNCTION public.compute_tgis_thumb_score(int) TO service_role;

COMMIT;

