CREATE OR REPLACE FUNCTION public.compute_discovery_panel_intel_snapshot(
  p_target_id uuid,
  p_window_days int DEFAULT 14,
  p_panel_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_window_days int := GREATEST(1, LEAST(COALESCE(p_window_days, 14), 60));
  v_window_start timestamptz := now() - make_interval(days => GREATEST(1, LEAST(COALESCE(p_window_days, 14), 60)));
  v_region text;
  v_surface text;
  v_upserted int := 0;
  v_processed_panels int := 0;
BEGIN
  IF (auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT t.region, t.surface_name
  INTO v_region, v_surface
  FROM public.discovery_exposure_targets t
  WHERE t.id = p_target_id
  LIMIT 1;

  IF v_region IS NULL OR v_surface IS NULL THEN
    RAISE EXCEPTION 'target_not_found';
  END IF;

  WITH panel_source AS (
    SELECT DISTINCT s.panel_name
    FROM public.discovery_exposure_presence_segments s
    WHERE s.target_id = p_target_id
      AND s.link_code_type = 'island'
      AND s.start_ts < v_now
      AND COALESCE(s.end_ts, s.last_seen_ts, v_now) > v_window_start
      AND (p_panel_name IS NULL OR s.panel_name = p_panel_name)
    UNION
    SELECT p_panel_name
    WHERE p_panel_name IS NOT NULL
  ),
  all_stint_base AS (
    SELECT
      s.panel_name,
      s.link_code,
      GREATEST(s.start_ts, v_window_start) AS overlap_start,
      LEAST(COALESCE(s.end_ts, s.last_seen_ts, v_now), v_now) AS overlap_end,
      s.ccu_start,
      s.ccu_end,
      s.ccu_max,
      s.end_ts,
      s.closed_reason
    FROM public.discovery_exposure_presence_segments s
    WHERE s.target_id = p_target_id
      AND s.link_code_type = 'island'
      AND s.start_ts < v_now
      AND COALESCE(s.end_ts, s.last_seen_ts, v_now) > v_window_start
  ),
  all_stint_enriched AS (
    SELECT
      b.panel_name,
      b.link_code,
      b.overlap_start,
      b.overlap_end,
      EXTRACT(EPOCH FROM (b.overlap_end - b.overlap_start)) / 60.0 AS stint_minutes,
      b.ccu_start,
      b.ccu_end,
      b.ccu_max,
      b.end_ts,
      b.closed_reason,
      CASE
        WHEN (CASE WHEN b.ccu_start IS NOT NULL THEN 1 ELSE 0 END
            + CASE WHEN b.ccu_end IS NOT NULL THEN 1 ELSE 0 END
            + CASE WHEN b.ccu_max IS NOT NULL THEN 1 ELSE 0 END) = 0 THEN NULL
        ELSE (
          COALESCE(b.ccu_start, 0)::numeric
          + COALESCE(b.ccu_end, 0)::numeric
          + COALESCE(b.ccu_max, 0)::numeric
        ) / (
          (CASE WHEN b.ccu_start IS NOT NULL THEN 1 ELSE 0 END)
          + (CASE WHEN b.ccu_end IS NOT NULL THEN 1 ELSE 0 END)
          + (CASE WHEN b.ccu_max IS NOT NULL THEN 1 ELSE 0 END)
        )::numeric
      END AS ccu_ref
    FROM all_stint_base b
    WHERE b.overlap_end > b.overlap_start
  ),
  panel_stints AS (
    SELECT e.*
    FROM all_stint_enriched e
    WHERE e.panel_name IN (SELECT panel_name FROM panel_source)
  ),
  panel_core AS (
    SELECT
      e.panel_name,
      CASE
        WHEN SUM(e.stint_minutes) FILTER (WHERE e.ccu_ref IS NOT NULL) > 0
          THEN (
            SUM(e.ccu_ref * e.stint_minutes) FILTER (WHERE e.ccu_ref IS NOT NULL)
            / SUM(e.stint_minutes) FILTER (WHERE e.ccu_ref IS NOT NULL)
          )::double precision
        ELSE NULL
      END AS panel_avg_ccu
    FROM panel_stints e
    GROUP BY e.panel_name
  ),
  closed_stints AS (
    SELECT *
    FROM panel_stints
    WHERE end_ts IS NOT NULL
      AND stint_minutes > 0
  ),
  closed_operational AS (
    SELECT *
    FROM closed_stints
    WHERE stint_minutes <= 180
  ),
  benchmark_stints AS (
    SELECT * FROM closed_operational
    UNION ALL
    SELECT c.*
    FROM closed_stints c
    WHERE NOT EXISTS (SELECT 1 FROM closed_operational)
  ),
  panel_stint AS (
    SELECT
      b.panel_name,
      COUNT(*)::int AS sample_stints,
      COUNT(*)::int AS sample_closed_stints,
      AVG(b.stint_minutes)::double precision AS avg_exposure_minutes_per_stint,
      CASE
        WHEN COUNT(DISTINCT b.link_code) > 0
          THEN (SUM(b.stint_minutes) / COUNT(DISTINCT b.link_code)::numeric)::double precision
        ELSE 0
      END AS avg_exposure_minutes_per_map
    FROM benchmark_stints b
    GROUP BY b.panel_name
  ),
  panel_percentiles AS (
    SELECT
      b.panel_name,
      PERCENTILE_CONT(0.40) WITHIN GROUP (ORDER BY b.ccu_ref)
        FILTER (WHERE b.ccu_ref IS NOT NULL) AS ccu_p40,
      PERCENTILE_CONT(0.80) WITHIN GROUP (ORDER BY b.ccu_ref)
        FILTER (WHERE b.ccu_ref IS NOT NULL) AS ccu_p80,
      PERCENTILE_CONT(0.40) WITHIN GROUP (ORDER BY b.stint_minutes) AS mins_p40,
      PERCENTILE_CONT(0.80) WITHIN GROUP (ORDER BY b.stint_minutes) AS mins_p80,
      PERCENTILE_CONT(0.35) WITHIN GROUP (ORDER BY b.ccu_end)
        FILTER (WHERE b.ccu_end IS NOT NULL) AS removal_risk_ccu_floor,
      PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY b.stint_minutes) AS typical_exit_minutes
    FROM benchmark_stints b
    GROUP BY b.panel_name
  ),
  panel_events AS (
    SELECT
      e.panel_name,
      COUNT(*) FILTER (WHERE e.event_type = 'enter')::int AS entries_24h,
      COUNT(*) FILTER (WHERE e.event_type = 'exit')::int AS exits_24h
    FROM public.discovery_exposure_presence_events e
    WHERE e.target_id = p_target_id
      AND e.ts >= v_now - interval '24 hours'
      AND e.panel_name IN (SELECT panel_name FROM panel_source)
    GROUP BY e.panel_name
  ),
  panel_replacements AS (
    SELECT
      r.panel_name,
      COUNT(*)::int AS replacements_24h
    FROM public.discovery_exposure_rank_segments r
    WHERE r.target_id = p_target_id
      AND r.closed_reason = 'replaced'
      AND COALESCE(r.end_ts, r.last_seen_ts, v_now) >= v_now - interval '24 hours'
      AND r.panel_name IN (SELECT panel_name FROM panel_source)
    GROUP BY r.panel_name
  ),
  panel_active_now AS (
    SELECT
      s.panel_name,
      COUNT(DISTINCT s.link_code)::int AS active_maps_now
    FROM public.discovery_exposure_presence_segments s
    WHERE s.target_id = p_target_id
      AND s.link_code_type = 'island'
      AND s.end_ts IS NULL
      AND s.panel_name IN (SELECT panel_name FROM panel_source)
    GROUP BY s.panel_name
  ),
  -- Transitions out of panel to next panel for same island
  next_after_close AS (
    SELECT
      s.panel_name AS source_panel,
      s.link_code,
      nx.panel_name AS next_panel,
      EXTRACT(EPOCH FROM (nx.overlap_start - s.overlap_end)) / 60.0 AS gap_minutes,
      s.overlap_end AS transition_ts
    FROM closed_stints s
    JOIN LATERAL (
      SELECT e2.panel_name, e2.overlap_start
      FROM all_stint_enriched e2
      WHERE e2.link_code = s.link_code
        AND e2.overlap_start >= s.overlap_end
      ORDER BY e2.overlap_start
      LIMIT 1
    ) nx ON true
    WHERE nx.panel_name IS NOT NULL
      AND nx.panel_name <> s.panel_name
  ),
  next_dedup_24h AS (
    SELECT
      source_panel,
      next_panel,
      link_code,
      MIN(gap_minutes) AS gap_minutes
    FROM next_after_close
    WHERE transition_ts >= v_now - interval '24 hours'
    GROUP BY source_panel, next_panel, link_code
  ),
  next_dedup_6h AS (
    SELECT
      source_panel,
      next_panel,
      link_code,
      MIN(gap_minutes) AS gap_minutes
    FROM next_after_close
    WHERE transition_ts >= v_now - interval '6 hours'
    GROUP BY source_panel, next_panel, link_code
  ),
  next_counts_24h AS (
    SELECT
      source_panel,
      next_panel,
      COUNT(*)::int AS cnt,
      PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY gap_minutes) AS gap_p50
    FROM next_dedup_24h
    GROUP BY source_panel, next_panel
  ),
  next_counts_6h AS (
    SELECT
      source_panel,
      next_panel,
      COUNT(*)::int AS cnt
    FROM next_dedup_6h
    GROUP BY source_panel, next_panel
  ),
  next_totals AS (
    SELECT
      panel_name,
      SUM(cnt_24h)::int AS out_total_24h,
      SUM(cnt_6h)::int AS out_total_6h
    FROM (
      SELECT source_panel AS panel_name, cnt AS cnt_24h, 0::int AS cnt_6h
      FROM next_counts_24h
      UNION ALL
      SELECT source_panel AS panel_name, 0::int AS cnt_24h, cnt AS cnt_6h
      FROM next_counts_6h
    ) x
    GROUP BY panel_name
  ),
  next_ranked AS (
    SELECT
      n.source_panel,
      n.next_panel,
      n.cnt,
      n.gap_p50,
      SUM(n.cnt) OVER (PARTITION BY n.source_panel) AS total_cnt_24h,
      ROW_NUMBER() OVER (PARTITION BY n.source_panel ORDER BY n.cnt DESC, n.next_panel ASC) AS rn
    FROM next_counts_24h n
  ),
  next_agg AS (
    SELECT
      r.source_panel AS panel_name,
      COALESCE(t.out_total_24h, 0) AS transitions_out_total_24h,
      COALESCE(t.out_total_6h, 0) AS transitions_out_total_6h,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'panel_name', r.next_panel,
            'count', r.cnt,
            'share_pct', CASE WHEN r.total_cnt_24h > 0 THEN ROUND((r.cnt::numeric * 100.0) / r.total_cnt_24h, 1) ELSE 0 END,
            'median_gap_minutes', CASE WHEN r.gap_p50 IS NULL THEN NULL ELSE ROUND(r.gap_p50::numeric, 2) END
          )
          ORDER BY r.cnt DESC, r.next_panel ASC
        ) FILTER (WHERE r.rn <= 5),
        '[]'::jsonb
      ) AS top_next_panels
    FROM next_ranked r
    LEFT JOIN next_totals t ON t.panel_name = r.source_panel
    GROUP BY r.source_panel, t.out_total_24h, t.out_total_6h
  ),
  -- Transitions into panel from previous panel for same island
  prev_before_entry AS (
    SELECT
      s.panel_name AS dest_panel,
      s.link_code,
      pv.panel_name AS prev_panel,
      pv.ccu_end AS prev_ccu_end,
      EXTRACT(EPOCH FROM (s.overlap_start - pv.overlap_end)) / 60.0 AS gap_minutes,
      s.overlap_start AS transition_ts
    FROM panel_stints s
    JOIN LATERAL (
      SELECT e2.panel_name, e2.ccu_end, e2.overlap_end
      FROM all_stint_enriched e2
      WHERE e2.link_code = s.link_code
        AND e2.overlap_end <= s.overlap_start
      ORDER BY e2.overlap_end DESC
      LIMIT 1
    ) pv ON true
    WHERE pv.panel_name IS NOT NULL
      AND pv.panel_name <> s.panel_name
  ),
  prev_dedup_24h AS (
    SELECT
      dest_panel,
      prev_panel,
      link_code,
      MIN(gap_minutes) AS gap_minutes
    FROM prev_before_entry
    WHERE transition_ts >= v_now - interval '24 hours'
    GROUP BY dest_panel, prev_panel, link_code
  ),
  prev_dedup_6h AS (
    SELECT
      dest_panel,
      prev_panel,
      link_code,
      MIN(gap_minutes) AS gap_minutes
    FROM prev_before_entry
    WHERE transition_ts >= v_now - interval '6 hours'
    GROUP BY dest_panel, prev_panel, link_code
  ),
  prev_counts_24h AS (
    SELECT
      dest_panel,
      prev_panel,
      COUNT(*)::int AS cnt,
      PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY gap_minutes) AS gap_p50
    FROM prev_dedup_24h
    GROUP BY dest_panel, prev_panel
  ),
  prev_counts_6h AS (
    SELECT
      dest_panel,
      prev_panel,
      COUNT(*)::int AS cnt
    FROM prev_dedup_6h
    GROUP BY dest_panel, prev_panel
  ),
  prev_totals AS (
    SELECT
      panel_name,
      SUM(cnt_24h)::int AS in_total_24h,
      SUM(cnt_6h)::int AS in_total_6h
    FROM (
      SELECT dest_panel AS panel_name, cnt AS cnt_24h, 0::int AS cnt_6h
      FROM prev_counts_24h
      UNION ALL
      SELECT dest_panel AS panel_name, 0::int AS cnt_24h, cnt AS cnt_6h
      FROM prev_counts_6h
    ) x
    GROUP BY panel_name
  ),
  prev_ranked AS (
    SELECT
      p.dest_panel,
      p.prev_panel,
      p.cnt,
      p.gap_p50,
      SUM(p.cnt) OVER (PARTITION BY p.dest_panel) AS total_cnt_24h,
      ROW_NUMBER() OVER (PARTITION BY p.dest_panel ORDER BY p.cnt DESC, p.prev_panel ASC) AS rn
    FROM prev_counts_24h p
  ),
  prev_agg AS (
    SELECT
      r.dest_panel AS panel_name,
      COALESCE(t.in_total_24h, 0) AS transitions_in_total_24h,
      COALESCE(t.in_total_6h, 0) AS transitions_in_total_6h,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'panel_name', r.prev_panel,
            'count', r.cnt,
            'share_pct', CASE WHEN r.total_cnt_24h > 0 THEN ROUND((r.cnt::numeric * 100.0) / r.total_cnt_24h, 1) ELSE 0 END,
            'median_gap_minutes', CASE WHEN r.gap_p50 IS NULL THEN NULL ELSE ROUND(r.gap_p50::numeric, 2) END
          )
          ORDER BY r.cnt DESC, r.prev_panel ASC
        ) FILTER (WHERE r.rn <= 5),
        '[]'::jsonb
      ) AS top_prev_panels
    FROM prev_ranked r
    LEFT JOIN prev_totals t ON t.panel_name = r.dest_panel
    GROUP BY r.dest_panel, t.in_total_24h, t.in_total_6h
  ),
  neighbor_flow_base AS (
    SELECT
      COALESCE(o.panel_name, i.panel_name) AS panel_name,
      COALESCE(o.neighbor_panel, i.neighbor_panel) AS neighbor_panel,
      COALESCE(o.cnt, 0)::int AS count_out,
      COALESCE(i.cnt, 0)::int AS count_in,
      o.gap_p50 AS out_gap_p50,
      i.gap_p50 AS in_gap_p50
    FROM (
      SELECT source_panel AS panel_name, next_panel AS neighbor_panel, cnt, gap_p50
      FROM next_counts_24h
    ) o
    FULL JOIN (
      SELECT dest_panel AS panel_name, prev_panel AS neighbor_panel, cnt, gap_p50
      FROM prev_counts_24h
    ) i ON i.panel_name = o.panel_name AND i.neighbor_panel = o.neighbor_panel
  ),
  directionality_totals AS (
    SELECT
      COALESCE(o.panel_name, i.panel_name) AS panel_name,
      COALESCE(o.out_total_24h, 0)::int AS out_24h,
      COALESCE(i.in_total_24h, 0)::int AS in_24h,
      (COALESCE(i.in_total_24h, 0) - COALESCE(o.out_total_24h, 0))::int AS net_24h
    FROM next_totals o
    FULL JOIN prev_totals i ON i.panel_name = o.panel_name
  ),
  neighbor_flow_scored AS (
    SELECT
      n.panel_name,
      n.neighbor_panel,
      n.count_out,
      n.count_in,
      (n.count_in - n.count_out)::int AS net_flow,
      CASE WHEN COALESCE(dt.out_24h, 0) > 0 THEN ROUND((n.count_out::numeric * 100.0) / dt.out_24h, 1) ELSE 0 END AS out_share_pct,
      CASE WHEN COALESCE(dt.in_24h, 0) > 0 THEN ROUND((n.count_in::numeric * 100.0) / dt.in_24h, 1) ELSE 0 END AS in_share_pct,
      n.out_gap_p50,
      n.in_gap_p50,
      ROW_NUMBER() OVER (
        PARTITION BY n.panel_name
        ORDER BY (n.count_out + n.count_in) DESC, ABS(n.count_in - n.count_out) DESC, n.neighbor_panel ASC
      ) AS rn
    FROM neighbor_flow_base n
    LEFT JOIN directionality_totals dt ON dt.panel_name = n.panel_name
    WHERE n.neighbor_panel IS NOT NULL
  ),
  neighbor_flow_agg AS (
    SELECT
      panel_name,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'panel_name', neighbor_panel,
            'count_out', count_out,
            'count_in', count_in,
            'net_flow', net_flow,
            'out_share_pct', out_share_pct,
            'in_share_pct', in_share_pct,
            'median_gap_minutes_out', CASE WHEN out_gap_p50 IS NULL THEN NULL ELSE ROUND(out_gap_p50::numeric, 2) END,
            'median_gap_minutes_in', CASE WHEN in_gap_p50 IS NULL THEN NULL ELSE ROUND(in_gap_p50::numeric, 2) END
          )
          ORDER BY (count_out + count_in) DESC, ABS(net_flow) DESC, neighbor_panel ASC
        ) FILTER (WHERE rn <= 8),
        '[]'::jsonb
      ) AS neighbor_net_flow_top
    FROM neighbor_flow_scored
    GROUP BY panel_name
  ),
  prev_stats AS (
    SELECT
      dest_panel AS panel_name,
      PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY prev_ccu_end) FILTER (WHERE prev_ccu_end IS NOT NULL) AS entry_prev_ccu_p50,
      PERCENTILE_CONT(0.80) WITHIN GROUP (ORDER BY prev_ccu_end) FILTER (WHERE prev_ccu_end IS NOT NULL) AS entry_prev_ccu_p80,
      PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY gap_minutes) AS entry_prev_gap_minutes_p50
    FROM prev_before_entry
    GROUP BY dest_panel
  ),
  panel_island_attempts AS (
    SELECT
      panel_name,
      link_code,
      COUNT(*)::int AS attempts
    FROM panel_stints
    GROUP BY panel_name, link_code
  ),
  attempts_stats AS (
    SELECT
      a.panel_name,
      AVG(a.attempts)::double precision AS attempts_avg_per_island,
      PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY a.attempts) AS attempts_p50_per_island,
      ROUND((COUNT(*) FILTER (WHERE a.attempts = 1)::numeric * 100.0) / NULLIF(COUNT(*), 0), 1) AS islands_single_attempt_pct,
      ROUND((COUNT(*) FILTER (WHERE a.attempts >= 2)::numeric * 100.0) / NULLIF(COUNT(*), 0), 1) AS islands_multi_attempt_pct
    FROM panel_island_attempts a
    GROUP BY a.panel_name
  ),
  closed_attempts AS (
    SELECT
      s.panel_name,
      s.link_code,
      s.overlap_start,
      s.overlap_end,
      ROW_NUMBER() OVER (PARTITION BY s.panel_name, s.link_code ORDER BY s.overlap_start) AS attempt_index
    FROM closed_stints s
  ),
  closed_flags AS (
    SELECT
      c.panel_name,
      c.link_code,
      c.attempt_index,
      EXISTS (
        SELECT 1
        FROM panel_stints nx
        WHERE nx.panel_name = c.panel_name
          AND nx.link_code = c.link_code
          AND nx.overlap_start > c.overlap_end
          AND nx.overlap_start <= c.overlap_end + interval '48 hours'
      ) AS has_reentry_48h
    FROM closed_attempts c
  ),
  retry_stats AS (
    SELECT
      f.panel_name,
      ROUND((COUNT(*) FILTER (WHERE f.has_reentry_48h)::numeric * 100.0) / NULLIF(COUNT(*), 0), 1) AS reentry_48h_pct,
      ROUND((COUNT(*) FILTER (WHERE NOT f.has_reentry_48h)::numeric * 100.0) / NULLIF(COUNT(*), 0), 1) AS abandon_48h_pct,
      AVG(f.attempt_index) FILTER (WHERE NOT f.has_reentry_48h) AS attempts_before_abandon_avg,
      PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY f.attempt_index)
        FILTER (WHERE NOT f.has_reentry_48h) AS attempts_before_abandon_p50
    FROM closed_flags f
    GROUP BY f.panel_name
  ),
  final_rows AS (
    SELECT
      p.panel_name,
      COALESCE(ps.sample_stints, 0) AS sample_stints,
      COALESCE(ps.sample_closed_stints, 0) AS sample_closed_stints,
      COALESCE(pa.active_maps_now, 0) AS active_maps_now,
      COALESCE(pe.entries_24h, 0) AS entries_24h,
      COALESCE(pe.exits_24h, 0) AS exits_24h,
      COALESCE(pr.replacements_24h, 0) AS replacements_24h,
      pc.panel_avg_ccu,
      ps.avg_exposure_minutes_per_stint,
      ps.avg_exposure_minutes_per_map,
      pp.ccu_p40,
      pp.ccu_p80,
      pp.mins_p40,
      pp.mins_p80,
      pp.removal_risk_ccu_floor,
      pp.typical_exit_minutes,
      CASE
        WHEN COALESCE(ps.sample_stints, 0) >= 120 AND COALESCE(ps.sample_closed_stints, 0) >= 40 THEN 'high'
        WHEN COALESCE(ps.sample_stints, 0) >= 60 AND COALESCE(ps.sample_closed_stints, 0) >= 20 THEN 'medium'
        ELSE 'low'
      END AS confidence,
      GREATEST(
        COALESCE(pp.removal_risk_ccu_floor, 0),
        COALESCE(pp.ccu_p40, 0)
      ) AS keep_alive_ccu_min,
      COALESCE(pp.typical_exit_minutes, pp.mins_p40, 0) AS keep_alive_minutes_min,
      COALESCE(na.transitions_out_total_24h, 0) AS transitions_out_total,
      COALESCE(na.transitions_out_total_6h, 0) AS transitions_out_total_6h,
      COALESCE(na.transitions_out_total_24h, 0) AS transitions_out_total_24h,
      COALESCE(na.top_next_panels, '[]'::jsonb) AS top_next_panels,
      COALESCE(pa2.transitions_in_total_24h, 0) AS transitions_in_total,
      COALESCE(pa2.transitions_in_total_6h, 0) AS transitions_in_total_6h,
      COALESCE(pa2.transitions_in_total_24h, 0) AS transitions_in_total_24h,
      COALESCE(pa2.top_prev_panels, '[]'::jsonb) AS top_prev_panels,
      COALESCE(nf.neighbor_net_flow_top, '[]'::jsonb) AS neighbor_net_flow_top,
      COALESCE(dt.out_24h, 0) AS direction_out_24h,
      COALESCE(dt.in_24h, 0) AS direction_in_24h,
      COALESCE(dt.net_24h, 0) AS direction_net_24h,
      pst.entry_prev_ccu_p50,
      pst.entry_prev_ccu_p80,
      pst.entry_prev_gap_minutes_p50,
      ast.attempts_avg_per_island,
      ast.attempts_p50_per_island,
      ast.islands_single_attempt_pct,
      ast.islands_multi_attempt_pct,
      rst.reentry_48h_pct,
      rst.abandon_48h_pct,
      rst.attempts_before_abandon_avg,
      rst.attempts_before_abandon_p50
    FROM panel_source p
    LEFT JOIN panel_core pc ON pc.panel_name = p.panel_name
    LEFT JOIN panel_stint ps ON ps.panel_name = p.panel_name
    LEFT JOIN panel_percentiles pp ON pp.panel_name = p.panel_name
    LEFT JOIN panel_events pe ON pe.panel_name = p.panel_name
    LEFT JOIN panel_replacements pr ON pr.panel_name = p.panel_name
    LEFT JOIN panel_active_now pa ON pa.panel_name = p.panel_name
    LEFT JOIN next_agg na ON na.panel_name = p.panel_name
    LEFT JOIN prev_agg pa2 ON pa2.panel_name = p.panel_name
    LEFT JOIN neighbor_flow_agg nf ON nf.panel_name = p.panel_name
    LEFT JOIN directionality_totals dt ON dt.panel_name = p.panel_name
    LEFT JOIN prev_stats pst ON pst.panel_name = p.panel_name
    LEFT JOIN attempts_stats ast ON ast.panel_name = p.panel_name
    LEFT JOIN retry_stats rst ON rst.panel_name = p.panel_name
  ),
  upserted AS (
    INSERT INTO public.discovery_panel_intel_snapshot (
      target_id,
      region,
      surface_name,
      panel_name,
      window_days,
      as_of,
      payload_json,
      sample_stints,
      sample_closed_stints,
      active_maps_now,
      confidence,
      updated_at
    )
    SELECT
      p_target_id,
      v_region,
      v_surface,
      f.panel_name,
      v_window_days,
      v_now,
      jsonb_build_object(
        'benchmark_mode', 'closed_stints_operational_180m',
        'panel_avg_ccu', CASE WHEN f.panel_avg_ccu IS NULL THEN NULL ELSE ROUND(f.panel_avg_ccu::numeric, 2) END,
        'avg_exposure_minutes_per_stint', CASE WHEN f.avg_exposure_minutes_per_stint IS NULL THEN NULL ELSE ROUND(f.avg_exposure_minutes_per_stint::numeric, 2) END,
        'avg_exposure_minutes_per_map', CASE WHEN f.avg_exposure_minutes_per_map IS NULL THEN NULL ELSE ROUND(f.avg_exposure_minutes_per_map::numeric, 2) END,
        'entries_24h', f.entries_24h,
        'exits_24h', f.exits_24h,
        'replacements_24h', f.replacements_24h,
        'ccu_bands', jsonb_build_object(
          'ruim_lt', CASE WHEN f.ccu_p40 IS NULL THEN NULL ELSE ROUND(f.ccu_p40::numeric, 2) END,
          'bom_gte', CASE WHEN f.ccu_p40 IS NULL THEN NULL ELSE ROUND(f.ccu_p40::numeric, 2) END,
          'excelente_gte', CASE WHEN f.ccu_p80 IS NULL THEN NULL ELSE ROUND(f.ccu_p80::numeric, 2) END
        ),
        'exposure_bands_minutes', jsonb_build_object(
          'ruim_lt', CASE WHEN f.mins_p40 IS NULL THEN NULL ELSE ROUND(f.mins_p40::numeric, 2) END,
          'bom_gte', CASE WHEN f.mins_p40 IS NULL THEN NULL ELSE ROUND(f.mins_p40::numeric, 2) END,
          'excelente_gte', CASE WHEN f.mins_p80 IS NULL THEN NULL ELSE ROUND(f.mins_p80::numeric, 2) END
        ),
        'removal_risk_ccu_floor', CASE WHEN f.removal_risk_ccu_floor IS NULL THEN NULL ELSE ROUND(f.removal_risk_ccu_floor::numeric, 2) END,
        'typical_exit_minutes', CASE WHEN f.typical_exit_minutes IS NULL THEN NULL ELSE ROUND(f.typical_exit_minutes::numeric, 2) END,
        'keep_alive_targets', jsonb_build_object(
          'ccu_min', CASE WHEN f.keep_alive_ccu_min = 0 THEN NULL ELSE ROUND(f.keep_alive_ccu_min::numeric, 2) END,
          'minutes_min', CASE WHEN f.keep_alive_minutes_min = 0 THEN NULL ELSE ROUND(f.keep_alive_minutes_min::numeric, 2) END
        ),
        'transitions_out_total', f.transitions_out_total,
        'transitions_out_total_6h', f.transitions_out_total_6h,
        'transitions_out_total_24h', f.transitions_out_total_24h,
        'top_next_panels', f.top_next_panels,
        'transitions_in_total', f.transitions_in_total,
        'transitions_in_total_6h', f.transitions_in_total_6h,
        'transitions_in_total_24h', f.transitions_in_total_24h,
        'top_prev_panels', f.top_prev_panels,
        'neighbor_net_flow_top', f.neighbor_net_flow_top,
        'directionality_totals', jsonb_build_object(
          'out_24h', f.direction_out_24h,
          'in_24h', f.direction_in_24h,
          'net_24h', f.direction_net_24h
        ),
        'entry_prev_ccu_p50', CASE WHEN f.entry_prev_ccu_p50 IS NULL THEN NULL ELSE ROUND(f.entry_prev_ccu_p50::numeric, 2) END,
        'entry_prev_ccu_p80', CASE WHEN f.entry_prev_ccu_p80 IS NULL THEN NULL ELSE ROUND(f.entry_prev_ccu_p80::numeric, 2) END,
        'entry_prev_gap_minutes_p50', CASE WHEN f.entry_prev_gap_minutes_p50 IS NULL THEN NULL ELSE ROUND(f.entry_prev_gap_minutes_p50::numeric, 2) END,
        'attempts_avg_per_island', CASE WHEN f.attempts_avg_per_island IS NULL THEN NULL ELSE ROUND(f.attempts_avg_per_island::numeric, 2) END,
        'attempts_p50_per_island', CASE WHEN f.attempts_p50_per_island IS NULL THEN NULL ELSE ROUND(f.attempts_p50_per_island::numeric, 2) END,
        'islands_single_attempt_pct', CASE WHEN f.islands_single_attempt_pct IS NULL THEN NULL ELSE ROUND(f.islands_single_attempt_pct::numeric, 1) END,
        'islands_multi_attempt_pct', CASE WHEN f.islands_multi_attempt_pct IS NULL THEN NULL ELSE ROUND(f.islands_multi_attempt_pct::numeric, 1) END,
        'reentry_48h_pct', CASE WHEN f.reentry_48h_pct IS NULL THEN NULL ELSE ROUND(f.reentry_48h_pct::numeric, 1) END,
        'abandon_48h_pct', CASE WHEN f.abandon_48h_pct IS NULL THEN NULL ELSE ROUND(f.abandon_48h_pct::numeric, 1) END,
        'attempts_before_abandon_avg', CASE WHEN f.attempts_before_abandon_avg IS NULL THEN NULL ELSE ROUND(f.attempts_before_abandon_avg::numeric, 2) END,
        'attempts_before_abandon_p50', CASE WHEN f.attempts_before_abandon_p50 IS NULL THEN NULL ELSE ROUND(f.attempts_before_abandon_p50::numeric, 2) END
      ),
      f.sample_stints,
      f.sample_closed_stints,
      f.active_maps_now,
      f.confidence,
      now()
    FROM final_rows f
    ON CONFLICT (target_id, panel_name, window_days)
    DO UPDATE SET
      region = EXCLUDED.region,
      surface_name = EXCLUDED.surface_name,
      as_of = EXCLUDED.as_of,
      payload_json = EXCLUDED.payload_json,
      sample_stints = EXCLUDED.sample_stints,
      sample_closed_stints = EXCLUDED.sample_closed_stints,
      active_maps_now = EXCLUDED.active_maps_now,
      confidence = EXCLUDED.confidence,
      updated_at = now()
    RETURNING 1
  )
  SELECT COUNT(*)::int INTO v_upserted FROM upserted;

  v_processed_panels := COALESCE(v_upserted, 0);

  RETURN jsonb_build_object(
    'target_id', p_target_id,
    'window_days', v_window_days,
    'processed_panels', COALESCE(v_processed_panels, 0),
    'upserted_rows', COALESCE(v_upserted, 0),
    'as_of', v_now
  );
END;
$$;
