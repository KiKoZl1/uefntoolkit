-- Admin controls to toggle cron domains without direct table privileges on cron.job

CREATE OR REPLACE FUNCTION public.admin_list_pipeline_crons(
  p_domain text DEFAULT NULL
)
RETURNS TABLE (
  jobid bigint,
  jobname text,
  schedule text,
  active boolean,
  domain text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_domain text := lower(coalesce(p_domain, ''));
BEGIN
  PERFORM public._assert_discover_cron_admin_access();

  IF v_domain <> '' AND v_domain NOT IN ('discover', 'dppi', 'tgis') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'domain must be discover, dppi, tgis or null';
  END IF;

  RETURN QUERY
  SELECT
    j.jobid,
    j.jobname,
    j.schedule::text,
    j.active,
    CASE
      WHEN j.jobname LIKE 'discover-%' THEN 'discover'
      WHEN j.jobname LIKE 'dppi-%' THEN 'dppi'
      WHEN j.jobname LIKE 'tgis-%' THEN 'tgis'
      ELSE 'other'
    END::text AS domain
  FROM cron.job j
  WHERE
    (v_domain = '' AND (j.jobname LIKE 'discover-%' OR j.jobname LIKE 'dppi-%' OR j.jobname LIKE 'tgis-%'))
    OR (v_domain = 'discover' AND j.jobname LIKE 'discover-%')
    OR (v_domain = 'dppi' AND j.jobname LIKE 'dppi-%')
    OR (v_domain = 'tgis' AND j.jobname LIKE 'tgis-%')
  ORDER BY j.jobname;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_pipeline_cron_domain_active(
  p_domain text,
  p_active boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_domain text := lower(coalesce(p_domain, ''));
  r record;
  v_updated integer := 0;
BEGIN
  PERFORM public._assert_discover_cron_admin_access();

  IF v_domain NOT IN ('discover', 'dppi', 'tgis') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'domain must be discover, dppi or tgis';
  END IF;

  FOR r IN
    SELECT j.jobid
    FROM cron.job j
    WHERE
      (v_domain = 'discover' AND j.jobname LIKE 'discover-%')
      OR (v_domain = 'dppi' AND j.jobname LIKE 'dppi-%')
      OR (v_domain = 'tgis' AND j.jobname LIKE 'tgis-%')
  LOOP
    PERFORM cron.alter_job(r.jobid, NULL, NULL, NULL, NULL, COALESCE(p_active, false));
    v_updated := v_updated + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'domain', v_domain,
    'active', COALESCE(p_active, false),
    'updated', v_updated
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_pipeline_cron_job_active(
  p_jobname text,
  p_active boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_jobid bigint;
  v_updated integer := 0;
BEGIN
  PERFORM public._assert_discover_cron_admin_access();

  IF p_jobname IS NULL OR p_jobname = '' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'jobname is required';
  END IF;

  IF p_jobname NOT LIKE 'discover-%'
     AND p_jobname NOT LIKE 'dppi-%'
     AND p_jobname NOT LIKE 'tgis-%' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'jobname must start with discover-, dppi-, or tgis-';
  END IF;

  SELECT j.jobid INTO v_jobid
  FROM cron.job j
  WHERE j.jobname = p_jobname
  LIMIT 1;

  IF v_jobid IS NOT NULL THEN
    PERFORM cron.alter_job(v_jobid, NULL, NULL, NULL, NULL, COALESCE(p_active, false));
    v_updated := 1;
  END IF;

  RETURN jsonb_build_object(
    'jobname', p_jobname,
    'active', COALESCE(p_active, false),
    'updated', v_updated
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_pipeline_crons(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_pipeline_cron_domain_active(text, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_pipeline_cron_job_active(text, boolean) TO authenticated, service_role;
