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

async function requireAdminOrEditor(req: Request, supabase: any): Promise<string> {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  if (!token) throw new Error("forbidden");

  const { data: u, error: uErr } = await supabase.auth.getUser(token);
  if (uErr || !u?.user?.id) throw new Error("forbidden");
  const userId = u.user.id;

  const { data: roles, error: rErr } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .in("role", ["admin", "editor"])
    .limit(1);
  if (rErr || !roles || roles.length === 0) throw new Error("forbidden");
  return userId;
}

function toDate(d: string | Date): string {
  const x = typeof d === "string" ? new Date(d) : d;
  return x.toISOString().slice(0, 10);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(mustEnv("SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const userId = await requireAdminOrEditor(req, supabase);

    let body: any = {};
    try { body = await req.json(); } catch { body = {}; }

    const weeklyReportId = body.weeklyReportId ? String(body.weeklyReportId) : null;
    const reportIdIn = body.reportId ? String(body.reportId) : null;
    const runAi = body.runAi != null ? Boolean(body.runAi) : true;
    const reinjectExposure = body.reinjectExposure != null ? Boolean(body.reinjectExposure) : true;
    const refreshMetadata = body.refreshMetadata != null ? Boolean(body.refreshMetadata) : false;

    if (!weeklyReportId && !reportIdIn) return json({ success: false, error: "Missing weeklyReportId or reportId" }, 400);

    // ── Resolve report & weekly report ──
    let reportId = reportIdIn;
    let wrRow: any = null;
    if (weeklyReportId) {
      const { data, error } = await supabase
        .from("weekly_reports")
        .select("id,discover_report_id,date_from,date_to,rankings_json")
        .eq("id", weeklyReportId)
        .single();
      if (error || !data) return json({ success: false, error: "weekly report not found" }, 404);
      wrRow = data;
      reportId = String(data.discover_report_id || "");
      if (!reportId) return json({ success: false, error: "weekly report missing discover_report_id" }, 400);
    }

    const { data: report, error: rErr } = await supabase
      .from("discover_reports")
      .select("id,week_start,week_end,week_number,year")
      .eq("id", reportId!)
      .single();
    if (rErr || !report) return json({ success: false, error: "discover report not found" }, 404);

    const weekStartDate = toDate(report.week_start);
    const weekEndDate = toDate(report.week_end);

    // ── Find previous report for WoW baselines ──
    const { data: prev } = await supabase
      .from("discover_reports")
      .select("id")
      .eq("phase", "done")
      .lt("week_end", report.week_start)
      .order("week_end", { ascending: false })
      .limit(1)
      .maybeSingle();
    const prevReportId = prev?.id ? String(prev.id) : null;

    // ── Optional: refresh metadata for top exposure items ──
    if (refreshMetadata && wrRow?.rankings_json?.discoveryExposure?.topByPanel) {
      const topByPanel = Array.isArray(wrRow.rankings_json.discoveryExposure.topByPanel)
        ? wrRow.rankings_json.discoveryExposure.topByPanel : [];
      const codes = Array.from(new Set(topByPanel.map((r: any) => String(r.linkCode)).filter(Boolean))).slice(0, 500);
      if (codes.length) {
        await supabase.functions.invoke("discover-links-metadata-collector", {
          body: { mode: "refresh_link_codes", linkCodes: codes },
        });
      }
    }

    // ══════════════════════════════════════════════════════════
    // CORE: Call ALL finalize RPCs in parallel (same as collector)
    // ══════════════════════════════════════════════════════════
    console.log(`[rebuild] Starting parallel RPCs for report ${reportId}`);

    const [
      kpisRes, rankingsRes, creatorsRes, categoriesRes,
      distributionsRes, trendingRes, moversRes,
      newIslandsRes, updatedRes, newCountRes,
      toolSplitRes, rookiesRes, exposureAnalysisRes, exposureEfficiencyRes,
    ] = await Promise.all([
      supabase.rpc("report_finalize_kpis", { p_report_id: reportId, p_prev_report_id: prevReportId }),
      supabase.rpc("report_finalize_rankings", { p_report_id: reportId, p_limit: 10 }),
      supabase.rpc("report_finalize_creators", { p_report_id: reportId, p_limit: 10 }),
      supabase.rpc("report_finalize_categories", { p_report_id: reportId, p_limit: 15 }),
      supabase.rpc("report_finalize_distributions", { p_report_id: reportId }),
      supabase.rpc("report_finalize_trending", { p_report_id: reportId, p_min_islands: 5, p_limit: 20 }),
      prevReportId
        ? supabase.rpc("report_finalize_wow_movers", { p_report_id: reportId, p_prev_report_id: prevReportId, p_limit: 10 })
        : Promise.resolve({ data: { topRisers: [], topDecliners: [] }, error: null }),
      supabase.rpc("report_new_islands_by_launch", { p_report_id: reportId, p_week_start: weekStartDate, p_week_end: weekEndDate, p_limit: 50 }),
      supabase.rpc("report_most_updated_islands", { p_report_id: reportId, p_week_start: weekStartDate, p_week_end: weekEndDate, p_limit: 50 }),
      supabase.rpc("report_new_islands_by_launch_count", { p_report_id: reportId, p_week_start: weekStartDate, p_week_end: weekEndDate }),
      supabase.rpc("report_finalize_tool_split", { p_report_id: reportId }),
      supabase.rpc("report_finalize_rookies", { p_report_id: reportId, p_limit: 10 }),
      supabase.rpc("report_finalize_exposure_analysis", { p_report_id: reportId!, p_days: 7 }),
      supabase.rpc("report_finalize_exposure_efficiency", { p_report_id: reportId!, p_limit: 15 }),
    ]);

    // Log RPC errors
    for (const [name, res] of [
      ["kpis", kpisRes], ["rankings", rankingsRes], ["creators", creatorsRes],
      ["categories", categoriesRes], ["distributions", distributionsRes],
      ["trending", trendingRes], ["movers", moversRes],
      ["toolSplit", toolSplitRes], ["rookies", rookiesRes], ["exposureAnalysis", exposureAnalysisRes], ["exposureEfficiency", exposureEfficiencyRes],
    ] as const) {
      if ((res as any).error) console.error(`[rebuild] RPC ${name} error:`, (res as any).error.message);
    }

    // ── Assemble KPIs ──
    const platformKPIs = {
      ...(kpisRes.data || {}),
      newMapsThisWeekPublished: newCountRes.data != null ? Number(newCountRes.data) : (kpisRes.data?.newMapsThisWeek || 0),
      baselineAvailable: Boolean(prevReportId),
    };

    // ── Assemble Rankings ──
    const topNewItems = (newIslandsRes.data || []).map((r: any) => ({
      code: r.island_code, name: r.title || r.island_code, title: r.title,
      creator: r.creator_code, category: r.category || "Fortnite UGC", value: r.week_plays || 0,
    }));

    // Enrich mostUpdated with version (from RPC) and image_url (from cache)
    const updatedRaw = updatedRes.data || [];
    const mostUpdatedItems = updatedRaw.map((r: any) => ({
      code: r.island_code, name: r.title || r.island_code, title: r.title,
      creator: r.creator_code, category: r.category || "Fortnite UGC", value: r.week_plays || 0,
      version: r.version || null,
    }));

    const computedRankings: any = {
      ...(rankingsRes.data || {}),
      ...(creatorsRes.data || {}),
      ...(categoriesRes.data || {}),
      ...(distributionsRes.data || {}),
      ...(trendingRes.data || {}),
      ...(moversRes.data || {}),
      ...(toolSplitRes.data || {}),
      ...(rookiesRes.data || {}),
      ...(exposureAnalysisRes.data || {}),
      ...(exposureEfficiencyRes.data || {}),
      topNewIslandsByPlays: topNewItems,
      topNewIslandsByPlaysPublished: topNewItems,
      topNewIslandsByCCU: [...topNewItems].sort((a, b) => (b.value || 0) - (a.value || 0)).slice(0, 10),
      mostUpdatedIslandsThisWeek: mostUpdatedItems,
      topAvgPeakCCU: (rankingsRes.data || {} as any).topPeakCCU || [],
      topAvgPeakCCU_UGC: (rankingsRes.data || {} as any).topPeakCCU_UGC || [],
      baselineAvailable: Boolean(prevReportId),
    };

    // ── Bulk-enrich ALL island ranking items with image_url from cache ──
    const ISLAND_RANKING_KEYS = [
      "topPeakCCU", "topPeakCCU_UGC", "topUniquePlayers", "topTotalPlays",
      "topMinutesPlayed", "topAvgMinutesPerPlayer", "topRetentionD1", "topRetentionD7",
      "topPlaysPerPlayer", "topFavsPer100", "topRecPer100", "topFavsPerPlay", "topRecsPerPlay",
      "topStickinessD1", "topStickinessD7", "topStickinessD1_UGC", "topStickinessD7_UGC",
      "topRetentionAdjD1", "topRetentionAdjD7",
      "failedIslandsList", "revivedIslands", "deadIslands",
      "topWeeklyGrowth", "topRisers", "topDecliners",
      "topNewIslandsByPlays", "topNewIslandsByPlaysPublished", "topNewIslandsByCCU",
      "mostUpdatedIslandsThisWeek",
    ];
    const allCodes = new Set<string>();
    for (const key of ISLAND_RANKING_KEYS) {
      const arr = computedRankings[key];
      if (Array.isArray(arr)) {
        for (const item of arr) {
          const c = item.code || item.island_code;
          if (c) allCodes.add(c);
        }
      }
    }
    const codesArr = Array.from(allCodes);
    const imageMap: Record<string, string> = {};
    if (codesArr.length > 0) {
      // Fetch in batches of 500
      for (let i = 0; i < codesArr.length; i += 500) {
        const batch = codesArr.slice(i, i + 500);
        const { data: cacheRows } = await supabase
          .from("discover_islands_cache")
          .select("island_code, image_url")
          .in("island_code", batch);
        for (const row of (cacheRows || [])) {
          if (row.image_url) imageMap[row.island_code] = row.image_url;
        }
      }
    }
    // Inject image_url into every ranking item
    for (const key of ISLAND_RANKING_KEYS) {
      const arr = computedRankings[key];
      if (Array.isArray(arr)) {
        for (const item of arr) {
          const c = item.code || item.island_code;
          if (c && imageMap[c] && !item.image_url) {
            item.image_url = imageMap[c];
          }
        }
      }
    }

    // ── Save to discover_reports ──
    await supabase.from("discover_reports").update({
      platform_kpis: platformKPIs,
      computed_rankings: computedRankings,
    }).eq("id", reportId!);

    console.log(`[rebuild] RPCs done. KPIs: totalIslands=${platformKPIs.totalIslands}, active=${platformKPIs.activeIslands}, new=${platformKPIs.newMapsThisWeekPublished}`);

    // ── Update weekly_reports CMS entry ──
    if (weeklyReportId) {
      // Build evidence packs in parallel
      const [covRes, histRes, expCovRes, topPanelsRes, breadthRes] = await Promise.all([
        supabase.rpc("report_link_metadata_coverage", { p_report_id: reportId }),
        supabase.rpc("report_low_perf_histogram", { p_report_id: reportId }),
        supabase.rpc("report_exposure_coverage", { p_weekly_report_id: weeklyReportId }),
        supabase.rpc("discovery_exposure_top_panels", { p_date_from: weekStartDate, p_date_to: weekEndDate, p_limit: 20 }),
        supabase.rpc("discovery_exposure_breadth_top", { p_date_from: weekStartDate, p_date_to: weekEndDate, p_limit: 20 }),
      ]);

      const evidence = {
        dataQuality: {
          baselineAvailable: Boolean(prevReportId),
          metadataCoverage: covRes.data || null,
          exposureCoverage: expCovRes.data || null,
          lowPerformanceHistogram: histRes.data || null,
        },
        newIslands: { topByPlays: topNewItems.slice(0, 20), topByPlayers: topNewItems.slice(0, 20) },
        updates: { mostUpdated: mostUpdatedItems.slice(0, 20) },
        exposure: {
          topPanelsByMinutes: topPanelsRes.data || [],
          breadthTop: breadthRes.data || [],
          hasDiscoveryExposure: true,
        },
      };

      computedRankings.evidence = evidence;

      // ── Fetch pollution data ──
      const { data: pollutionRows } = await supabase
        .from("discovery_public_pollution_creators_now")
        .select("*")
        .order("spam_score", { ascending: false })
        .limit(30);
      if (pollutionRows && pollutionRows.length > 0) {
        computedRankings.discoveryPollution = pollutionRows.map((r: any) => ({
          creator_code: r.creator_code,
          spam_score: r.spam_score,
          duplicate_clusters_7d: r.duplicate_clusters_7d,
          duplicate_islands_7d: r.duplicate_islands_7d,
          duplicates_over_min: r.duplicates_over_min,
          sample_titles: r.sample_titles || [],
          as_of: r.as_of,
        }));
      }

      const { data: wrExisting } = await supabase
        .from("weekly_reports")
        .select("id,rebuild_count")
        .eq("id", weeklyReportId)
        .single();

      await supabase.from("weekly_reports").update({
        kpis_json: platformKPIs,
        rankings_json: computedRankings,
        rebuild_count: Number(wrExisting?.rebuild_count || 0) + 1,
        last_rebuilt_at: new Date().toISOString(),
      }).eq("id", weeklyReportId);

      // Audit rebuild run (best-effort)
      try {
        await supabase.from("discover_report_rebuild_runs").insert({
          weekly_report_id: weeklyReportId,
          report_id: reportId,
          user_id: userId,
          ts_start: new Date().toISOString(),
          ts_end: new Date().toISOString(),
          ok: true,
          summary_json: {
            baselineAvailable: Boolean(prevReportId),
            totalIslands: platformKPIs.totalIslands,
            activeIslands: platformKPIs.activeIslands,
            newPublishedCount: platformKPIs.newMapsThisWeekPublished,
            trendingTopics: (trendingRes.data?.trendsByPlays || []).length,
          },
        });
      } catch (_e) { /* ignore */ }
    }

    // ── Reinject exposure ──
    if (reinjectExposure && weeklyReportId) {
      console.log(`[rebuild] Reinjecting exposure for weekly ${weeklyReportId}`);
      await supabase.functions.invoke("discover-exposure-report", { body: { weeklyReportId } });
    }

    // ── Run AI narratives ──
    if (runAi) {
      console.log(`[rebuild] Running AI for report ${reportId}`);
      await supabase.functions.invoke("discover-report-ai", { body: { reportId } });
    }

    // ── Mark as completed ──
    await supabase.from("discover_reports").update({
      status: "completed",
      phase: "done",
      progress_pct: 100,
    }).eq("id", reportId!);

    console.log(`[rebuild] Complete.`);

    return json({
      success: true,
      reportId,
      weeklyReportId,
      baselineAvailable: Boolean(prevReportId),
      totalIslands: platformKPIs.totalIslands,
      activeIslands: platformKPIs.activeIslands,
      newPublishedCount: platformKPIs.newMapsThisWeekPublished,
      trendingTopics: (trendingRes.data?.trendsByPlays || []).length,
      ranAi: runAi,
      reinjectedExposure: reinjectExposure,
    });
  } catch (e) {
    console.error("[rebuild] Fatal error:", e);
    return json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
