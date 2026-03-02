DO $$
DECLARE
  v_url text := current_setting('app.settings.supabase_url', true);
  v_key text := current_setting('app.settings.service_role_key', true);
  v_jobid bigint;
  rec record;
BEGIN
  IF v_url IS NULL OR v_url = '' OR v_key IS NULL OR v_key = '' THEN
    RAISE NOTICE 'Skipping DPPI granular cron setup: missing app.settings.supabase_url/service_role_key';
    RETURN;
  END IF;

  FOR rec IN
    SELECT *
    FROM (
      VALUES
        ('dppi-feature-hourly', '5 * * * *', '{"mode":"feature_hourly","batchTargets":24,"activeWithinHours":24}'::jsonb),
        ('dppi-feature-daily', '10 2 * * *', '{"mode":"feature_daily","batchTargets":64,"activeWithinHours":72}'::jsonb),
        ('dppi-labels-daily', '20 2 * * *', '{"mode":"labels_daily","batchTargets":64,"activeWithinHours":72}'::jsonb),
        ('dppi-opportunities-refresh-10min', '*/10 * * * *', '{"mode":"opportunities","batchTargets":24,"activeWithinHours":12}'::jsonb),
        ('dppi-cleanup-daily', '20 4 * * *', '{"mode":"cleanup","keepDays":90}'::jsonb)
    ) AS t(jobname, schedule, body_json)
  LOOP
    SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = rec.jobname LIMIT 1;
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
          url := %L || '/functions/v1/dppi-refresh-batch',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || %L,
            'apikey', %L
          ),
          body := %L::jsonb
        ) AS request_id;
      $job$, v_url, v_key, v_key, rec.body_json::text)
    );
  END LOOP;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Skipping DPPI granular cron setup due to error: %', SQLERRM;
END $$;

DO $$
DECLARE
  v_url text := current_setting('app.settings.supabase_url', true);
  v_key text := current_setting('app.settings.service_role_key', true);
  v_jobid bigint;
  rec record;
BEGIN
  IF v_url IS NULL OR v_url = '' OR v_key IS NULL OR v_key = '' THEN
    RAISE NOTICE 'Skipping DPPI train cron setup: missing app.settings.supabase_url/service_role_key';
    RETURN;
  END IF;

  FOR rec IN
    SELECT *
    FROM (
      VALUES
        ('dppi-train-entry-weekly', '0 3 * * 0', '{"taskType":"entry","modelName":"dppi_entry","region":"NAE","surfaceName":"CreativeDiscoverySurface_Frontend","minDays":60}'::jsonb),
        ('dppi-train-survival-weekly', '20 3 * * 0', '{"taskType":"survival","modelName":"dppi_survival","region":"NAE","surfaceName":"CreativeDiscoverySurface_Frontend","minDays":60}'::jsonb)
    ) AS t(jobname, schedule, body_json)
  LOOP
    SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = rec.jobname LIMIT 1;
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
          url := %L || '/functions/v1/dppi-train-dispatch',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || %L,
            'apikey', %L
          ),
          body := %L::jsonb
        ) AS request_id;
      $job$, v_url, v_key, v_key, rec.body_json::text)
    );
  END LOOP;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Skipping DPPI train cron setup due to error: %', SQLERRM;
END $$;
