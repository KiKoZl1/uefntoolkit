CREATE OR REPLACE FUNCTION public.admin_list_discover_cron_jobs()
RETURNS TABLE (
  jobid bigint,
  jobname text,
  schedule text,
  active boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._assert_discover_cron_admin_access();

  RETURN QUERY
  SELECT j.jobid, j.jobname, j.schedule, j.active
  FROM cron.job j
  WHERE j.jobname LIKE 'discover-%'
     OR j.jobname LIKE 'dppi-%'
  ORDER BY j.jobname;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_discover_cron_jobs() TO authenticated, service_role;

