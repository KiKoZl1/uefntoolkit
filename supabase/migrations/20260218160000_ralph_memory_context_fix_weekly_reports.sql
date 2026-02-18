-- Fix get_ralph_context_pack weekly_reports columns
-- weekly_reports uses public_slug/title_public in this project schema.

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
          'slug', w.public_slug,
          'title', w.title_public,
          'status', w.status,
          'published_at', w.published_at,
          'updated_at', w.updated_at
        )
        ORDER BY w.updated_at DESC
      )
      FROM (
        SELECT id, public_slug, title_public, status, published_at, updated_at
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

GRANT EXECUTE ON FUNCTION public.get_ralph_context_pack(TEXT[], INT, INT) TO authenticated, service_role;
