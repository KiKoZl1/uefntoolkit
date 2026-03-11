import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  dataBridgeUnavailableResponse,
  dataProxyResponse,
  getEnvNumber,
  invokeDataFunction,
  shouldBlockLocalExecution,
  shouldProxyToData,
} from "../_shared/dataBridge.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const EPIC_API = "https://api.fortnite.com/ecosystem/v1";
const ISLAND_CODE_RE = /^\d{4}-\d{4}-\d{4}$/;
const CACHE_TTL_MINUTES = 2;
const CACHE_STALE_MINUTES = 10;
const ACTIVE_CACHE_RETENTION_DAYS = 3;
const DEFAULT_REFRESH_BATCH = 50;
const MAX_REFRESH_BATCH = 200;

function cacheTtlMinutes(): number {
  const ttlSeconds = getEnvNumber("SERVING_CACHE_TTL_SECONDS", CACHE_TTL_MINUTES * 60);
  return Math.max(1, Math.ceil(ttlSeconds / 60));
}

type ChartRangeKey = "1D" | "1W" | "1M" | "ALL";
type RequestRangeKey = ChartRangeKey | "1Y";
const RANGES: ChartRangeKey[] = ["1D", "1W", "1M", "ALL"];
const RANGE_MS: Record<Exclude<ChartRangeKey, "ALL">, number> = {
  "1D": 24 * 60 * 60 * 1000,
  "1W": 7 * 24 * 60 * 60 * 1000,
  "1M": 30 * 24 * 60 * 60 * 1000,
};

type SeriesPoint = {
  ts: string;
  current: number;
  previous: number | null;
};

type SeriesBundle = {
  playerCount24h: SeriesPoint[];
  uniquePlayers: SeriesPoint[];
  favorites: SeriesPoint[];
  recommends: SeriesPoint[];
  avgPlaytime: SeriesPoint[];
  totalPlaytime: SeriesPoint[];
  sessions: SeriesPoint[];
};

type CachePayload = {
  meta: {
    islandCode: string;
    title: string;
    imageUrl: string | null;
    creatorCode: string | null;
    category: string | null;
    tags: string[];
    publishedAtEpic: string | null;
    updatedAtEpic: string | null;
  };
  kpisNow: {
    playersNow: number;
    rankNow: number | null;
    peak24h: number;
    peakAllTime: number;
  };
  overview24h: {
    uniquePlayers: number;
    plays: number;
    favorites: number;
    recommends: number;
    minutesPlayed: number;
    avgMinutesPerPlayer: number;
    avgSessionMinutes: number;
    retentionD1: number;
    retentionD7: number;
  };
  overviewAllTime: {
    minutesPlayed: number;
    favorites: number;
    recommends: number;
  };
  platformDistribution?: {
    pc: number;
    console: number;
    mobile: number;
  } | null;
  seriesByRange: Record<ChartRangeKey, SeriesBundle>;
  panelTimeline24h: {
    rows: Array<{
      panelName: string;
      panelDisplayName: string;
      segments: Array<{ start: string; end: string; rank: number | null; minutes: number }>;
    }>;
  };
  updates: {
    events: Array<{
      ts: string;
      eventType: string;
      oldValue: unknown;
      newValue: unknown;
    }>;
    technicalFilteredCount: number;
    lastMeaningfulUpdateAt: string | null;
  };
  dppi_radar?: {
    model_version_used: string | null;
    prediction_generated_at: string | null;
    headline: {
      panel_name: string;
      score_h2: number;
      opening_signal: number;
      pressure_forecast: string;
      confidence_bucket: string;
    } | null;
    top_panel_opportunities: Array<{
      panel_name: string;
      score: { h2: number; h5: number; h12: number };
      opening_signal: number;
      pressure_forecast: string;
      confidence_bucket: string;
      evidence: Record<string, unknown>;
    }>;
    survival_signals: Array<{
      panel_name: string;
      horizon: string;
      score: number;
      confidence_bucket: string;
      generated_at: string | null;
    }>;
    attempts: {
      total_14d: number;
      entries_48h: number;
      exits_48h: number;
    };
  } | null;
  asOf: string;
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

function asNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function asIso(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const ms = Date.parse(v);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function toEpoch(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v !== "string" || !v.trim()) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}

function clampRange(v: unknown): ChartRangeKey {
  const value = String(v || "").toUpperCase() as RequestRangeKey;
  if (value === "1Y") return "ALL";
  if (RANGES.includes(value as ChartRangeKey)) return value as ChartRangeKey;
  return "1D";
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const entries = Object.entries(obj).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

function extractUpdatedValue(v: unknown): unknown {
  if (v == null || typeof v !== "object") return v;
  const obj = v as Record<string, unknown>;
  if ("updated" in obj) return obj.updated;
  if ("updated_at" in obj) return obj.updated_at;
  return v;
}

function isEquivalentInstant(a: unknown, b: unknown): boolean {
  const ta = toEpoch(a);
  const tb = toEpoch(b);
  return ta != null && tb != null && ta === tb;
}

function pickImageUrl(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && /^https?:\/\//i.test(value)) return value;
    if (value && typeof value === "object") {
      const obj = value as Record<string, unknown>;
      for (const key of [
        "image_url",
        "imageUrl",
        "thumb_url",
        "thumbUrl",
        "thumbnail_url",
        "thumbnailUrl",
        "landscapeImageUrl",
        "landscape_image_url",
        "url",
      ]) {
        const candidate = obj[key];
        if (typeof candidate === "string" && /^https?:\/\//i.test(candidate)) return candidate;
      }
    }
  }
  return null;
}

function tagsToArray(value: unknown): string[] {
  const out = new Set<string>();
  const push = (v: unknown) => {
    const t = String(v || "").trim();
    if (t) out.add(t);
  };

  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string") push(item);
      else if (item && typeof item === "object") {
        const obj = item as Record<string, unknown>;
        push(obj.tag);
        push(obj.name);
      }
    }
  } else if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === "boolean") {
        if (v) push(k);
      } else {
        push(v);
      }
    }
  }

  return Array.from(out);
}

function normalizePlatformName(value: unknown): "pc" | "console" | "mobile" | null {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return null;
  if (raw.includes("pc") || raw.includes("desktop") || raw.includes("windows") || raw.includes("win")) return "pc";
  if (
    raw.includes("console") ||
    raw.includes("xbox") ||
    raw.includes("playstation") ||
    raw.includes("ps") ||
    raw.includes("switch")
  ) return "console";
  if (raw.includes("mobile") || raw.includes("android") || raw.includes("ios") || raw.includes("phone")) return "mobile";
  return null;
}

function parsePlatformDistribution(...sources: unknown[]): { pc: number; console: number; mobile: number } | null {
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;

    const acc = { pc: 0, console: 0, mobile: 0 };
    const addValue = (platform: "pc" | "console" | "mobile" | null, rawValue: unknown) => {
      const value = asNum(rawValue);
      if (!platform || value <= 0) return;
      acc[platform] += value;
    };

    if (Array.isArray(source)) {
      for (const row of source) {
        if (!row || typeof row !== "object") continue;
        const obj = row as Record<string, unknown>;
        const platform = normalizePlatformName(obj.platform ?? obj.name ?? obj.key ?? obj.device ?? obj.label);
        const value = obj.share ?? obj.percent ?? obj.percentage ?? obj.value ?? obj.count ?? obj.players;
        addValue(platform, value);
      }
    } else {
      const obj = source as Record<string, unknown>;
      for (const [key, value] of Object.entries(obj)) {
        const platform = normalizePlatformName(key);
        if (platform) {
          addValue(platform, value);
          continue;
        }
        if (value && typeof value === "object" && !Array.isArray(value)) {
          const nested = value as Record<string, unknown>;
          const nestedPlatform = normalizePlatformName(nested.platform ?? nested.name ?? nested.key ?? nested.device ?? key);
          const nestedValue = nested.share ?? nested.percent ?? nested.percentage ?? nested.value ?? nested.count ?? nested.players;
          addValue(nestedPlatform, nestedValue);
        }
      }
    }

    if (acc.pc + acc.console + acc.mobile > 0) return acc;
  }

  return null;
}

async function fetchJsonWithTimeout(url: string, timeoutMs = 8000, throwOnHttp = true): Promise<any | null> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      if (throwOnHttp) {
        throw new Error(`Epic request failed (${res.status})`);
      }
      return null;
    }
    return await res.json();
  } catch (err) {
    if (throwOnHttp) throw err;
    return null;
  } finally {
    clearTimeout(id);
  }
}

function getMetricsRoot(payload: any): Record<string, any[]> {
  if (!payload || typeof payload !== "object") return {};
  if (payload.data && typeof payload.data === "object") return payload.data as Record<string, any[]>;
  return payload as Record<string, any[]>;
}

function metricArray(root: Record<string, any[]>, candidates: string[]): any[] {
  for (const key of candidates) {
    const row = root?.[key];
    if (Array.isArray(row)) return row;
  }
  return [];
}

function pointTs(point: any): number | null {
  return (
    toEpoch(point?.timestamp) ??
    toEpoch(point?.ts) ??
    toEpoch(point?.date) ??
    toEpoch(point?.time) ??
    toEpoch(point?.bucket)
  );
}

function pointValue(point: any): number | null {
  const candidates = [point?.value, point?.current, point?.count, point?.ccu, point?.players];
  for (const v of candidates) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function normalizeNumericSeries(rows: any[]): Array<{ ts: number; value: number }> {
  return rows
    .map((r) => {
      const ts = pointTs(r);
      const value = pointValue(r);
      if (ts == null || value == null) return null;
      return { ts, value };
    })
    .filter(Boolean)
    .sort((a, b) => (a as any).ts - (b as any).ts) as Array<{ ts: number; value: number }>;
}

function aggregateSeriesByDay(
  rows: Array<{ ts: number; value: number }>,
  mode: "sum" | "avg" | "max",
): Array<{ ts: number; value: number }> {
  const map = new Map<string, number[]>();
  for (const row of rows) {
    const d = new Date(row.ts);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    const bucket = map.get(key) || [];
    bucket.push(asNum(row.value));
    map.set(key, bucket);
  }

  const out: Array<{ ts: number; value: number }> = [];
  for (const [key, values] of map.entries()) {
    const ts = Date.parse(`${key}T00:00:00.000Z`);
    if (!Number.isFinite(ts) || values.length === 0) continue;
    const value =
      mode === "max"
        ? values.reduce((acc, v) => Math.max(acc, v), 0)
        : mode === "avg"
          ? values.reduce((acc, v) => acc + v, 0) / values.length
          : values.reduce((acc, v) => acc + v, 0);
    out.push({ ts, value });
  }

  return out.sort((a, b) => a.ts - b.ts);
}

function bucketByRange(ts: number, range: ChartRangeKey): string {
  const d = new Date(ts);
  if (range === "1D") {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}T${String(d.getUTCHours()).padStart(2, "0")}`;
  }
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

async function hasServiceRoleKey(req: Request): Promise<boolean> {
  const serviceKey = mustEnv("SUPABASE_SERVICE_ROLE_KEY");
  const supabaseUrl = mustEnv("SUPABASE_URL");
  const auth = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  const apikey = req.headers.get("apikey") || req.headers.get("x-api-key") || "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  const token = bearer || apikey;
  if (!token) return false;
  if (token === serviceKey) return true;

  // Fallback for projects using rotated secret keys different from SUPABASE_SERVICE_ROLE_KEY value
  // available to caller. We validate service-level access against Auth Admin endpoint.
  try {
    const resp = await fetch(`${supabaseUrl}/auth/v1/admin/users?per_page=1&page=1`, {
      method: "GET",
      headers: {
        apikey: token,
        Authorization: `Bearer ${token}`,
      },
    });
    return resp.ok;
  } catch {
    return false;
  }
}

function clampBatchSize(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_REFRESH_BATCH;
  return Math.min(MAX_REFRESH_BATCH, Math.max(1, Math.round(n)));
}

function buildComparativeSeries(
  rows: Array<{ ts: number; value: number }>,
  range: ChartRangeKey,
  nowMs: number,
  createdMs: number | null,
): SeriesPoint[] {
  if (range === "ALL") {
    const start = createdMs ?? (rows[0]?.ts ?? nowMs);
    return rows
      .filter((p) => p.ts >= start && p.ts <= nowMs)
      .map((p) => ({ ts: new Date(p.ts).toISOString(), current: asNum(p.value), previous: null }));
  }

  const duration = RANGE_MS[range];
  const currentStart = nowMs - duration;
  const prevStart = currentStart - duration;
  const current = rows.filter((p) => p.ts >= currentStart && p.ts <= nowMs);
  const prev = rows.filter((p) => p.ts >= prevStart && p.ts < currentStart);

  const prevShifted = new Map<string, number>();
  for (const p of prev) {
    const shiftedBucket = bucketByRange(p.ts + duration, range);
    prevShifted.set(shiftedBucket, asNum(p.value));
  }

  return current.map((p) => {
    const bucket = bucketByRange(p.ts, range);
    return {
      ts: new Date(p.ts).toISOString(),
      current: asNum(p.value),
      previous: prevShifted.has(bucket) ? asNum(prevShifted.get(bucket)) : null,
    };
  });
}

function latestValue(rows: Array<{ ts: number; value: number }>): number {
  if (!rows.length) return 0;
  return asNum(rows[rows.length - 1].value);
}

function maxValue(rows: Array<{ ts: number; value: number }>): number {
  if (!rows.length) return 0;
  return rows.reduce((acc, p) => Math.max(acc, asNum(p.value)), 0);
}

function sumInWindow(rows: Array<{ ts: number; value: number }>, startMs: number, endMs: number): number {
  return rows
    .filter((p) => p.ts >= startMs && p.ts <= endMs)
    .reduce((acc, p) => acc + asNum(p.value), 0);
}

function avgInWindow(rows: Array<{ ts: number; value: number }>, startMs: number, endMs: number): number {
  const filtered = rows.filter((p) => p.ts >= startMs && p.ts <= endMs);
  if (filtered.length === 0) return 0;
  return filtered.reduce((acc, p) => acc + asNum(p.value), 0) / filtered.length;
}

function isMeaningfulEventType(type: string): boolean {
  return [
    "title_changed",
    "thumb_changed",
    "version_changed",
    "moderation_changed",
    "link_state_changed",
    "published_at_changed",
    "epic_updated",
  ].includes(type);
}

function sliceSeriesByRange(
  payload: CachePayload,
  range: ChartRangeKey,
): SeriesBundle {
  return payload.seriesByRange?.[range] || payload.seriesByRange?.["1D"] || {
    playerCount24h: [],
    uniquePlayers: [],
    favorites: [],
    recommends: [],
    avgPlaytime: [],
    totalPlaytime: [],
    sessions: [],
  };
}

function normalizeLegacySeriesBundle(value: unknown): SeriesBundle {
  const row = (value && typeof value === "object") ? (value as Record<string, unknown>) : {};
  const arr = (k: string): SeriesPoint[] => {
    const v = row[k];
    return Array.isArray(v) ? (v as SeriesPoint[]) : [];
  };

  return {
    playerCount24h: arr("playerCount24h"),
    uniquePlayers: arr("uniquePlayers"),
    favorites: arr("favorites"),
    recommends: arr("recommends"),
    avgPlaytime: arr("avgPlaytime"),
    totalPlaytime: arr("totalPlaytime"),
    sessions: arr("sessions"),
  };
}

function normalizeSeriesByRange(
  payload: CachePayload | (Record<string, unknown> & { seriesByRange?: unknown; series?: unknown }),
): Record<ChartRangeKey, SeriesBundle> | null {
  const map = payload?.seriesByRange;
  if (map && typeof map === "object") {
    const row = map as Record<string, unknown>;
    const out = {} as Record<ChartRangeKey, SeriesBundle>;
    let hasAny = false;
    for (const range of RANGES) {
      const normalized = normalizeLegacySeriesBundle(row[range]);
      out[range] = normalized;
      if (normalized.playerCount24h.length > 0) hasAny = true;
    }
    if (hasAny) {
      const hasShortRange = out["1D"].playerCount24h.length > 0;
      const hasLongRange =
        out["1W"].playerCount24h.length > 0 ||
        out["1M"].playerCount24h.length > 0 ||
        out["ALL"].playerCount24h.length > 0;
      // Legacy payloads were persisted with only 1D populated.
      if (hasShortRange && !hasLongRange) return null;
      return out;
    }
  }

  const legacySeries = normalizeLegacySeriesBundle((payload as Record<string, unknown>)?.series);
  const hasLegacy =
    legacySeries.playerCount24h.length > 0 ||
    legacySeries.uniquePlayers.length > 0 ||
    legacySeries.favorites.length > 0 ||
    legacySeries.recommends.length > 0 ||
    legacySeries.avgPlaytime.length > 0 ||
    legacySeries.totalPlaytime.length > 0 ||
    legacySeries.sessions.length > 0;
  if (!hasLegacy) return null;

  return {
    "1D": legacySeries,
    "1W": legacySeries,
    "1M": legacySeries,
    "ALL": legacySeries,
  };
}

function legacyFallbackSeriesByRange(payload: Record<string, unknown>): Record<ChartRangeKey, SeriesBundle> {
  const legacy = normalizeLegacySeriesBundle(payload.series);
  return {
    "1D": legacy,
    "1W": legacy,
    "1M": legacy,
    "ALL": legacy,
  };
}

async function buildFreshPayload(
  supabase: any,
  islandCode: string,
  region: string,
  surfaceName: string,
): Promise<CachePayload> {
  const now = new Date();
  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  const from24hIso = new Date(nowMs - RANGE_MS["1D"]).toISOString();

  const [
    targetRes,
    metadataRes,
    cacheRes,
    reportRowsRes,
  ] = await Promise.all([
    supabase
      .from("discovery_exposure_targets")
      .select("id,last_ok_tick_at")
      .eq("region", region)
      .eq("surface_name", surfaceName)
      .order("last_ok_tick_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("discover_link_metadata")
      .select("link_code,title,support_code,image_url,published_at_epic,updated_at_epic,raw")
      .eq("link_code", islandCode)
      .maybeSingle(),
    supabase
      .from("discover_islands_cache")
      .select("island_code,title,creator_code,image_url,category,tags,published_at_epic,updated_at_epic,last_week_peak_ccu")
      .eq("island_code", islandCode)
      .maybeSingle(),
    supabase
      .from("discover_report_islands")
      .select(
        "report_id,week_unique,week_plays,week_minutes,week_minutes_per_player_avg,week_peak_ccu_max,week_favorites,week_recommends,week_d1_avg,week_d7_avg,updated_at",
      )
      .eq("island_code", islandCode)
      .eq("status", "reported")
      .order("updated_at", { ascending: true })
      .limit(520),
  ]);

  const targetId = String(targetRes?.data?.id || "");

  const [segmentsRes, eventsRes] = await Promise.all([
    targetId
      ? supabase
          .from("discovery_exposure_rank_segments")
          .select("panel_name,panel_display_name,rank,start_ts,end_ts,last_seen_ts")
          .eq("target_id", targetId)
          .eq("link_code", islandCode)
          .eq("link_code_type", "island")
          .lt("start_ts", nowIso)
          .or(`end_ts.is.null,end_ts.gt.${from24hIso}`)
          .order("panel_name", { ascending: true })
          .order("start_ts", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("discover_link_metadata_events")
      .select("ts,created_at,event_type,old_value,new_value")
      .eq("link_code", islandCode)
      .order("ts", { ascending: false })
      .limit(200),
  ]);

  const epicMeta = (await fetchJsonWithTimeout(`${EPIC_API}/islands/${islandCode}`, 8000, false)) || {};

  const createdHint = asIso(
    epicMeta?.publishedAt ||
      epicMeta?.published_at ||
      epicMeta?.createdAt ||
      epicMeta?.created_at ||
      metadataRes?.data?.published_at_epic ||
      cacheRes?.data?.published_at_epic,
  );

  const hourFrom = new Date(nowMs - 7 * 24 * 60 * 60 * 1000);
  const hourMetricsPayload = await fetchJsonWithTimeout(
    `${EPIC_API}/islands/${islandCode}/metrics/hour?from=${hourFrom.toISOString()}&to=${nowIso}`,
    10000,
    false,
  );
  const hourRoot = getMetricsRoot(hourMetricsPayload);

  const seriesCandidates = {
    players: ["peakCCU", "ccu", "players", "concurrentPlayers"],
    uniquePlayers: ["uniquePlayers", "unique_players"],
    favorites: ["favorites", "favourites"],
    recommends: ["recommendations", "recommends"],
    avgPlaytime: ["averageMinutesPerPlayer", "averagePlaytime", "avgPlaytime", "avg_minutes_per_player"],
    totalPlaytime: ["minutesPlayed", "minutes_played", "playtimeMinutes"],
    sessions: ["sessions", "plays", "totalPlays"],
    plays: ["plays", "totalPlays"],
  };

  const playersHour = normalizeNumericSeries(metricArray(hourRoot, seriesCandidates.players));
  const uniqueHour = normalizeNumericSeries(metricArray(hourRoot, seriesCandidates.uniquePlayers));
  const favoritesHour = normalizeNumericSeries(metricArray(hourRoot, seriesCandidates.favorites));
  const recommendsHour = normalizeNumericSeries(metricArray(hourRoot, seriesCandidates.recommends));
  const avgPlaytimeHour = normalizeNumericSeries(metricArray(hourRoot, seriesCandidates.avgPlaytime));
  const totalPlaytimeHour = normalizeNumericSeries(metricArray(hourRoot, seriesCandidates.totalPlaytime));
  const sessionsHour = normalizeNumericSeries(metricArray(hourRoot, seriesCandidates.sessions));
  const playsHour = normalizeNumericSeries(metricArray(hourRoot, seriesCandidates.plays));

  const playersDayFromHour = aggregateSeriesByDay(playersHour, "max");
  const uniqueDayFromHour = aggregateSeriesByDay(uniqueHour, "sum");
  const favoritesDayFromHour = aggregateSeriesByDay(favoritesHour, "sum");
  const recommendsDayFromHour = aggregateSeriesByDay(recommendsHour, "sum");
  const avgPlaytimeDayFromHour = aggregateSeriesByDay(avgPlaytimeHour, "avg");
  const totalPlaytimeDayFromHour = aggregateSeriesByDay(totalPlaytimeHour, "sum");
  const sessionsDayFromHour = aggregateSeriesByDay(sessionsHour, "sum");
  const playersBase = playersHour.length ? playersHour : playersDayFromHour;

  const reportRowsBase = ((reportRowsRes?.data || []) as Array<{
    report_id: string | null;
    week_unique: number | null;
    week_plays: number | null;
    week_minutes: number | null;
    week_minutes_per_player_avg: number | null;
    week_peak_ccu_max: number | null;
    week_favorites: number | null;
    week_recommends: number | null;
    week_d1_avg: number | null;
    week_d7_avg: number | null;
    updated_at: string | null;
  }>)
    .map((r) => ({ ...r, updatedAtTs: toEpoch(r.updated_at) }))
    .sort((a, b) => asNum(a.updatedAtTs) - asNum(b.updatedAtTs));

  // Keep weekly chronology even if some rows have no timestamp.
  const reportRows = reportRowsBase.map((r, idx) => ({
    ...r,
    probeTs:
      r.updatedAtTs ??
      (nowMs - ((reportRowsBase.length - idx) * 7 * 24 * 60 * 60 * 1000)),
  }));

  const fromReports = (field: keyof typeof reportRows[number]): Array<{ ts: number; value: number }> =>
    reportRows
      .map((r) => ({ ts: r.probeTs as number, value: asNum(r[field]) }))
      .filter((r) => Number.isFinite(r.ts));

  const playersMonthBase = fromReports("week_peak_ccu_max");
  const uniqueMonthBase = fromReports("week_unique");
  const favoritesMonthBase = fromReports("week_favorites");
  const recommendsMonthBase = fromReports("week_recommends");
  const avgPlaytimeMonthBase = fromReports("week_minutes_per_player_avg");
  const totalPlaytimeMonthBase = fromReports("week_minutes");
  const sessionsMonthBase = fromReports("week_plays");

  const createdMs = createdHint ? Date.parse(createdHint) : null;
  const seriesByRange = {} as CachePayload["seriesByRange"];
  for (const range of RANGES) {
    const hourlyRange = range === "1D";
    const weeklyRange = range === "1W";

    const playerSource = hourlyRange
      ? playersHour
      : weeklyRange
        ? playersDayFromHour
        : (playersMonthBase.length ? playersMonthBase : playersDayFromHour);
    const uniqueSource = hourlyRange
      ? uniqueHour
      : weeklyRange
        ? uniqueDayFromHour
        : (uniqueMonthBase.length ? uniqueMonthBase : uniqueDayFromHour);
    const favoritesSource = hourlyRange
      ? favoritesHour
      : weeklyRange
        ? favoritesDayFromHour
        : (favoritesMonthBase.length ? favoritesMonthBase : favoritesDayFromHour);
    const recommendsSource = hourlyRange
      ? recommendsHour
      : weeklyRange
        ? recommendsDayFromHour
        : (recommendsMonthBase.length ? recommendsMonthBase : recommendsDayFromHour);
    const avgPlaytimeSource = hourlyRange
      ? avgPlaytimeHour
      : weeklyRange
        ? avgPlaytimeDayFromHour
        : (avgPlaytimeMonthBase.length ? avgPlaytimeMonthBase : avgPlaytimeDayFromHour);
    const totalPlaytimeSource = hourlyRange
      ? totalPlaytimeHour
      : weeklyRange
        ? totalPlaytimeDayFromHour
        : (totalPlaytimeMonthBase.length ? totalPlaytimeMonthBase : totalPlaytimeDayFromHour);
    const sessionsSource = hourlyRange
      ? sessionsHour
      : weeklyRange
        ? sessionsDayFromHour
        : (sessionsMonthBase.length ? sessionsMonthBase : sessionsDayFromHour);

    seriesByRange[range] = {
      playerCount24h: buildComparativeSeries(playerSource, range, nowMs, createdMs),
      uniquePlayers: buildComparativeSeries(uniqueSource, range, nowMs, createdMs),
      favorites: buildComparativeSeries(favoritesSource, range, nowMs, createdMs),
      recommends: buildComparativeSeries(recommendsSource, range, nowMs, createdMs),
      avgPlaytime: buildComparativeSeries(avgPlaytimeSource, range, nowMs, createdMs),
      totalPlaytime: buildComparativeSeries(totalPlaytimeSource, range, nowMs, createdMs),
      sessions: buildComparativeSeries(sessionsSource, range, nowMs, createdMs),
    };
  }

  const player24hSeries = seriesByRange["1D"].playerCount24h;
  const playersNow = (() => {
    if (!player24hSeries.length) return latestValue(playersBase);
    const last = player24hSeries[player24hSeries.length - 1];
    const lastCurrent = asNum(last.current);
    if (lastCurrent > 0) return lastCurrent;
    for (let i = player24hSeries.length - 2; i >= 0; i -= 1) {
      const fallback = asNum(player24hSeries[i].current);
      if (fallback > 0) return fallback;
    }
    return lastCurrent;
  })();
  const peak24h = player24hSeries.reduce((acc, p) => Math.max(acc, asNum(p.current)), 0);

  const peakAllTime = Math.max(
    peak24h,
    maxValue(playersDayFromHour),
    asNum(cacheRes?.data?.last_week_peak_ccu),
    ...reportRows.map((r) => asNum(r.week_peak_ccu_max)),
  );

  const rankNow = (() => {
    const rows = (segmentsRes?.data || []) as any[];
    const active = rows.filter((r) => !r.end_ts);
    const source = active.length ? active : rows;
    if (!source.length) return null;
    return source.reduce((best, r) => {
      const rank = Number(r.rank);
      if (!Number.isFinite(rank)) return best;
      if (best == null || rank < best) return rank;
      return best;
    }, null as number | null);
  })();

  const overview24hWindowStart = nowMs - RANGE_MS["1D"];
  const overview24h = {
    uniquePlayers: Math.round(sumInWindow(uniqueHour, overview24hWindowStart, nowMs)),
    plays: Math.round(sumInWindow(playsHour.length ? playsHour : sessionsHour, overview24hWindowStart, nowMs)),
    favorites: Math.round(sumInWindow(favoritesHour, overview24hWindowStart, nowMs)),
    recommends: Math.round(sumInWindow(recommendsHour, overview24hWindowStart, nowMs)),
    minutesPlayed: Math.round(sumInWindow(totalPlaytimeHour, overview24hWindowStart, nowMs)),
    avgMinutesPerPlayer: Number(avgInWindow(avgPlaytimeHour, overview24hWindowStart, nowMs).toFixed(2)),
    avgSessionMinutes: Number(avgInWindow(avgPlaytimeHour, overview24hWindowStart, nowMs).toFixed(2)),
    retentionD1: Number(asNum(reportRows[reportRows.length - 1]?.week_d1_avg).toFixed(2)),
    retentionD7: Number(asNum(reportRows[reportRows.length - 1]?.week_d7_avg).toFixed(2)),
  };

  const overviewAllTime = {
    minutesPlayed: Math.round(reportRows.reduce((acc, r) => acc + asNum(r.week_minutes), 0)),
    favorites: Math.round(reportRows.reduce((acc, r) => acc + asNum(r.week_favorites), 0)),
    recommends: Math.round(reportRows.reduce((acc, r) => acc + asNum(r.week_recommends), 0)),
  };

  const panelRowsMap = new Map<
    string,
    { panelDisplayName: string; segments: Array<{ start: string; end: string; rank: number | null; minutes: number }> }
  >();
  for (const raw of ((segmentsRes?.data || []) as any[])) {
    const panelName = String(raw.panel_name || "");
    if (!panelName) continue;

    const startMs = toEpoch(raw.start_ts) ?? nowMs;
    const endCandidateMs = toEpoch(raw.end_ts) ?? toEpoch(raw.last_seen_ts) ?? nowMs;
    const clampedStart = Math.max(startMs, nowMs - RANGE_MS["1D"]);
    const clampedEnd = Math.min(endCandidateMs, nowMs);
    if (clampedEnd <= clampedStart) continue;

    const row = panelRowsMap.get(panelName) || {
      panelDisplayName: String(raw.panel_display_name || raw.panel_name || panelName),
      segments: [],
    };
    row.segments.push({
      start: new Date(clampedStart).toISOString(),
      end: new Date(clampedEnd).toISOString(),
      rank: Number.isFinite(Number(raw.rank)) ? Number(raw.rank) : null,
      minutes: Math.max(0, Math.round((clampedEnd - clampedStart) / 60000)),
    });
    panelRowsMap.set(panelName, row);
  }

  const panelTimeline24h = {
    rows: Array.from(panelRowsMap.entries())
      .map(([panelName, row]) => ({
        panelName,
        panelDisplayName: row.panelDisplayName,
        segments: row.segments.sort((a, b) => a.start.localeCompare(b.start)),
      }))
      .sort((a, b) => a.panelDisplayName.localeCompare(b.panelDisplayName)),
  };

  const rawEvents = ((eventsRes?.data || []) as any[]).map((e) => ({
    ts: String(e.ts || e.created_at || ""),
    eventType: String(e.event_type || ""),
    oldValue: e.old_value,
    newValue: e.new_value,
  }));

  const meaningful: CachePayload["updates"]["events"] = [];
  for (const ev of rawEvents) {
    if (!ev.ts || !ev.eventType) continue;
    if (!isMeaningfulEventType(ev.eventType)) continue;
    if (stableStringify(ev.oldValue) === stableStringify(ev.newValue)) continue;
    if (ev.eventType === "epic_updated") {
      const oldUpdated = extractUpdatedValue(ev.oldValue);
      const newUpdated = extractUpdatedValue(ev.newValue);
      if (isEquivalentInstant(oldUpdated, newUpdated)) continue;
    }
    meaningful.push(ev);
  }
  meaningful.sort((a, b) => b.ts.localeCompare(a.ts));

  let dppiRadar: CachePayload["dppi_radar"] = null;
  if (targetId) {
    const [oppRes, survRes, attemptRes] = await Promise.all([
      supabase
        .from("dppi_opportunities")
        .select("generated_at,panel_name,enter_score_2h,enter_score_5h,enter_score_12h,opening_signal,pressure_forecast,confidence_bucket,model_version,evidence_json")
        .eq("target_id", targetId)
        .eq("island_code", islandCode)
        .order("enter_score_2h", { ascending: false })
        .limit(8),
      supabase
        .from("dppi_survival_predictions")
        .select("generated_at,panel_name,prediction_horizon,score,confidence_bucket")
        .eq("target_id", targetId)
        .eq("island_code", islandCode)
        .order("generated_at", { ascending: false })
        .limit(24),
      supabase
        .from("discovery_exposure_presence_events")
        .select("event_type,ts")
        .eq("target_id", targetId)
        .eq("link_code", islandCode)
        .eq("link_code_type", "island")
        .gte("ts", new Date(nowMs - 14 * 24 * 60 * 60 * 1000).toISOString())
        .order("ts", { ascending: false })
        .limit(400),
    ]);

    if (!oppRes.error && !survRes.error && !attemptRes.error) {
      const opportunities = (oppRes.data || []) as any[];
      const survivalRows = (survRes.data || []) as any[];
      const attemptEvents = (attemptRes.data || []) as any[];
      const headline = opportunities[0] || null;
      const generatedAt = opportunities[0]?.generated_at || survivalRows[0]?.generated_at || null;
      dppiRadar = {
        model_version_used: opportunities[0]?.model_version || null,
        prediction_generated_at: generatedAt,
        headline: headline
          ? {
              panel_name: String(headline.panel_name || ""),
              score_h2: asNum(headline.enter_score_2h),
              opening_signal: asNum(headline.opening_signal),
              pressure_forecast: String(headline.pressure_forecast || "medium"),
              confidence_bucket: String(headline.confidence_bucket || "low"),
            }
          : null,
        top_panel_opportunities: opportunities.map((row) => ({
          panel_name: String(row.panel_name || ""),
          score: {
            h2: asNum(row.enter_score_2h),
            h5: asNum(row.enter_score_5h),
            h12: asNum(row.enter_score_12h),
          },
          opening_signal: asNum(row.opening_signal),
          pressure_forecast: String(row.pressure_forecast || "medium"),
          confidence_bucket: String(row.confidence_bucket || "low"),
          evidence: (row.evidence_json && typeof row.evidence_json === "object") ? row.evidence_json as Record<string, unknown> : {},
        })),
        survival_signals: survivalRows.map((row) => ({
          panel_name: String(row.panel_name || ""),
          horizon: String(row.prediction_horizon || ""),
          score: asNum(row.score),
          confidence_bucket: String(row.confidence_bucket || "low"),
          generated_at: row.generated_at || null,
        })),
        attempts: {
          total_14d: attemptEvents.length,
          entries_48h: attemptEvents.filter((e) => e.event_type === "enter" && (toEpoch(e.ts) || 0) >= nowMs - (48 * 60 * 60 * 1000)).length,
          exits_48h: attemptEvents.filter((e) => e.event_type === "exit" && (toEpoch(e.ts) || 0) >= nowMs - (48 * 60 * 60 * 1000)).length,
        },
      };
    }
  }

  const metaTitle = String(
    epicMeta?.title ||
      metadataRes?.data?.title ||
      cacheRes?.data?.title ||
      islandCode,
  );
  const metaImage = pickImageUrl(
    epicMeta?.imageUrl,
    epicMeta?.thumbnailUrl,
    epicMeta?.images?.landscape,
    metadataRes?.data?.image_url,
    cacheRes?.data?.image_url,
  );

  const platformDistribution = parsePlatformDistribution(
    epicMeta?.platformDistribution,
    epicMeta?.platform_distribution,
    epicMeta?.platformShare,
    epicMeta?.platform_share,
    epicMeta?.deviceDistribution,
    epicMeta?.device_distribution,
    epicMeta?.platforms,
    epicMeta?.devices,
    metadataRes?.data?.raw?.platformDistribution,
    metadataRes?.data?.raw?.platform_distribution,
    metadataRes?.data?.raw?.platforms,
    metadataRes?.data?.raw?.devices,
    cacheRes?.data?.platform_distribution,
  );

  return {
    meta: {
      islandCode,
      title: metaTitle,
      imageUrl: metaImage,
      creatorCode: String(epicMeta?.creatorCode || metadataRes?.data?.support_code || cacheRes?.data?.creator_code || "") || null,
      category: String(epicMeta?.category || cacheRes?.data?.category || "") || null,
      tags: tagsToArray(epicMeta?.tags ?? cacheRes?.data?.tags ?? metadataRes?.data?.raw?.tags),
      publishedAtEpic: asIso(epicMeta?.publishedAt || metadataRes?.data?.published_at_epic || cacheRes?.data?.published_at_epic),
      updatedAtEpic: asIso(epicMeta?.updatedAt || metadataRes?.data?.updated_at_epic || cacheRes?.data?.updated_at_epic),
    },
    kpisNow: {
      playersNow: Math.round(playersNow),
      rankNow,
      peak24h: Math.round(peak24h),
      peakAllTime: Math.round(peakAllTime),
    },
    overview24h,
    overviewAllTime,
    platformDistribution,
    seriesByRange,
    panelTimeline24h,
    updates: {
      events: meaningful.slice(0, 60),
      technicalFilteredCount: Math.max(0, rawEvents.length - meaningful.length),
      lastMeaningfulUpdateAt: meaningful[0]?.ts || null,
    },
    dppi_radar: dppiRadar,
    asOf: nowIso,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const now = new Date();
  const nowIso = now.toISOString();
  const nowMs = now.getTime();

  try {
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    if (shouldProxyToData(req)) {
      const proxied = await invokeDataFunction({
        req,
        functionName: "discover-island-page",
        body,
        timeoutMs: getEnvNumber("LOOKUP_DATA_TIMEOUT_MS", 4500),
      });
      if (proxied.ok) return dataProxyResponse(proxied.data, proxied.status, corsHeaders);
      return dataBridgeUnavailableResponse(corsHeaders, proxied.error);
    }

    if (shouldBlockLocalExecution(req)) {
      return dataBridgeUnavailableResponse(corsHeaders, "strict proxy mode");
    }

    const mode = String(body?.mode || "").trim().toLowerCase();
    const supabase = createClient(mustEnv("SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));

    if (mode === "refresh_cache") {
      if (!(await hasServiceRoleKey(req))) {
        return json({ error: "forbidden" }, 401);
      }

      const batchSize = clampBatchSize(body?.batchSize);
      const cutoffIso = new Date(nowMs - ACTIVE_CACHE_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
      const prewarmHot = body?.prewarmHot != null ? Boolean(body.prewarmHot) : true;

      const { data: activeRows, error: activeError } = await supabase
        .from("discover_island_page_cache")
        .select("island_code,region,surface_name")
        .gte("last_accessed_at", cutoffIso)
        .order("updated_at", { ascending: true, nullsFirst: true })
        .limit(batchSize);

      if (activeError) throw activeError;

      const selectedRows = new Map<string, { island_code: string; region: string; surface_name: string }>();
      for (const row of activeRows || []) {
        const islandCode = String((row as any).island_code || "").trim();
        const region = String((row as any).region || "NAE").trim().toUpperCase();
        const surfaceName = String((row as any).surface_name || "CreativeDiscoverySurface_Frontend").trim();
        if (!ISLAND_CODE_RE.test(islandCode)) continue;
        selectedRows.set(`${islandCode}:${region}:${surfaceName}`, {
          island_code: islandCode,
          region,
          surface_name: surfaceName,
        });
      }

      let seededHot = 0;
      if (prewarmHot && selectedRows.size < batchSize) {
        const remaining = Math.max(0, batchSize - selectedRows.size);
        const [premiumRes, emergingRes] = await Promise.all([
          supabase
            .from("discovery_public_premium_now")
            .select("link_code,region,surface_name,rank,link_code_type")
            .eq("link_code_type", "island")
            .order("rank", { ascending: true })
            .limit(Math.max(remaining * 2, 30)),
          supabase
            .from("discovery_public_emerging_now")
            .select("link_code,region,surface_name,score,link_code_type")
            .eq("link_code_type", "island")
            .order("score", { ascending: false })
            .limit(Math.max(remaining * 2, 30)),
        ]);

        const hotRows = [...(premiumRes.data || []), ...(emergingRes.data || [])] as any[];
        for (const row of hotRows) {
          if (selectedRows.size >= batchSize) break;
          const islandCode = String(row?.link_code || "").trim();
          const region = String(row?.region || "NAE").trim().toUpperCase();
          const surfaceName = String(row?.surface_name || "CreativeDiscoverySurface_Frontend").trim();
          if (!ISLAND_CODE_RE.test(islandCode)) continue;

          const key = `${islandCode}:${region}:${surfaceName}`;
          if (selectedRows.has(key)) continue;
          selectedRows.set(key, {
            island_code: islandCode,
            region,
            surface_name: surfaceName,
          });
          seededHot += 1;
        }
      }

      let processed = 0;
      let succeeded = 0;
      let failed = 0;

      for (const row of selectedRows.values()) {
        const islandCode = row.island_code;
        const region = row.region;
        const surfaceName = row.surface_name;

        processed += 1;
        try {
          const freshPayload = await buildFreshPayload(supabase, islandCode, region, surfaceName);
          const expiresAt = new Date(Date.now() + cacheTtlMinutes() * 60 * 1000).toISOString();
          await supabase
            .from("discover_island_page_cache")
            .update({
              payload_json: freshPayload as unknown as Record<string, unknown>,
              as_of: freshPayload.asOf,
              expires_at: expiresAt,
              updated_at: new Date().toISOString(),
              last_refresh_error: null,
            })
            .eq("island_code", islandCode)
            .eq("region", region)
            .eq("surface_name", surfaceName);
          succeeded += 1;
        } catch (refreshErr) {
          failed += 1;
          const message = refreshErr instanceof Error ? refreshErr.message : String(refreshErr);
          await supabase
            .from("discover_island_page_cache")
            .update({
              updated_at: new Date().toISOString(),
              last_refresh_error: message.slice(0, 500),
            })
            .eq("island_code", islandCode)
            .eq("region", region)
            .eq("surface_name", surfaceName);
        }
      }

      return json({
        mode: "refresh_cache",
        batchSize,
        cutoffIso,
        prewarmHot,
        seededHot,
        processed,
        succeeded,
        failed,
      });
    }

    const islandCode = String(body?.islandCode || "").trim();
    const region = String(body?.region || "NAE").trim().toUpperCase();
    const surfaceName = String(body?.surfaceName || "CreativeDiscoverySurface_Frontend").trim();
    const requestedRange = clampRange(body?.range);

    if (!ISLAND_CODE_RE.test(islandCode)) {
      return json({ error: "Invalid island code format" }, 400);
    }

    const responseFromPayload = (
      payload: CachePayload,
      seriesByRange: Record<ChartRangeKey, SeriesBundle>,
      cacheHit: boolean,
      stale: boolean,
    ) => ({
      meta: payload.meta,
      kpisNow: payload.kpisNow,
      overview24h: payload.overview24h,
      overviewAllTime: payload.overviewAllTime,
      platformDistribution: payload.platformDistribution ?? null,
      seriesByRange,
      series: seriesByRange[requestedRange] || seriesByRange["1D"],
      panelTimeline24h: payload.panelTimeline24h,
      updates: payload.updates,
      dppi_radar: payload.dppi_radar ?? null,
      asOf: payload.asOf,
      range: requestedRange,
      cache: { hit: cacheHit, stale, asOf: payload.asOf },
    });

    const { data: cacheRow } = await supabase
      .from("discover_island_page_cache")
      .select("payload_json,as_of,expires_at,hit_count")
      .eq("island_code", islandCode)
      .eq("region", region)
      .eq("surface_name", surfaceName)
      .maybeSingle();

    const payload = cacheRow?.payload_json as CachePayload | null;
    if (payload) {
      let normalized = normalizeSeriesByRange(payload);
      if (!normalized) {
        try {
          const refreshed = await buildFreshPayload(supabase, islandCode, region, surfaceName);
          normalized = normalizeSeriesByRange(refreshed);
          const expiresAt = new Date(nowMs + cacheTtlMinutes() * 60 * 1000).toISOString();
          await supabase
            .from("discover_island_page_cache")
            .update({
              payload_json: refreshed as unknown as Record<string, unknown>,
              as_of: refreshed.asOf,
              expires_at: expiresAt,
              updated_at: nowIso,
              last_accessed_at: nowIso,
              hit_count: asNum(cacheRow?.hit_count) + 1,
              last_refresh_error: null,
            })
            .eq("island_code", islandCode)
            .eq("region", region)
            .eq("surface_name", surfaceName);

          if (normalized) {
            const refreshedAsOfMs = toEpoch(refreshed.asOf);
            const refreshedStale = refreshedAsOfMs == null || (nowMs - refreshedAsOfMs) > CACHE_STALE_MINUTES * 60 * 1000;
            return json(responseFromPayload(refreshed, normalized, true, refreshedStale));
          }
        } catch (legacyUpgradeErr) {
          const message = legacyUpgradeErr instanceof Error ? legacyUpgradeErr.message : String(legacyUpgradeErr);
          await supabase
            .from("discover_island_page_cache")
            .update({
              updated_at: nowIso,
              last_accessed_at: nowIso,
              hit_count: asNum(cacheRow?.hit_count) + 1,
              last_refresh_error: message.slice(0, 500),
            })
            .eq("island_code", islandCode)
            .eq("region", region)
            .eq("surface_name", surfaceName);
        }
      }

      if (!normalized) {
        normalized = legacyFallbackSeriesByRange(payload as unknown as Record<string, unknown>);
      }

      const asOfMs = toEpoch(payload.asOf);
      const stale = asOfMs == null || (nowMs - asOfMs) > CACHE_STALE_MINUTES * 60 * 1000;
      await supabase
        .from("discover_island_page_cache")
        .update({
          last_accessed_at: nowIso,
          hit_count: asNum(cacheRow?.hit_count) + 1,
          updated_at: nowIso,
        })
        .eq("island_code", islandCode)
        .eq("region", region)
        .eq("surface_name", surfaceName);
      return json(responseFromPayload(payload, normalized, true, stale));
    }

    const freshPayload = await buildFreshPayload(supabase, islandCode, region, surfaceName);
    const normalizedFresh = normalizeSeriesByRange(freshPayload) || legacyFallbackSeriesByRange(freshPayload as unknown as Record<string, unknown>);
    const expiresAt = new Date(nowMs + cacheTtlMinutes() * 60 * 1000).toISOString();

    await supabase.from("discover_island_page_cache").upsert(
      {
        island_code: islandCode,
        region,
        surface_name: surfaceName,
        payload_json: freshPayload as unknown as Record<string, unknown>,
        as_of: freshPayload.asOf,
        expires_at: expiresAt,
        updated_at: nowIso,
        last_accessed_at: nowIso,
        hit_count: 0,
        last_refresh_error: null,
      },
      { onConflict: "island_code,region,surface_name" },
    );

    return json(responseFromPayload(freshPayload, normalizedFresh, false, false));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const status = message.toLowerCase().includes("invalid island code") ? 400 : 500;
    return json({ error: message }, status);
  }
});
