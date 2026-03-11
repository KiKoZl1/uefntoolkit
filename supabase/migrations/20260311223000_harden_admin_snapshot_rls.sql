-- Harden admin snapshot RLS after latency wave:
-- - remove permissive authenticated read policy
-- - allow direct SELECT only for admin/editor users (when user_roles exists)
-- - keep service_role access policy as-is

ALTER TABLE public.discover_admin_overview_snapshot ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS select_discover_admin_overview_snapshot_authenticated
  ON public.discover_admin_overview_snapshot;

DO $$
BEGIN
  IF to_regclass('public.user_roles') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename = 'discover_admin_overview_snapshot'
         AND policyname = 'select_discover_admin_overview_snapshot_admin'
     ) THEN
    CREATE POLICY select_discover_admin_overview_snapshot_admin
      ON public.discover_admin_overview_snapshot
      FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.user_roles ur
          WHERE ur.user_id = auth.uid()
            AND ur.role IN ('admin', 'editor')
        )
      );
  END IF;
END $$;
