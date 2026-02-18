-- Ralph memory/context foundation
-- Purpose:
-- - Persist operational snapshots for continuous learning context.
-- - Persist durable memory items (issues, observations, decisions) with evidence.
-- - Provide one context-pack RPC for Ralph + future LLM V2 consumers.

CREATE TABLE IF NOT EXISTS public.ralph_memory_snapshots (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source TEXT NOT NULL DEFAULT 'system',
  scope TEXT[] NOT NULL DEFAULT '{}',
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS ralph_memory_snapshots_created_idx
  ON public.ralph_memory_snapshots (created_at DESC);

CREATE INDEX IF NOT EXISTS ralph_memory_snapshots_source_created_idx
  ON public.ralph_memory_snapshots (source, created_at DESC);

ALTER TABLE public.ralph_memory_snapshots ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.ralph_memory_items (
  id BIGSERIAL PRIMARY KEY,
  memory_key TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL DEFAULT 'general',
  importance INT NOT NULL DEFAULT 50 CHECK (importance >= 0 AND importance <= 100),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'watch', 'resolved', 'ignored')),
  scope TEXT[] NOT NULL DEFAULT '{}',
  summary TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  hit_count INT NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS ralph_memory_items_status_importance_idx
  ON public.ralph_memory_items (status, importance DESC, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS ralph_memory_items_category_idx
  ON public.ralph_memory_items (category, last_seen_at DESC);

ALTER TABLE public.ralph_memory_items ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.ralph_memory_decisions (
  id BIGSERIAL PRIMARY KEY,
  run_id UUID NULL REFERENCES public.ralph_runs(id) ON DELETE SET NULL,
  decision_key TEXT NOT NULL,
  decision TEXT NOT NULL,
  rationale TEXT NULL,
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'accepted', 'rejected', 'applied')),
  scope TEXT[] NOT NULL DEFAULT '{}',
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ralph_memory_decisions_status_created_idx
  ON public.ralph_memory_decisions (status, created_at DESC);

CREATE INDEX IF NOT EXISTS ralph_memory_decisions_key_idx
  ON public.ralph_memory_decisions (decision_key, created_at DESC);

ALTER TABLE public.ralph_memory_decisions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ralph_memory_snapshots'
      AND policyname = 'select_ralph_memory_snapshots_admin_editor'
  ) THEN
    CREATE POLICY select_ralph_memory_snapshots_admin_editor
      ON public.ralph_memory_snapshots
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

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ralph_memory_items'
      AND policyname = 'select_ralph_memory_items_admin_editor'
  ) THEN
    CREATE POLICY select_ralph_memory_items_admin_editor
      ON public.ralph_memory_items
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

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ralph_memory_decisions'
      AND policyname = 'select_ralph_memory_decisions_admin_editor'
  ) THEN
    CREATE POLICY select_ralph_memory_decisions_admin_editor
      ON public.ralph_memory_decisions
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

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ralph_memory_snapshots'
      AND policyname = 'all_ralph_memory_snapshots_service_role'
  ) THEN
    CREATE POLICY all_ralph_memory_snapshots_service_role
      ON public.ralph_memory_snapshots
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ralph_memory_items'
      AND policyname = 'all_ralph_memory_items_service_role'
  ) THEN
    CREATE POLICY all_ralph_memory_items_service_role
      ON public.ralph_memory_items
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ralph_memory_decisions'
      AND policyname = 'all_ralph_memory_decisions_service_role'
  ) THEN
    CREATE POLICY all_ralph_memory_decisions_service_role
      ON public.ralph_memory_decisions
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.upsert_ralph_memory_item(
  p_memory_key TEXT,
  p_category TEXT DEFAULT 'general',
  p_summary TEXT DEFAULT '',
  p_importance INT DEFAULT 50,
  p_status TEXT DEFAULT 'active',
  p_scope TEXT[] DEFAULT '{}',
  p_evidence JSONB DEFAULT '{}'::jsonb
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id BIGINT;
  v_status TEXT;
  v_importance INT;
BEGIN
  IF COALESCE(NULLIF(trim(p_memory_key), ''), '') = '' THEN
    RAISE EXCEPTION 'p_memory_key is required';
  END IF;

  v_status := CASE
    WHEN p_status IN ('active', 'watch', 'resolved', 'ignored') THEN p_status
    ELSE 'active'
  END;

  v_importance := LEAST(GREATEST(COALESCE(p_importance, 50), 0), 100);

  INSERT INTO public.ralph_memory_items (
    memory_key,
    category,
    importance,
    status,
    scope,
    summary,
    evidence,
    first_seen_at,
    last_seen_at,
    hit_count
  )
  VALUES (
    p_memory_key,
    COALESCE(NULLIF(trim(p_category), ''), 'general'),
    v_importance,
    v_status,
    COALESCE(p_scope, '{}'),
    COALESCE(NULLIF(p_summary, ''), p_memory_key),
    COALESCE(p_evidence, '{}'::jsonb),
    now(),
    now(),
    1
  )
  ON CONFLICT (memory_key)
  DO UPDATE SET
    category = EXCLUDED.category,
    importance = GREATEST(public.ralph_memory_items.importance, EXCLUDED.importance),
    status = EXCLUDED.status,
    scope = EXCLUDED.scope,
    summary = EXCLUDED.summary,
    evidence = COALESCE(public.ralph_memory_items.evidence, '{}'::jsonb) || COALESCE(EXCLUDED.evidence, '{}'::jsonb),
    last_seen_at = now(),
    hit_count = public.ralph_memory_items.hit_count + 1
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.compute_ralph_memory_snapshot(
  p_source TEXT DEFAULT 'system',
  p_scope TEXT[] DEFAULT '{}',
  p_notes JSONB DEFAULT '{}'::jsonb,
  p_min_interval_minutes INT DEFAULT 10,
  p_force BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_latest_ts TIMESTAMPTZ;
  v_metrics JSONB;
  v_id BIGINT;
BEGIN
  SELECT s.created_at
    INTO v_latest_ts
  FROM public.ralph_memory_snapshots s
  WHERE s.source = COALESCE(NULLIF(trim(p_source), ''), 'system')
  ORDER BY s.created_at DESC
  LIMIT 1;

  IF NOT COALESCE(p_force, false)
     AND v_latest_ts IS NOT NULL
     AND v_latest_ts > now() - make_interval(mins => GREATEST(COALESCE(p_min_interval_minutes, 10), 1)) THEN
    RETURN jsonb_build_object(
      'success', true,
      'skipped', true,
      'reason', 'min_interval_not_elapsed',
      'last_snapshot_at', v_latest_ts
    );
  END IF;

  WITH m AS (
    SELECT
      (SELECT COUNT(*)::INT FROM public.discovery_exposure_targets) AS exposure_targets_total,
      (
        SELECT COUNT(*)::INT
        FROM public.discovery_exposure_targets t
        WHERE t.last_status <> 'paused'
          AND (
            t.last_ok_tick_at IS NULL
            OR t.last_ok_tick_at < now() - (make_interval(mins => GREATEST(t.interval_minutes, 1) * 2))
          )
      ) AS exposure_targets_stale,
      (
        SELECT COUNT(*)::INT
        FROM public.discovery_exposure_targets
        WHERE last_status = 'paused'
      ) AS exposure_targets_paused,
      (SELECT COUNT(*)::INT FROM public.discover_link_metadata) AS metadata_total,
      (
        SELECT COUNT(*)::INT
        FROM public.discover_link_metadata
        WHERE next_due_at <= now() AND locked_at IS NULL
      ) AS metadata_due_now,
      (
        SELECT COUNT(*)::INT
        FROM public.discover_link_metadata
        WHERE COALESCE(NULLIF(trim(title), ''), '') <> ''
      ) AS metadata_with_title,
      (
        SELECT COUNT(*)::INT
        FROM public.discover_link_metadata
        WHERE COALESCE(NULLIF(trim(image_url), ''), '') <> ''
      ) AS metadata_with_image,
      (
        SELECT COUNT(*)::INT
        FROM public.discover_link_metadata
        WHERE link_code_type = 'collection'
      ) AS collections_total,
      (
        SELECT COUNT(DISTINCT e.parent_link_code)::INT
        FROM public.discover_link_edges e
      ) AS collections_with_edges,
      (
        SELECT COUNT(*)::INT
        FROM public.system_alerts_current a
        WHERE a.severity <> 'ok'
      ) AS alerts_open,
      (
        SELECT COUNT(*)::INT
        FROM public.system_alerts_current a
        WHERE a.severity = 'error'
      ) AS alerts_critical,
      (SELECT COUNT(*)::INT FROM public.weekly_reports) AS weekly_reports_total,
      (SELECT MAX(updated_at) FROM public.weekly_reports) AS weekly_reports_last_updated_at
  )
  SELECT jsonb_build_object(
    'exposure_targets_total', exposure_targets_total,
    'exposure_targets_stale', exposure_targets_stale,
    'exposure_targets_paused', exposure_targets_paused,
    'metadata_total', metadata_total,
    'metadata_due_now', metadata_due_now,
    'metadata_coverage_title_pct', CASE
      WHEN metadata_total > 0 THEN ROUND((metadata_with_title::numeric * 100.0 / metadata_total), 2)
      ELSE 0
    END,
    'metadata_coverage_image_pct', CASE
      WHEN metadata_total > 0 THEN ROUND((metadata_with_image::numeric * 100.0 / metadata_total), 2)
      ELSE 0
    END,
    'collections_total', collections_total,
    'collections_with_edges', collections_with_edges,
    'collections_edges_coverage_pct', CASE
      WHEN collections_total > 0 THEN ROUND((collections_with_edges::numeric * 100.0 / collections_total), 2)
      ELSE 100
    END,
    'alerts_open', alerts_open,
    'alerts_critical', alerts_critical,
    'weekly_reports_total', weekly_reports_total,
    'weekly_reports_last_updated_at', weekly_reports_last_updated_at
  )
  INTO v_metrics
  FROM m;

  INSERT INTO public.ralph_memory_snapshots (
    source,
    scope,
    metrics,
    notes
  )
  VALUES (
    COALESCE(NULLIF(trim(p_source), ''), 'system'),
    COALESCE(p_scope, '{}'),
    COALESCE(v_metrics, '{}'::jsonb),
    COALESCE(p_notes, '{}'::jsonb)
  )
  RETURNING id INTO v_id;

  IF COALESCE((v_metrics ->> 'exposure_targets_stale')::INT, 0) > 0 THEN
    PERFORM public.upsert_ralph_memory_item(
      p_memory_key => 'pipeline.exposure.stale_targets',
      p_category => 'pipeline',
      p_summary => format(
        'Exposure stale targets detected: %s',
        COALESCE(v_metrics ->> 'exposure_targets_stale', '0')
      ),
      p_importance => 80,
      p_status => 'watch',
      p_scope => ARRAY['exposure'],
      p_evidence => jsonb_build_object('snapshot_id', v_id, 'metrics', v_metrics)
    );
  END IF;

  IF COALESCE((v_metrics ->> 'metadata_due_now')::INT, 0) > 0 THEN
    PERFORM public.upsert_ralph_memory_item(
      p_memory_key => 'pipeline.metadata.backlog_due_now',
      p_category => 'pipeline',
      p_summary => format(
        'Metadata due-now backlog: %s',
        COALESCE(v_metrics ->> 'metadata_due_now', '0')
      ),
      p_importance => 75,
      p_status => 'watch',
      p_scope => ARRAY['metadata'],
      p_evidence => jsonb_build_object('snapshot_id', v_id, 'metrics', v_metrics)
    );
  END IF;

  IF COALESCE((v_metrics ->> 'alerts_critical')::INT, 0) = 0 THEN
    PERFORM public.upsert_ralph_memory_item(
      p_memory_key => 'system.health.no_critical_alerts',
      p_category => 'health',
      p_summary => 'No critical alerts in current snapshot',
      p_importance => 60,
      p_status => 'active',
      p_scope => ARRAY['health'],
      p_evidence => jsonb_build_object('snapshot_id', v_id, 'metrics', v_metrics)
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'snapshot_id', v_id,
    'metrics', v_metrics
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_ralph_context_pack(
  p_scope TEXT[] DEFAULT '{}',
  p_hours INT DEFAULT 72,
  p_limit_items INT DEFAULT 20
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scope TEXT[] := COALESCE(p_scope, '{}');
  v_hours INT := GREATEST(COALESCE(p_hours, 72), 1);
  v_limit INT := GREATEST(COALESCE(p_limit_items, 20), 1);
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'generated_at', now(),
    'scope', v_scope,
    'window_hours', v_hours,
    'health_24h', public.get_ralph_health(24),
    'latest_snapshot', (
      SELECT jsonb_build_object(
        'id', s.id,
        'created_at', s.created_at,
        'source', s.source,
        'scope', s.scope,
        'metrics', s.metrics,
        'notes', s.notes
      )
      FROM public.ralph_memory_snapshots s
      ORDER BY s.created_at DESC
      LIMIT 1
    ),
    'recent_snapshots', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'created_at', s.created_at,
          'source', s.source,
          'metrics', s.metrics
        )
        ORDER BY s.created_at DESC
      )
      FROM (
        SELECT id, created_at, source, metrics
        FROM public.ralph_memory_snapshots
        WHERE created_at >= now() - make_interval(hours => v_hours)
        ORDER BY created_at DESC
        LIMIT 36
      ) s
    ), '[]'::jsonb),
    'memory_items', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', mi.id,
          'memory_key', mi.memory_key,
          'category', mi.category,
          'importance', mi.importance,
          'status', mi.status,
          'scope', mi.scope,
          'summary', mi.summary,
          'evidence', mi.evidence,
          'first_seen_at', mi.first_seen_at,
          'last_seen_at', mi.last_seen_at,
          'hit_count', mi.hit_count
        )
        ORDER BY mi.importance DESC, mi.last_seen_at DESC
      )
      FROM (
        SELECT *
        FROM public.ralph_memory_items mi
        WHERE mi.status IN ('active', 'watch')
          AND (
            COALESCE(array_length(mi.scope, 1), 0) = 0
            OR COALESCE(array_length(v_scope, 1), 0) = 0
            OR mi.scope && v_scope
          )
        ORDER BY mi.importance DESC, mi.last_seen_at DESC
        LIMIT v_limit
      ) mi
    ), '[]'::jsonb),
    'open_alerts', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'alert_key', a.alert_key,
          'severity', a.severity,
          'message', a.message,
          'details', a.details,
          'updated_at', a.updated_at
        )
        ORDER BY a.updated_at DESC
      )
      FROM public.system_alerts_current a
      WHERE a.severity <> 'ok'
    ), '[]'::jsonb),
    'latest_reports', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', w.id,
          'slug', w.slug,
          'title', w.title,
          'status', w.status,
          'published_at', w.published_at,
          'updated_at', w.updated_at
        )
        ORDER BY w.updated_at DESC
      )
      FROM (
        SELECT id, slug, title, status, published_at, updated_at
        FROM public.weekly_reports
        ORDER BY updated_at DESC
        LIMIT 5
      ) w
    ), '[]'::jsonb)
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_ralph_memory_item(TEXT, TEXT, TEXT, INT, TEXT, TEXT[], JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.compute_ralph_memory_snapshot(TEXT, TEXT[], JSONB, INT, BOOLEAN) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_ralph_context_pack(TEXT[], INT, INT) TO authenticated, service_role;
