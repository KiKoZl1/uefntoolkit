BEGIN;

-- Disable legacy hardcoded taxonomy seeds so V2 clustering can emerge from metadata only.
-- Rules can still be added manually later via admin/SQL if needed.
UPDATE public.tgis_cluster_taxonomy_rules
SET
  is_active = false,
  updated_at = now()
WHERE cluster_slug IN (
  'combat_the_pit',
  'combat_zonewars',
  'combat_boxfight',
  'combat_red_vs_blue',
  'combat_gungame',
  'combat_edit_course',
  'combat_free_for_all',
  'combat_1v1',
  'tycoon',
  'horror',
  'prop_hunt',
  'deathrun',
  'driving',
  'party_games',
  'roleplay',
  'fashion',
  'pve'
);

COMMIT;
