-- Update claim_discovery_exposure_target to claim multiple targets at once
CREATE OR REPLACE FUNCTION public.claim_discovery_exposure_target(p_stale_after_seconds integer DEFAULT 180, p_take integer DEFAULT 4)
 RETURNS TABLE(id uuid, region text, surface_name text, platform text, locale text, interval_minutes integer, lock_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lock UUID := gen_random_uuid();
BEGIN
  IF (auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Unstale any stuck targets
  UPDATE public.discovery_exposure_targets t
  SET last_status = 'idle',
      locked_at = NULL,
      lock_id = NULL,
      updated_at = now()
  WHERE t.last_status = 'processing'
    AND t.locked_at IS NOT NULL
    AND t.locked_at < now() - make_interval(secs => GREATEST(p_stale_after_seconds, 60));

  RETURN QUERY
  WITH picked AS (
    SELECT t.id
    FROM public.discovery_exposure_targets t
    WHERE t.next_due_at <= now()
      AND t.last_status <> 'processing'
    ORDER BY t.next_due_at ASC, t.id ASC
    FOR UPDATE SKIP LOCKED
    LIMIT GREATEST(p_take, 1)
  )
  UPDATE public.discovery_exposure_targets t
  SET last_status = 'processing',
      locked_at = now(),
      lock_id = v_lock,
      last_error = NULL,
      next_due_at = now() + make_interval(mins => GREATEST(t.interval_minutes, 1)),
      updated_at = now()
  FROM picked p
  WHERE t.id = p.id
  RETURNING t.id, t.region, t.surface_name, t.platform, t.locale, t.interval_minutes, v_lock;
END;
$function$;