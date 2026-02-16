-- V1.1: cleanup helper for discover_link_edges retention
-- Keeps graph table bounded by last_seen_at horizon.

CREATE OR REPLACE FUNCTION public.cleanup_discover_link_edges(
  p_days INT DEFAULT 60,
  p_delete_batch INT DEFAULT 200000
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days INT := GREATEST(1, COALESCE(p_days, 60));
  v_batch INT := GREATEST(1, COALESCE(p_delete_batch, 200000));
  v_deleted INT := 0;
BEGIN
  WITH doomed AS (
    SELECT parent_link_code, child_link_code, edge_type
    FROM public.discover_link_edges
    WHERE last_seen_at < now() - make_interval(days => v_days)
    ORDER BY last_seen_at ASC
    LIMIT v_batch
  )
  DELETE FROM public.discover_link_edges e
  USING doomed d
  WHERE e.parent_link_code = d.parent_link_code
    AND e.child_link_code = d.child_link_code
    AND e.edge_type = d.edge_type;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'deleted', v_deleted,
    'days', v_days,
    'batch', v_batch
  );
END;
$$;

