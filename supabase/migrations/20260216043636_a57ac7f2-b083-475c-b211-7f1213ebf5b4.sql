CREATE OR REPLACE FUNCTION public.claim_discover_link_metadata(
  p_take integer DEFAULT 500,
  p_stale_after_seconds integer DEFAULT 180
)
RETURNS TABLE(link_code text, lock_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_lock UUID := gen_random_uuid();
BEGIN
  -- Unstale stuck rows
  UPDATE public.discover_link_metadata
  SET locked_at = NULL, lock_id = NULL
  WHERE locked_at IS NOT NULL
    AND locked_at < now() - make_interval(secs => GREATEST(p_stale_after_seconds, 60));

  RETURN QUERY
  WITH picked AS (
    SELECT m.link_code
    FROM public.discover_link_metadata m
    WHERE m.next_due_at <= now()
      AND m.locked_at IS NULL
    ORDER BY
      -- Priority: non-tournament collections first (these produce edges for Rails)
      CASE 
        WHEN m.link_code_type = 'collection' AND m.link_code NOT LIKE 'tournament_%' THEN 0
        WHEN m.link_code_type = 'collection' THEN 2
        ELSE 1
      END,
      m.next_due_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT GREATEST(p_take, 1)
  )
  UPDATE public.discover_link_metadata m
  SET locked_at = now(), lock_id = v_lock
  FROM picked p
  WHERE m.link_code = p.link_code
  RETURNING m.link_code, v_lock;
END;
$$;