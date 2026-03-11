BEGIN;

CREATE OR REPLACE FUNCTION public.get_tgis_training_candidates(
  p_min_score numeric DEFAULT 0.30,
  p_limit int DEFAULT 5000
)
RETURNS TABLE (
  link_code text,
  image_url text,
  tag_group text,
  quality_score numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Fresh databases can run this migration before compute_tgis_thumb_score exists.
  IF to_regprocedure('public.compute_tgis_thumb_score(integer)') IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    s.link_code,
    s.image_url,
    s.tag_group,
    s.quality_score
  FROM public.compute_tgis_thumb_score(14) s
  WHERE s.quality_score >= COALESCE(p_min_score, 0.30)
  ORDER BY s.quality_score DESC
  LIMIT LEAST(50000, GREATEST(1, COALESCE(p_limit, 5000)));
END;
$$;

CREATE OR REPLACE FUNCTION public.get_tgis_training_candidates(
  p_min_score numeric,
  p_limit int,
  p_window_days int
)
RETURNS TABLE (
  link_code text,
  image_url text,
  tag_group text,
  quality_score numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Fresh databases can run this migration before compute_tgis_thumb_score exists.
  IF to_regprocedure('public.compute_tgis_thumb_score(integer)') IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    s.link_code,
    s.image_url,
    s.tag_group,
    s.quality_score
  FROM public.compute_tgis_thumb_score(
    LEAST(365, GREATEST(1, COALESCE(p_window_days, 14)))
  ) s
  WHERE s.quality_score >= COALESCE(p_min_score, 0.30)
  ORDER BY s.quality_score DESC
  LIMIT LEAST(50000, GREATEST(1, COALESCE(p_limit, 5000)));
END;
$$;

CREATE OR REPLACE FUNCTION public.tgis_refresh_dataset_daily()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.tgis_refresh_dataset_daily(0.30, 50000, 14);
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
    COALESCE(p_min_score, 0.30),
    COALESCE(p_limit, 50000),
    COALESCE(p_window_days, 14)
  );

  UPDATE public.tgis_dataset_runs
  SET status = 'success',
      ended_at = now(),
      summary_json = jsonb_build_object(
        'candidate_count', v_count,
        'min_score', COALESCE(p_min_score, 0.30),
        'limit', COALESCE(p_limit, 50000),
        'window_days', COALESCE(p_window_days, 14)
      ),
      updated_at = now()
  WHERE id = v_run_id;

  RETURN jsonb_build_object(
    'ok', true,
    'run_id', v_run_id,
    'candidate_count', v_count,
    'min_score', COALESCE(p_min_score, 0.30),
    'limit', COALESCE(p_limit, 50000),
    'window_days', COALESCE(p_window_days, 14)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_tgis_training_candidates(numeric, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_tgis_training_candidates(numeric, int, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.tgis_refresh_dataset_daily() TO service_role;
GRANT EXECUTE ON FUNCTION public.tgis_refresh_dataset_daily(numeric, int, int) TO service_role;

COMMIT;

