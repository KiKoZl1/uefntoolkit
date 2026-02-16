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

function asRankingItems(rows: any[], valueKey: string, opts: { nameKey?: string; titleKey?: string } = {}) {
  const nameKey = opts.nameKey || "title";
  const titleKey = opts.titleKey || "title";
  return (rows || []).map((r: any) => ({
    code: r.island_code || r.code,
    title: r[titleKey] || r.title || r.island_code,
    creator: r.creator_code || r.creator || null,
    category: r.category || "Fortnite UGC",
    value: Number(r[valueKey] ?? r.value ?? 0),
    name: r[nameKey] || r.title || r.island_code,
  }));
}

async function buildEvidence(args: {
  supabase: any;
  reportId: string;
  weeklyReportId: string | null;
  weekStartDate: string;
  weekEndDate: string;
  baselineAvailable: boolean;
}) {
  const { supabase, reportId, weeklyReportId, weekStartDate, weekEndDate, baselineAvailable } = args;

  const evidence: any = {};

  // Data quality
  let metaCov: any = null;
  try {
    const { data, error } = await supabase.rpc("report_link_metadata_coverage", { p_report_id: reportId });
    if (!error) metaCov = data;
  } catch (_e) {
    // ignore
  }

  let exposureCov: any = null;
  if (weeklyReportId) {
    try {
      const { data, error } = await supabase.rpc("report_exposure_coverage", { p_weekly_report_id: weeklyReportId });
      if (!error) exposureCov = data;
    } catch (_e) {
      // ignore
    }
  }

  let lowPerfHist: any = null;
  try {
    const { data, error } = await supabase.rpc("report_low_perf_histogram", { p_report_id: reportId });
    if (!error) lowPerfHist = data;
  } catch (_e) {
    // ignore
  }

  evidence.dataQuality = {
    baselineAvailable,
    metadataCoverage: metaCov,
    exposureCoverage: exposureCov,
    lowPerformanceHistogram: lowPerfHist,
  };

  // New islands / updates (cheap helper RPCs)
  try {
    const { data: newRows } = await supabase.rpc("report_new_islands_by_launch", {
      p_report_id: reportId,
      p_week_start: weekStartDate,
      p_week_end: weekEndDate,
      p_limit: 20,
    });
    evidence.newIslands = {
      topByPlays: asRankingItems(newRows || [], "week_plays"),
      topByPlayers: asRankingItems(newRows || [], "week_unique"),
    };
  } catch (_e) {
    // ignore
  }

  try {
    const { data: updRows } = await supabase.rpc("report_most_updated_islands", {
      p_report_id: reportId,
      p_week_start: weekStartDate,
      p_week_end: weekEndDate,
      p_limit: 20,
    });
    evidence.updates = { mostUpdated: asRankingItems(updRows || [], "week_plays") };
  } catch (_e) {
    // ignore
  }

  // Exposure evidence (rollup-based)
  if (weeklyReportId) {
    evidence.exposure = {};
    try {
      const { data: topPanels } = await supabase.rpc("discovery_exposure_top_panels", {
        p_date_from: weekStartDate,
        p_date_to: weekEndDate,
        p_limit: 20,
      });
      evidence.exposure.topPanelsByMinutes = topPanels || [];
    } catch (_e) {
      // ignore
    }
    try {
      const { data: breadth } = await supabase.rpc("discovery_exposure_breadth_top", {
        p_date_from: weekStartDate,
        p_date_to: weekEndDate,
        p_limit: 20,
      });
      evidence.exposure.breadthTop = breadth || [];
    } catch (_e) {
      // ignore
    }

    // How much of collection containers can be expanded into child links (Homebar/reference/ref_panel).
    try {
      const rangeStart = `${weekStartDate}T00:00:00.000Z`;
      const rangeEnd = `${weekEndDate}T00:00:00.000Z`;
      const { data: collSegs, error: collErr } = await supabase
        .from("discovery_exposure_rank_segments")
        .select("link_code")
        .eq("link_code_type", "collection")
        .lt("start_ts", rangeEnd)
        .or(`end_ts.is.null,end_ts.gt.${rangeStart}`)
        .limit(50000);
      if (!collErr) {
        const collectionsSeen = Array.from(new Set((collSegs || []).map((r: any) => String(r.link_code))));
        let resolvedCollections = 0;
        if (collectionsSeen.length) {
          const { data: edges, error: eErr } = await supabase
            .from("discover_link_edges")
            .select("parent_link_code")
            .in("parent_link_code", collectionsSeen);
          if (!eErr) {
            const withEdges = new Set((edges || []).map((r: any) => String(r.parent_link_code)));
            resolvedCollections = withEdges.size;
          }
        }
        const coveragePct = collectionsSeen.length > 0
          ? Number(((resolvedCollections / collectionsSeen.length) * 100).toFixed(1))
          : null;
        evidence.exposure.collectionResolution = {
          collectionsSeen: collectionsSeen.length,
          resolvedCollections,
          coveragePct,
        };
      }
    } catch (_e) {
      // ignore
    }
  }

  return evidence;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(mustEnv("SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const userId = await requireAdminOrEditor(req, supabase);

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const weeklyReportId = body.weeklyReportId ? String(body.weeklyReportId) : null;
    const reportIdIn = body.reportId ? String(body.reportId) : null;
    const runAi = body.runAi != null ? Boolean(body.runAi) : true;
    const reinjectExposure = body.reinjectExposure != null ? Boolean(body.reinjectExposure) : true;
    const refreshMetadata = body.refreshMetadata != null ? Boolean(body.refreshMetadata) : false;

    if (!weeklyReportId && !reportIdIn) return json({ success: false, error: "Missing weeklyReportId or reportId" }, 400);

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
      .select("id,week_start,week_end,platform_kpis,computed_rankings,week_number,year")
      .eq("id", reportId!)
      .single();
    if (rErr || !report) return json({ success: false, error: "discover report not found" }, 404);

    const weekStart = report.week_start;
    const weekEnd = report.week_end;
    const weekStartDate = toDate(weekStart);
    const weekEndDate = toDate(weekEnd);

    const { data: prev, error: pErr } = await supabase
      .from("discover_reports")
      .select("id,week_start,week_end")
      .eq("phase", "done")
      .lt("week_end", weekStart)
      .order("week_end", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    const prevReportId = prev?.id ? String(prev.id) : null;
    const baselineAvailable = Boolean(prevReportId);

    // Optional best-effort: seed metadata for the top items already referenced by exposure injection.
    if (refreshMetadata && wrRow?.rankings_json?.discoveryExposure?.topByPanel) {
      const topByPanel = Array.isArray(wrRow.rankings_json.discoveryExposure.topByPanel)
        ? wrRow.rankings_json.discoveryExposure.topByPanel
        : [];
      const codes = Array.from(new Set(topByPanel.map((r: any) => String(r.linkCode)).filter(Boolean))).slice(0, 500);
      if (codes.length) {
        await supabase.functions.invoke("discover-links-metadata-collector", {
          body: { mode: "refresh_link_codes", linkCodes: codes },
        });
      }
    }

    const { data: cov, error: covErr } = await supabase.rpc("report_link_metadata_coverage", { p_report_id: reportId });
    if (covErr) throw new Error(covErr.message);
    const coverage = cov || {};
    const reportedIslands = Number(coverage.total || 0);
    const withTitle = Number(coverage.withTitle || 0);
    const withImage = Number(coverage.withImageUrl || coverage.withImage || 0);

    const { data: newIslandsRows, error: newErr } = await supabase.rpc("report_new_islands_by_launch", {
      p_report_id: reportId,
      p_week_start: weekStartDate,
      p_week_end: weekEndDate,
      p_limit: 50,
    });
    if (newErr) throw new Error(newErr.message);

    const { data: newIslandsCount, error: newCntErr } = await supabase.rpc("report_new_islands_by_launch_count", {
      p_report_id: reportId,
      p_week_start: weekStartDate,
      p_week_end: weekEndDate,
    });
    if (newCntErr) throw new Error(newCntErr.message);

    const { data: updatedRows, error: updErr } = await supabase.rpc("report_most_updated_islands", {
      p_report_id: reportId,
      p_week_start: weekStartDate,
      p_week_end: weekEndDate,
      p_limit: 50,
    });
    if (updErr) throw new Error(updErr.message);

    let deadUniqueRows: any[] = [];
    if (baselineAvailable) {
      const { data, error } = await supabase.rpc("report_dead_islands_by_unique_drop", {
        p_report_id: reportId,
        p_prev_report_id: prevReportId,
        p_limit: 50,
      });
      if (error) throw new Error(error.message);
      deadUniqueRows = data || [];
    }

    const oldKpis = (report.platform_kpis || {}) as any;
    const oldRankings = (report.computed_rankings || {}) as any;

    const patchKpis = {
      ...oldKpis,
      baselineAvailable,
      newMapsThisWeekPublished: Number(newIslandsCount || 0),
      deadByUniqueDropCount: baselineAvailable ? deadUniqueRows.length : null,
      metadataCoverage: {
        reportedIslands,
        withTitle,
        withImageUrl: withImage,
        titlePct: reportedIslands > 0 ? withTitle / reportedIslands : null,
        imagePct: reportedIslands > 0 ? withImage / reportedIslands : null,
      },
    };

    const patchRankings = {
      ...oldRankings,
      baselineAvailable,
      topNewIslandsByPlaysPublished: asRankingItems(newIslandsRows as any[], "week_plays"),
      topNewIslandsByPlayersPublished: asRankingItems(newIslandsRows as any[], "week_unique"),
      mostUpdatedIslandsThisWeek: asRankingItems(updatedRows as any[], "week_plays"),
      deadIslandsByUniqueDrop: (deadUniqueRows || []).map((r: any) => ({
        code: r.island_code,
        title: r.title || r.island_code,
        creator: r.creator_code || null,
        category: "Fortnite UGC",
        value: Number(r.delta_unique != null ? -Number(r.delta_unique) : 0),
        name: r.title || r.island_code,
        prev: Number(r.prev_week_unique || 0),
        cur: Number(r.week_unique || 0),
        delta: Number(r.delta_unique || 0),
      })),
    };

    await supabase
      .from("discover_reports")
      .update({ platform_kpis: patchKpis, computed_rankings: patchRankings })
      .eq("id", reportId);

    // Update weekly_reports CMS entry too (if we have it)
    if (weeklyReportId) {
      const { data: wrExisting, error: wErr } = await supabase
        .from("weekly_reports")
        .select("id,rankings_json,rebuild_count")
        .eq("id", weeklyReportId)
        .single();
      if (wErr) throw new Error(wErr.message);
      const mergedRankings = { ...(wrExisting.rankings_json || {}), ...patchRankings };

      const evidence = await buildEvidence({
        supabase,
        reportId: reportId!,
        weeklyReportId,
        weekStartDate,
        weekEndDate,
        baselineAvailable,
      });
      (mergedRankings as any).evidence = evidence;

      await supabase
        .from("weekly_reports")
        .update({
          kpis_json: patchKpis,
          rankings_json: mergedRankings,
          rebuild_count: Number((wrExisting as any).rebuild_count || 0) + 1,
          last_rebuilt_at: new Date().toISOString(),
        })
        .eq("id", weeklyReportId);

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
            baselineAvailable,
            metadataCoverage: patchKpis.metadataCoverage,
            newPublishedCount: patchKpis.newMapsThisWeekPublished,
          },
        });
      } catch (_e) {
        // ignore
      }
    }

    if (reinjectExposure && weeklyReportId) {
      await supabase.functions.invoke("discover-exposure-report", { body: { weeklyReportId } });
    }

    if (runAi) {
      await supabase.functions.invoke("discover-report-ai", { body: { reportId } });
    }

    // Ensure status is set to completed after successful rebuild
    await supabase
      .from("discover_reports")
      .update({ status: "completed", phase: "done", progress_pct: 100 })
      .eq("id", reportId!);

    return json({
      success: true,
      reportId,
      weeklyReportId,
      baselineAvailable,
      metadataCoverage: patchKpis.metadataCoverage,
      newPublishedCount: patchKpis.newMapsThisWeekPublished,
      updatedCount: Array.isArray(updatedRows) ? updatedRows.length : 0,
      deadUniqueCount: baselineAvailable ? deadUniqueRows.length : null,
      ranAi: runAi,
      reinjectedExposure: reinjectExposure,
    });
  } catch (e) {
    return json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
