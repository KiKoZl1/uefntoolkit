-- TGIS caption metadata view (latest per island)
-- Canonical join for caption/training metadata:
-- - discover_link_metadata (description/introduction/version/ratings)
-- - latest discover_report_islands row (title/tags/map_type)

CREATE OR REPLACE VIEW public.tgis_island_metadata_latest AS
WITH latest_report AS (
  SELECT DISTINCT ON (r.island_code)
    r.island_code,
    r.title AS report_title,
    r.creator_code AS report_creator_code,
    r.tags AS report_tags,
    r.created_in AS map_type,
    r.updated_at AS report_updated_at
  FROM public.discover_report_islands r
  ORDER BY r.island_code, r.updated_at DESC NULLS LAST
)
SELECT
  m.link_code,
  m.link_code_type,
  COALESCE(NULLIF(BTRIM(lr.report_title), ''), NULLIF(BTRIM(m.title), '')) AS title,
  m.tagline AS description,
  m.introduction,
  COALESCE(NULLIF(BTRIM(m.support_code), ''), NULLIF(BTRIM(lr.report_creator_code), '')) AS creator_code,
  lr.report_tags AS tags,
  lr.map_type,
  m.image_url,
  m.published_at_epic,
  m.updated_at_epic,
  m.version,
  m.max_players,
  m.min_players,
  m.ratings,
  m.raw,
  lr.report_updated_at
FROM public.discover_link_metadata m
LEFT JOIN latest_report lr ON lr.island_code = m.link_code
WHERE m.link_code_type = 'island';

