-- V1.1: Link graph edges (parent collection -> child links)
-- Used to resolve Homebar/reference/ref_panel/set/playlist containers into real child cards.

CREATE TABLE IF NOT EXISTS public.discover_link_edges (
  parent_link_code TEXT NOT NULL,
  child_link_code TEXT NOT NULL,
  edge_type TEXT NOT NULL,
  sort_order INT NULL,
  source TEXT NOT NULL DEFAULT 'links_related',
  metadata JSONB NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (parent_link_code, child_link_code, edge_type)
);

CREATE INDEX IF NOT EXISTS discover_link_edges_parent_idx
  ON public.discover_link_edges (parent_link_code, edge_type, sort_order NULLS LAST);

CREATE INDEX IF NOT EXISTS discover_link_edges_child_idx
  ON public.discover_link_edges (child_link_code);

CREATE INDEX IF NOT EXISTS discover_link_edges_seen_idx
  ON public.discover_link_edges (last_seen_at DESC);

ALTER TABLE public.discover_link_edges ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'discover_link_edges'
      AND policyname = 'select_discover_link_edges_authenticated'
  ) THEN
    CREATE POLICY select_discover_link_edges_authenticated
      ON public.discover_link_edges FOR SELECT
      TO authenticated
      USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'discover_link_edges'
      AND policyname = 'all_discover_link_edges_service_role'
  ) THEN
    CREATE POLICY all_discover_link_edges_service_role
      ON public.discover_link_edges FOR ALL
      TO public
      USING ((auth.jwt() ->> 'role') = 'service_role')
      WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');
  END IF;
END $$;

