BEGIN;

CREATE OR REPLACE FUNCTION public.tgis_refresh_dataset_daily()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.tgis_refresh_dataset_daily(0.25, 25000, 14);
END;
$$;

CREATE OR REPLACE FUNCTION public.tgis_refresh_dataset_daily(
  p_min_score numeric,
  p_limit int,
  p_window_days int
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id bigint;
  v_count int;
BEGIN
  PERFORM public._tgis_require_service_role();

  INSERT INTO public.tgis_dataset_runs (run_type, status, started_at, summary_json)
  VALUES ('daily_refresh', 'running', now(), '{}'::jsonb)
  RETURNING id INTO v_run_id;

  SELECT COUNT(*)::int INTO v_count
  FROM public.get_tgis_training_candidates(
    COALESCE(p_min_score, 0.25),
    LEAST(50000, GREATEST(1, COALESCE(p_limit, 25000))),
    COALESCE(p_window_days, 14)
  );

  UPDATE public.tgis_dataset_runs
  SET status = 'success',
      ended_at = now(),
      summary_json = jsonb_build_object(
        'candidate_count', v_count,
        'min_score', COALESCE(p_min_score, 0.25),
        'limit', LEAST(50000, GREATEST(1, COALESCE(p_limit, 25000))),
        'window_days', COALESCE(p_window_days, 14)
      ),
      updated_at = now()
  WHERE id = v_run_id;

  RETURN jsonb_build_object(
    'ok', true,
    'run_id', v_run_id,
    'candidate_count', v_count,
    'min_score', COALESCE(p_min_score, 0.25),
    'limit', LEAST(50000, GREATEST(1, COALESCE(p_limit, 25000))),
    'window_days', COALESCE(p_window_days, 14)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.tgis_refresh_dataset_daily() TO service_role;
GRANT EXECUTE ON FUNCTION public.tgis_refresh_dataset_daily(numeric, int, int) TO service_role;

COMMIT;

