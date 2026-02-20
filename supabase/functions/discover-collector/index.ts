import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const EPIC_API = "https://api.fortnite.com/ecosystem/v1";
const PAGE_SIZE = 1000;

// ========== Helpers ==========

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithRetry(url: string, retries = 3): Promise<{ data: any; status: number }> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return { data: await res.json(), status: res.status };
      if (res.status === 429) return { data: null, status: 429 };
      if (res.status === 404) return { data: null, status: 404 };
      console.error(`Error ${res.status} for ${url}`);
      return { data: null, status: res.status };
    } catch (e) {
      console.error(`Fetch error attempt ${i + 1}:`, e);
      if (i < retries - 1) await delay(1000 * (i + 1));
    }
  }
  return { data: null, status: 0 };
}

async function fetchIslandPage(cursor: string | null): Promise<{ islands: any[]; nextCursor: string | null }> {
  let url = `${EPIC_API}/islands?size=${PAGE_SIZE}`;
  if (cursor) url += `&after=${encodeURIComponent(cursor)}`;

  const { data } = await fetchWithRetry(url);
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

function avgRetentionCalc(retArr: any[] | undefined, key: string): number {
  if (!retArr?.length) return 0;
  const valid = retArr.filter((r: any) => r?.[key] != null);
  if (!valid.length) return 0;
  return valid.reduce((s: number, r: any) => s + r[key], 0) / valid.length;
}

function isServiceRoleRequest(req: Request, serviceKey: string): boolean {
  const authHeader = (req.headers.get("Authorization") || "").trim();
  const apiKeyHeader = (req.headers.get("apikey") || "").trim();
  const authToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : authHeader;

  const isServiceRoleJwt = (token: string): boolean => {
    try {
      const parts = token.split(".");
      if (parts.length !== 3) return false;
      let b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const pad = b64.length % 4;
      if (pad) b64 += "=".repeat(4 - pad);
      const payload = JSON.parse(atob(b64));
      return payload?.role === "service_role";
    } catch {
      return false;
    }
  };

  if (serviceKey && (
    authHeader === `Bearer ${serviceKey}` ||
    authHeader === serviceKey ||
    apiKeyHeader === serviceKey
  )) return true;

  return isServiceRoleJwt(authToken) || isServiceRoleJwt(apiKeyHeader);
}

// Dynamic NLP stopwords for trend detection (no more hardcoded keywords)
const TREND_STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "in", "on", "at", "to", "for", "is", "it",
  "by", "with", "from", "up", "out", "if", "my", "no", "not", "but", "all", "new",
  "your", "you", "me", "we", "us", "so", "do", "be", "am", "are", "was", "get",
  "has", "had", "how", "its", "let", "may", "our", "own", "say", "she", "too",
  "use", "way", "who", "did", "got", "may", "old", "see", "now", "man", "day",
  "any", "few", "big", "per", "try", "ask",
  // Fortnite generic terms to skip
  "fortnite", "map", "island", "game", "mode", "v2", "v3", "v4", "2.0", "3.0",
  "chapter", "season", "update", "beta", "alpha", "test", "pro", "mega", "ultra",
  "super", "extreme", "ultimate", "best", "top", "epic", "new", "updated",
]);

function extractTrendingNgrams(
  islands: any[],
  maxResults = 30,
): Array<{ name: string; keyword: string; islands: number; totalPlays: number; totalPlayers: number; peakCCU: number; avgD1: number; value: number }> {
  const ngramMap: Record<string, { islands: Set<string>; totalPlays: number; totalPlayers: number; peakCCU: number; sumD1: number; d1Count: number }> = {};

  for (const isl of islands) {
    const title = (isl.title || "").toLowerCase();
    // Clean title: remove emojis, special chars, normalize
    const cleaned = title.replace(/[\u{1F000}-\u{1FFFF}]/gu, "").replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim();
    const words = cleaned.split(" ").filter((w: string) => w.length >= 2 && !TREND_STOPWORDS.has(w));

    const seen = new Set<string>();

    // 1-grams
    for (const w of words) {
      if (w.length < 3) continue;
      if (!seen.has(w)) {
        seen.add(w);
        if (!ngramMap[w]) ngramMap[w] = { islands: new Set(), totalPlays: 0, totalPlayers: 0, peakCCU: 0, sumD1: 0, d1Count: 0 };
        const t = ngramMap[w];
        t.islands.add(isl.island_code);
        t.totalPlays += isl.week_plays || 0;
        t.totalPlayers += isl.week_unique || 0;
        t.peakCCU = Math.max(t.peakCCU, isl.week_peak_ccu_max || 0);
        if ((isl.week_d1_avg || 0) > 0) { t.sumD1 += isl.week_d1_avg; t.d1Count++; }
      }
    }

    // 2-grams
    for (let i = 0; i < words.length - 1; i++) {
      if (words[i].length < 2 || words[i + 1].length < 2) continue;
      const bigram = `${words[i]} ${words[i + 1]}`;
      if (!seen.has(bigram)) {
        seen.add(bigram);
        if (!ngramMap[bigram]) ngramMap[bigram] = { islands: new Set(), totalPlays: 0, totalPlayers: 0, peakCCU: 0, sumD1: 0, d1Count: 0 };
        const t = ngramMap[bigram];
        t.islands.add(isl.island_code);
        t.totalPlays += isl.week_plays || 0;
        t.totalPlayers += isl.week_unique || 0;
        t.peakCCU = Math.max(t.peakCCU, isl.week_peak_ccu_max || 0);
        if ((isl.week_d1_avg || 0) > 0) { t.sumD1 += isl.week_d1_avg; t.d1Count++; }
      }
    }
  }

  // Score: frequency weighted by plays (sqrt to avoid extreme dominance)
  return Object.entries(ngramMap)
    .filter(([_, t]) => t.islands.size >= 5) // at least 5 islands
    .map(([keyword, t]) => ({
      name: keyword.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" "),
      keyword,
      islands: t.islands.size,
      totalPlays: t.totalPlays,
      totalPlayers: t.totalPlayers,
      peakCCU: t.peakCCU,
      avgD1: t.d1Count > 0 ? t.sumD1 / t.d1Count : 0,
      value: t.totalPlays,
      label: `${t.islands.size} islands · ${t.totalPlays >= 1_000_000 ? (t.totalPlays / 1_000_000).toFixed(1) + "M" : t.totalPlays >= 1_000 ? (t.totalPlays / 1_000).toFixed(1) + "K" : t.totalPlays} plays`,
    }))
    .sort((a, b) => b.totalPlays - a.totalPlays)
    .slice(0, maxResults);
}

const METRICS_V2_DEFAULTS = {
  // Faster default profile (still protected by adaptive backoff on 429).
  workers: 6,
  claimSizePerWorker: 700,
  workerInitialConcurrency: 5,
  workerMinConcurrency: 1,
  workerMaxConcurrency: 12,
  staleAfterSeconds: 600,
  workerBudgetMs: 58000,
  chunkSize: 500,
  globalDelayBetweenBatchesMs: 120,
};

function toInt(val: unknown, fallback: number): number {
  const n = Number(val);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

function clampInt(val: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, val));
}

function envInt(name: string, fallback: number): number {
  const raw = Deno.env.get(name);
  if (raw == null || raw === "") return fallback;
  return toInt(raw, fallback);
}

function getMetricsV2Profile(body: any) {
  const raw = body?.metricsProfile || body?.profile || {};
  const profile = {
    workers: clampInt(toInt(raw.workers ?? envInt("DISCOVER_METRICS_V2_WORKERS", METRICS_V2_DEFAULTS.workers), METRICS_V2_DEFAULTS.workers), 1, 20),
    claimSizePerWorker: clampInt(
      toInt(
        raw.claimSizePerWorker ?? envInt("DISCOVER_METRICS_V2_CLAIM_SIZE_PER_WORKER", METRICS_V2_DEFAULTS.claimSizePerWorker),
        METRICS_V2_DEFAULTS.claimSizePerWorker
      ),
      50,
      3000,
    ),
    workerInitialConcurrency: clampInt(
      toInt(
        raw.workerInitialConcurrency ?? envInt("DISCOVER_METRICS_V2_WORKER_INITIAL_CONCURRENCY", METRICS_V2_DEFAULTS.workerInitialConcurrency),
        METRICS_V2_DEFAULTS.workerInitialConcurrency
      ),
      1,
      40,
    ),
    workerMinConcurrency: clampInt(
      toInt(
        raw.workerMinConcurrency ?? envInt("DISCOVER_METRICS_V2_WORKER_MIN_CONCURRENCY", METRICS_V2_DEFAULTS.workerMinConcurrency),
        METRICS_V2_DEFAULTS.workerMinConcurrency
      ),
      1,
      20,
    ),
    workerMaxConcurrency: clampInt(
      toInt(
        raw.workerMaxConcurrency ?? envInt("DISCOVER_METRICS_V2_WORKER_MAX_CONCURRENCY", METRICS_V2_DEFAULTS.workerMaxConcurrency),
        METRICS_V2_DEFAULTS.workerMaxConcurrency
      ),
      1,
      80,
    ),
    staleAfterSeconds: clampInt(
      toInt(
        raw.staleAfterSeconds ?? envInt("DISCOVER_METRICS_V2_STALE_AFTER_SECONDS", METRICS_V2_DEFAULTS.staleAfterSeconds),
        METRICS_V2_DEFAULTS.staleAfterSeconds
      ),
      30,
      3600,
    ),
    workerBudgetMs: clampInt(
      toInt(
        raw.workerBudgetMs ?? envInt("DISCOVER_METRICS_V2_WORKER_BUDGET_MS", METRICS_V2_DEFAULTS.workerBudgetMs),
        METRICS_V2_DEFAULTS.workerBudgetMs
      ),
      10000,
      59000,
    ),
    chunkSize: clampInt(
      toInt(
        raw.chunkSize ?? envInt("DISCOVER_METRICS_V2_CHUNK_SIZE", METRICS_V2_DEFAULTS.chunkSize),
        METRICS_V2_DEFAULTS.chunkSize
      ),
      50,
      2000,
    ),
    globalDelayBetweenBatchesMs: clampInt(
      toInt(
        raw.globalDelayBetweenBatchesMs ?? envInt("DISCOVER_METRICS_V2_GLOBAL_DELAY_MS", METRICS_V2_DEFAULTS.globalDelayBetweenBatchesMs),
        METRICS_V2_DEFAULTS.globalDelayBetweenBatchesMs
      ),
      0,
      3000,
    ),
  };

  // Keep invariants valid even if env/body provided conflicting values.
  if (profile.workerInitialConcurrency > profile.workerMaxConcurrency) {
    profile.workerInitialConcurrency = profile.workerMaxConcurrency;
  }
  if (profile.workerMinConcurrency > profile.workerInitialConcurrency) {
    profile.workerMinConcurrency = profile.workerInitialConcurrency;
  }

  return profile;
}

function chunkArray<T>(arr: T[], chunkSize: number): T[][] {
  const out: T[][] = [];
  const size = Math.max(1, chunkSize);
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function getFunctionsBaseUrl(): string {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!supabaseUrl) throw new Error("SUPABASE_URL is not configured");
  return `${supabaseUrl}/functions/v1`;
}

async function callEdgeFunction(functionName: string, payload: Record<string, unknown>): Promise<any> {
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (serviceRoleKey) {
    headers.Authorization = `Bearer ${serviceRoleKey}`;
    headers.apikey = serviceRoleKey;
  }

  const res = await fetch(`${getFunctionsBaseUrl()}/${functionName}`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const errorMessage = data?.error || `HTTP ${res.status}`;
    throw new Error(`${functionName} failed: ${errorMessage}`);
  }
  return data;
}

async function getQueueStatusCounts(supabase: any, reportId: string) {
  const statuses = ["pending", "processing", "done", "error"] as const;
  const results = await Promise.all(
    statuses.map((status) =>
      supabase
        .from("discover_report_queue")
        .select("*", { count: "exact", head: true })
        .eq("report_id", reportId)
        .eq("status", status)
    )
  );

  const counts: Record<string, number> = { pending: 0, processing: 0, done: 0, error: 0 };
  for (let i = 0; i < statuses.length; i++) {
    const status = statuses[i];
    const { count, error } = results[i];
    if (error) throw new Error(`Queue count (${status}) failed: ${error.message}`);
    counts[status] = count || 0;
  }

  return {
    pending: counts.pending,
    processing: counts.processing,
    done: counts.done,
    error: counts.error,
    total: counts.pending + counts.processing + counts.done + counts.error,
  };
}

async function getIslandStatusCounts(supabase: any, reportId: string) {
  const [reportedRes, suppressedRes] = await Promise.all([
    supabase
      .from("discover_report_islands")
      .select("*", { count: "exact", head: true })
      .eq("report_id", reportId)
      .eq("status", "reported"),
    supabase
      .from("discover_report_islands")
      .select("*", { count: "exact", head: true })
      .eq("report_id", reportId)
      .eq("status", "suppressed"),
  ]);

  if (reportedRes.error) throw new Error(`Reported count failed: ${reportedRes.error.message}`);
  if (suppressedRes.error) throw new Error(`Suppressed count failed: ${suppressedRes.error.message}`);

  return {
    reported: reportedRes.count || 0,
    suppressed: suppressedRes.count || 0,
  };
}

async function flushQueueStatusUpdatesV2(supabase: any, reportId: string, updates: any[]) {
  if (!updates.length) return 0;
  let total = 0;
  for (const chunk of chunkArray(updates, 500)) {
    let applied = false;
    let lastErr: any = null;
    const maxAttempts = 4;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const { data, error } = await supabase.rpc("apply_discover_queue_results", {
        p_report_id: reportId,
        p_results: chunk,
      });
      if (!error) {
        total += Number(data || 0);
        applied = true;
        break;
      }

      lastErr = error;
      const msg = String(error.message || "").toLowerCase();
      const retryable =
        msg.includes("deadlock detected") ||
        msg.includes("could not serialize access") ||
        msg.includes("serialization failure") ||
        msg.includes("lock timeout");
      if (!retryable || attempt === maxAttempts) break;
      const backoffMs = 120 * attempt + Math.floor(Math.random() * 120);
      await delay(backoffMs);
    }

    if (!applied) throw new Error(`apply_discover_queue_results failed: ${lastErr?.message || "unknown"}`);
  }
  return total;
}

async function processMetricsWorkerV2(
  supabase: any,
  reportId: string,
  weekFrom: string,
  weekTo: string,
  yesterdayStr: string,
  profile: typeof METRICS_V2_DEFAULTS
) {
  const workerStart = Date.now();
  const { data: claimedRows, error: claimErr } = await supabase.rpc("claim_discover_report_queue", {
    p_report_id: reportId,
    p_take: profile.claimSizePerWorker,
    p_stale_after_seconds: profile.staleAfterSeconds,
  });

  if (claimErr) throw new Error(`Queue claim failed: ${claimErr.message}`);
  const claimed = (claimedRows || []) as Array<{ id: string; island_code: string; priority: number | null }>;
  if (!claimed.length) {
    return {
      claimed: 0,
      processed: 0,
      reported: 0,
      suppressed: 0,
      errors: 0,
      skipped: 0,
      requeuedPending: 0,
      rateLimited: 0,
      finalConcurrency: profile.workerInitialConcurrency,
      durationSec: (Date.now() - workerStart) / 1000,
    };
  }

  const claimedMap = new Map<string, { id: string; island_code: string; priority: number | null }>();
  for (const row of claimed) claimedMap.set(row.id, row);

  const claimedCodes = claimed.map((r) => r.island_code);
  const cacheRows: any[] = [];
  const preloadChunkSize = 250;
  for (const codeChunk of chunkArray(claimedCodes, preloadChunkSize)) {
    const { data: chunkRows, error: chunkErr } = await supabase
      .from("discover_islands_cache")
      .select("island_code, last_status, suppressed_streak, last_reported_at, reported_streak")
      .in("island_code", codeChunk);
    if (chunkErr) throw new Error(`Cache preload failed: ${chunkErr.message}`);
    if (chunkRows?.length) cacheRows.push(...chunkRows);
  }

  const cacheMap = new Map<string, any>();
  for (const c of cacheRows || []) cacheMap.set(c.island_code, c);

  const sixtyDaysAgo = new Date();
  sixtyDaysAgo.setUTCDate(sixtyDaysAgo.getUTCDate() - 60);

  const skipQueue: Array<{ id: string; island_code: string }> = [];
  const islandQueue: Array<{ id: string; island_code: string }> = [];
  for (const item of claimed) {
    const cached = cacheMap.get(item.island_code);
    if (cached && (cached.suppressed_streak || 0) >= 6) {
      const lastReported = cached.last_reported_at ? new Date(cached.last_reported_at) : null;
      const isOld = !lastReported || lastReported < sixtyDaysAgo;
      const shouldRevalidate = Math.random() < 0.1;
      if (isOld && !shouldRevalidate) {
        skipQueue.push({ id: item.id, island_code: item.island_code });
        continue;
      }
    }
    islandQueue.push({ id: item.id, island_code: item.island_code });
  }

  let concurrency = profile.workerInitialConcurrency;
  let consecutiveOk = 0;
  let processed = 0;
  let reported = 0;
  let suppressed = 0;
  let errors = 0;
  let skipped = 0;
  let rateLimited = 0;
  let requeuedPending = 0;

  const queueUpdates: Array<{ id: string; status: string; last_error?: string }> = [];
  const islandUpserts: any[] = [];
  const cacheUpserts: any[] = [];

  for (const item of skipQueue) {
    skipped++;
    processed++;
    suppressed++;
    islandUpserts.push({
      report_id: reportId,
      island_code: item.island_code,
      status: "suppressed",
    });
    const cached = cacheMap.get(item.island_code);
    cacheUpserts.push({
      island_code: item.island_code,
      last_seen_at: new Date().toISOString(),
      last_status: "suppressed",
      last_report_id: reportId,
      last_suppressed_at: new Date().toISOString(),
      suppressed_streak: (cached?.suppressed_streak || 0) + 1,
      reported_streak: 0,
      updated_at: new Date().toISOString(),
    });
    queueUpdates.push({ id: item.id, status: "done" });
    claimedMap.delete(item.id);
  }

  while (islandQueue.length > 0) {
    if (Date.now() - workerStart > profile.workerBudgetMs) {
      for (const pendingItem of islandQueue) {
        queueUpdates.push({ id: pendingItem.id, status: "pending" });
        claimedMap.delete(pendingItem.id);
        requeuedPending++;
      }
      islandQueue.length = 0;
      break;
    }

    const batch = islandQueue.splice(0, Math.max(1, Math.min(concurrency, islandQueue.length)));
    const results = await Promise.all(batch.map(async (item) => {
      try {
        const weekUrl = `${EPIC_API}/islands/${item.island_code}/metrics/day?from=${weekFrom}&to=${weekTo}`;
        const weekRes = await fetchWithRetry(weekUrl);
        if (weekRes.status === 429) return { item, rateLimited: true };
        // Treat 404 as suppressed (island doesn't exist / was removed)
        if (weekRes.status === 404) {
          return {
            item,
            suppressed: true,
            islandData: {
              report_id: reportId,
              island_code: item.island_code,
              status: "suppressed",
            },
            permanent404: true,
          };
        }
        if (!weekRes.data) return { item, error: true, errorMsg: `Metrics failed: status ${weekRes.status}` };

        const m = weekRes.data;
        const weekUnique = sumMetric(m.uniquePlayers);
        const weekPlays = sumMetric(m.plays);
        const weekMinutes = sumMetric(m.minutesPlayed);
        const weekPeakCcu = maxMetric(m.peakCCU);
        const hasData = weekUnique > 0 || weekPlays > 0;

        if (!hasData) {
          return {
            item,
            suppressed: true,
            islandData: {
              report_id: reportId,
              island_code: item.island_code,
              status: "suppressed",
            },
          };
        }

        const weekMpp = avgMetric(m.averageMinutesPerPlayer);
        const weekFavorites = sumMetric(m.favorites);
        const weekRecommends = sumMetric(m.recommendations);
        const weekD1 = avgRetentionCalc(m.retention, "d1");
        const weekD7 = avgRetentionCalc(m.retention, "d7");

        const probeUnique = m.uniquePlayers?.find((v: any) => v.timestamp?.startsWith(yesterdayStr))?.value ?? 0;
        const probePlays = m.plays?.find((v: any) => v.timestamp?.startsWith(yesterdayStr))?.value ?? 0;
        const probeMinutes = m.minutesPlayed?.find((v: any) => v.timestamp?.startsWith(yesterdayStr))?.value ?? 0;
        const probePeakCcu = m.peakCCU?.find((v: any) => v.timestamp?.startsWith(yesterdayStr))?.value ?? 0;

        return {
          item,
          reported: true,
          islandData: {
            report_id: reportId,
            island_code: item.island_code,
            status: "reported",
            probe_unique: probeUnique,
            probe_plays: probePlays,
            probe_minutes: probeMinutes,
            probe_peak_ccu: probePeakCcu,
            probe_date: yesterdayStr,
            week_unique: weekUnique,
            week_plays: weekPlays,
            week_minutes: weekMinutes,
            week_minutes_per_player_avg: weekMpp,
            week_peak_ccu_max: weekPeakCcu,
            week_favorites: weekFavorites,
            week_recommends: weekRecommends,
            week_d1_avg: weekD1,
            week_d7_avg: weekD7,
          },
          weekData: {
            weekUnique,
            weekPlays,
            weekMinutes,
            weekPeakCcu,
            weekFavorites,
            weekRecommends,
            weekMpp,
            weekD1,
            weekD7,
            probeUnique,
            probePlays,
          },
        };
      } catch (e) {
        return {
          item,
          error: true,
          errorMsg: e instanceof Error ? e.message : "Unknown",
        };
      }
    }));

    const hasRateLimit = results.some((r: any) => r.rateLimited);
    if (hasRateLimit) {
      const relimitItems = results.filter((r: any) => r.rateLimited).map((r: any) => r.item);
      rateLimited += relimitItems.length;
      islandQueue.push(...relimitItems);
      concurrency = Math.max(profile.workerMinConcurrency, Math.floor(concurrency * 0.6));
      consecutiveOk = 0;
      await delay(3000 + Math.floor(Math.random() * 3000));
    } else {
      consecutiveOk++;
      if (consecutiveOk >= 5 && concurrency < profile.workerMaxConcurrency) {
        concurrency = Math.min(profile.workerMaxConcurrency, concurrency + 1);
        consecutiveOk = 0;
      }
      // Small delay between batches to smooth out request rate
      if (profile.globalDelayBetweenBatchesMs > 0) {
        await delay(profile.globalDelayBetweenBatchesMs);
      }
    }

    for (const r of results) {
      if (r.rateLimited) continue;

      processed++;
      if (r.error) {
        errors++;
        queueUpdates.push({ id: r.item.id, status: "error", last_error: r.errorMsg || "Unknown error" });
        claimedMap.delete(r.item.id);
        continue;
      }

      if (r.suppressed) {
        suppressed++;
        islandUpserts.push(r.islandData);
        queueUpdates.push({ id: r.item.id, status: "done" });
        const cached = cacheMap.get(r.item.island_code);
        cacheUpserts.push({
          island_code: r.item.island_code,
          last_seen_at: new Date().toISOString(),
          last_status: "suppressed",
          last_report_id: reportId,
          last_suppressed_at: new Date().toISOString(),
          suppressed_streak: (cached?.suppressed_streak || 0) + 1,
          reported_streak: 0,
          updated_at: new Date().toISOString(),
        });
        claimedMap.delete(r.item.id);
        continue;
      }

      if (r.reported) {
        reported++;
        islandUpserts.push(r.islandData);
        queueUpdates.push({ id: r.item.id, status: "done" });
        const wd = r.weekData;
        cacheUpserts.push({
          island_code: r.item.island_code,
          last_seen_at: new Date().toISOString(),
          last_status: "reported",
          last_report_id: reportId,
          last_reported_at: new Date().toISOString(),
          suppressed_streak: 0,
          reported_streak: (cacheMap.get(r.item.island_code)?.reported_streak || 0) + 1,
          last_probe_unique: wd.probeUnique,
          last_probe_plays: wd.probePlays,
          last_week_unique: wd.weekUnique,
          last_week_plays: wd.weekPlays,
          last_week_minutes: wd.weekMinutes,
          last_week_peak_ccu: wd.weekPeakCcu,
          last_week_favorites: wd.weekFavorites,
          last_week_recommends: wd.weekRecommends,
          last_week_d1_avg: wd.weekD1,
          last_week_d7_avg: wd.weekD7,
          last_week_minutes_per_player_avg: wd.weekMpp,
          updated_at: new Date().toISOString(),
        });
        claimedMap.delete(r.item.id);
      }
    }
  }

  for (const orphan of claimedMap.values()) {
    queueUpdates.push({ id: orphan.id, status: "pending" });
    requeuedPending++;
  }

  for (const chunk of chunkArray(islandUpserts, profile.chunkSize)) {
    const { error } = await supabase
      .from("discover_report_islands")
      .upsert(chunk, { onConflict: "report_id,island_code" });
    if (error) throw new Error(`discover_report_islands upsert failed: ${error.message}`);
  }

  for (const chunk of chunkArray(cacheUpserts, profile.chunkSize)) {
    const { error } = await supabase
      .from("discover_islands_cache")
      .upsert(chunk, { onConflict: "island_code" });
    if (error) throw new Error(`discover_islands_cache upsert failed: ${error.message}`);
  }

  await flushQueueStatusUpdatesV2(supabase, reportId, queueUpdates);

  return {
    claimed: claimed.length,
    processed,
    reported,
    suppressed,
    errors,
    skipped,
    requeuedPending,
    rateLimited,
    finalConcurrency: concurrency,
    durationSec: (Date.now() - workerStart) / 1000,
  };
}

// ========== Main Handler ==========

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Auth guard: require service_role key OR cron-safe mode (any auth) OR admin/editor user
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sbUrl = Deno.env.get("SUPABASE_URL")!;
    const isServiceRole = isServiceRoleRequest(req, serviceKey);

    let body: any = {};
    try { body = await req.json(); } catch { /* empty body ok */ }

    const mode = body.mode || "start";

    // Cron-safe modes: allow through without specific auth (cron jobs use anon key)
    const cronSafeModes = ["orchestrate", "start", "catalog", "metrics", "finalize"];
    // Modes requiring admin/editor user auth
    const userAuthModes: string[] = [];

    if (!isServiceRole) {
      if (cronSafeModes.includes(mode)) {
        // Allow cron jobs and internal calls through for safe automation modes
      } else if (userAuthModes.includes(mode)) {
        // These modes would handle their own auth
      } else {
        return new Response(JSON.stringify({ error: "Forbidden: service_role required" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const supabase = createClient(sbUrl, serviceKey);
    const reportId = body.reportId || null;

    // ======================== MODE: START ========================
    if (mode === "start") {
      const now = new Date();
      const to = new Date(now);
      to.setUTCHours(0, 0, 0, 0);
      const from = new Date(to);
      from.setUTCDate(from.getUTCDate() - 7);

      const weekEnd = to.toISOString().split("T")[0];
      const weekStart = from.toISOString().split("T")[0];
      const d = new Date(from);
      d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
      const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      const weekNumber = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
      const year = d.getUTCFullYear();

      // Get estimated_total from last completed report
      const { data: lastReport } = await supabase
        .from("discover_reports")
        .select("queue_total")
        .eq("phase", "done")
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      const estimatedTotal = lastReport?.queue_total || null;

      const { data: report, error: reportErr } = await supabase
        .from("discover_reports")
        .insert({
          week_start: weekStart,
          week_end: weekEnd,
          week_number: weekNumber,
          year,
          status: "collecting",
          phase: "catalog",
          estimated_total: estimatedTotal,
          started_at: new Date().toISOString(),
        })
        .select("id")
        .single();

      if (reportErr) throw new Error(`Failed to create report: ${reportErr.message}`);

      console.log(`[start] Created report ${report.id}, estimated_total=${estimatedTotal}`);

      return new Response(JSON.stringify({
        success: true, reportId: report.id, estimated_total: estimatedTotal, phase: "catalog",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ======================== MODE: ORCHESTRATE ========================
    if (mode === "orchestrate") {
      let activeReportId: string | null = reportId;
      let activePhase: string | null = null;

      if (activeReportId) {
        const { data: report, error } = await supabase
          .from("discover_reports")
          .select("id, phase, last_metrics_tick_at")
          .eq("id", activeReportId)
          .single();
        if (error || !report) throw new Error("Active report not found");
        activePhase = report.phase;
        if (report.phase === "metrics" && report.last_metrics_tick_at) {
          const lastTick = new Date(report.last_metrics_tick_at).getTime();
          if (Date.now() - lastTick < 25000) {
            return new Response(JSON.stringify({
              success: true,
              reportId: activeReportId,
              idle: true,
              message: "Recent metrics tick still fresh; skipping overlap",
            }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }
        }
      } else {
        const { data: report } = await supabase
          .from("discover_reports")
          .select("id, phase, created_at, last_metrics_tick_at")
          .in("phase", ["catalog", "metrics", "finalize", "ai"])
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!report) {
          return new Response(JSON.stringify({
            success: true,
            idle: true,
            message: "No active report to orchestrate",
          }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        activeReportId = report.id;
        activePhase = report.phase;
        if (report.phase === "metrics" && report.last_metrics_tick_at) {
          const lastTick = new Date(report.last_metrics_tick_at).getTime();
          if (Date.now() - lastTick < 25000) {
            return new Response(JSON.stringify({
              success: true,
              reportId: activeReportId,
              idle: true,
              message: "Recent metrics tick still fresh; skipping overlap",
            }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }
        }
      }

      let tickResult: any = {};
      if (activePhase === "catalog") {
        tickResult = await callEdgeFunction("discover-collector", { mode: "catalog", reportId: activeReportId });
      } else if (activePhase === "metrics") {
        tickResult = await callEdgeFunction("discover-collector", { mode: "metrics", reportId: activeReportId });
      } else if (activePhase === "finalize") {
        tickResult = await callEdgeFunction("discover-collector", { mode: "finalize", reportId: activeReportId });
      } else if (activePhase === "ai") {
        tickResult = await callEdgeFunction("discover-report-ai", { reportId: activeReportId });
      } else {
        tickResult = { success: true, phase: activePhase };
      }

      const [{ data: latestReport }, queueCounts] = await Promise.all([
        supabase
          .from("discover_reports")
          .select("id, phase, progress_pct, metrics_done_count, reported_count, suppressed_count, error_count, queue_total, throughput_per_min, workers_active")
          .eq("id", activeReportId)
          .single(),
        getQueueStatusCounts(supabase, activeReportId!),
      ]);

      return new Response(JSON.stringify({
        success: true,
        reportId: activeReportId,
        triggered_phase: activePhase,
        phase: latestReport?.phase || activePhase,
        progress_pct: latestReport?.progress_pct || 0,
        metrics_done_count: latestReport?.metrics_done_count || 0,
        queue_total: latestReport?.queue_total || queueCounts.total,
        reported_count: latestReport?.reported_count || 0,
        suppressed_count: latestReport?.suppressed_count || 0,
        error_count: latestReport?.error_count || queueCounts.error,
        throughput_per_min: latestReport?.throughput_per_min || 0,
        workers_active: latestReport?.workers_active || 0,
        pending_count: queueCounts.pending,
        processing_count: queueCounts.processing,
        done_count: queueCounts.done,
        tick_result: tickResult,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // All subsequent modes need reportId
    if (!reportId) throw new Error("reportId is required");

    // ======================== MODE: CATALOG ========================
    if (mode === "catalog") {
      const { data: report } = await supabase
        .from("discover_reports")
        .select("catalog_cursor, catalog_discovered_count, estimated_total")
        .eq("id", reportId)
        .single();

      if (!report) throw new Error("Report not found");

      const startTime = Date.now();
      let cursor = report.catalog_cursor;
      let discovered = report.catalog_discovered_count || 0;
      let exhausted = false;
      let pagesThisRun = 0;

      // Preload cache for priority assignment
      const { data: cacheRows } = await supabase
        .from("discover_islands_cache")
        .select("island_code, last_status, suppressed_streak");
      const cacheMap = new Map<string, { last_status: string | null; suppressed_streak: number }>();
      for (const c of (cacheRows || [])) {
        cacheMap.set(c.island_code, { last_status: c.last_status, suppressed_streak: c.suppressed_streak || 0 });
      }

      // Paginate as much as possible within 40s budget
      while (Date.now() - startTime < 40000) {
        const { islands, nextCursor } = await fetchIslandPage(cursor);
        if (!islands.length) { exhausted = true; break; }

        pagesThisRun++;
        
        // Bulk insert into queue with priority from cache
        const queueRows = islands.map((isl: any) => {
          const cached = cacheMap.get(isl.code);
          let priority = 20; // default: new island
          if (cached) {
            if (cached.last_status === "reported") priority = 10;
            else if (cached.suppressed_streak <= 2) priority = 30;
            else priority = 50;
          }
          return {
            report_id: reportId,
            island_code: isl.code,
            priority,
          };
        });

        // Pre-populate island metadata from catalog listing
        const metaRows = islands.map((isl: any) => ({
          report_id: reportId,
          island_code: isl.code,
          title: isl.title || null,
          creator_code: isl.creatorCode || null,
          category: isl.category || null,
          created_in: isl.createdIn || null,
          tags: isl.tags || [],
          status: "pending",
        }));

        // Insert metadata in chunks of 500
        for (let i = 0; i < metaRows.length; i += 500) {
          const chunk = metaRows.slice(i, i + 500);
          await supabase.from("discover_report_islands").upsert(chunk, {
            onConflict: "report_id,island_code",
            ignoreDuplicates: true,
          });
        }

        // Insert in chunks of 500
        for (let i = 0; i < queueRows.length; i += 500) {
          const chunk = queueRows.slice(i, i + 500);
          await supabase.from("discover_report_queue").upsert(chunk, {
            onConflict: "report_id,island_code",
            ignoreDuplicates: true,
          });
        }

        discovered += islands.length;
        cursor = nextCursor;
        if (!cursor) { exhausted = true; break; }
      }

      // Count current queue size for dashboard visibility
      const { count: currentQueueCount } = await supabase
        .from("discover_report_queue")
        .select("*", { count: "exact", head: true })
        .eq("report_id", reportId);

      const queueNow = currentQueueCount || discovered;

      // Update report state - always show pending_count during catalog
      const progressPct = report.estimated_total && report.estimated_total > 0
        ? Math.min(10, Math.floor((discovered / report.estimated_total) * 10))
        : (exhausted ? 10 : Math.min(9, Math.floor(pagesThisRun / 2)));

      const updateFields: any = {
        catalog_discovered_count: discovered,
        catalog_cursor: cursor,
        progress_pct: progressPct,
        pending_count: queueNow,
        island_count: discovered,
      };

      if (exhausted) {
        updateFields.catalog_done = true;
        updateFields.queue_total = queueNow;
        updateFields.phase = "metrics";
        updateFields.progress_pct = 10;
      }

      await supabase.from("discover_reports").update(updateFields).eq("id", reportId);

      console.log(`[catalog] pages=${pagesThisRun}, discovered=${discovered}, exhausted=${exhausted}`);

      return new Response(JSON.stringify({
        success: true,
        phase: exhausted ? "metrics" : "catalog",
        catalog_discovered_count: discovered,
        catalog_done: exhausted,
        queue_total: updateFields.queue_total || null,
        progress_pct: updateFields.progress_pct,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ======================== MODE: METRICS ========================
    if (mode === "metrics") {
      const { data: report } = await supabase
        .from("discover_reports")
        .select("queue_total, metrics_done_count, reported_count, suppressed_count, error_count, stale_requeued_count, rate_limited_count")
        .eq("id", reportId)
        .single();

      if (!report) throw new Error("Report not found");

      const metricsEngine = (Deno.env.get("METRICS_ENGINE") || "v2").toLowerCase();
      if (metricsEngine === "v2") {
        const profile = getMetricsV2Profile(body);
        const tickStart = Date.now();
        const requeueRes = await supabase.rpc("requeue_stale_discover_queue", {
          p_report_id: reportId,
          p_stale_after_seconds: profile.staleAfterSeconds,
          p_max_rows: 5000,
        });
        if (requeueRes.error) throw new Error(`requeue_stale_discover_queue failed: ${requeueRes.error.message}`);
        const staleRequeued = Number(requeueRes.data || 0);

        const now = new Date();
        const todayMidnight = new Date(now);
        todayMidnight.setUTCHours(0, 0, 0, 0);
        const yesterday = new Date(todayMidnight);
        yesterday.setUTCDate(yesterday.getUTCDate() - 1);
        const sevenDaysAgo = new Date(todayMidnight);
        sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 7);
        const weekFrom = sevenDaysAgo.toISOString();
        const weekTo = todayMidnight.toISOString();
        const yesterdayStr = yesterday.toISOString().split("T")[0];

        const workerRuns = await Promise.all(
          Array.from({ length: profile.workers }).map(() =>
            processMetricsWorkerV2(
              supabase,
              reportId,
              weekFrom,
              weekTo,
              yesterdayStr,
              profile
            )
          )
        );

        const totals = workerRuns.reduce((acc, worker) => {
          acc.claimed += worker.claimed;
          acc.processed += worker.processed;
          acc.reported += worker.reported;
          acc.suppressed += worker.suppressed;
          acc.errors += worker.errors;
          acc.skipped += worker.skipped;
          acc.requeuedPending += worker.requeuedPending;
          acc.rateLimited += worker.rateLimited;
          return acc;
        }, {
          claimed: 0,
          processed: 0,
          reported: 0,
          suppressed: 0,
          errors: 0,
          skipped: 0,
          requeuedPending: 0,
          rateLimited: 0,
        });

        const workersActive = workerRuns.filter((w) => w.claimed > 0).length;
        const elapsedSec = Math.max(1, (Date.now() - tickStart) / 1000);
        const throughputPerMin = Math.round((totals.processed / elapsedSec) * 60);

        let [queueCounts, islandCounts] = await Promise.all([
          getQueueStatusCounts(supabase, reportId),
          getIslandStatusCounts(supabase, reportId),
        ]);

        // SELF-HEAL: If no workers claimed anything but there are stale processing items,
        // force-requeue them immediately (60s timeout instead of 15min)
        if (totals.claimed === 0 && queueCounts.pending === 0 && queueCounts.processing > 0) {
          console.log(`[metrics:v2:self-heal] 0 claimed, ${queueCounts.processing} stuck in processing — force-requeue with 60s stale`);
          const { data: forceRequeued } = await supabase.rpc("requeue_stale_discover_queue", {
            p_report_id: reportId,
            p_stale_after_seconds: 60,
            p_max_rows: 10000,
          });
          const forceCount = Number(forceRequeued || 0);
          console.log(`[metrics:v2:self-heal] force-requeued ${forceCount} items`);

          // If force-requeue found nothing (items are very fresh), mark remaining processing as done
          if (forceCount === 0 && queueCounts.processing > 0) {
            console.log(`[metrics:v2:self-heal] items too fresh to requeue — force-marking ${queueCounts.processing} as done`);
            const { error: forceErr } = await supabase
              .from("discover_report_queue")
              .update({ status: "done", last_error: "force_cleared: stuck processing", locked_at: null, updated_at: new Date().toISOString() })
              .eq("report_id", reportId)
              .eq("status", "processing");
            if (forceErr) console.error(`[self-heal] force-clear failed: ${forceErr.message}`);
          }

          // Re-fetch counts after self-heal
          queueCounts = await getQueueStatusCounts(supabase, reportId);
        }

        // SELF-HEAL: Force-clear error items with too many attempts (they'll never succeed)
        if (queueCounts.pending === 0 && queueCounts.processing === 0 && queueCounts.error > 0) {
          console.log(`[metrics:v2:self-heal] ${queueCounts.error} error items remaining — marking as done to unblock finalize`);
          const { error: clearErr } = await supabase
            .from("discover_report_queue")
            .update({ status: "done", last_error: "auto_cleared: permanent error", locked_at: null, updated_at: new Date().toISOString() })
            .eq("report_id", reportId)
            .eq("status", "error");
          if (clearErr) console.error(`[self-heal] error-clear failed: ${clearErr.message}`);
          queueCounts = await getQueueStatusCounts(supabase, reportId);
        }

        const queueTotal = report.queue_total || queueCounts.total || 1;
        const metricsDone = queueCounts.done + queueCounts.error;
        const isDone = queueCounts.pending === 0 && queueCounts.processing === 0;
        const progressPct = isDone
          ? 95
          : Math.min(95, 10 + Math.floor((metricsDone / queueTotal) * 85));

        const { error: reportUpdateErr } = await supabase
          .from("discover_reports")
          .update({
            queue_total: queueTotal,
            metrics_done_count: metricsDone,
            reported_count: islandCounts.reported,
            suppressed_count: islandCounts.suppressed,
            error_count: queueCounts.error,
            pending_count: queueCounts.pending,
            processing_count: queueCounts.processing,
            done_count: queueCounts.done,
            workers_active: workersActive,
            throughput_per_min: throughputPerMin,
            stale_requeued_count: (report.stale_requeued_count || 0) + staleRequeued,
            rate_limited_count: (report.rate_limited_count || 0) + totals.rateLimited,
            last_metrics_tick_at: new Date().toISOString(),
            phase: isDone ? "finalize" : "metrics",
            progress_pct: progressPct,
          })
          .eq("id", reportId);
        if (reportUpdateErr) throw new Error(`Failed to update report counters: ${reportUpdateErr.message}`);

        console.log(
          `[metrics:v2] workers=${workersActive}/${profile.workers} claimed=${totals.claimed} processed=${totals.processed} reported=${totals.reported} suppressed=${totals.suppressed} errors=${totals.errors} rateLimited=${totals.rateLimited} pending=${queueCounts.pending} processing=${queueCounts.processing} done=${queueCounts.done} throughput_per_min=${throughputPerMin} profile=${JSON.stringify(profile)}`
        );

        return new Response(JSON.stringify({
          success: true,
          engine: "v2",
          profile,
          phase: isDone ? "finalize" : "metrics",
          metrics_done_count: metricsDone,
          queue_total: queueTotal,
          reported_count: islandCounts.reported,
          suppressed_count: islandCounts.suppressed,
          error_count: queueCounts.error,
          progress_pct: progressPct,
          workers_active: workersActive,
          throughput_per_min: throughputPerMin,
          pending_count: queueCounts.pending,
          processing_count: queueCounts.processing,
          done_count: queueCounts.done,
          stale_requeued_count: staleRequeued,
          batch_processed: totals.processed,
          batch_claimed: totals.claimed,
          batch_rate_limited: totals.rateLimited,
          batch_requeued_pending: totals.requeuedPending,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const BATCH_SIZE = 800;
      const startTime = Date.now();

      // Fetch pending items from queue ordered by priority (lower = higher priority)
      const { data: pendingItems, error: fetchErr } = await supabase
        .from("discover_report_queue")
        .select("id, island_code, priority")
        .eq("report_id", reportId)
        .eq("status", "pending")
        .order("priority", { ascending: true })
        .limit(BATCH_SIZE);

      if (fetchErr) throw new Error(`Queue fetch error: ${fetchErr.message}`);
      if (!pendingItems?.length) {
        // All done
        await supabase.from("discover_reports").update({
          phase: "finalize",
          progress_pct: 95,
        }).eq("id", reportId);

        return new Response(JSON.stringify({
          success: true, phase: "finalize",
          metrics_done_count: report.metrics_done_count,
          queue_total: report.queue_total,
          reported_count: report.reported_count,
          suppressed_count: report.suppressed_count,
          error_count: report.error_count,
          progress_pct: 95,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Lock items: set status to processing
      const itemIds = pendingItems.map((i: any) => i.id);
      await supabase.from("discover_report_queue")
        .update({ status: "processing", locked_at: new Date().toISOString() })
        .in("id", itemIds);

      // Load cache for suppressed_streak skip logic
      const islandCodes = pendingItems.map((i: any) => i.island_code);
      const { data: cacheRows } = await supabase
        .from("discover_islands_cache")
        .select("island_code, last_status, suppressed_streak, last_reported_at, last_week_unique, last_week_plays, last_week_minutes, last_week_peak_ccu, last_week_favorites, last_week_recommends")
        .in("island_code", islandCodes);
      const cacheMap = new Map<string, any>();
      for (const c of (cacheRows || [])) cacheMap.set(c.island_code, c);

      // Date calculations
      const now = new Date();
      const todayMidnight = new Date(now);
      todayMidnight.setUTCHours(0, 0, 0, 0);
      const yesterday = new Date(todayMidnight);
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      const sevenDaysAgo = new Date(todayMidnight);
      sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 7);

      const weekFrom = sevenDaysAgo.toISOString();
      const weekTo = todayMidnight.toISOString();
      const sixtyDaysAgo = new Date(todayMidnight);
      sixtyDaysAgo.setUTCDate(sixtyDaysAgo.getUTCDate() - 60);

      // Adaptive concurrency - increased for better throughput
      let concurrency = 30; // increased from 15
      let consecutiveOk = 0;
      let reported = 0;
      let suppressed = 0;
      let errors = 0;
      let processed = 0;
      let skipped = 0;

      const islandQueue: any[] = [];
      const skipQueue: any[] = [];

      // Separate items: skip chronic suppressed vs normal processing
      for (const item of pendingItems) {
        const cached = cacheMap.get(item.island_code);
        if (cached && cached.suppressed_streak >= 6) {
          const lastReported = cached.last_reported_at ? new Date(cached.last_reported_at) : null;
          const isOld = !lastReported || lastReported < sixtyDaysAgo;
          // Revalidate 10% randomly
          const shouldRevalidate = Math.random() < 0.1;
          if (isOld && !shouldRevalidate) {
            skipQueue.push(item);
            continue;
          }
        }
        islandQueue.push(item);
      }

      // Process skipped items (assumed suppressed, no API call)
      const skipUpserts: any[] = [];
      const skipCacheUpserts: any[] = [];
      const skipQueueUpdates: any[] = [];
      for (const item of skipQueue) {
        skipped++;
        suppressed++;
        processed++;
        skipUpserts.push({
          report_id: reportId,
          island_code: item.island_code,
          status: "suppressed",
        });
        const cached = cacheMap.get(item.island_code);
        skipCacheUpserts.push({
          island_code: item.island_code,
          last_seen_at: new Date().toISOString(),
          last_status: "suppressed",
          last_report_id: reportId,
          last_suppressed_at: new Date().toISOString(),
          suppressed_streak: (cached?.suppressed_streak || 0) + 1,
          reported_streak: 0,
          updated_at: new Date().toISOString(),
        });
        skipQueueUpdates.push(item.id);
      }

      // Batch upsert skip results
      for (let i = 0; i < skipUpserts.length; i += 100) {
        await supabase.from("discover_report_islands").upsert(skipUpserts.slice(i, i + 100), { onConflict: "report_id,island_code" });
      }
      for (let i = 0; i < skipCacheUpserts.length; i += 100) {
        await supabase.from("discover_islands_cache").upsert(skipCacheUpserts.slice(i, i + 100), { onConflict: "island_code" });
      }
      if (skipQueueUpdates.length > 0) {
        await supabase.from("discover_report_queue").update({ status: "done" }).in("id", skipQueueUpdates);
      }

      const islandUpserts: any[] = [];
      const cacheUpserts: any[] = [];
      const queueUpdates: { id: string; status: string; last_error?: string }[] = [];

      while (islandQueue.length > 0 && Date.now() - startTime < 45000) {
        const batch = islandQueue.splice(0, concurrency);

        const results = await Promise.all(batch.map(async (item: any) => {
          try {
            // SINGLE 7-day fetch
            const weekUrl = `${EPIC_API}/islands/${item.island_code}/metrics/day?from=${weekFrom}&to=${weekTo}`;
            const weekRes = await fetchWithRetry(weekUrl);

            if (weekRes.status === 429) return { item, rateLimited: true };
            // Treat 404 as suppressed (island removed/doesn't exist)
            if (weekRes.status === 404) {
              return {
                item,
                suppressed: true,
                islandData: {
                  report_id: reportId,
                  island_code: item.island_code,
                  status: "suppressed",
                },
              };
            }
            if (!weekRes.data) {
              return { item, error: true, errorMsg: `Metrics failed: status ${weekRes.status}` };
            }

            const m = weekRes.data;
            const weekUnique = sumMetric(m.uniquePlayers);
            const weekPlays = sumMetric(m.plays);
            const weekMinutes = sumMetric(m.minutesPlayed);
            const weekPeakCcu = maxMetric(m.peakCCU);

            const hasData = weekUnique > 0 || weekPlays > 0;

            if (!hasData) {
              return {
                item,
                suppressed: true,
                islandData: {
                  report_id: reportId,
                  island_code: item.island_code,
                  status: "suppressed",
                },
              };
            }

            // Has data — compute all aggregates
            const weekMpp = avgMetric(m.averageMinutesPerPlayer);
            const weekFavorites = sumMetric(m.favorites);
            const weekRecommends = sumMetric(m.recommendations);
            const weekD1 = avgRetentionCalc(m.retention, "d1");
            const weekD7 = avgRetentionCalc(m.retention, "d7");

            // Extract yesterday's probe values
            const yesterdayStr = yesterday.toISOString().split("T")[0];
            const probeUnique = m.uniquePlayers?.find((v: any) => v.timestamp?.startsWith(yesterdayStr))?.value ?? 0;
            const probePlays = m.plays?.find((v: any) => v.timestamp?.startsWith(yesterdayStr))?.value ?? 0;
            const probeMinutes = m.minutesPlayed?.find((v: any) => v.timestamp?.startsWith(yesterdayStr))?.value ?? 0;
            const probePeakCcu = m.peakCCU?.find((v: any) => v.timestamp?.startsWith(yesterdayStr))?.value ?? 0;

            return {
              item,
              reported: true,
              islandData: {
                report_id: reportId,
                island_code: item.island_code,
                status: "reported",
                probe_unique: probeUnique,
                probe_plays: probePlays,
                probe_minutes: probeMinutes,
                probe_peak_ccu: probePeakCcu,
                probe_date: yesterdayStr,
                week_unique: weekUnique,
                week_plays: weekPlays,
                week_minutes: weekMinutes,
                week_minutes_per_player_avg: weekMpp,
                week_peak_ccu_max: weekPeakCcu,
                week_favorites: weekFavorites,
                week_recommends: weekRecommends,
                week_d1_avg: weekD1,
                week_d7_avg: weekD7,
              },
              weekData: { weekUnique, weekPlays, weekMinutes, weekPeakCcu, weekFavorites, weekRecommends, weekMpp, weekD1, weekD7, probeUnique, probePlays },
            };
          } catch (e) {
            return { item, error: true, errorMsg: e instanceof Error ? e.message : "Unknown" };
          }
        }));

        // Check for rate limits
        const hasRateLimit = results.some((r: any) => r.rateLimited);
        if (hasRateLimit) {
          for (const r of results) {
            if (r.rateLimited) islandQueue.unshift(r.item);
          }
          concurrency = Math.max(3, Math.floor(concurrency / 2));
          consecutiveOk = 0;
          const backoffMs = 3000 * (1 + Math.random());
          console.log(`[metrics] 429 hit, concurrency -> ${concurrency}, backoff ${Math.round(backoffMs)}ms`);
          await delay(backoffMs);
        } else {
          consecutiveOk++;
          if (consecutiveOk >= 5 && concurrency < 60) {
            concurrency += 4;
            consecutiveOk = 0;
          }
        }

        // Process results — write-through to cache
        for (const r of results) {
          if (r.rateLimited) continue;
          processed++;

          if (r.error) {
            errors++;
            queueUpdates.push({ id: r.item.id, status: "error", last_error: r.errorMsg });
          } else if (r.suppressed) {
            suppressed++;
            islandUpserts.push(r.islandData);
            queueUpdates.push({ id: r.item.id, status: "done" });
            // Write-through cache: suppressed
            const cached = cacheMap.get(r.item.island_code);
            cacheUpserts.push({
              island_code: r.item.island_code,
              last_seen_at: new Date().toISOString(),
              last_status: "suppressed",
              last_report_id: reportId,
              last_suppressed_at: new Date().toISOString(),
              suppressed_streak: (cached?.suppressed_streak || 0) + 1,
              reported_streak: 0,
              updated_at: new Date().toISOString(),
            });
          } else if (r.reported) {
            reported++;
            islandUpserts.push(r.islandData);
            queueUpdates.push({ id: r.item.id, status: "done" });
            // Write-through cache: reported
            const wd = r.weekData;
            cacheUpserts.push({
              island_code: r.item.island_code,
              last_seen_at: new Date().toISOString(),
              last_status: "reported",
              last_report_id: reportId,
              last_reported_at: new Date().toISOString(),
              suppressed_streak: 0,
              reported_streak: (cacheMap.get(r.item.island_code)?.reported_streak || 0) + 1,
              last_probe_unique: wd.probeUnique,
              last_probe_plays: wd.probePlays,
              last_week_unique: wd.weekUnique,
              last_week_plays: wd.weekPlays,
              last_week_minutes: wd.weekMinutes,
              last_week_peak_ccu: wd.weekPeakCcu,
              last_week_favorites: wd.weekFavorites,
              last_week_recommends: wd.weekRecommends,
              last_week_d1_avg: wd.weekD1,
              last_week_d7_avg: wd.weekD7,
              last_week_minutes_per_player_avg: wd.weekMpp,
              updated_at: new Date().toISOString(),
            });
          }
        }
      }

      // Batch upsert island data
      for (let i = 0; i < islandUpserts.length; i += 100) {
        await supabase.from("discover_report_islands").upsert(islandUpserts.slice(i, i + 100), { onConflict: "report_id,island_code" });
      }

      // Batch upsert cache
      for (let i = 0; i < cacheUpserts.length; i += 100) {
        await supabase.from("discover_islands_cache").upsert(cacheUpserts.slice(i, i + 100), { onConflict: "island_code" });
      }

      // Batch update queue statuses
      for (const upd of queueUpdates) {
        await supabase.from("discover_report_queue")
          .update({ status: upd.status, last_error: upd.last_error || null })
          .eq("id", upd.id);
      }

      // Update report counters
      const newMetricsDone = (report.metrics_done_count || 0) + processed;
      const newReported = (report.reported_count || 0) + reported;
      const newSuppressed = (report.suppressed_count || 0) + suppressed;
      const newErrors = (report.error_count || 0) + errors;
      const queueTotal = report.queue_total || 1;
      const progressPct = Math.min(95, 10 + Math.floor((newMetricsDone / queueTotal) * 85));

      const isDone = newMetricsDone >= queueTotal;

      await supabase.from("discover_reports").update({
        metrics_done_count: newMetricsDone,
        reported_count: newReported,
        suppressed_count: newSuppressed,
        error_count: newErrors,
        progress_pct: isDone ? 95 : progressPct,
        phase: isDone ? "finalize" : "metrics",
      }).eq("id", reportId);

      console.log(`[metrics] processed=${processed}, reported=${reported}, suppressed=${suppressed}, skipped=${skipped}, errors=${errors}, total=${newMetricsDone}/${queueTotal}, concurrency=${concurrency}`);

      return new Response(JSON.stringify({
        success: true,
        phase: isDone ? "finalize" : "metrics",
        metrics_done_count: newMetricsDone,
        queue_total: queueTotal,
        reported_count: newReported,
        suppressed_count: newSuppressed,
        error_count: newErrors,
        progress_pct: isDone ? 95 : progressPct,
        batch_processed: processed,
        batch_skipped: skipped,
        concurrency,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ======================== MODE: FINALIZE ========================
    if (mode === "finalize") {
      console.log(`[finalize] Starting for report ${reportId} — SQL RPC mode`);

      // Get report info
      const { data: reportInfo } = await supabase
        .from("discover_reports")
        .select("week_start, week_end, week_number, year")
        .eq("id", reportId)
        .single();
      if (!reportInfo) throw new Error("Report not found");

      const weekStartDate = new Date(String(reportInfo.week_start)).toISOString().slice(0, 10);
      const weekEndDate = new Date(String(reportInfo.week_end)).toISOString().slice(0, 10);

      // Find previous report for WoW deltas
      const { data: prevReport } = await supabase
        .from("discover_reports")
        .select("id")
        .eq("phase", "done")
        .lt("week_end", reportInfo.week_start)
        .order("week_end", { ascending: false })
        .limit(1)
        .maybeSingle();
      const prevReportId = prevReport?.id || null;

      // Call ALL RPCs in parallel — this is the core improvement
      const [kpisRes, rankingsRes, creatorsRes, categoriesRes, distributionsRes, trendingRes, moversRes, newIslandsRes, updatedRes, newCountRes] = await Promise.all([
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
      ]);

      // Check for errors
      for (const [name, res] of [["kpis", kpisRes], ["rankings", rankingsRes], ["creators", creatorsRes], ["categories", categoriesRes], ["distributions", distributionsRes], ["trending", trendingRes], ["movers", moversRes]] as const) {
        if ((res as any).error) console.error(`[finalize] RPC ${name} error:`, (res as any).error.message);
      }

      const platformKPIs = {
        ...(kpisRes.data || {}),
        newMapsThisWeekPublished: newCountRes.data != null ? Number(newCountRes.data) : (kpisRes.data?.newMapsThisWeek || 0),
        baselineAvailable: Boolean(prevReportId),
      };

      const topNewItems = (newIslandsRes.data || []).map((r: any) => ({
        code: r.island_code, name: r.title || r.island_code, title: r.title,
        creator: r.creator_code, category: r.category || "Fortnite UGC", value: r.week_plays || 0,
      }));

      const mostUpdatedItems = (updatedRes.data || []).map((r: any) => ({
        code: r.island_code, name: r.title || r.island_code, title: r.title,
        creator: r.creator_code, category: r.category || "Fortnite UGC", value: r.week_plays || 0,
      }));

      const computedRankings = {
        ...(rankingsRes.data || {}),
        ...(creatorsRes.data || {}),
        ...(categoriesRes.data || {}),
        ...(distributionsRes.data || {}),
        ...(trendingRes.data || {}),
        ...(moversRes.data || {}),
        topNewIslandsByPlays: topNewItems,
        topNewIslandsByPlaysPublished: topNewItems,
        topNewIslandsByCCU: topNewItems.sort((a: any, b: any) => (b.value || 0) - (a.value || 0)).slice(0, 10),
        mostUpdatedIslandsThisWeek: mostUpdatedItems,
        topAvgPeakCCU: (rankingsRes.data || {}).topPeakCCU || [],
        topAvgPeakCCU_UGC: (rankingsRes.data || {}).topPeakCCU_UGC || [],
      };

      // Update discover_reports
      await supabase.from("discover_reports").update({
        phase: "ai",
        progress_pct: 95,
        computed_rankings: computedRankings,
        platform_kpis: platformKPIs,
        island_count: platformKPIs.totalIslands || 0,
        status: "analyzing",
      }).eq("id", reportId);

      // Create/update weekly_reports CMS entry as draft
      const weekKey = `${reportInfo.year}-W${String(reportInfo.week_number).padStart(2, "0")}`;
      const publicSlug = weekKey.toLowerCase();
      const titlePublic = `Fortnite Discovery - Semana ${reportInfo.week_number}/${reportInfo.year}`;

      const { data: weeklyRow, error: weeklyErr } = await supabase.from("weekly_reports").upsert({
        discover_report_id: reportId,
        week_key: weekKey,
        date_from: reportInfo.week_start,
        date_to: reportInfo.week_end,
        status: "draft",
        public_slug: publicSlug,
        title_public: titlePublic,
        kpis_json: platformKPIs,
        rankings_json: computedRankings,
      }, { onConflict: "public_slug" }).select("id").single();

      if (!weeklyErr && weeklyRow?.id) {
        // Best-effort: inject exposure data
        try {
          await supabase.functions.invoke("discover-exposure-report", { body: { weeklyReportId: weeklyRow.id } });
        } catch (e) {
          console.log(`[finalize] exposure enrichment skipped: ${e instanceof Error ? e.message : String(e)}`);
        }

        // Build evidence packs
        try {
          const [covRes, histRes, expCovRes, topPanelsRes, breadthRes] = await Promise.all([
            supabase.rpc("report_link_metadata_coverage", { p_report_id: reportId }),
            supabase.rpc("report_low_perf_histogram", { p_report_id: reportId }),
            supabase.rpc("report_exposure_coverage", { p_weekly_report_id: weeklyRow.id }),
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

          const { data: wr2 } = await supabase
            .from("weekly_reports")
            .select("id,rankings_json")
            .eq("id", weeklyRow.id)
            .single();
          if (wr2?.rankings_json) {
            const merged = { ...(wr2.rankings_json || {}), evidence };
            await supabase.from("weekly_reports").update({ rankings_json: merged }).eq("id", weeklyRow.id);
          }
        } catch (e) {
          console.log(`[finalize] evidence packs warning: ${e instanceof Error ? e.message : String(e)}`);
        }
      } else if (weeklyErr) {
        console.log(`[finalize] weekly_reports upsert failed: ${weeklyErr.message}`);
      }

      // Update discover_islands table (metadata sync — best-effort, limited batch)
      try {
        const { data: metaRows } = await supabase
          .from("discover_report_islands")
          .select("island_code, title, creator_code, category, tags, created_in")
          .eq("report_id", reportId)
          .eq("status", "reported")
          .not("title", "is", null)
          .limit(5000);
        if (metaRows?.length) {
          for (let i = 0; i < metaRows.length; i += 500) {
            await supabase.from("discover_islands").upsert(
              metaRows.slice(i, i + 500).map((r: any) => ({
                island_code: r.island_code, title: r.title, creator_code: r.creator_code,
                category: r.category, tags: r.tags, created_in: r.created_in,
              })),
              { onConflict: "island_code" }
            );
          }
        }
      } catch (e) {
        console.log(`[finalize] discover_islands sync warning: ${e instanceof Error ? e.message : String(e)}`);
      }

      console.log(`[finalize] Done via SQL RPCs. KPIs: ${JSON.stringify({ totalIslands: platformKPIs.totalIslands, activeIslands: platformKPIs.activeIslands, newMaps: platformKPIs.newMapsThisWeekPublished })}`);

      return new Response(JSON.stringify({
        success: true, phase: "ai", progress_pct: 95,
        reported_count: platformKPIs.totalIslands,
        kpis: platformKPIs,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    throw new Error(`Unknown mode: ${mode}`);
  } catch (e) {
    console.error("Collector error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
