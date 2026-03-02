DO $$
DECLARE
  v_url text := current_setting('app.settings.supabase_url', true);
  v_key text := current_setting('app.settings.service_role_key', true);
  v_jobid bigint;
BEGIN
  IF v_url IS NULL OR v_url = '' OR v_key IS NULL OR v_key = '' THEN
    RAISE NOTICE 'Skipping DPPI cron setup: missing app.settings.supabase_url/service_role_key';
    RETURN;
  END IF;

  SELECT jobid INTO v_jobid
  FROM cron.job
  WHERE jobname = 'dppi-opportunities-refresh-10min'
  LIMIT 1;

  IF v_jobid IS NOT NULL THEN
    BEGIN
      PERFORM cron.unschedule(v_jobid);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Could not unschedule dppi-opportunities-refresh-10min: %', SQLERRM;
    END;
  END IF;

  PERFORM cron.schedule(
    'dppi-opportunities-refresh-10min',
    '*/10 * * * *',
    format($job$
      SELECT net.http_post(
        url := %L || '/functions/v1/dppi-refresh-batch',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || %L,
          'apikey', %L
        ),
        body := '{
          "region": "NAE",
          "surfaceName": "CreativeDiscoverySurface_Frontend",
          "windowDays": 14,
          "batchTargets": 8
        }'::jsonb
      ) AS request_id;
    $job$, v_url, v_key, v_key)
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Skipping DPPI opportunities refresh cron due to error: %', SQLERRM;
END $$;

DO $$
DECLARE
  v_url text := current_setting('app.settings.supabase_url', true);
  v_key text := current_setting('app.settings.service_role_key', true);
  v_jobid bigint;
BEGIN
  IF v_url IS NULL OR v_url = '' OR v_key IS NULL OR v_key = '' THEN
    RAISE NOTICE 'Skipping DPPI cleanup cron setup: missing app.settings.supabase_url/service_role_key';
    RETURN;
  END IF;

  SELECT jobid INTO v_jobid
  FROM cron.job
  WHERE jobname = 'dppi-cleanup-daily'
  LIMIT 1;

  IF v_jobid IS NOT NULL THEN
    BEGIN
      PERFORM cron.unschedule(v_jobid);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Could not unschedule dppi-cleanup-daily: %', SQLERRM;
    END;
  END IF;

  PERFORM cron.schedule(
    'dppi-cleanup-daily',
    '20 4 * * *',
    format($job$
      SELECT net.http_post(
        url := %L || '/functions/v1/dppi-refresh-batch',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || %L,
          'apikey', %L
        ),
        body := '{"mode":"cleanup","keepDays":90}'::jsonb
      ) AS request_id;
    $job$, v_url, v_key, v_key)
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Skipping DPPI cleanup cron due to error: %', SQLERRM;
END $$;
