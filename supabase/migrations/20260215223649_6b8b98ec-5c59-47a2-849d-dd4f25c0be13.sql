
CREATE OR REPLACE FUNCTION public.discovery_exposure_run_maintenance(
  p_raw_hours integer DEFAULT 3,
  p_segment_days integer DEFAULT 30,
  p_delete_batch integer DEFAULT 200000,
  p_do_rollup boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '90s'
AS $function$
DECLARE
  v_raw_deleted INT:=0; v_presence_deleted INT:=0; v_rank_deleted INT:=0;
  v_presence_stale_closed INT:=0; v_rank_stale_closed INT:=0;
  v_rollup_rows INT:=0; v_rollup_date DATE:=(CURRENT_DATE-1);
  v_events_deleted INT:=0; v_linkstate_deleted INT:=0;
BEGIN
  IF (auth.jwt()->>'role') IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;

  WITH todel AS(SELECT id FROM discovery_exposure_entries_raw WHERE ts<now()-make_interval(hours=>GREATEST(p_raw_hours,1)) ORDER BY ts ASC LIMIT GREATEST(p_delete_batch,1))
  DELETE FROM discovery_exposure_entries_raw r USING todel d WHERE r.id=d.id;
  GET DIAGNOSTICS v_raw_deleted=ROW_COUNT;

  UPDATE discovery_exposure_presence_segments SET end_ts=last_seen_ts,closed_reason=COALESCE(closed_reason,'stale_cleanup')
  WHERE end_ts IS NULL AND last_seen_ts<now()-make_interval(days=>GREATEST(p_segment_days,1));
  GET DIAGNOSTICS v_presence_stale_closed=ROW_COUNT;

  UPDATE discovery_exposure_rank_segments SET end_ts=last_seen_ts,closed_reason=COALESCE(closed_reason,'stale_cleanup')
  WHERE end_ts IS NULL AND last_seen_ts<now()-make_interval(days=>GREATEST(p_segment_days,1));
  GET DIAGNOSTICS v_rank_stale_closed=ROW_COUNT;

  WITH todel AS(SELECT id FROM discovery_exposure_presence_segments WHERE end_ts IS NOT NULL AND end_ts<now()-make_interval(days=>GREATEST(p_segment_days,1)) ORDER BY end_ts ASC LIMIT GREATEST(p_delete_batch,1))
  DELETE FROM discovery_exposure_presence_segments s USING todel d WHERE s.id=d.id;
  GET DIAGNOSTICS v_presence_deleted=ROW_COUNT;

  WITH todel AS(SELECT id FROM discovery_exposure_rank_segments WHERE end_ts IS NOT NULL AND end_ts<now()-make_interval(days=>GREATEST(p_segment_days,1)) ORDER BY end_ts ASC LIMIT GREATEST(p_delete_batch,1))
  DELETE FROM discovery_exposure_rank_segments s USING todel d WHERE s.id=d.id;
  GET DIAGNOSTICS v_rank_deleted=ROW_COUNT;

  -- Events retention: 30 days (was 7 days)
  WITH todel AS(SELECT id FROM discovery_exposure_presence_events WHERE ts<now()-interval'30 days' ORDER BY ts ASC LIMIT GREATEST(p_delete_batch,1))
  DELETE FROM discovery_exposure_presence_events ev USING todel d WHERE ev.id=d.id;
  GET DIAGNOSTICS v_events_deleted=ROW_COUNT;

  DELETE FROM discovery_exposure_link_state WHERE last_seen_at<now()-interval'14 days';
  GET DIAGNOSTICS v_linkstate_deleted=ROW_COUNT;

  IF p_do_rollup THEN v_rollup_rows:=compute_discovery_exposure_rollup_daily(v_rollup_date); END IF;

  RETURN jsonb_build_object('raw_deleted',v_raw_deleted,'presence_deleted',v_presence_deleted,
    'rank_deleted',v_rank_deleted,'presence_stale_closed',v_presence_stale_closed,
    'rank_stale_closed',v_rank_stale_closed,'rollup_date',v_rollup_date,
    'rollup_rows',v_rollup_rows,'do_rollup',p_do_rollup,
    'events_deleted',v_events_deleted,'linkstate_deleted',v_linkstate_deleted);
END;$function$;
