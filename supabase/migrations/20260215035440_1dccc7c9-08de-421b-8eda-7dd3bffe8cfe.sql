
CREATE OR REPLACE FUNCTION public.compute_discovery_public_intel(p_as_of timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '45s'
AS $function$
DECLARE v_premium INT:=0; v_emerging INT:=0; v_pollution INT:=0;
BEGIN
  IF (auth.jwt()->>'role') IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;

  TRUNCATE discovery_public_premium_now;
  INSERT INTO discovery_public_premium_now(as_of,region,surface_name,panel_name,panel_display_name,panel_type,link_code,link_code_type,rank,ccu,title,creator_code)
  SELECT DISTINCT ON (t.region, ps.surface_name, ps.panel_name, COALESCE(ps.best_rank,999))
    p_as_of,t.region,ps.surface_name,ps.panel_name,ps.panel_display_name,ps.panel_type,ps.link_code,ps.link_code_type,COALESCE(ps.best_rank,999),ps.ccu_end,c.title,c.creator_code
  FROM discovery_exposure_presence_segments ps
  JOIN discovery_exposure_targets t ON t.id=ps.target_id
  JOIN discovery_panel_tiers pt ON pt.panel_name=ps.panel_name AND pt.tier=1
  LEFT JOIN discover_islands_cache c ON c.island_code=ps.link_code
  WHERE ps.end_ts IS NULL AND t.last_ok_tick_at IS NOT NULL
  ORDER BY t.region, ps.surface_name, ps.panel_name, COALESCE(ps.best_rank,999), ps.ccu_end DESC NULLS LAST;
  GET DIAGNOSTICS v_premium=ROW_COUNT;

  TRUNCATE discovery_public_emerging_now;
  INSERT INTO discovery_public_emerging_now(as_of,region,surface_name,link_code,link_code_type,first_seen_at,panels_24h,premium_panels_24h,minutes_24h,minutes_6h,best_rank_24h,reentries_24h,score,title,creator_code)
  SELECT p_as_of,t.region,ps.surface_name,ps.link_code,MAX(ps.link_code_type),MIN(ps.start_ts),COUNT(DISTINCT ps.panel_name)::int,COUNT(DISTINCT CASE WHEN pt.tier=1 THEN ps.panel_name END)::int,COALESCE(SUM(EXTRACT(EPOCH FROM(COALESCE(ps.end_ts,p_as_of)-ps.start_ts))/60.0)::int,0),COALESCE(SUM(CASE WHEN ps.start_ts>=p_as_of-interval'6h' THEN EXTRACT(EPOCH FROM(COALESCE(ps.end_ts,p_as_of)-ps.start_ts))/60.0 ELSE 0 END)::int,0),MIN(ps.best_rank),COUNT(*)::int,(COUNT(DISTINCT ps.panel_name)*10+COUNT(DISTINCT CASE WHEN pt.tier=1 THEN ps.panel_name END)*50+COALESCE(SUM(EXTRACT(EPOCH FROM(COALESCE(ps.end_ts,p_as_of)-ps.start_ts))/60.0),0))::float8
  FROM discovery_exposure_presence_segments ps JOIN discovery_exposure_targets t ON t.id=ps.target_id LEFT JOIN discovery_panel_tiers pt ON pt.panel_name=ps.panel_name LEFT JOIN discover_islands_cache c ON c.island_code=ps.link_code
  WHERE ps.start_ts>=p_as_of-interval'24h' AND ps.link_code_type='island' AND t.last_ok_tick_at IS NOT NULL GROUP BY t.region,ps.surface_name,ps.link_code HAVING MIN(ps.start_ts)>=p_as_of-interval'24h';
  UPDATE discovery_public_emerging_now e SET title=c.title,creator_code=c.creator_code FROM discover_islands_cache c WHERE c.island_code=e.link_code AND(e.title IS NULL OR e.creator_code IS NULL);
  GET DIAGNOSTICS v_emerging=ROW_COUNT;

  TRUNCATE discovery_public_pollution_creators_now;
  WITH ip AS(SELECT c.creator_code,ps.link_code,c.title,ps.panel_name FROM discovery_exposure_presence_segments ps JOIN discover_islands_cache c ON c.island_code=ps.link_code JOIN discovery_exposure_targets t ON t.id=ps.target_id WHERE ps.start_ts>=p_as_of-interval'7d' AND ps.link_code_type='island' AND c.creator_code IS NOT NULL AND t.last_ok_tick_at IS NOT NULL),cs AS(SELECT creator_code,COUNT(DISTINCT link_code)::int ti,COUNT(DISTINCT panel_name)::int tp,array_agg(DISTINCT title ORDER BY title)FILTER(WHERE title IS NOT NULL)tt FROM ip GROUP BY creator_code HAVING COUNT(DISTINCT link_code)>=3)
  INSERT INTO discovery_public_pollution_creators_now(as_of,creator_code,duplicate_islands_7d,duplicate_clusters_7d,duplicates_over_min,spam_score,sample_titles)SELECT p_as_of,cs.creator_code,cs.ti,GREATEST(cs.ti/3,1),GREATEST(cs.ti-2,0),(cs.ti*cs.tp)::float8,cs.tt[1:5] FROM cs WHERE cs.ti>=5 ORDER BY(cs.ti*cs.tp)DESC LIMIT 50;
  GET DIAGNOSTICS v_pollution=ROW_COUNT;

  RETURN jsonb_build_object('as_of',p_as_of,'premium_rows',v_premium,'emerging_rows',v_emerging,'pollution_rows',v_pollution);
END;$function$;
