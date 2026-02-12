import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const EPIC_API = "https://api.fortnite.com/ecosystem/v1";
const BATCH_SIZE = 500;
const DELAY_MS = 100; // delay between API calls to respect rate limits

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithRetry(url: string, retries = 3): Promise<any> {
  for (let i = 0; i < retries; i++) {
    const res = await fetch(url);
    if (res.ok) return res.json();
    if (res.status === 429) {
      console.log(`Rate limited on ${url}, waiting ${(i + 1) * 2}s...`);
      await delay((i + 1) * 2000);
      continue;
    }
    if (res.status === 404) return null;
    console.error(`Error ${res.status} fetching ${url}`);
    return null;
  }
  return null;
}

async function fetchIslandList(maxIslands: number): Promise<any[]> {
  const islands: any[] = [];
  let cursor: string | null = null;
  const pageSize = Math.min(maxIslands, 1000);

  while (islands.length < maxIslands) {
    let url = `${EPIC_API}/islands?size=${pageSize}`;
    if (cursor) url += `&after=${cursor}`;

    const data = await fetchWithRetry(url);
    if (!data?.data?.length) break;

    islands.push(...data.data);
    cursor = data.meta?.page?.nextCursor;
    if (!cursor) break;
    await delay(DELAY_MS);
  }

  return islands.slice(0, maxIslands);
}

async function fetchIslandMetrics(code: string, from: string, to: string): Promise<any> {
  const url = `${EPIC_API}/islands/${code}/metrics/day?from=${from}&to=${to}`;
  return fetchWithRetry(url);
}

function sumMetric(arr: any[] | undefined): number {
  if (!arr) return 0;
  return arr.reduce((s: number, v: any) => s + (v.value ?? 0), 0);
}

function avgMetric(arr: any[] | undefined): number {
  if (!arr?.length) return 0;
  const valid = arr.filter((v: any) => v.value != null);
  if (!valid.length) return 0;
  return valid.reduce((s: number, v: any) => s + v.value, 0) / valid.length;
}

function maxMetric(arr: any[] | undefined): number {
  if (!arr?.length) return 0;
  return Math.max(0, ...arr.filter((v: any) => v.value != null).map((v: any) => v.value));
}

function avgRetention(retArr: any[] | undefined, key: string): number {
  if (!retArr?.length) return 0;
  const valid = retArr.filter((r: any) => r[key] != null);
  if (!valid.length) return 0;
  return valid.reduce((s: number, r: any) => s + r[key], 0) / valid.length;
}

function topN(arr: any[], key: string, n: number, ascending = false) {
  return [...arr]
    .filter((i) => i[key] != null && i[key] !== 0)
    .sort((a, b) => ascending ? a[key] - b[key] : b[key] - a[key])
    .slice(0, n)
    .map((i) => ({ code: i.code, title: i.title, creator: i.creator, category: i.category, value: i[key] }));
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Parse optional params
    let body: any = {};
    try { body = await req.json(); } catch { /* empty body ok */ }
    const maxIslands = body.maxIslands ?? BATCH_SIZE;

    // Calculate week range (last 7 days)
    const now = new Date();
    const to = new Date(now);
    to.setUTCHours(0, 0, 0, 0);
    const from = new Date(to);
    from.setUTCDate(from.getUTCDate() - 7);

    const weekEnd = to.toISOString().split("T")[0];
    const weekStart = from.toISOString().split("T")[0];

    // ISO week number
    const d = new Date(from);
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNumber = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    const year = d.getUTCFullYear();

    // Create report record
    const { data: report, error: reportErr } = await supabase
      .from("discover_reports")
      .insert({ week_start: weekStart, week_end: weekEnd, week_number: weekNumber, year, status: "collecting" })
      .select("id")
      .single();

    if (reportErr) throw new Error(`Failed to create report: ${reportErr.message}`);
    const reportId = report.id;

    console.log(`Report ${reportId}: Fetching islands...`);

    // 1. Fetch island list
    const islands = await fetchIslandList(maxIslands);
    console.log(`Fetched ${islands.length} islands`);

    // 2. Fetch metrics for each island
    const fromISO = from.toISOString();
    const toISO = to.toISOString();

    const islandData: any[] = [];
    const creatorsMap: Record<string, any> = {};
    const categoriesMap: Record<string, any> = {};
    const tagsMap: Record<string, number> = {};

    for (let i = 0; i < islands.length; i++) {
      const island = islands[i];
      const code = island.code;

      if (i > 0 && i % 50 === 0) {
        console.log(`Processing island ${i}/${islands.length}...`);
        await delay(DELAY_MS * 2);
      }

      const metrics = await fetchIslandMetrics(code, fromISO, toISO);
      await delay(DELAY_MS);

      if (!metrics) continue;

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

      const entry = {
        code,
        title: island.title || code,
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
        // Derived ratios
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

      islandData.push(entry);

      // Aggregate by creator
      const cKey = entry.creator;
      if (!creatorsMap[cKey]) {
        creatorsMap[cKey] = { creator: cKey, totalPlays: 0, uniquePlayers: 0, minutesPlayed: 0, peakCCU: 0, maps: 0, sumD1: 0, sumD7: 0, countD1: 0, countD7: 0 };
      }
      const c = creatorsMap[cKey];
      c.totalPlays += totalPlays;
      c.uniquePlayers += uniquePlayers;
      c.minutesPlayed += minutesPlayed;
      c.peakCCU = Math.max(c.peakCCU, peakCCU);
      c.maps++;
      if (d1 > 0) { c.sumD1 += d1; c.countD1++; }
      if (d7 > 0) { c.sumD7 += d7; c.countD7++; }

      // Aggregate by category
      const cat = entry.category;
      if (!categoriesMap[cat]) {
        categoriesMap[cat] = { category: cat, totalPlays: 0, uniquePlayers: 0, minutesPlayed: 0, peakCCU: 0, maps: 0 };
      }
      const cm = categoriesMap[cat];
      cm.totalPlays += totalPlays;
      cm.uniquePlayers += uniquePlayers;
      cm.minutesPlayed += minutesPlayed;
      cm.peakCCU = Math.max(cm.peakCCU, peakCCU);
      cm.maps++;

      // Tags
      for (const tag of entry.tags) {
        tagsMap[tag] = (tagsMap[tag] || 0) + 1;
      }

      // Upsert island cache
      await supabase.from("discover_islands").upsert({
        island_code: code,
        title: island.title,
        creator_code: island.creatorCode,
        category: island.category,
        tags: island.tags,
        created_in: island.createdIn,
        last_metrics: { uniquePlayers, totalPlays, minutesPlayed, peakCCU, avgMinPerPlayer, favorites, recommendations, d1, d7 },
      }, { onConflict: "island_code" });
    }

    // 3. Compute platform KPIs
    const activeIslands = islandData.filter((i) => i.isActive);
    const ugcIslands = islandData.filter((i) => i.isUGC);
    const uniqueCreators = new Set(islandData.map((i) => i.creator));

    const platformKPIs = {
      totalIslands: islandData.length,
      activeIslands: activeIslands.length,
      inactiveIslands: islandData.length - activeIslands.length,
      totalCreators: uniqueCreators.size,
      avgMapsPerCreator: uniqueCreators.size > 0 ? (islandData.length / uniqueCreators.size).toFixed(1) : 0,
      totalPlays: islandData.reduce((s, i) => s + i.totalPlays, 0),
      totalUniquePlayers: islandData.reduce((s, i) => s + i.uniquePlayers, 0),
      totalMinutesPlayed: islandData.reduce((s, i) => s + i.minutesPlayed, 0),
      avgPlayDuration: activeIslands.length > 0 ? (activeIslands.reduce((s, i) => s + i.avgMinPerPlayer, 0) / activeIslands.length).toFixed(1) : 0,
      avgCCUPerMap: activeIslands.length > 0 ? Math.round(activeIslands.reduce((s, i) => s + i.avgPeakCCU, 0) / activeIslands.length) : 0,
      platformAvgD1: activeIslands.length > 0 ? (activeIslands.reduce((s, i) => s + i.d1, 0) / activeIslands.length).toFixed(2) : 0,
      platformAvgD7: activeIslands.length > 0 ? (activeIslands.reduce((s, i) => s + i.d7, 0) / activeIslands.length).toFixed(2) : 0,
      avgFavToPlayRatio: activeIslands.length > 0 ? (activeIslands.reduce((s, i) => s + i.favToPlayRatio, 0) / activeIslands.length).toFixed(4) : 0,
      avgRecToPlayRatio: activeIslands.length > 0 ? (activeIslands.reduce((s, i) => s + i.recToPlayRatio, 0) / activeIslands.length).toFixed(4) : 0,
    };

    // 4. Compute rankings
    const creators = Object.values(creatorsMap).map((c: any) => ({
      ...c,
      avgD1: c.countD1 > 0 ? c.sumD1 / c.countD1 : 0,
      avgD7: c.countD7 > 0 ? c.sumD7 / c.countD7 : 0,
    }));
    const categories = Object.values(categoriesMap).map((c: any) => ({
      ...c,
      avgPlays: c.maps > 0 ? Math.round(c.totalPlays / c.maps) : 0,
      avgCCU: c.maps > 0 ? Math.round(c.peakCCU / c.maps) : 0,
    }));

    const topTags = Object.entries(tagsMap)
      .sort((a, b) => (b[1] as number) - (a[1] as number))
      .slice(0, 20)
      .map(([tag, count]) => ({ tag, count }));

    const computedRankings = {
      // Section 2: Engagement
      topPeakCCU: topN(islandData, "peakCCU", 10),
      topPeakCCU_UGC: topN(ugcIslands, "peakCCU", 10),
      topAvgPeakCCU: topN(islandData, "avgPeakCCU", 10),
      topUniquePlayers: topN(islandData, "uniquePlayers", 10),
      topTotalPlays: topN(islandData, "totalPlays", 10),
      topMinutesPlayed: topN(islandData, "minutesPlayed", 10),
      // Section 3: Retention
      topD1: topN(islandData, "d1", 10),
      topD7: topN(islandData, "d7", 10),
      topD1_UGC: topN(ugcIslands, "d1", 10),
      topD7_UGC: topN(ugcIslands, "d7", 10),
      // Section 4: Creator Performance
      topCreatorsByPlays: topN(creators, "totalPlays", 10),
      topCreatorsByPlayers: topN(creators, "uniquePlayers", 10),
      topCreatorsByMinutes: topN(creators, "minutesPlayed", 10),
      topCreatorsByCCU: topN(creators, "peakCCU", 10),
      topCreatorsByD1: topN(creators, "avgD1", 10),
      topCreatorsByD7: topN(creators, "avgD7", 10),
      // Section 5: Quality
      topAvgMinPerPlayer: topN(islandData, "avgMinPerPlayer", 10),
      topFavorites: topN(islandData, "favorites", 10),
      topRecommendations: topN(islandData, "recommendations", 10),
      // Section 6: Ratios
      topPlaysPerPlayer: topN(islandData, "playsPerPlayer", 10),
      topFavPer100: topN(islandData, "favPer100", 10),
      topRecPer100: topN(islandData, "recPer100", 10),
      topRetentionAdjD1: topN(islandData, "retentionAdjD1", 10),
      topRetentionAdjD7: topN(islandData, "retentionAdjD7", 10),
      // Section 7: Categories
      categoryShare: categories.sort((a: any, b: any) => b.totalPlays - a.totalPlays).slice(0, 15),
      topTags,
      // Section 8: Efficiency
      topFavToPlay: topN(islandData, "favToPlayRatio", 10),
      topRecToPlay: topN(islandData, "recToPlayRatio", 10),
    };

    // 5. Save to DB
    const { error: updateErr } = await supabase
      .from("discover_reports")
      .update({
        status: "completed",
        raw_metrics: { islandSummaries: islandData.slice(0, 100) }, // store top 100 for reference
        computed_rankings: computedRankings,
        platform_kpis: platformKPIs,
        island_count: islandData.length,
      })
      .eq("id", reportId);

    if (updateErr) throw new Error(`Failed to update report: ${updateErr.message}`);

    console.log(`Report ${reportId} completed with ${islandData.length} islands`);

    return new Response(
      JSON.stringify({ success: true, reportId, islandCount: islandData.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("Collector error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
