import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const EPIC_API = "https://api.fortnite.com/ecosystem/v1";

function dayIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function asNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function classifyLookupError(message: string, httpStatus?: number): string {
  const m = String(message || "").toLowerCase();
  if (httpStatus === 401 || m.includes("unauthorized")) return "auth_error";
  if (httpStatus === 400 || m.includes("invalid island code") || m.includes("islandcode is required")) return "bad_request";
  if (httpStatus === 404 || m.includes("island not found")) return "epic_not_found";
  if (m.includes("abort") || m.includes("timeout")) return "epic_timeout";
  if (m.includes("failed to fetch") || m.includes("network")) return "network_error";
  if (m.includes("rpc") || m.includes("postgres") || m.includes("supabase") || m.includes("db")) return "db_error";
  return "unknown_error";
}

async function safeLogRun(service: any, row: Record<string, unknown>) {
  try {
    await service.from("discover_lookup_pipeline_runs").insert(row);
  } catch (_e) {
    // best-effort log only
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startedAt = Date.now();
  let service: any = null;
  let code = "unknown";
  let userId: string | null = null;

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
    const sbUrl = Deno.env.get("SUPABASE_URL")!;
    const sbAnon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const sbService = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(sbUrl, sbAnon, { global: { headers: { Authorization: authHeader } } });
    service = createClient(sbUrl, sbService);

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await sb.auth.getClaims(token);
    userId = String(claimsData?.claims?.sub || "") || null;
    if (claimsError || !claimsData?.claims) {
      await safeLogRun(service, {
        user_id: userId,
        island_code: code,
        status: "error",
        duration_ms: Date.now() - startedAt,
        error_type: "auth_error",
        error_message: "Unauthorized",
      });
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }
    const { islandCode } = body;
    if (!islandCode) {
      await safeLogRun(service, {
        user_id: userId,
        island_code: code,
        status: "error",
        duration_ms: Date.now() - startedAt,
        error_type: "bad_request",
        error_message: "islandCode is required",
      });
      return new Response(JSON.stringify({ error: "islandCode is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    code = String(islandCode).trim().substring(0, 30);
    if (!/^\d{4}-\d{4}-\d{4}$/.test(code) && !/^[a-zA-Z0-9_-]+$/.test(code)) {
      await safeLogRun(service, {
        user_id: userId,
        island_code: code,
        status: "error",
        duration_ms: Date.now() - startedAt,
        error_type: "bad_request",
        error_message: "Invalid island code format",
      });
      return new Response(JSON.stringify({ error: "Invalid island code format" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Epic metadata
    const metaRes = await fetch(`${EPIC_API}/islands/${code}`);
    if (!metaRes.ok) {
      const message = metaRes.status === 404 ? "Island not found" : `Epic metadata failed (${metaRes.status})`;
      await safeLogRun(service, {
        user_id: userId,
        island_code: code,
        status: "error",
        duration_ms: Date.now() - startedAt,
        error_type: classifyLookupError(message, metaRes.status),
        error_message: message,
      });
      return new Response(JSON.stringify({ error: message }), {
        status: metaRes.status === 404 ? 404 : 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const metadata = await metaRes.json();

    // Epic daily metrics (7d)
    const now = new Date();
    const to = new Date(now);
    to.setUTCHours(0, 0, 0, 0);
    const from = new Date(to);
    from.setUTCDate(from.getUTCDate() - 7);

    const metricsRes = await fetch(
      `${EPIC_API}/islands/${code}/metrics/day?from=${from.toISOString()}&to=${to.toISOString()}`,
    );
    let metrics = null;
    if (metricsRes.ok) metrics = await metricsRes.json();

    // Epic hourly metrics (24h)
    const from24h = new Date(now);
    from24h.setUTCHours(from24h.getUTCHours() - 24);
    const hourlyRes = await fetch(
      `${EPIC_API}/islands/${code}/metrics/hour?from=${from24h.toISOString()}&to=${now.toISOString()}`,
    );
    let hourlyMetrics = null;
    if (hourlyRes.ok) hourlyMetrics = await hourlyRes.json();

    const now14 = new Date();
    now14.setUTCDate(now14.getUTCDate() - 14);
    const fromDay14 = dayIso(now14);

    const [cardRpc, rollupRes, reportIslandsRes, latestReportRes] = await Promise.all([
      service.rpc("get_island_card", { p_island_code: code, p_window_hours: 168 }),
      service
        .from("discovery_exposure_rollup_daily")
        .select("date,panel_name,surface_name,minutes_exposed,best_rank,avg_rank,ccu_max_seen")
        .eq("link_code", code)
        .eq("link_code_type", "island")
        .gte("date", fromDay14)
        .order("date", { ascending: true }),
      service
        .from("discover_report_islands")
        .select("report_id,week_plays,week_unique,week_peak_ccu_max,week_minutes,updated_at,status,category,title,creator_code")
        .eq("island_code", code)
        .eq("status", "reported")
        .order("updated_at", { ascending: false })
        .limit(12),
      service
        .from("discover_reports")
        .select("id,year,week_number,week_start,week_end,status")
        .in("status", ["done", "completed"])
        .order("week_end", { ascending: false })
        .limit(1),
    ]);

    let eventsRes = await service
      .from("discover_link_metadata_events")
      .select("*")
      .eq("link_code", code)
      .order("ts", { ascending: false })
      .limit(20);
    if (eventsRes.error) {
      eventsRes = await service
        .from("discover_link_metadata_events")
        .select("*")
        .eq("link_code", code)
        .order("created_at", { ascending: false })
        .limit(20);
    }

    const internalCard = cardRpc?.data ?? null;

    const rollRows = rollupRes?.data ?? [];
    const panelAgg = new Map<
      string,
      {
        panelName: string;
        surfaceName: string;
        minutesExposed: number;
        bestRank: number | null;
        avgRankSum: number;
        avgRankCount: number;
        ccuMaxSeen: number;
        daysSet: Set<string>;
      }
    >();
    const dailyMinutesMap = new Map<string, number>();

    for (const row of rollRows as any[]) {
      const date = String(row.date || "");
      const key = `${row.surface_name || ""}::${row.panel_name || ""}`;
      if (!panelAgg.has(key)) {
        panelAgg.set(key, {
          panelName: String(row.panel_name || ""),
          surfaceName: String(row.surface_name || ""),
          minutesExposed: 0,
          bestRank: null,
          avgRankSum: 0,
          avgRankCount: 0,
          ccuMaxSeen: 0,
          daysSet: new Set<string>(),
        });
      }
      const a = panelAgg.get(key)!;
      const minutes = asNum(row.minutes_exposed);
      const bestRank = row.best_rank != null ? asNum(row.best_rank) : null;
      const avgRank = row.avg_rank != null ? asNum(row.avg_rank) : null;
      const ccuMax = asNum(row.ccu_max_seen);

      a.minutesExposed += minutes;
      if (bestRank != null && bestRank > 0) {
        a.bestRank = a.bestRank == null ? bestRank : Math.min(a.bestRank, bestRank);
      }
      if (avgRank != null && avgRank > 0) {
        a.avgRankSum += avgRank;
        a.avgRankCount += 1;
      }
      a.ccuMaxSeen = Math.max(a.ccuMaxSeen, ccuMax);
      if (date) a.daysSet.add(date);
      dailyMinutesMap.set(date, (dailyMinutesMap.get(date) || 0) + minutes);
    }

    const exposurePanelsTop = Array.from(panelAgg.values())
      .map((a) => ({
        panelName: a.panelName,
        surfaceName: a.surfaceName,
        minutesExposed: a.minutesExposed,
        bestRank: a.bestRank,
        avgRank: a.avgRankCount > 0 ? Number((a.avgRankSum / a.avgRankCount).toFixed(2)) : null,
        ccuMaxSeen: a.ccuMaxSeen > 0 ? a.ccuMaxSeen : null,
        daysActive: a.daysSet.size,
      }))
      .sort((x, y) => y.minutesExposed - x.minutesExposed)
      .slice(0, 25);

    const exposureDailyMinutes = Array.from(dailyMinutesMap.entries())
      .map(([date, minutesExposed]) => ({ date, minutesExposed }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const reportRows = (reportIslandsRes?.data ?? []) as any[];
    const reportIds = [...new Set(reportRows.map((r) => r.report_id).filter(Boolean))];
    let reportMetaMap = new Map<string, any>();
    if (reportIds.length > 0) {
      const reportMetaRes = await service
        .from("discover_reports")
        .select("id,year,week_number,week_start,week_end,status")
        .in("id", reportIds);
      const reportMetaRows = (reportMetaRes?.data ?? []) as any[];
      reportMetaMap = new Map(reportMetaRows.map((r) => [r.id, r]));
    }

    const weeklyPerformance = reportRows
      .map((r) => {
        const m = reportMetaMap.get(r.report_id);
        return {
          reportId: r.report_id,
          year: m?.year ?? null,
          weekNumber: m?.week_number ?? null,
          weekStart: m?.week_start ?? null,
          weekEnd: m?.week_end ?? null,
          weekPlays: asNum(r.week_plays),
          weekUnique: asNum(r.week_unique),
          weekPeakCcu: asNum(r.week_peak_ccu_max),
          weekMinutes: asNum(r.week_minutes),
        };
      })
      .sort((a, b) => String(a.weekEnd || "").localeCompare(String(b.weekEnd || "")))
      .slice(-10);

    const latestReport = latestReportRes?.data?.[0] ?? null;
    const category = (metadata?.category || (internalCard as any)?.category || reportRows[0]?.category || null) as
      | string
      | null;
    let categoryLeaders: any[] = [];
    if (latestReport?.id && category) {
      const peersRes = await service
        .from("discover_report_islands")
        .select("island_code,title,creator_code,week_unique,week_plays,week_peak_ccu_max")
        .eq("report_id", latestReport.id)
        .eq("status", "reported")
        .eq("category", category)
        .order("week_unique", { ascending: false })
        .limit(10);

      categoryLeaders = ((peersRes?.data ?? []) as any[]).map((p) => ({
        islandCode: p.island_code,
        title: p.title || p.island_code,
        creatorCode: p.creator_code,
        weekUnique: asNum(p.week_unique),
        weekPlays: asNum(p.week_plays),
        weekPeakCcu: asNum(p.week_peak_ccu_max),
      }));
    }

    const metadataEvents = ((eventsRes?.data ?? []) as any[]).map((e) => ({
      ts: e.ts ?? e.created_at ?? null,
      eventType: e.event_type ?? null,
      oldValue: e.old_value ?? null,
      newValue: e.new_value ?? null,
    }));

    await safeLogRun(service, {
      user_id: userId,
      island_code: code,
      status: "ok",
      duration_ms: Date.now() - startedAt,
      has_internal_card: Boolean(internalCard),
      has_discovery_signals: exposurePanelsTop.length > 0 || exposureDailyMinutes.length > 0,
      has_weekly_performance: weeklyPerformance.length > 0,
      category_leaders_count: categoryLeaders.length,
    });

    return new Response(
      JSON.stringify({
        metadata: {
          code: metadata.code,
          title: metadata.title,
          creatorCode: metadata.creatorCode,
          category: metadata.category,
          tags: metadata.tags,
          createdIn: metadata.createdIn,
        },
        dailyMetrics: metrics,
        hourlyMetrics,
        internalCard,
        discoverySignals: {
          panelsTop: exposurePanelsTop,
          dailyMinutes: exposureDailyMinutes,
        },
        metadataEvents,
        weeklyPerformance,
        categoryLeaders,
        latestDoneReport: latestReport
          ? {
              id: latestReport.id,
              year: latestReport.year,
              weekNumber: latestReport.week_number,
              weekStart: latestReport.week_start,
              weekEnd: latestReport.week_end,
              status: latestReport.status,
            }
          : null,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (service) {
      await safeLogRun(service, {
        user_id: userId,
        island_code: code,
        status: "error",
        duration_ms: Date.now() - startedAt,
        error_type: classifyLookupError(msg),
        error_message: msg,
      });
    }
    console.error("Island lookup error:", e);
    return new Response(JSON.stringify({ error: msg || "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
