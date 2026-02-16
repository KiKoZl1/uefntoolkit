
-- Drop old function with different return type
DROP FUNCTION IF EXISTS public.report_most_updated_islands(uuid, date, date, integer);

-- Recreate with version column added
CREATE OR REPLACE FUNCTION public.report_most_updated_islands(p_report_id uuid, p_week_start date, p_week_end date, p_limit integer DEFAULT 10)
 RETURNS TABLE(island_code text, title text, creator_code text, category text, week_plays integer, week_unique integer, updated_at_epic timestamp with time zone, version integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT ri.island_code, COALESCE(lm.title, ri.title), COALESCE(lm.creator_name, ri.creator_code), ri.category,
         ri.week_plays, ri.week_unique, lm.updated_at_epic, lm.version
  FROM discover_report_islands ri
  JOIN discover_link_metadata lm ON lm.link_code = ri.island_code
  WHERE ri.report_id = p_report_id AND ri.status = 'reported'
    AND lm.updated_at_epic IS NOT NULL
    AND lm.updated_at_epic >= p_week_start::timestamptz
    AND lm.updated_at_epic < (p_week_end + 1)::timestamptz
    AND (lm.published_at_epic IS NULL OR lm.published_at_epic < p_week_start::timestamptz)
  ORDER BY ri.week_plays DESC NULLS LAST
  LIMIT GREATEST(p_limit, 1);
$function$;
