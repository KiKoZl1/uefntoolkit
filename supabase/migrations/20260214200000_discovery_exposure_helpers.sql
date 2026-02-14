-- Discovery Exposure helpers: maintenance + rollup + report aggregations

-- ============================================================
-- 1) Daily rollup computation (from rank segments; accurate rank-weighting)
-- ============================================================
CREATE OR REPLACE FUNCTION public.compute_discovery_exposure_rollup_daily(
  p_date DATE
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows INT := 0;
  v_start TIMESTAMPTZ := (p_date::timestamptz);
  v_end TIMESTAMPTZ := (p_date::timestamptz + interval '1 day');
BEGIN
  IF (auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  WITH segs AS (
    SELECT
      s.target_id,
      s.surface_name,
      s.panel_name,
      s.link_code,
      s.link_code_type,
      s.rank,
      s.ccu_max,
      GREATEST(s.start_ts, v_start) AS a,
      LEAST(COALESCE(s.end_ts, s.last_seen_ts), v_end) AS b
    FROM public.discovery_exposure_rank_segments s
    WHERE s.start_ts < v_end
      AND COALESCE(s.end_ts, s.last_seen_ts) > v_start
  ),
  overlapped AS (
    SELECT
      target_id, surface_name, panel_name, link_code, link_code_type, rank, ccu_max,
      EXTRACT(EPOCH FROM (b - a))::double precision AS secs
    FROM segs
    WHERE b > a
  ),
  agg AS (
    SELECT
      p_date AS date,
      target_id,
      surface_name,
      panel_name,
      link_code,
      link_code_type,
      CEIL(SUM(secs) / 60.0)::int AS minutes_exposed,
      COUNT(*)::int AS appearances,
      MIN(rank)::int AS best_rank,
      (SUM((rank::double precision) * secs) / NULLIF(SUM(secs), 0))::double precision AS avg_rank,
      MAX(ccu_max)::int AS ccu_max_seen
    FROM overlapped
    GROUP BY target_id, surface_name, panel_name, link_code, link_code_type
  )
  INSERT INTO public.discovery_exposure_rollup_daily (
    date, target_id, surface_name, panel_name, link_code, link_code_type,
    minutes_exposed, appearances, best_rank, avg_rank, ccu_max_seen,
    distinct_creators
  )
  SELECT
    date, target_id, surface_name, panel_name, link_code, link_code_type,
    minutes_exposed, appearances, best_rank, avg_rank, ccu_max_seen,
    CASE
      WHEN link_code_type = 'island' THEN 1
      ELSE NULL
    END
  FROM agg
  ON CONFLICT (date, target_id, panel_name, link_code)
  DO UPDATE SET
    surface_name = EXCLUDED.surface_name,
    link_code_type = EXCLUDED.link_code_type,
    minutes_exposed = EXCLUDED.minutes_exposed,
    appearances = EXCLUDED.appearances,
    best_rank = EXCLUDED.best_rank,
    avg_rank = EXCLUDED.avg_rank,
    ccu_max_seen = EXCLUDED.ccu_max_seen,
    distinct_creators = EXCLUDED.distinct_creators;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN COALESCE(v_rows, 0);
END;
$$;

-- ============================================================
-- 2) Maintenance RPC (called by Edge Function daily)
-- ============================================================
CREATE OR REPLACE FUNCTION public.discovery_exposure_run_maintenance(
  p_raw_hours INT DEFAULT 48,
  p_segment_days INT DEFAULT 30,
  p_delete_batch INT DEFAULT 200000
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_raw_deleted INT := 0;
  v_presence_deleted INT := 0;
  v_rank_deleted INT := 0;
  v_presence_stale_closed INT := 0;
  v_rank_stale_closed INT := 0;
  v_rollup_rows INT := 0;
  v_rollup_date DATE := (CURRENT_DATE - 1);
BEGIN
  IF (auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Raw retention: delete in bounded batches
  WITH todel AS (
    SELECT id
    FROM public.discovery_exposure_entries_raw
    WHERE ts < now() - make_interval(hours => GREATEST(p_raw_hours, 1))
    ORDER BY ts ASC
    LIMIT GREATEST(p_delete_batch, 1)
  )
  DELETE FROM public.discovery_exposure_entries_raw r
  USING todel d
  WHERE r.id = d.id;
  GET DIAGNOSTICS v_raw_deleted = ROW_COUNT;

  -- Close stale open segments (should be rare)
  UPDATE public.discovery_exposure_presence_segments
  SET end_ts = last_seen_ts,
      closed_reason = COALESCE(closed_reason, 'stale_cleanup')
  WHERE end_ts IS NULL
    AND last_seen_ts < now() - make_interval(days => GREATEST(p_segment_days, 1));
  GET DIAGNOSTICS v_presence_stale_closed = ROW_COUNT;

  UPDATE public.discovery_exposure_rank_segments
  SET end_ts = last_seen_ts,
      closed_reason = COALESCE(closed_reason, 'stale_cleanup')
  WHERE end_ts IS NULL
    AND last_seen_ts < now() - make_interval(days => GREATEST(p_segment_days, 1));
  GET DIAGNOSTICS v_rank_stale_closed = ROW_COUNT;

  -- Segment retention: delete closed segments older than N days (bounded batches)
  WITH todel AS (
    SELECT id
    FROM public.discovery_exposure_presence_segments
    WHERE end_ts IS NOT NULL
      AND end_ts < now() - make_interval(days => GREATEST(p_segment_days, 1))
    ORDER BY end_ts ASC
    LIMIT GREATEST(p_delete_batch, 1)
  )
  DELETE FROM public.discovery_exposure_presence_segments s
  USING todel d
  WHERE s.id = d.id;
  GET DIAGNOSTICS v_presence_deleted = ROW_COUNT;

  WITH todel AS (
    SELECT id
    FROM public.discovery_exposure_rank_segments
    WHERE end_ts IS NOT NULL
      AND end_ts < now() - make_interval(days => GREATEST(p_segment_days, 1))
    ORDER BY end_ts ASC
    LIMIT GREATEST(p_delete_batch, 1)
  )
  DELETE FROM public.discovery_exposure_rank_segments s
  USING todel d
  WHERE s.id = d.id;
  GET DIAGNOSTICS v_rank_deleted = ROW_COUNT;

  -- Compute yesterday rollup
  v_rollup_rows := public.compute_discovery_exposure_rollup_daily(v_rollup_date);

  RETURN jsonb_build_object(
    'raw_deleted', v_raw_deleted,
    'presence_deleted', v_presence_deleted,
    'rank_deleted', v_rank_deleted,
    'presence_stale_closed', v_presence_stale_closed,
    'rank_stale_closed', v_rank_stale_closed,
    'rollup_date', v_rollup_date,
    'rollup_rows', v_rollup_rows
  );
END;
$$;

-- ============================================================
-- 3) Report aggregations (small payloads; used by discover-exposure-report)
-- ============================================================
CREATE OR REPLACE FUNCTION public.discovery_exposure_top_by_panel(
  p_date_from DATE,
  p_date_to DATE,
  p_limit_per_panel INT DEFAULT 3
)
RETURNS TABLE (
  target_id UUID,
  surface_name TEXT,
  panel_name TEXT,
  link_code TEXT,
  link_code_type TEXT,
  minutes_exposed INT,
  ccu_max_seen INT,
  best_rank INT,
  avg_rank DOUBLE PRECISION
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH base AS (
    SELECT
      r.target_id,
      MAX(r.surface_name) AS surface_name,
      r.panel_name,
      r.link_code,
      MAX(r.link_code_type) AS link_code_type,
      SUM(r.minutes_exposed)::int AS minutes_exposed,
      MAX(r.ccu_max_seen)::int AS ccu_max_seen,
      MIN(r.best_rank)::int AS best_rank,
      (SUM(r.avg_rank * r.minutes_exposed) / NULLIF(SUM(r.minutes_exposed), 0))::double precision AS avg_rank
    FROM public.discovery_exposure_rollup_daily r
    WHERE r.date >= p_date_from
      AND r.date < p_date_to
    GROUP BY r.target_id, r.panel_name, r.link_code
  ),
  ranked AS (
    SELECT
      *,
      ROW_NUMBER() OVER (PARTITION BY target_id, panel_name ORDER BY minutes_exposed DESC, ccu_max_seen DESC NULLS LAST, link_code ASC) AS rn
    FROM base
  )
  SELECT
    target_id, surface_name, panel_name, link_code, link_code_type,
    minutes_exposed, ccu_max_seen, best_rank, avg_rank
  FROM ranked
  WHERE rn <= GREATEST(p_limit_per_panel, 1)
  ORDER BY target_id, panel_name, rn;
$$;

CREATE OR REPLACE FUNCTION public.discovery_exposure_panel_daily_summaries(
  p_date_from DATE,
  p_date_to DATE
)
RETURNS TABLE (
  date DATE,
  target_id UUID,
  surface_name TEXT,
  panel_name TEXT,
  maps INT,
  creators INT,
  collections INT
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH base AS (
    SELECT
      r.date,
      r.target_id,
      r.surface_name,
      r.panel_name,
      r.link_code,
      r.link_code_type
    FROM public.discovery_exposure_rollup_daily r
    WHERE r.date >= p_date_from
      AND r.date < p_date_to
  ),
  islands AS (
    SELECT
      b.date,
      b.target_id,
      b.surface_name,
      b.panel_name,
      b.link_code
    FROM base b
    WHERE b.link_code_type = 'island'
  ),
  collections AS (
    SELECT
      b.date,
      b.target_id,
      b.surface_name,
      b.panel_name,
      b.link_code
    FROM base b
    WHERE b.link_code_type = 'collection'
  ),
  creators AS (
    SELECT DISTINCT
      i.date,
      i.target_id,
      i.surface_name,
      i.panel_name,
      c.creator_code
    FROM islands i
    JOIN public.discover_islands_cache c
      ON c.island_code = i.link_code
    WHERE c.creator_code IS NOT NULL
  )
  SELECT
    d::date AS date,
    t.target_id,
    t.surface_name,
    t.panel_name,
    COALESCE(m.maps, 0)::int AS maps,
    COALESCE(cr.creators, 0)::int AS creators,
    COALESCE(col.collections, 0)::int AS collections
  FROM (
    SELECT DISTINCT date AS d, target_id, surface_name, panel_name FROM base
  ) t
  LEFT JOIN (
    SELECT date, target_id, surface_name, panel_name, COUNT(DISTINCT link_code)::int AS maps
    FROM islands
    GROUP BY date, target_id, surface_name, panel_name
  ) m USING (date, target_id, surface_name, panel_name)
  LEFT JOIN (
    SELECT date, target_id, surface_name, panel_name, COUNT(DISTINCT creator_code)::int AS creators
    FROM creators
    GROUP BY date, target_id, surface_name, panel_name
  ) cr USING (date, target_id, surface_name, panel_name)
  LEFT JOIN (
    SELECT date, target_id, surface_name, panel_name, COUNT(DISTINCT link_code)::int AS collections
    FROM collections
    GROUP BY date, target_id, surface_name, panel_name
  ) col USING (date, target_id, surface_name, panel_name)
  ORDER BY date DESC, target_id, panel_name;
$$;
