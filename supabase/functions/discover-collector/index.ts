import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const EPIC_API = "https://api.fortnite.com/ecosystem/v1";
const PARALLEL_BATCH = 5; // Conservative to avoid 429s
const PAGE_SIZE = 100;
const ISLANDS_PER_PASS = 200; // How many islands to fetch metrics for per call
const TIME_LIMIT_MS = 50000; // Stop fetching metrics at 50s to leave time for DB save

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithRetry(url: string, retries = 3): Promise<any> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res.json();
      if (res.status === 429) {
        const wait = (i + 1) * 3000;
        console.log(`Rate limited on ${url}, waiting ${wait / 1000}s...`);
        await delay(wait);
        continue;
      }
      if (res.status === 404) return null;
      console.error(`Error ${res.status} for ${url}`);
      return null;
    } catch (e) {
      console.error(`Fetch error:`, e);
      if (i < retries - 1) await delay(1000);
    }
  }
  return null;
}

// Fetch one page of islands from Epic API
async function fetchIslandPage(cursor: string | null): Promise<{ islands: any[]; nextCursor: string | null }> {
  let url = `${EPIC_API}/islands?size=${PAGE_SIZE}`;
  if (cursor) url += `&after=${encodeURIComponent(cursor)}`;

  const data = await fetchWithRetry(url);
  if (!data?.data?.length) return { islands: [], nextCursor: null };

  let nextCursor: string | null = null;
  const rawCursor = data.meta?.page?.nextCursor || data.links?.next;
  if (rawCursor) {
    if (typeof rawCursor === "string" && rawCursor.includes("after=")) {
      const match = rawCursor.match(/after=([^&]+)/);
      nextCursor = match ? decodeURIComponent(match[1]) : null;
    } else {
      nextCursor = rawCursor;
    }
  }

  return { islands: data.data, nextCursor };
}

function sumMetric(arr: any[] | undefined): number {
  if (!arr || !Array.isArray(arr)) return 0;
  return arr.reduce((s: number, v: any) => s + (v?.value ?? 0), 0);
}

function avgMetric(arr: any[] | undefined): number {
  if (!arr?.length) return 0;
  const valid = arr.filter((v: any) => v?.value != null);
  if (!valid.length) return 0;
  return valid.reduce((s: number, v: any) => s + v.value, 0) / valid.length;
}

function maxMetric(arr: any[] | undefined): number {
  if (!arr?.length) return 0;
  const vals = arr.filter((v: any) => v?.value != null).map((v: any) => v.value);
  return vals.length ? Math.max(0, ...vals) : 0;
}

function avgRetention(retArr: any[] | undefined, key: string): number {
  if (!retArr?.length) return 0;
  const valid = retArr.filter((r: any) => r?.[key] != null);
  if (!valid.length) return 0;
  return valid.reduce((s: number, r: any) => s + r[key], 0) / valid.length;
}

function topN(arr: any[], key: string, n: number) {
  return [...arr]
    .filter((i) => i[key] != null && Number(i[key]) > 0)
    .sort((a, b) => Number(b[key]) - Number(a[key]))
    .slice(0, n)
    .map((i) => ({
      code: i.code,
      title: i.title,
      creator: i.creator,
      category: i.category,
      value: Number(i[key]),
      name: i.title || i.creator || i.code,
    }));
}

function processIslandMetrics(island: any, metrics: any) {
  const uniquePlayers = sumMetric(metrics.uniquePlayers);
  const totalPlays = sumMetric(metrics.plays);
  const minutesPlayed = sumMetric(metrics.minutesPlayed);
  const avgMinPerPlayer = avgMetric(metrics.averageMinutesPerPlayer);
  const peakCCU = maxMetric(metrics.peakCCU);
  const avgPeakCCU = avgMetric(metrics.peakCCU);
  const favorites = sumMetric(metrics.favorites);
  const recommendations = sumMetric(metrics.recommendations);
  const d1 = avgRetention(metrics.retention, "d1");
  const d7 = avgRetention(metrics.retention, "d7");

  return {
    code: island.code,
    title: island.title || island.code,
    creator: island.creatorCode || "unknown",
    category: island.category || "None",
    createdIn: island.createdIn || "Unknown",
    tags: island.tags || [],
    uniquePlayers,
    totalPlays,
    minutesPlayed,
    avgMinPerPlayer,
    peakCCU,
    avgPeakCCU,
    favorites,
    recommendations,
    d1,
    d7,
    playsPerPlayer: uniquePlayers > 0 ? totalPlays / uniquePlayers : 0,
    favPer100: uniquePlayers > 0 ? (favorites / uniquePlayers) * 100 : 0,
    recPer100: uniquePlayers > 0 ? (recommendations / uniquePlayers) * 100 : 0,
    favToPlayRatio: totalPlays > 0 ? favorites / totalPlays : 0,
    recToPlayRatio: totalPlays > 0 ? recommendations / totalPlays : 0,
    retentionAdjD1: avgMinPerPlayer * d1,
    retentionAdjD7: avgMinPerPlayer * d7,
    isUGC: island.creatorCode !== "fortnite" && island.creatorCode !== "epic",
    isActive: uniquePlayers >= 5,
  };
}

function computeReportData(islandData: any[]) {
  const creatorsMap: Record<string, any> = {};
  const categoriesMap: Record<string, any> = {};
  const tagsMap: Record<string, number> = {};

  for (const entry of islandData) {
    // Creator aggregation
    const cKey = entry.creator;
    if (!creatorsMap[cKey]) {
      creatorsMap[cKey] = { name: cKey, creator: cKey, totalPlays: 0, uniquePlayers: 0, minutesPlayed: 0, peakCCU: 0, maps: 0, favorites: 0, recommendations: 0, sumD1: 0, sumD7: 0, countD1: 0, countD7: 0 };
    }
    const c = creatorsMap[cKey];
    c.totalPlays += entry.totalPlays;
    c.uniquePlayers += entry.uniquePlayers;
    c.minutesPlayed += entry.minutesPlayed;
    c.peakCCU = Math.max(c.peakCCU, entry.peakCCU);
    c.favorites += entry.favorites;
    c.recommendations += entry.recommendations;
    c.maps++;
    if (entry.d1 > 0) { c.sumD1 += entry.d1; c.countD1++; }
    if (entry.d7 > 0) { c.sumD7 += entry.d7; c.countD7++; }

    // Category aggregation
    const cat = entry.category;
    if (!categoriesMap[cat]) {
      categoriesMap[cat] = { name: cat, category: cat, totalPlays: 0, uniquePlayers: 0, minutesPlayed: 0, peakCCU: 0, maps: 0, favorites: 0, recommendations: 0 };
    }
    const cm = categoriesMap[cat];
    cm.totalPlays += entry.totalPlays;
    cm.uniquePlayers += entry.uniquePlayers;
    cm.minutesPlayed += entry.minutesPlayed;
    cm.peakCCU = Math.max(cm.peakCCU, entry.peakCCU);
    cm.favorites += entry.favorites;
    cm.recommendations += entry.recommendations;
    cm.maps++;

    // Tags
    if (Array.isArray(entry.tags)) {
      for (const tag of entry.tags) {
        if (typeof tag === "string") tagsMap[tag] = (tagsMap[tag] || 0) + 1;
      }
    }
  }

  const activeIslands = islandData.filter((i) => i.isActive);
  const ugcIslands = islandData.filter((i) => i.isUGC);
  const uniqueCreators = new Set(islandData.map((i) => i.creator));
  const safeDiv = (num: number, den: number) => den > 0 ? num / den : 0;

  const totalPlaysAll = islandData.reduce((s, i) => s + i.totalPlays, 0);
  const totalPlayersAll = islandData.reduce((s, i) => s + i.uniquePlayers, 0);
  const totalMinutesAll = islandData.reduce((s, i) => s + i.minutesPlayed, 0);
  const totalFavoritesAll = islandData.reduce((s, i) => s + i.favorites, 0);
  const totalRecommendationsAll = islandData.reduce((s, i) => s + i.recommendations, 0);

  const platformKPIs = {
    totalIslands: islandData.length,
    activeIslands: activeIslands.length,
    inactiveIslands: islandData.length - activeIslands.length,
    totalCreators: uniqueCreators.size,
    avgMapsPerCreator: safeDiv(islandData.length, uniqueCreators.size),
    totalPlays: totalPlaysAll,
    totalUniquePlayers: totalPlayersAll,
    totalMinutesPlayed: totalMinutesAll,
    totalFavorites: totalFavoritesAll,
    totalRecommendations: totalRecommendationsAll,
    avgPlayDuration: safeDiv(
      activeIslands.reduce((s, i) => s + i.avgMinPerPlayer, 0),
      activeIslands.length
    ),
    avgCCUPerMap: safeDiv(
      activeIslands.reduce((s, i) => s + i.avgPeakCCU, 0),
      activeIslands.length
    ),
    avgPlayersPerDay: safeDiv(totalPlayersAll, 7),
    platformAvgD1: safeDiv(
      activeIslands.reduce((s, i) => s + i.d1, 0),
      activeIslands.length
    ),
    platformAvgD7: safeDiv(
      activeIslands.reduce((s, i) => s + i.d7, 0),
      activeIslands.length
    ),
    favToPlayRatio: safeDiv(totalFavoritesAll, totalPlaysAll),
    recToPlayRatio: safeDiv(totalRecommendationsAll, totalPlaysAll),
  };

  const creators = Object.values(creatorsMap).map((c: any) => ({
    ...c,
    avgD1: c.countD1 > 0 ? c.sumD1 / c.countD1 : 0,
    avgD7: c.countD7 > 0 ? c.sumD7 / c.countD7 : 0,
    value: c.totalPlays,
  }));
  const categories = Object.values(categoriesMap).map((c: any) => ({
    ...c,
    avgPlays: c.maps > 0 ? Math.round(c.totalPlays / c.maps) : 0,
    avgCCU: c.maps > 0 ? Math.round(c.peakCCU / c.maps) : 0,
    value: c.totalPlays,
  }));
  const topTags = Object.entries(tagsMap)
    .sort((a, b) => (b[1] as number) - (a[1] as number))
    .slice(0, 20)
    .map(([tag, count]) => ({ name: tag, tag, value: count, count }));

  const computedRankings = {
    topPeakCCU: topN(islandData, "peakCCU", 10),
    topPeakCCU_UGC: topN(ugcIslands, "peakCCU", 10),
    topAvgPeakCCU: topN(islandData, "avgPeakCCU", 10),
    topUniquePlayers: topN(islandData, "uniquePlayers", 10),
    topTotalPlays: topN(islandData, "totalPlays", 10),
    topMinutesPlayed: topN(islandData, "minutesPlayed", 10),
    topRetentionD1: topN(islandData, "d1", 10),
    topRetentionD7: topN(islandData, "d7", 10),
    topD1_UGC: topN(ugcIslands, "d1", 10),
    topD7_UGC: topN(ugcIslands, "d7", 10),
    topCreatorsByPlays: topN(creators, "totalPlays", 10),
    topCreatorsByPlayers: topN(creators, "uniquePlayers", 10),
    topCreatorsByMinutes: topN(creators, "minutesPlayed", 10),
    topCreatorsByCCU: topN(creators, "peakCCU", 10),
    topCreatorsByD1: topN(creators, "avgD1", 10),
    topCreatorsByD7: topN(creators, "avgD7", 10),
    topAvgMinutesPerPlayer: topN(islandData, "avgMinPerPlayer", 10),
    topFavorites: topN(islandData, "favorites", 10),
    topRecommendations: topN(islandData, "recommendations", 10),
    topPlaysPerPlayer: topN(islandData, "playsPerPlayer", 10),
    topFavsPer100: topN(islandData, "favPer100", 10),
    topRecPer100: topN(islandData, "recPer100", 10),
    topRetentionAdjD1: topN(islandData, "retentionAdjD1", 10),
    topRetentionAdjD7: topN(islandData, "retentionAdjD7", 10),
    categoryShare: categories.sort((a: any, b: any) => b.totalPlays - a.totalPlays).slice(0, 15),
    categoryPopularity: Object.fromEntries(
      categories.sort((a: any, b: any) => b.maps - a.maps).slice(0, 10).map((c: any) => [c.category, c.maps])
    ),
    topCategoriesByPlays: topN(categories, "totalPlays", 10),
    topCategoriesByPlayers: topN(categories, "uniquePlayers", 10),
    topTags,
    topFavsPerPlay: topN(islandData, "favToPlayRatio", 10),
    topRecsPerPlay: topN(islandData, "recToPlayRatio", 10),
  };

  return { platformKPIs, computedRankings, activeCount: activeIslands.length, totalPlaysAll, totalPlayersAll };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    let body: any = {};
    try { body = await req.json(); } catch { /* empty body ok */ }

    // Mode: "collect" (default) or "finalize"
    const mode = body.mode || "collect";
    const reportId = body.reportId || null;
    const islandCursor = body.cursor || null;
    const targetIslands = body.targetIslands || 1000;

    // Calculate week range
    const now = new Date();
    const to = new Date(now);
    to.setUTCHours(0, 0, 0, 0);
    const from = new Date(to);
    from.setUTCDate(from.getUTCDate() - 7);
    const fromISO = from.toISOString();
    const toISO = to.toISOString();

    const weekEnd = to.toISOString().split("T")[0];
    const weekStart = from.toISOString().split("T")[0];
    const d = new Date(from);
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNumber = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    const year = d.getUTCFullYear();

    // ============ FINALIZE MODE ============
    // Reads all collected island data and computes final report
    if (mode === "finalize" && reportId) {
      console.log(`Finalizing report ${reportId}...`);
      
      // Load existing raw_metrics from the report
      const { data: existingReport } = await supabase
        .from("discover_reports")
        .select("raw_metrics")
        .eq("id", reportId)
        .single();

      const allIslands = existingReport?.raw_metrics?.islandSummaries || [];
      console.log(`Finalizing with ${allIslands.length} islands`);

      const { platformKPIs, computedRankings, activeCount, totalPlaysAll, totalPlayersAll } = computeReportData(allIslands);

      await supabase.from("discover_reports").update({
        status: "completed",
        computed_rankings: computedRankings,
        platform_kpis: platformKPIs,
        island_count: allIslands.length,
      }).eq("id", reportId);

      console.log(`Report ${reportId} finalized: ${allIslands.length} islands, ${activeCount} active, ${totalPlaysAll} plays`);

      return new Response(JSON.stringify({
        success: true,
        reportId,
        done: true,
        islandCount: allIslands.length,
        activeCount,
        totalPlays: totalPlaysAll,
        totalPlayers: totalPlayersAll,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ============ COLLECT MODE ============
    const startTime = Date.now();
    let currentReportId = reportId;

    // Create report if first call
    if (!currentReportId) {
      const { data: report, error: reportErr } = await supabase
        .from("discover_reports")
        .insert({ week_start: weekStart, week_end: weekEnd, week_number: weekNumber, year, status: "collecting" })
        .select("id")
        .single();
      if (reportErr) throw new Error(`Failed to create report: ${reportErr.message}`);
      currentReportId = report.id;
      console.log(`Created report ${currentReportId}`);
    }

    // Load existing collected islands from the report
    const { data: existingReport } = await supabase
      .from("discover_reports")
      .select("raw_metrics")
      .eq("id", currentReportId)
      .single();

    const existingIslands: any[] = existingReport?.raw_metrics?.islandSummaries || [];
    const existingCodes = new Set(existingIslands.map((i: any) => i.code));
    console.log(`Report ${currentReportId}: ${existingIslands.length} already collected, fetching more...`);

    // Fetch island pages until we have enough NEW islands or run out of time
    let cursor = islandCursor;
    const newIslandsToProcess: any[] = [];
    let pagesScanned = 0;
    let apiExhausted = false;

    while (newIslandsToProcess.length < ISLANDS_PER_PASS) {
      if (Date.now() - startTime > 15000) {
        console.log(`Time limit for island listing: stopping at ${newIslandsToProcess.length} new islands`);
        break;
      }

      const { islands: pageIslands, nextCursor } = await fetchIslandPage(cursor);
      if (!pageIslands.length) {
        apiExhausted = true;
        console.log(`No more islands from API after ${pagesScanned} pages`);
        break;
      }

      pagesScanned++;
      for (const island of pageIslands) {
        if (!existingCodes.has(island.code)) {
          newIslandsToProcess.push(island);
        }
      }
      console.log(`Page ${pagesScanned}: +${pageIslands.length} islands, ${newIslandsToProcess.length} new`);

      cursor = nextCursor;
      if (!cursor) {
        apiExhausted = true;
        break;
      }
      await delay(100);
    }

    // Limit to ISLANDS_PER_PASS
    const batch = newIslandsToProcess.slice(0, ISLANDS_PER_PASS);
    console.log(`Fetching metrics for ${batch.length} islands...`);

    // Fetch metrics for this batch
    const newIslandData: any[] = [];
    for (let i = 0; i < batch.length; i += PARALLEL_BATCH) {
      if (Date.now() - startTime > TIME_LIMIT_MS) {
        console.log(`Time limit: stopping metrics at ${newIslandData.length}/${batch.length}`);
        break;
      }

      const chunk = batch.slice(i, i + PARALLEL_BATCH);
      const promises = chunk.map(async (island: any) => {
        const url = `${EPIC_API}/islands/${island.code}/metrics/day?from=${fromISO}&to=${toISO}`;
        const metrics = await fetchWithRetry(url);
        return { island, metrics };
      });

      const results = await Promise.all(promises);
      for (const { island, metrics } of results) {
        if (metrics) {
          const processed = processIslandMetrics(island, metrics);
          newIslandData.push(processed);
        }
      }

      if (i % 50 === 0 && i > 0) {
        console.log(`Metrics progress: ${newIslandData.length}/${batch.length} (${((Date.now() - startTime) / 1000).toFixed(1)}s)`);
      }
      await delay(200);
    }

    // Merge with existing
    const allIslands = [...existingIslands, ...newIslandData];
    const totalCollected = allIslands.length;
    const totalTarget = targetIslands;
    const done = apiExhausted || totalCollected >= totalTarget;

    console.log(`Batch complete: +${newIslandData.length} new, ${totalCollected} total, done=${done}`);

    // Upsert island cache
    const islandUpserts = batch.slice(0, newIslandData.length).map((island: any, idx: number) => ({
      island_code: island.code,
      title: island.title,
      creator_code: island.creatorCode,
      category: island.category,
      tags: island.tags,
      created_in: island.createdIn,
      last_metrics: {
        uniquePlayers: newIslandData[idx]?.uniquePlayers || 0,
        totalPlays: newIslandData[idx]?.totalPlays || 0,
        minutesPlayed: newIslandData[idx]?.minutesPlayed || 0,
        peakCCU: newIslandData[idx]?.peakCCU || 0,
      },
    }));

    for (let i = 0; i < islandUpserts.length; i += 100) {
      await supabase.from("discover_islands").upsert(islandUpserts.slice(i, i + 100), { onConflict: "island_code" });
    }

    // Save progress — only keep last 500 island summaries in raw_metrics to avoid payload size issues
    const trimmedSummaries = allIslands.slice(-500);
    
    await supabase.from("discover_reports").update({
      status: done ? "analyzing" : "collecting",
      raw_metrics: { islandSummaries: allIslands },
      island_count: totalCollected,
    }).eq("id", currentReportId);

    // If done, compute final rankings inline
    if (done) {
      const { platformKPIs, computedRankings, activeCount, totalPlaysAll, totalPlayersAll } = computeReportData(allIslands);
      await supabase.from("discover_reports").update({
        status: "completed",
        computed_rankings: computedRankings,
        platform_kpis: platformKPIs,
      }).eq("id", currentReportId);

      console.log(`Report ${currentReportId} completed: ${totalCollected} islands, ${activeCount} active, ${totalPlaysAll} plays`);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`Pass finished in ${elapsed}s`);

    return new Response(JSON.stringify({
      success: true,
      reportId: currentReportId,
      cursor: done ? null : cursor,
      done,
      totalCollected,
      batchCollected: newIslandData.length,
      targetIslands: totalTarget,
      progress: Math.min(100, Math.round((totalCollected / totalTarget) * 100)),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e) {
    console.error("Collector error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
