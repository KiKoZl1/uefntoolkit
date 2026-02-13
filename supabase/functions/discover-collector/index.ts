import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const EPIC_API = "https://api.fortnite.com/ecosystem/v1";
const PARALLEL_BATCH = 20; // fetch 20 islands' metrics at once
const DEFAULT_MAX_ISLANDS = 1000;

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithRetry(url: string, retries = 3): Promise<any> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res.json();
      if (res.status === 429) {
        console.log(`Rate limited, waiting ${(i + 1) * 3}s...`);
        await delay((i + 1) * 3000);
        continue;
      }
      if (res.status === 404) return null;
      console.error(`Error ${res.status} fetching ${url}`);
      return null;
    } catch (e) {
      console.error(`Fetch error for ${url}:`, e);
      if (i < retries - 1) await delay(1000);
    }
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
    console.log(`Island list: fetched ${islands.length} so far...`);
    cursor = data.meta?.page?.nextCursor;
    if (!cursor) break;
    await delay(200);
  }

  return islands.slice(0, maxIslands);
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

function topN(arr: any[], key: string, n: number) {
  return [...arr]
    .filter((i) => i[key] != null && i[key] !== 0)
    .sort((a, b) => b[key] - a[key])
    .slice(0, n)
    .map((i) => ({
      code: i.code,
      title: i.title,
      creator: i.creator,
      category: i.category,
      value: i[key],
      name: i.title || i.creator || i.code,
    }));
}

async function fetchMetricsBatch(
  islands: any[],
  fromISO: string,
  toISO: string,
): Promise<Map<string, any>> {
  const results = new Map<string, any>();

  // Process in parallel batches
  for (let i = 0; i < islands.length; i += PARALLEL_BATCH) {
    const batch = islands.slice(i, i + PARALLEL_BATCH);

    const promises = batch.map(async (island: any) => {
      const url = `${EPIC_API}/islands/${island.code}/metrics/day?from=${fromISO}&to=${toISO}`;
      const metrics = await fetchWithRetry(url);
      return { code: island.code, metrics };
    });

    const batchResults = await Promise.all(promises);
    for (const { code, metrics } of batchResults) {
      if (metrics) results.set(code, metrics);
    }

    if (i + PARALLEL_BATCH < islands.length) {
      console.log(`Metrics: ${results.size}/${islands.length} fetched...`);
      await delay(300); // small pause between batches to respect rate limits
    }
  }

  return results;
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
    const maxIslands = body.maxIslands ?? DEFAULT_MAX_ISLANDS;

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
    console.log(`Report ${reportId}: Fetching island list (max ${maxIslands})...`);

    // 1. Fetch island list
    const islands = await fetchIslandList(maxIslands);
    console.log(`Fetched ${islands.length} islands from Epic API`);

    // 2. Fetch metrics for all islands in parallel batches
    const fromISO = from.toISOString();
    const toISO = to.toISOString();
    const metricsMap = await fetchMetricsBatch(islands, fromISO, toISO);
    console.log(`Got metrics for ${metricsMap.size} islands`);

    // 3. Process all island data
    const islandData: any[] = [];
    const creatorsMap: Record<string, any> = {};
    const categoriesMap: Record<string, any> = {};
    const tagsMap: Record<string, number> = {};

    for (const island of islands) {
      const code = island.code;
      const metrics = metricsMap.get(code);
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
        creatorsMap[cKey] = { name: cKey, creator: cKey, totalPlays: 0, uniquePlayers: 0, minutesPlayed: 0, peakCCU: 0, maps: 0, sumD1: 0, sumD7: 0, countD1: 0, countD7: 0 };
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
        categoriesMap[cat] = { name: cat, category: cat, totalPlays: 0, uniquePlayers: 0, minutesPlayed: 0, peakCCU: 0, maps: 0 };
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
    }

    // 4. Upsert islands to cache in batches
    const islandUpserts = islands.map((island: any) => {
      const m = metricsMap.get(island.code);
      const entry = islandData.find((e) => e.code === island.code);
      return {
        island_code: island.code,
        title: island.title,
        creator_code: island.creatorCode,
        category: island.category,
        tags: island.tags,
        created_in: island.createdIn,
        last_metrics: entry
          ? { uniquePlayers: entry.uniquePlayers, totalPlays: entry.totalPlays, minutesPlayed: entry.minutesPlayed, peakCCU: entry.peakCCU, avgMinPerPlayer: entry.avgMinPerPlayer, favorites: entry.favorites, recommendations: entry.recommendations, d1: entry.d1, d7: entry.d7 }
          : {},
      };
    });

    // Upsert in batches of 100
    for (let i = 0; i < islandUpserts.length; i += 100) {
      const batch = islandUpserts.slice(i, i + 100);
      await supabase.from("discover_islands").upsert(batch, { onConflict: "island_code" });
    }

    // 5. Compute platform KPIs
    const activeIslands = islandData.filter((i) => i.isActive);
    const ugcIslands = islandData.filter((i) => i.isUGC);
    const uniqueCreators = new Set(islandData.map((i) => i.creator));

    const safeDiv = (num: number, den: number) => den > 0 ? num / den : 0;

    const platformKPIs = {
      totalIslands: islandData.length,
      activeIslands: activeIslands.length,
      inactiveIslands: islandData.length - activeIslands.length,
      totalCreators: uniqueCreators.size,
      avgMapsPerCreator: safeDiv(islandData.length, uniqueCreators.size),
      totalPlays: islandData.reduce((s, i) => s + i.totalPlays, 0),
      totalUniquePlayers: islandData.reduce((s, i) => s + i.uniquePlayers, 0),
      totalMinutesPlayed: islandData.reduce((s, i) => s + i.minutesPlayed, 0),
      avgPlayDuration: safeDiv(activeIslands.reduce((s, i) => s + i.avgMinPerPlayer, 0), activeIslands.length),
      avgCCUPerMap: safeDiv(activeIslands.reduce((s, i) => s + i.avgPeakCCU, 0), activeIslands.length),
      avgPlayersPerDay: safeDiv(islandData.reduce((s, i) => s + i.uniquePlayers, 0), 7),
      platformAvgD1: safeDiv(activeIslands.reduce((s, i) => s + i.d1, 0), activeIslands.length),
      platformAvgD7: safeDiv(activeIslands.reduce((s, i) => s + i.d7, 0), activeIslands.length),
      avgFavToPlayRatio: safeDiv(activeIslands.reduce((s, i) => s + i.favToPlayRatio, 0), activeIslands.length),
      avgRecToPlayRatio: safeDiv(activeIslands.reduce((s, i) => s + i.recToPlayRatio, 0), activeIslands.length),
    };

    // 6. Compute rankings
    const creators = Object.values(creatorsMap).map((c: any) => ({
      ...c,
      avgD1: c.countD1 > 0 ? c.sumD1 / c.countD1 : 0,
      avgD7: c.countD7 > 0 ? c.sumD7 / c.countD7 : 0,
      value: c.totalPlays, // default sort value
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
      topAvgMinPerPlayer: topN(islandData, "avgMinPerPlayer", 10),
      topFavorites: topN(islandData, "favorites", 10),
      topRecommendations: topN(islandData, "recommendations", 10),
      topPlaysPerPlayer: topN(islandData, "playsPerPlayer", 10),
      topFavPer100: topN(islandData, "favPer100", 10),
      topRecPer100: topN(islandData, "recPer100", 10),
      topRetentionAdjD1: topN(islandData, "retentionAdjD1", 10),
      topRetentionAdjD7: topN(islandData, "retentionAdjD7", 10),
      categoryShare: categories.sort((a: any, b: any) => b.totalPlays - a.totalPlays).slice(0, 15),
      categoryPopularity: Object.fromEntries(categories.slice(0, 10).map((c: any) => [c.category, c.maps])),
      topCategoriesByPlays: topN(categories, "totalPlays", 10),
      topTags,
      topFavsPerPlay: topN(islandData, "favToPlayRatio", 10),
      topRecsPerPlay: topN(islandData, "recToPlayRatio", 10),
    };

    // 7. Save to DB
    const { error: updateErr } = await supabase
      .from("discover_reports")
      .update({
        status: "completed",
        raw_metrics: { islandSummaries: islandData.slice(0, 200) },
        computed_rankings: computedRankings,
        platform_kpis: platformKPIs,
        island_count: islandData.length,
      })
      .eq("id", reportId);

    if (updateErr) throw new Error(`Failed to update report: ${updateErr.message}`);

    console.log(`Report ${reportId} completed: ${islandData.length} islands, ${activeIslands.length} active`);

    return new Response(
      JSON.stringify({ success: true, reportId, islandCount: islandData.length, activeCount: activeIslands.length }),
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
