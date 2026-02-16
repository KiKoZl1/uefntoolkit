import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(res: unknown, status = 200) {
  return new Response(JSON.stringify(res), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function mustEnv(key: string): string {
  const v = Deno.env.get(key);
  if (!v) throw new Error(`Missing env var: ${key}`);
  return v;
}

function toUtcStart(dateStr: string): string {
  // dateStr is YYYY-MM-DD
  return new Date(`${dateStr}T00:00:00.000Z`).toISOString();
}

function toUtcEndExclusive(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00.000Z`).toISOString();
}

function durationMinutes(startIso: string, endIso: string): number {
  const a = new Date(startIso).getTime();
  const b = new Date(endIso).getTime();
  return Math.max(0, Math.round((b - a) / 60000));
}

async function fetchAll<T>(
  q: any,
  pageSize = 1000,
  maxRows = 100000,
): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const { data, error } = await q.range(offset, offset + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = (data || []) as T[];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Auth guard: require service_role key
    const authHeader = req.headers.get("Authorization") || "";
    const serviceKey = mustEnv("SUPABASE_SERVICE_ROLE_KEY");
    if (authHeader !== `Bearer ${serviceKey}`) {
      return json({ error: "Forbidden: service_role required" }, 403);
    }

    const supabase = createClient(mustEnv("SUPABASE_URL"), serviceKey);

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const weeklyReportId = body.weeklyReportId as string | undefined;
    if (!weeklyReportId) return json({ success: false, error: "Missing weeklyReportId" }, 400);

    const { data: wr, error: wrErr } = await supabase
      .from("weekly_reports")
      .select("id,date_from,date_to,rankings_json")
      .eq("id", weeklyReportId)
      .single();
    if (wrErr || !wr) return json({ success: false, error: wrErr?.message || "weekly report not found" }, 404);

    const dateFrom = String(wr.date_from);
    const dateTo = String(wr.date_to);
    const rangeStart = toUtcStart(dateFrom);
    const rangeEnd = toUtcEndExclusive(dateTo);

    const { data: targets, error: tErr } = await supabase
      .from("discovery_exposure_targets")
      .select("id,region,surface_name,platform,locale,interval_minutes,last_ok_tick_at")
      .in("surface_name", ["CreativeDiscoverySurface_Frontend", "CreativeDiscoverySurface_Browse"]);
    if (tErr) throw new Error(tErr.message);

    // Default: include all active targets (so adding BR/ASIA automatically shows up in reports)
    // Caller can override by passing regions: ["NAE","EU",...].
    const reqRegions = Array.isArray(body.regions) ? body.regions.map((r: any) => String(r)) : null;
    const targetRows = (targets || [])
      .filter((t: any) => (reqRegions ? reqRegions.includes(String(t.region)) : true))
      .filter((t: any) => t.last_ok_tick_at != null) as any[];

    const targetIds = targetRows.map((t) => String(t.id));

    // Panels metadata from rank segments overlapping the report range.
    const panelMetaByKey = new Map<string, any>();
    for (const tid of targetIds) {
      const q = supabase
        .from("discovery_exposure_rank_segments")
        .select("target_id,surface_name,panel_name,panel_display_name,panel_type,feature_tags,start_ts,end_ts,last_seen_ts")
        .eq("target_id", tid)
        .lt("start_ts", rangeEnd)
        .or(`end_ts.is.null,end_ts.gt.${rangeStart}`);
      const rows = await fetchAll<any>(q, 1000, 20000);
      for (const r of rows) {
        const key = `${r.target_id}|||${r.panel_name}`;
        if (!panelMetaByKey.has(key)) {
          panelMetaByKey.set(key, {
            target_id: r.target_id,
            surface_name: r.surface_name,
            panelName: r.panel_name,
            panelDisplayName: r.panel_display_name,
            panelType: r.panel_type,
            featureTags: r.feature_tags,
          });
        }
      }
    }

    // Rank timeline segments (#1..#10) overlapping the report range.
    const rankSegs: any[] = [];
    for (const tid of targetIds) {
      const q = supabase
        .from("discovery_exposure_rank_segments")
        .select("target_id,surface_name,panel_name,rank,link_code,link_code_type,start_ts,end_ts,last_seen_ts,ccu_max,ccu_start,ccu_end")
        .eq("target_id", tid)
        .lte("rank", 10)
        .lt("start_ts", rangeEnd)
        .or(`end_ts.is.null,end_ts.gt.${rangeStart}`)
        .order("panel_name", { ascending: true })
        .order("rank", { ascending: true })
        .order("start_ts", { ascending: true });
      const rows = await fetchAll<any>(q, 1000, 100000);
      rankSegs.push(...rows);
    }

    const allCodes = Array.from(
      new Set(rankSegs.map((s) => String(s.link_code))),
    );

    // Canonical card metadata (islands + collections)
    const linkMeta = new Map<string, { title: string | null; creator_code: string | null; image_url: string | null }>();
    for (let i = 0; i < allCodes.length; i += 1000) {
      const chunk = allCodes.slice(i, i + 1000);
      const { data, error } = await supabase
        .from("discover_link_metadata")
        .select("link_code,title,support_code,image_url")
        .in("link_code", chunk);
      if (error) throw new Error(error.message);
      for (const r of data || []) {
        linkMeta.set(String(r.link_code), {
          title: r.title ?? null,
          creator_code: (r as any).support_code ?? null,
          image_url: (r as any).image_url ?? null,
        });
      }
    }

    // Fallback for islands (legacy cache might still have creator_code/category)
    const islandCodes = Array.from(
      new Set(rankSegs.filter((s) => String(s.link_code_type) === "island").map((s) => String(s.link_code))),
    );
    const islandFallback = new Map<string, { title: string | null; creator_code: string | null }>();
    for (let i = 0; i < islandCodes.length; i += 1000) {
      const chunk = islandCodes.slice(i, i + 1000);
      const { data, error } = await supabase
        .from("discover_islands_cache")
        .select("island_code,title,creator_code")
        .in("island_code", chunk);
      if (error) throw new Error(error.message);
      for (const r of data || []) {
        islandFallback.set(String(r.island_code), { title: r.title ?? null, creator_code: r.creator_code ?? null });
      }
    }

    // Top 3 per panel for the range (DB-side aggregation).
    const { data: topByPanelRows, error: topErr } = await supabase.rpc("discovery_exposure_top_by_panel", {
      p_date_from: dateFrom,
      p_date_to: dateTo,
      p_limit_per_panel: 3,
    });
    if (topErr) throw new Error(topErr.message);

    // Daily panel summaries (DB-side).
    const { data: panelDailyRows, error: dailyErr } = await supabase.rpc("discovery_exposure_panel_daily_summaries", {
      p_date_from: dateFrom,
      p_date_to: dateTo,
    });
    if (dailyErr) throw new Error(dailyErr.message);

    // Build JSON payload
    const profiles = targetRows.map((t) => ({
      targetId: String(t.id),
      region: t.region,
      surfaceName: t.surface_name,
      platform: t.platform,
      locale: t.locale,
      intervalMinutes: t.interval_minutes,
    }));

    const panels = Array.from(panelMetaByKey.values());

    const panelSummaries: any[] = (panelDailyRows || []).map((r: any) => ({
      date: r.date,
      targetId: r.target_id,
      surfaceName: r.surface_name,
      panelName: r.panel_name,
      maps: Number(r.maps || 0),
      creators: Number(r.creators || 0),
      collections: Number(r.collections || 0),
    }));

    const topByPanel: any[] = (topByPanelRows || []).map((r: any) => {
      const code = String(r.link_code);
      const m = linkMeta.get(code);
      const fb = r.link_code_type === "island" ? islandFallback.get(code) : null;
      return {
        targetId: r.target_id,
        surfaceName: r.surface_name,
        panelName: r.panel_name,
        linkCode: code,
        linkCodeType: r.link_code_type,
        minutesExposed: Number(r.minutes_exposed || 0),
        ccuMaxSeen: r.ccu_max_seen != null ? Number(r.ccu_max_seen) : null,
        bestRank: r.best_rank != null ? Number(r.best_rank) : null,
        avgRank: r.avg_rank != null ? Number(r.avg_rank) : null,
        title: m?.title ?? fb?.title ?? null,
        creatorCode: m?.creator_code ?? fb?.creator_code ?? null,
        imageUrl: m?.image_url ?? null,
      };
    });

    const panelRankTimeline: any[] = rankSegs.map((s: any) => {
      const start = String(s.start_ts);
      const end = s.end_ts ? String(s.end_ts) : String(s.last_seen_ts || s.start_ts);
      const clampedStart = start < rangeStart ? rangeStart : start;
      const clampedEnd = end > rangeEnd ? rangeEnd : end;
      const code = String(s.link_code);
      const m = linkMeta.get(code);
      const fb = String(s.link_code_type) === "island" ? islandFallback.get(code) : null;
      return {
        targetId: s.target_id,
        surfaceName: s.surface_name,
        panelName: s.panel_name,
        rank: Number(s.rank),
        start: clampedStart,
        end: clampedEnd,
        durationMinutes: durationMinutes(clampedStart, clampedEnd),
        linkCode: code,
        linkCodeType: s.link_code_type,
        ccuMax: s.ccu_max != null ? Number(s.ccu_max) : null,
        title: m?.title ?? fb?.title ?? null,
        creatorCode: m?.creator_code ?? fb?.creator_code ?? null,
        imageUrl: m?.image_url ?? null,
      };
    });

    const discoveryExposure = {
      meta: {
        dateFrom,
        dateTo,
        rangeStart,
        rangeEnd,
      },
      profiles,
      panels,
      panelSummaries,
      topByPanel,
      panelRankTimeline,
    };

    const existing = (wr.rankings_json || {}) as any;
    const mergedRankings = { ...existing, discoveryExposure };

    const { error: updErr } = await supabase
      .from("weekly_reports")
      .update({ rankings_json: mergedRankings })
      .eq("id", weeklyReportId);
    if (updErr) throw new Error(updErr.message);

    return json({ success: true, weeklyReportId, injected: true });
  } catch (e) {
    return json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
