
CREATE OR REPLACE FUNCTION public.apply_discovery_exposure_tick(
  p_target_id uuid, p_tick_id uuid, p_tick_ts timestamp with time zone,
  p_branch text, p_test_variant_name text, p_test_name text, p_test_analytics_id text,
  p_rows jsonb, p_duration_ms integer, p_correlation_id text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_raw_inserted INT := 0;
  v_presence_upserted INT := 0;
  v_presence_closed INT := 0;
  v_rank_replaced_closed INT := 0;
  v_rank_upserted INT := 0;
  v_rank_absent_closed INT := 0;
  v_panels_count INT := 0;
  v_entries_count INT := 0;
  v_events_enter INT := 0;
  v_events_exit INT := 0;
BEGIN
  IF (auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  CREATE TEMP TABLE _tick_incoming ON COMMIT DROP AS
  SELECT
    x.surface_name::text AS surface_name,
    x.panel_name::text AS panel_name,
    NULLIF(x.panel_display_name::text, '') AS panel_display_name,
    NULLIF(x.panel_type::text, '') AS panel_type,
    x.feature_tags::text[] AS feature_tags,
    COALESCE(x.page_index::int, 0) AS page_index,
    GREATEST(x.rank::int, 1) AS rank,
    x.link_code::text AS link_code,
    x.link_code_type::text AS link_code_type,
    x.global_ccu::int AS global_ccu,
    x.is_visible::boolean AS is_visible,
    NULLIF(x.lock_status::text, '') AS lock_status,
    NULLIF(x.lock_status_reason::text, '') AS lock_status_reason
  FROM jsonb_to_recordset(COALESCE(p_rows, '[]'::jsonb)) AS x(
    surface_name text, panel_name text, panel_display_name text, panel_type text,
    feature_tags text[], page_index int, rank int, link_code text, link_code_type text,
    global_ccu int, is_visible boolean, lock_status text, lock_status_reason text
  )
  WHERE x.panel_name IS NOT NULL AND x.panel_name <> ''
    AND x.link_code IS NOT NULL AND x.link_code <> '';

  SELECT COUNT(*)::int, COUNT(DISTINCT panel_name)::int
  INTO v_entries_count, v_panels_count
  FROM _tick_incoming;

  -- 1) Raw insert
  INSERT INTO public.discovery_exposure_entries_raw (
    tick_id, target_id, ts,
    surface_name, panel_name, panel_display_name, panel_type, feature_tags,
    page_index, rank, link_code, link_code_type,
    global_ccu, is_visible, lock_status, lock_status_reason
  )
  SELECT
    p_tick_id, p_target_id, p_tick_ts,
    i.surface_name, i.panel_name, i.panel_display_name, i.panel_type, i.feature_tags,
    i.page_index, i.rank, i.link_code, i.link_code_type,
    i.global_ccu, i.is_visible, i.lock_status, i.lock_status_reason
  FROM _tick_incoming i;
  GET DIAGNOSTICS v_raw_inserted = ROW_COUNT;

  -- 2) Presence segments — collect which are NEW (enter events)
  -- First, identify link_codes that do NOT have an open segment yet
  CREATE TEMP TABLE _new_presence ON COMMIT DROP AS
  SELECT i.surface_name, i.panel_name, i.link_code, i.link_code_type,
         MAX(i.panel_display_name) AS panel_display_name,
         MAX(i.panel_type) AS panel_type,
         MAX(i.feature_tags) AS feature_tags,
         MIN(i.rank)::int AS rank,
         MAX(i.global_ccu)::int AS global_ccu
  FROM (SELECT DISTINCT surface_name, panel_name, link_code FROM _tick_incoming) ik
  LEFT JOIN public.discovery_exposure_presence_segments ps
    ON ps.target_id = p_target_id AND ps.panel_name = ik.panel_name AND ps.link_code = ik.link_code AND ps.end_ts IS NULL
  JOIN _tick_incoming i ON i.surface_name = ik.surface_name AND i.panel_name = ik.panel_name AND i.link_code = ik.link_code
  WHERE ps.id IS NULL
  GROUP BY i.surface_name, i.panel_name, i.link_code, i.link_code_type;

  -- Upsert presence segments
  WITH incoming_presence AS (
    SELECT
      surface_name, panel_name,
      MAX(panel_display_name) AS panel_display_name,
      MAX(panel_type) AS panel_type,
      MAX(feature_tags) AS feature_tags,
      link_code,
      MAX(link_code_type) AS link_code_type,
      MIN(rank)::int AS rank,
      MAX(global_ccu)::int AS global_ccu
    FROM _tick_incoming
    GROUP BY surface_name, panel_name, link_code
  )
  INSERT INTO public.discovery_exposure_presence_segments (
    target_id, surface_name, panel_name, panel_display_name, panel_type, feature_tags,
    link_code, link_code_type,
    start_ts, last_seen_ts, end_ts,
    best_rank, rank_sum, rank_samples, end_rank,
    ccu_start, ccu_max, ccu_end, closed_reason
  )
  SELECT
    p_target_id, i.surface_name, i.panel_name, i.panel_display_name, i.panel_type, i.feature_tags,
    i.link_code, i.link_code_type,
    p_tick_ts, p_tick_ts, NULL,
    i.rank, i.rank, 1, i.rank,
    i.global_ccu, i.global_ccu, i.global_ccu, NULL
  FROM incoming_presence i
  ON CONFLICT (target_id, panel_name, link_code) WHERE end_ts IS NULL
  DO UPDATE SET
    surface_name = EXCLUDED.surface_name,
    panel_display_name = EXCLUDED.panel_display_name,
    panel_type = EXCLUDED.panel_type,
    feature_tags = EXCLUDED.feature_tags,
    last_seen_ts = p_tick_ts,
    best_rank = LEAST(COALESCE(discovery_exposure_presence_segments.best_rank, EXCLUDED.best_rank), EXCLUDED.best_rank),
    rank_sum = discovery_exposure_presence_segments.rank_sum + EXCLUDED.rank_sum,
    rank_samples = discovery_exposure_presence_segments.rank_samples + 1,
    end_rank = EXCLUDED.end_rank,
    ccu_end = EXCLUDED.ccu_end,
    ccu_max = CASE
      WHEN discovery_exposure_presence_segments.ccu_max IS NULL THEN EXCLUDED.ccu_max
      WHEN EXCLUDED.ccu_max IS NULL THEN discovery_exposure_presence_segments.ccu_max
      ELSE GREATEST(discovery_exposure_presence_segments.ccu_max, EXCLUDED.ccu_max)
    END,
    closed_reason = NULL;
  GET DIAGNOSTICS v_presence_upserted = ROW_COUNT;

  -- 2b) Emit ENTER events for new presence
  INSERT INTO public.discovery_exposure_presence_events (
    event_type, ts, tick_id, target_id,
    surface_name, panel_name, panel_display_name, panel_type, feature_tags,
    link_code, link_code_type, rank, global_ccu
  )
  SELECT
    'enter', p_tick_ts, p_tick_id, p_target_id,
    np.surface_name, np.panel_name, np.panel_display_name, np.panel_type, np.feature_tags,
    np.link_code, np.link_code_type, np.rank, np.global_ccu
  FROM _new_presence np;
  GET DIAGNOSTICS v_events_enter = ROW_COUNT;

  -- Close presence segments not seen
  -- First collect which will be closed for exit events
  CREATE TEMP TABLE _closing_presence ON COMMIT DROP AS
  SELECT s.surface_name, s.panel_name, s.panel_display_name, s.panel_type, s.feature_tags,
         s.link_code, s.link_code_type, s.best_rank, s.ccu_end
  FROM public.discovery_exposure_presence_segments s
  WHERE s.target_id = p_target_id AND s.end_ts IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM _tick_incoming k
      WHERE k.panel_name = s.panel_name AND k.link_code = s.link_code
    );

  UPDATE public.discovery_exposure_presence_segments s
  SET end_ts = s.last_seen_ts, closed_reason = 'absent_confirmed'
  WHERE s.target_id = p_target_id AND s.end_ts IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM _tick_incoming k
      WHERE k.panel_name = s.panel_name AND k.link_code = s.link_code
    );
  GET DIAGNOSTICS v_presence_closed = ROW_COUNT;

  -- 2c) Emit EXIT events for closed presence
  INSERT INTO public.discovery_exposure_presence_events (
    event_type, ts, tick_id, target_id,
    surface_name, panel_name, panel_display_name, panel_type, feature_tags,
    link_code, link_code_type, rank, global_ccu, closed_reason
  )
  SELECT
    'exit', p_tick_ts, p_tick_id, p_target_id,
    cp.surface_name, cp.panel_name, cp.panel_display_name, cp.panel_type, cp.feature_tags,
    cp.link_code, cp.link_code_type, cp.best_rank, cp.ccu_end, 'absent_confirmed'
  FROM _closing_presence cp;
  GET DIAGNOSTICS v_events_exit = ROW_COUNT;

  -- 3) Rank segments - close replaced first
  UPDATE public.discovery_exposure_rank_segments s
  SET end_ts = s.last_seen_ts, closed_reason = 'replaced'
  WHERE s.target_id = p_target_id AND s.end_ts IS NULL
    AND EXISTS (
      SELECT 1 FROM _tick_incoming k
      WHERE k.panel_name = s.panel_name AND k.rank = s.rank AND k.link_code <> s.link_code
    );
  GET DIAGNOSTICS v_rank_replaced_closed = ROW_COUNT;

  WITH incoming_rank AS (
    SELECT surface_name, panel_name, MAX(panel_display_name) AS panel_display_name,
      MAX(panel_type) AS panel_type, MAX(feature_tags) AS feature_tags,
      rank, link_code, MAX(link_code_type) AS link_code_type, MAX(global_ccu)::int AS global_ccu
    FROM _tick_incoming GROUP BY surface_name, panel_name, rank, link_code
  )
  INSERT INTO public.discovery_exposure_rank_segments (
    target_id, surface_name, panel_name, panel_display_name, panel_type, feature_tags,
    rank, link_code, link_code_type,
    start_ts, last_seen_ts, end_ts,
    ccu_start, ccu_max, ccu_end, closed_reason
  )
  SELECT
    p_target_id, i.surface_name, i.panel_name, i.panel_display_name, i.panel_type, i.feature_tags,
    i.rank, i.link_code, i.link_code_type,
    p_tick_ts, p_tick_ts, NULL,
    i.global_ccu, i.global_ccu, i.global_ccu, NULL
  FROM incoming_rank i
  ON CONFLICT (target_id, panel_name, rank) WHERE end_ts IS NULL
  DO UPDATE SET
    surface_name = EXCLUDED.surface_name,
    panel_display_name = EXCLUDED.panel_display_name,
    panel_type = EXCLUDED.panel_type,
    feature_tags = EXCLUDED.feature_tags,
    last_seen_ts = p_tick_ts,
    ccu_end = EXCLUDED.ccu_end,
    ccu_max = CASE
      WHEN discovery_exposure_rank_segments.ccu_max IS NULL THEN EXCLUDED.ccu_max
      WHEN EXCLUDED.ccu_max IS NULL THEN discovery_exposure_rank_segments.ccu_max
      ELSE GREATEST(discovery_exposure_rank_segments.ccu_max, EXCLUDED.ccu_max)
    END,
    closed_reason = NULL;
  GET DIAGNOSTICS v_rank_upserted = ROW_COUNT;

  -- Close absent ranks
  UPDATE public.discovery_exposure_rank_segments s
  SET end_ts = s.last_seen_ts, closed_reason = 'absent_confirmed'
  WHERE s.target_id = p_target_id AND s.end_ts IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM _tick_incoming k
      WHERE k.panel_name = s.panel_name AND k.rank = s.rank
    );
  GET DIAGNOSTICS v_rank_absent_closed = ROW_COUNT;

  -- 4) Tick telemetry update
  UPDATE public.discovery_exposure_ticks
  SET ts_end = now(), status = 'ok',
      branch = p_branch, test_variant_name = p_test_variant_name,
      test_name = p_test_name, test_analytics_id = p_test_analytics_id,
      panels_count = COALESCE(v_panels_count, 0),
      entries_count = COALESCE(v_entries_count, 0),
      duration_ms = p_duration_ms, correlation_id = p_correlation_id
  WHERE id = p_tick_id AND target_id = p_target_id;

  RETURN jsonb_build_object(
    'tick_id', p_tick_id, 'target_id', p_target_id,
    'panels_count', COALESCE(v_panels_count, 0), 'entries_count', COALESCE(v_entries_count, 0),
    'raw_inserted', v_raw_inserted,
    'presence_upserted', v_presence_upserted, 'presence_closed', v_presence_closed,
    'events_enter', v_events_enter, 'events_exit', v_events_exit,
    'rank_replaced_closed', v_rank_replaced_closed, 'rank_upserted', v_rank_upserted,
    'rank_absent_closed', v_rank_absent_closed
  );
END;
$function$;
