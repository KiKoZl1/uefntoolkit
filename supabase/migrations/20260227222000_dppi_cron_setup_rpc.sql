CREATE OR REPLACE FUNCTION public.setup_dppi_crons(
  p_url text,
  p_service_role_key text,
  p_surface_name text DEFAULT 'CreativeDiscoverySurface_Frontend',
  p_region text DEFAULT 'NAE'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_jobid bigint;
  v_created int := 0;
  rec record;
BEGIN
  PERFORM public._dppi_require_service_role();

  IF p_url IS NULL OR btrim(p_url) = '' OR p_service_role_key IS NULL OR btrim(p_service_role_key) = '' THEN
    RAISE EXCEPTION 'missing_url_or_key';
  END IF;

  FOR rec IN
    SELECT *
    FROM (
      VALUES
        ('dppi-feature-hourly', '5 * * * *', '/functions/v1/dppi-refresh-batch', jsonb_build_object('mode','feature_hourly','batchTargets',24,'activeWithinHours',24,'region',p_region,'surfaceName',p_surface_name)),
        ('dppi-feature-daily', '10 2 * * *', '/functions/v1/dppi-refresh-batch', jsonb_build_object('mode','feature_daily','batchTargets',64,'activeWithinHours',72,'region',p_region,'surfaceName',p_surface_name)),
        ('dppi-labels-daily', '20 2 * * *', '/functions/v1/dppi-refresh-batch', jsonb_build_object('mode','labels_daily','batchTargets',64,'activeWithinHours',72,'region',p_region,'surfaceName',p_surface_name)),
        ('dppi-opportunities-refresh-10min', '*/10 * * * *', '/functions/v1/dppi-refresh-batch', jsonb_build_object('mode','opportunities','batchTargets',24,'activeWithinHours',12,'region',p_region,'surfaceName',p_surface_name)),
        ('dppi-cleanup-daily', '20 4 * * *', '/functions/v1/dppi-refresh-batch', jsonb_build_object('mode','cleanup','keepDays',90)),
        ('dppi-train-entry-weekly', '0 3 * * 0', '/functions/v1/dppi-train-dispatch', jsonb_build_object('taskType','entry','modelName','dppi_entry','region',p_region,'surfaceName',p_surface_name,'minDays',60)),
        ('dppi-train-survival-weekly', '20 3 * * 0', '/functions/v1/dppi-train-dispatch', jsonb_build_object('taskType','survival','modelName','dppi_survival','region',p_region,'surfaceName',p_surface_name,'minDays',60))
    ) AS t(jobname, schedule, endpoint, body_json)
  LOOP
    SELECT jobid
      INTO v_jobid
    FROM cron.job
    WHERE jobname = rec.jobname
    LIMIT 1;

    IF v_jobid IS NOT NULL THEN
      BEGIN
        PERFORM cron.unschedule(v_jobid);
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Could not unschedule %: %', rec.jobname, SQLERRM;
      END;
    END IF;

    PERFORM cron.schedule(
      rec.jobname,
      rec.schedule,
      format($job$
        SELECT net.http_post(
          url := %L || %L,
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || %L,
            'apikey', %L
          ),
          body := %L::jsonb
        ) AS request_id;
      $job$, p_url, rec.endpoint, p_service_role_key, p_service_role_key, rec.body_json::text)
    );

    v_created := v_created + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'jobs_scheduled', v_created,
    'region', p_region,
    'surface_name', p_surface_name
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.setup_dppi_crons(text, text, text, text) TO service_role;
