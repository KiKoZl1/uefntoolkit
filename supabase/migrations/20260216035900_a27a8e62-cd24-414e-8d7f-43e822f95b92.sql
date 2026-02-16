
-- Update get_link_graph_stats to return all fields expected by the Command Center frontend
CREATE OR REPLACE FUNCTION public.get_link_graph_stats()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH edge_stats AS (
    SELECT
      count(*)::int AS total_edges,
      count(DISTINCT parent_link_code)::int AS distinct_parents,
      count(DISTINCT child_link_code)::int AS distinct_children,
      count(*) FILTER (WHERE last_seen_at < now() - interval '60 days')::int AS stale_60d,
      count(*) FILTER (WHERE last_seen_at >= now() - interval '24 hours')::int AS edges_seen_24h,
      EXTRACT(epoch FROM (now() - MAX(last_seen_at)))::int AS edge_age_seconds
    FROM discover_link_edges
  ),
  collection_stats AS (
    SELECT
      count(DISTINCT e.parent_link_code)::int AS collections_resolved_24h
    FROM discover_link_edges e
    WHERE e.last_seen_at >= now() - interval '24 hours'
  ),
  collections_seen AS (
    SELECT count(DISTINCT rs.link_code)::int AS seen_24h
    FROM discovery_exposure_rank_segments rs
    WHERE rs.link_code_type = 'collection'
      AND rs.end_ts IS NULL
  ),
  collections_due AS (
    SELECT count(*)::int AS due_now
    FROM discover_link_metadata
    WHERE link_code_type = 'collection'
      AND next_due_at <= now()
      AND locked_at IS NULL
  )
  SELECT jsonb_build_object(
    'total_edges',              es.total_edges,
    'distinct_parents',         es.distinct_parents,
    'distinct_children',        es.distinct_children,
    'stale_60d',                es.stale_60d,
    'stale_edges_60d',          es.stale_60d,
    'edge_age_seconds',         es.edge_age_seconds,
    'parents_total',            es.distinct_parents,
    'children_total',           es.distinct_children,
    'edges_total',              es.total_edges,
    'collections_seen_24h',     cs_seen.seen_24h,
    'collections_resolved_24h', cs_res.collections_resolved_24h,
    'resolution_24h_pct',       CASE WHEN cs_seen.seen_24h > 0 THEN cs_res.collections_resolved_24h::float / cs_seen.seen_24h ELSE NULL END,
    'collections_due',          cd.due_now,
    'collections_due_now',      cd.due_now
  )
  FROM edge_stats es
  CROSS JOIN collection_stats cs_res
  CROSS JOIN collections_seen cs_seen
  CROSS JOIN collections_due cd;
$function$;
