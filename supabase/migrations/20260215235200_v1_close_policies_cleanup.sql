-- V1 close: RLS policies + cleanup helpers

-- 1) RLS for rebuild runs (admin/editor can read; service_role writes)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='discover_report_rebuild_runs'
      AND policyname='select_rebuild_runs_authenticated'
  ) THEN
    CREATE POLICY select_rebuild_runs_authenticated
      ON public.discover_report_rebuild_runs FOR SELECT
      TO authenticated
      USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='discover_report_rebuild_runs'
      AND policyname='all_rebuild_runs_service_role'
  ) THEN
    CREATE POLICY all_rebuild_runs_service_role
      ON public.discover_report_rebuild_runs FOR ALL
      TO public
      USING ((auth.jwt() ->> 'role') = 'service_role')
      WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');
  END IF;
END $$;

-- 2) RLS for system_alerts_current (authenticated read; service_role write)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='system_alerts_current'
      AND policyname='select_system_alerts_authenticated'
  ) THEN
    CREATE POLICY select_system_alerts_authenticated
      ON public.system_alerts_current FOR SELECT
      TO authenticated
      USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='system_alerts_current'
      AND policyname='all_system_alerts_service_role'
  ) THEN
    CREATE POLICY all_system_alerts_service_role
      ON public.system_alerts_current FOR ALL
      TO public
      USING ((auth.jwt() ->> 'role') = 'service_role')
      WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');
  END IF;
END $$;

-- 3) Cleanup helper: link metadata events retention (default 90 days)
CREATE OR REPLACE FUNCTION public.cleanup_discover_link_metadata_events(
  p_days integer DEFAULT 90,
  p_delete_batch integer DEFAULT 200000
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_deleted int := 0;
BEGIN
  IF (auth.jwt()->>'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  WITH todel AS (
    SELECT id
    FROM public.discover_link_metadata_events
    WHERE created_at < now() - make_interval(days => GREATEST(p_days,1))
    ORDER BY created_at ASC
    LIMIT GREATEST(p_delete_batch,1)
  )
  DELETE FROM public.discover_link_metadata_events e
  USING todel d
  WHERE e.id = d.id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN jsonb_build_object('deleted', v_deleted, 'days', p_days);
END;
$function$;

