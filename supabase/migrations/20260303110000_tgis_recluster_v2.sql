BEGIN;

-- Cluster registry: support dynamic taxonomy slugs/family/routing tags.
ALTER TABLE public.tgis_cluster_registry
  ADD COLUMN IF NOT EXISTS cluster_slug text NULL,
  ADD COLUMN IF NOT EXISTS cluster_family text NULL,
  ADD COLUMN IF NOT EXISTS routing_tags text[] NOT NULL DEFAULT '{}'::text[];

CREATE UNIQUE INDEX IF NOT EXISTS tgis_cluster_registry_cluster_slug_uidx
  ON public.tgis_cluster_registry (cluster_slug)
  WHERE cluster_slug IS NOT NULL;

-- Generation log: persist user tags and routing diagnostics.
ALTER TABLE public.tgis_generation_log
  ADD COLUMN IF NOT EXISTS user_tags_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS cluster_slug text NULL,
  ADD COLUMN IF NOT EXISTS routing_debug_json jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS tgis_generation_log_cluster_slug_created_idx
  ON public.tgis_generation_log (cluster_slug, created_at DESC);

-- Taxonomy rules for metadata-first routing and reclustering.
CREATE TABLE IF NOT EXISTS public.tgis_cluster_taxonomy_rules (
  rule_id bigserial PRIMARY KEY,
  cluster_slug text NOT NULL,
  cluster_family text NOT NULL,
  priority int NOT NULL,
  include_any text[] NOT NULL DEFAULT '{}'::text[],
  include_all text[] NOT NULL DEFAULT '{}'::text[],
  exclude_any text[] NOT NULL DEFAULT '{}'::text[],
  is_active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tgis_cluster_taxonomy_rules_active_priority
  ON public.tgis_cluster_taxonomy_rules (is_active, priority ASC, rule_id ASC);

CREATE INDEX IF NOT EXISTS idx_tgis_cluster_taxonomy_rules_slug
  ON public.tgis_cluster_taxonomy_rules (cluster_slug, cluster_family);

-- Manual merge map (phase 3).
CREATE TABLE IF NOT EXISTS public.tgis_cluster_merge_rules (
  source_cluster_slug text PRIMARY KEY,
  target_cluster_slug text NOT NULL,
  reason text NULL,
  is_active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tgis_cluster_merge_rules_active
  ON public.tgis_cluster_merge_rules (is_active, target_cluster_slug);

-- RLS for new tables, service role + admin/editor select.
ALTER TABLE public.tgis_cluster_taxonomy_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tgis_cluster_merge_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tgis_cluster_taxonomy_rules_service_all ON public.tgis_cluster_taxonomy_rules;
CREATE POLICY tgis_cluster_taxonomy_rules_service_all
  ON public.tgis_cluster_taxonomy_rules FOR ALL
  TO public
  USING ((auth.jwt() ->> 'role') = 'service_role')
  WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

DROP POLICY IF EXISTS tgis_cluster_taxonomy_rules_admin_select ON public.tgis_cluster_taxonomy_rules;
CREATE POLICY tgis_cluster_taxonomy_rules_admin_select
  ON public.tgis_cluster_taxonomy_rules FOR SELECT
  TO authenticated
  USING (public.is_admin_or_editor());

DROP POLICY IF EXISTS tgis_cluster_merge_rules_service_all ON public.tgis_cluster_merge_rules;
CREATE POLICY tgis_cluster_merge_rules_service_all
  ON public.tgis_cluster_merge_rules FOR ALL
  TO public
  USING ((auth.jwt() ->> 'role') = 'service_role')
  WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

DROP POLICY IF EXISTS tgis_cluster_merge_rules_admin_select ON public.tgis_cluster_merge_rules;
CREATE POLICY tgis_cluster_merge_rules_admin_select
  ON public.tgis_cluster_merge_rules FOR SELECT
  TO authenticated
  USING (public.is_admin_or_editor());

-- Backfill slug/family/routing tags for existing rows.
UPDATE public.tgis_cluster_registry r
SET
  cluster_slug = COALESCE(
    r.cluster_slug,
    regexp_replace(lower(replace(replace(r.cluster_name, 'cluster_', ''), ' ', '_')), '[^a-z0-9_]+', '', 'g')
  ),
  cluster_family = COALESCE(
    r.cluster_family,
    regexp_replace(lower(replace(replace(r.cluster_name, 'cluster_', ''), ' ', '_')), '[^a-z0-9_]+', '', 'g')
  ),
  routing_tags = CASE
    WHEN COALESCE(array_length(r.routing_tags, 1), 0) > 0 THEN r.routing_tags
    ELSE (
      SELECT ARRAY(
        SELECT DISTINCT lower(trim(value))
        FROM (
          SELECT jsonb_array_elements_text(COALESCE(r.categories_json, '[]'::jsonb)) AS value
          UNION ALL
          SELECT regexp_replace(lower(replace(replace(r.cluster_name, 'cluster_', ''), ' ', '_')), '[^a-z0-9_]+', '', 'g')
        ) s
        WHERE trim(value) <> ''
      )
    )
  END
WHERE true;

-- Seed keyword-first taxonomy rules once.
INSERT INTO public.tgis_cluster_taxonomy_rules
  (cluster_slug, cluster_family, priority, include_any, include_all, exclude_any, is_active)
SELECT *
FROM (
  VALUES
    ('combat_the_pit', 'combat', 10, ARRAY['the pit','pit'], ARRAY[]::text[], ARRAY[]::text[], true),
    ('combat_zonewars', 'combat', 20, ARRAY['zonewars','zone wars','storm wars'], ARRAY[]::text[], ARRAY[]::text[], true),
    ('combat_boxfight', 'combat', 30, ARRAY['boxfight','box fight','box pvp','boxfights'], ARRAY[]::text[], ARRAY[]::text[], true),
    ('combat_red_vs_blue', 'combat', 40, ARRAY['red vs blue','redvblue','rvb'], ARRAY[]::text[], ARRAY[]::text[], true),
    ('combat_gungame', 'combat', 50, ARRAY['gungame','gun game'], ARRAY[]::text[], ARRAY[]::text[], true),
    ('combat_edit_course', 'combat', 60, ARRAY['edit course','edit practice'], ARRAY[]::text[], ARRAY[]::text[], true),
    ('combat_free_for_all', 'combat', 70, ARRAY['free for all','ffa'], ARRAY[]::text[], ARRAY['tycoon'], true),
    ('combat_1v1', 'combat', 80, ARRAY['1v1','2v2','3v3','4v4'], ARRAY[]::text[], ARRAY['tycoon'], true),

    ('tycoon', 'tycoon', 100, ARRAY['tycoon','simulator','idle','incremental','cash'], ARRAY[]::text[], ARRAY['zonewars','boxfight','box fight','1v1','red vs blue','the pit','gun game','gungame','ffa','free for all'], true),
    ('horror', 'horror', 110, ARRAY['horror','scary','haunted','creepy','backrooms','fnaf'], ARRAY[]::text[], ARRAY[]::text[], true),
    ('prop_hunt', 'prop_hunt', 120, ARRAY['prop hunt','hide and seek','hide n seek'], ARRAY[]::text[], ARRAY[]::text[], true),
    ('deathrun', 'deathrun', 130, ARRAY['deathrun','parkour','obby','only up'], ARRAY[]::text[], ARRAY[]::text[], true),
    ('driving', 'driving', 140, ARRAY['driving','race','racing','drift','car','vehicle','rocket racing'], ARRAY[]::text[], ARRAY[]::text[], true),
    ('party_games', 'party_games', 150, ARRAY['party game','party games','minigame','murder mystery','impostor'], ARRAY[]::text[], ARRAY[]::text[], true),
    ('roleplay', 'roleplay', 160, ARRAY['roleplay','rp','open world roleplay'], ARRAY[]::text[], ARRAY[]::text[], true),
    ('fashion', 'fashion', 170, ARRAY['fashion','skin contest','dress up'], ARRAY[]::text[], ARRAY[]::text[], true),
    ('pve', 'pve', 180, ARRAY['pve','adventure','survival','boss','dungeon','roguelike'], ARRAY[]::text[], ARRAY[]::text[], true)
) AS v(cluster_slug, cluster_family, priority, include_any, include_all, exclude_any, is_active)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.tgis_cluster_taxonomy_rules r
  WHERE r.cluster_slug = v.cluster_slug
    AND r.priority = v.priority
);

COMMIT;
