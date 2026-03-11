import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  dataBridgeUnavailableResponse,
  dataProxyResponse,
  getEnvNumber,
  invokeDataFunction,
  isInternalBridgeRequest,
  shouldBlockLocalExecution,
  shouldProxyToData,
} from "../_shared/dataBridge.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};

const EPIC_API = "https://api.fortnite.com/ecosystem/v1";
const DISCOVERY_SURFACE = "CreativeDiscoverySurface_Frontend";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const COMPETITOR_WEIGHTS = {
  unique: 0.25,
  plays: 0.2,
  peakCCU: 0.15,
  minutesPerPlayer: 0.15,
  retentionComposite: 0.2,
  advocacy: 0.05,
} as const;
const PREWARM_CACHE_USER_ID =
  String(Deno.env.get("DISCOVERY_PREWARM_CACHE_USER_ID") || "00000000-0000-0000-0000-000000000000").trim();
const TOKEN_SUB_CACHE = new Map<string, { sub: string; expiresAt: number }>();
type MemoryEntry<T> = { value: T; expiresAt: number };
const LOOKUP_RESPONSE_MEM = new Map<string, MemoryEntry<Record<string, unknown>>>();
const RECENT_LOOKUPS_MEM = new Map<string, MemoryEntry<any[]>>();

function readMemory<T>(store: Map<string, MemoryEntry<T>>, key: string): T | null {
  const row = store.get(key);
  if (!row) return null;
  if (row.expiresAt <= Date.now()) {
    store.delete(key);
    return null;
  }
  return row.value;
}

function writeMemory<T>(store: Map<string, MemoryEntry<T>>, key: string, value: T, ttlMs: number, maxSize: number) {
  store.set(key, { value, expiresAt: Date.now() + Math.max(1_000, ttlMs) });
  if (store.size <= maxSize) return;

  const now = Date.now();
  for (const [k, v] of store.entries()) {
    if (v.expiresAt <= now) store.delete(k);
    if (store.size <= maxSize) return;
  }

  while (store.size > maxSize) {
    const oldest = store.keys().next().value as string | undefined;
    if (!oldest) break;
    store.delete(oldest);
  }
}

function lookupMemTtlMs(): number {
  return Math.max(5_000, getEnvNumber("LOOKUP_MEMORY_CACHE_TTL_MS", 20_000));
}

function recentMemTtlMs(): number {
  return Math.max(3_000, getEnvNumber("LOOKUP_RECENT_MEMORY_CACHE_TTL_MS", 10_000));
}

function lookupMemKey(primaryCode: string, compareCode: string): string {
  return `${String(primaryCode || "").trim()}::${String(compareCode || "").trim()}`;
}

function getCachedSub(token: string): string | null {
  const row = TOKEN_SUB_CACHE.get(token);
  if (!row) return null;
  if (row.expiresAt <= Date.now()) {
    TOKEN_SUB_CACHE.delete(token);
    return null;
  }
  return row.sub;
}

function cacheSub(token: string, sub: string, ttlMs = 60_000) {
  TOKEN_SUB_CACHE.set(token, { sub, expiresAt: Date.now() + Math.max(5_000, ttlMs) });
  if (TOKEN_SUB_CACHE.size > 512) {
    const now = Date.now();
    for (const [k, v] of TOKEN_SUB_CACHE.entries()) {
      if (v.expiresAt <= now) TOKEN_SUB_CACHE.delete(k);
      if (TOKEN_SUB_CACHE.size <= 384) break;
    }
  }
}

function dayIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function extractBearerToken(req: Request): string {
  const auth = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  return auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    let b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4;
    if (pad) b64 += "=".repeat(4 - pad);
    const payload = JSON.parse(atob(b64));
    return payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

async function hasServiceRoleKey(req: Request, serviceKey: string, supabaseUrl: string): Promise<boolean> {
  const bearer = extractBearerToken(req);
  const apikey = String(req.headers.get("apikey") || "").trim();
  const token = bearer || apikey;
  if (!token) return false;
  if (token === serviceKey) return true;

  // Fast negative path for regular user JWTs.
  const bearerRole = bearer ? String(decodeJwtPayload(bearer)?.role || "").trim() : "";
  if (bearerRole && bearerRole !== "service_role") return false;
  if (!bearer) {
    const apiRole = apikey ? String(decodeJwtPayload(apikey)?.role || "").trim() : "";
    if (apiRole && apiRole !== "service_role") return false;
  }

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
  } catch {
    // best-effort log only
  }
}

function titleizeWords(input: string): string {
  return input
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function normalizePanelDisplayName(panelName: string): string {
  const raw = String(panelName || "").trim();
  if (!raw) return raw;

  if (/^ForYou[_A-Z]/.test(raw)) return "For You";

  if (/^Experiences[_A-Z]/.test(raw)) {
    const rest = raw
      .replace(/^Experiences_?/, "")
      .replace(/_Flat$/i, "")
      .replace(/_Rows?$/i, "");
    return titleizeWords(rest.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2"));
  }

  if (/^Nested[_A-Z]/.test(raw)) {
    const rest = raw.replace(/^Nested_?/, "");
    return titleizeWords(rest.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2"));
  }

  if (/^Browse[_A-Z]/.test(raw)) {
    const rest = raw.replace(/^Browse_?/, "");
    return titleizeWords(rest.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2"));
  }

  if (/^GameCollections[_A-Z]/.test(raw)) {
    const rest = raw.replace(/^GameCollections_?/, "");
    const label = titleizeWords(
      rest
        .replace(/_Group\d+$/i, "")
        .replace(/^Split_?/i, "")
        .replace(/_/g, " ")
        .replace(/([a-z])([A-Z])/g, "$1 $2"),
    );
    return `Game Collections ${label}`.trim();
  }

  return titleizeWords(raw.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\bDefault\b/gi, "").trim());
}

function surfaceDisplayName(surfaceName: string): string {
  const raw = String(surfaceName || "");
  if (raw === "CreativeDiscoverySurface_Frontend") return "Discovery";
  if (raw === "CreativeDiscoverySurface_Browse") return "Browse";
  return raw;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const entries = Object.entries(obj).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

function toEpochMs(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v).trim();
  if (!s) return null;
  const t = Date.parse(s);
  if (Number.isFinite(t)) return t;
  return null;
}

function extractUpdatedValue(v: unknown): unknown {
  if (v == null) return null;
  if (typeof v !== "object") return v;
  const o = v as Record<string, unknown>;
  if ("updated" in o) return o.updated;
  if ("updated_at" in o) return o.updated_at;
  return v;
}

function isEquivalentInstant(a: unknown, b: unknown): boolean {
  const ta = toEpochMs(a);
  const tb = toEpochMs(b);
  return ta != null && tb != null && ta === tb;
}

function sanitizeCreator(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function isEpicCreator(value: unknown): boolean {
  const v = sanitizeCreator(value);
  return v === "epic" || v === "epicgames";
}

function normalizeTag(input: unknown): string {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function tagsToSet(input: unknown): Set<string> {
  const out = new Set<string>();
  const push = (v: unknown) => {
    const n = normalizeTag(v);
    if (n) out.add(n);
  };

  if (Array.isArray(input)) {
    for (const item of input) {
      if (typeof item === "string") {
        push(item);
      } else if (item && typeof item === "object") {
        const obj = item as Record<string, unknown>;
        if (typeof obj.tag === "string") push(obj.tag);
        if (typeof obj.name === "string") push(obj.name);
      }
    }
    return out;
  }

  if (input && typeof input === "object") {
    const obj = input as Record<string, unknown>;
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === "boolean") {
        if (v) push(k);
      } else if (typeof v === "string") {
        push(k);
        push(v);
      } else {
        push(k);
      }
    }
  }

  return out;
}

function overlapCount(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let n = 0;
  for (const x of a) if (b.has(x)) n += 1;
  return n;
}

function percentileArray(values: number[]): number[] {
  const n = values.length;
  if (n === 0) return [];
  if (n === 1) return [100];

  const pairs = values.map((v, i) => ({ v: Number.isFinite(v) ? v : 0, i }));
  pairs.sort((a, b) => a.v - b.v);

  const out = new Array<number>(n).fill(0);
  let i = 0;
  while (i < n) {
    let j = i + 1;
    while (j < n && pairs[j].v === pairs[i].v) j += 1;
    const avgPos = (i + (j - 1)) / 2;
    const pct = (avgPos / (n - 1)) * 100;
    for (let k = i; k < j; k += 1) out[pairs[k].i] = Number(pct.toFixed(2));
    i = j;
  }
  return out;
}

function pickImageUrl(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && /^https?:\/\//i.test(value)) return value;
  }
  return null;
}

async function listRecentLookups(service: any, userId: string) {
  const { data } = await service
    .from("discover_lookup_recent")
    .select("primary_code,compare_code,primary_title,compare_title,payload_json,created_at,last_accessed_at,hit_count")
    .eq("user_id", userId)
    .order("last_accessed_at", { ascending: false })
    .limit(3);

  return (data || []).map((row: any) => ({
    primaryImageUrl: pickImageUrl(
      row?.payload_json?.metadata?.imageUrl,
      row?.payload_json?.metadata?.thumbnailUrl,
      row?.payload_json?.internalCard?.imageUrl,
      row?.payload_json?.internalCard?.thumbUrl,
      row?.payload_json?.internalCard?.thumbnailUrl,
    ),
    primaryCode: row.primary_code,
    compareCode: row.compare_code || "",
    primaryTitle: row.primary_title || null,
    compareTitle: row.compare_title || null,
    createdAt: row.created_at,
    lastAccessedAt: row.last_accessed_at,
    hitCount: asNum(row.hit_count),
  }));
}

async function getRecentLookupsCached(service: any, userId: string): Promise<any[]> {
  const cacheKey = String(userId || "").trim();
  if (!cacheKey) return [];

  const fromMem = readMemory(RECENT_LOOKUPS_MEM, cacheKey);
  if (fromMem) return fromMem;

  const rows = await listRecentLookups(service, cacheKey);
  writeMemory(RECENT_LOOKUPS_MEM, cacheKey, rows, recentMemTtlMs(), 2048);
  return rows;
}

function runInBackground(task: Promise<unknown> | unknown) {
  const promise = Promise.resolve(task as any);
  const edgeRuntime = (globalThis as any)?.EdgeRuntime;
  if (edgeRuntime && typeof edgeRuntime.waitUntil === "function") {
    edgeRuntime.waitUntil(promise.catch(() => void 0));
    return;
  }
  promise.catch(() => void 0);
}

async function fetchJsonWithTimeout(
  url: string,
  timeoutMs: number,
): Promise<{ ok: boolean; status: number; data: any | null; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const raw = await res.text();
    let parsed: any = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = null;
    }
    if (!res.ok) return { ok: false, status: res.status, data: parsed, error: `Epic request failed (${res.status})` };
    return { ok: true, status: res.status, data: parsed };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 599, data: null, error: message };
  } finally {
    clearTimeout(timer);
  }
}

function prependRecentLookup(
  rows: any[],
  payload: Record<string, unknown>,
  primaryCode: string,
  compareCode: string,
): any[] {
  const current = {
    primaryImageUrl: pickImageUrl(
      (payload as any)?.metadata?.imageUrl,
      (payload as any)?.metadata?.thumbnailUrl,
      (payload as any)?.internalCard?.imageUrl,
      (payload as any)?.internalCard?.thumbUrl,
      (payload as any)?.internalCard?.thumbnailUrl,
    ),
    primaryCode,
    compareCode,
    primaryTitle: String((payload as any)?.metadata?.title || primaryCode),
    compareTitle: compareCode || null,
    createdAt: new Date().toISOString(),
    lastAccessedAt: new Date().toISOString(),
    hitCount: 0,
  };
  const deduped = [
    current,
    ...(rows || []).filter((r: any) => String(r?.primaryCode || "") !== primaryCode || String(r?.compareCode || "") !== compareCode),
  ];
  return deduped.slice(0, 3);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startedAt = Date.now();
  let service: any = null;
  let code = "unknown";
  let userId: string | null = null;
  let serviceRoleMode = false;

  try {
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const internalBridge = isInternalBridgeRequest(req);
    const authHeader = req.headers.get("Authorization") || "";
    const sbUrl = Deno.env.get("SUPABASE_URL")!;
    const sbAnon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const sbService = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    service = createClient(sbUrl, sbService);

    if (!internalBridge) {
      if (!authHeader.startsWith("Bearer ")) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      serviceRoleMode = await hasServiceRoleKey(req, sbService, sbUrl);
      if (!serviceRoleMode) {
        const token = authHeader.replace("Bearer ", "");
        const cachedSub = getCachedSub(token);
        if (cachedSub) {
          userId = cachedSub;
        } else {
          const sb = createClient(sbUrl, sbAnon, { global: { headers: { Authorization: authHeader } } });
          const { data: claimsData, error: claimsError } = await sb.auth.getClaims(token);
          userId = String(claimsData?.claims?.sub || "") || null;
          if (claimsError || !claimsData?.claims || !userId) {
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
          cacheSub(token, userId);
        }
        if (!userId) {
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
      }
    } else {
      const forwardedUserId = String(req.headers.get("x-forwarded-user-id") || "").trim();
      if (forwardedUserId && !UUID_RE.test(forwardedUserId)) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      userId = forwardedUserId || null;
    }

    const mode = String(body?.mode || "").trim().toLowerCase();
    if (mode === "recent") {
      if (!userId || serviceRoleMode) {
        return new Response(JSON.stringify({ recentLookups: [] }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const recentLookups = await getRecentLookupsCached(service, userId);
      return new Response(JSON.stringify({ recentLookups }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { islandCode } = body;
    const compareIslandCode = String(body?.compareCode || body?.compareIslandCode || "").trim() || null;

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
    const compareKey = compareIslandCode || "";
    const fastLookupKey = lookupMemKey(code, compareKey);
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

    if (!internalBridge && shouldProxyToData(req)) {
      const proxied = await invokeDataFunction({
        req,
        functionName: "discover-island-lookup",
        body,
        timeoutMs: getEnvNumber("LOOKUP_DATA_TIMEOUT_MS", 5000),
        extraHeaders: userId ? { "x-forwarded-user-id": userId } : undefined,
      });
      const proxyTiming = [
        `total;dur=${(Date.now() - startedAt).toFixed(1)}`,
        `bridge;dur=${Number(proxied.bridgeMs || 0).toFixed(1)}`,
        String(proxied.upstreamServerTiming || "").trim(),
      ].filter(Boolean).join(", ");

      if (proxied.ok) {
        return dataProxyResponse(proxied.data, proxied.status, { ...corsHeaders, "Server-Timing": proxyTiming });
      }
      if (proxied.status >= 400 && proxied.status < 500 && proxied.data) {
        return dataProxyResponse(proxied.data, proxied.status, { ...corsHeaders, "Server-Timing": proxyTiming });
      }
      return dataBridgeUnavailableResponse({ ...corsHeaders, "Server-Timing": proxyTiming }, proxied.error);
    }

    if (!internalBridge && shouldBlockLocalExecution(req)) {
      return dataBridgeUnavailableResponse(
        { ...corsHeaders, "Server-Timing": `total;dur=${(Date.now() - startedAt).toFixed(1)}` },
        "strict proxy mode",
      );
    }

    const userCacheEnabled = !serviceRoleMode && Boolean(userId);
    const sharedCacheEnabled = serviceRoleMode;
    const cacheUserId = userCacheEnabled ? String(userId) : (sharedCacheEnabled ? PREWARM_CACHE_USER_ID : "");
    const canWriteCache = Boolean(cacheUserId);
    const cacheKeepLimit = userCacheEnabled
      ? 3
      : (sharedCacheEnabled ? Math.max(50, getEnvNumber("LOOKUP_SHARED_CACHE_KEEP", 200)) : 0);

    const memoryPayload = readMemory(LOOKUP_RESPONSE_MEM, fastLookupKey);
    if (memoryPayload) {
      const recentLookupsDb = userCacheEnabled ? await getRecentLookupsCached(service, cacheUserId) : [];
      const recentLookups = userCacheEnabled
        ? prependRecentLookup(recentLookupsDb, memoryPayload, code, compareKey)
        : [];
      if (userCacheEnabled) {
        writeMemory(RECENT_LOOKUPS_MEM, cacheUserId, recentLookups, recentMemTtlMs(), 2048);
      }
      runInBackground(
        safeLogRun(service, {
          user_id: userId,
          island_code: code,
          status: "ok",
          duration_ms: Date.now() - startedAt,
          cache_hit: true,
          cache_scope: "memory",
        }),
      );
      return new Response(
        JSON.stringify({
          ...memoryPayload,
          cacheHit: true,
          recentLookups,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    let cachedLookup: any = null;
    if (cacheUserId) {
      const { data } = await service
        .from("discover_lookup_recent")
        .select("id,payload_json,hit_count,last_accessed_at,created_at")
        .eq("user_id", cacheUserId)
        .eq("primary_code", code)
        .eq("compare_code", compareKey)
        .maybeSingle();
      cachedLookup = data;
    }

    let sharedLookup: any = null;
    if (!cachedLookup?.payload_json) {
      const { data } = await service
        .from("discover_lookup_recent")
        .select("id,user_id,payload_json,hit_count,last_accessed_at,created_at,primary_title,compare_title")
        .eq("primary_code", code)
        .eq("compare_code", compareKey)
        .order("last_accessed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      sharedLookup = data;
    }

    const cacheRow = cachedLookup?.payload_json ? cachedLookup : sharedLookup;
    if (cacheRow?.payload_json) {
      const nowIso = new Date().toISOString();
      const payload = cacheRow.payload_json as Record<string, unknown>;
      writeMemory(LOOKUP_RESPONSE_MEM, fastLookupKey, payload, lookupMemTtlMs(), 1024);
      const recentLookupsDb = userCacheEnabled ? await getRecentLookupsCached(service, cacheUserId) : [];
      const recentLookups = userCacheEnabled
        ? prependRecentLookup(recentLookupsDb, payload, code, compareKey)
        : [];
      if (userCacheEnabled) {
        writeMemory(RECENT_LOOKUPS_MEM, cacheUserId, recentLookups, recentMemTtlMs(), 2048);
      }

      runInBackground((async () => {
        const tasks: Promise<any>[] = [];
        if (cachedLookup?.id) {
          tasks.push(
            service
              .from("discover_lookup_recent")
              .update({
                hit_count: asNum(cachedLookup.hit_count) + 1,
                last_accessed_at: nowIso,
              })
              .eq("id", cachedLookup.id),
          );
        }
        if (canWriteCache && (!cachedLookup?.id || String(cacheRow?.user_id || "") !== cacheUserId)) {
          tasks.push(
            service
              .from("discover_lookup_recent")
              .upsert(
                {
                  user_id: cacheUserId,
                  primary_code: code,
                  compare_code: compareKey,
                  primary_title: String((payload as any)?.metadata?.title || cacheRow?.primary_title || code),
                  compare_title: compareIslandCode || cacheRow?.compare_title || null,
                  payload_json: payload,
                  created_at: nowIso,
                  last_accessed_at: nowIso,
                  hit_count: 0,
                },
                { onConflict: "user_id,primary_code,compare_code" },
              ),
          );
          if (cacheKeepLimit > 0) {
            tasks.push((async () => {
              const { data: keepRows } = await service
                .from("discover_lookup_recent")
                .select("id")
                .eq("user_id", cacheUserId)
                .order("last_accessed_at", { ascending: false })
                .limit(cacheKeepLimit);
              const keepIds = (keepRows || []).map((r: any) => asNum(r.id)).filter((v) => v > 0);
              if (keepIds.length > 0) {
                await service
                  .from("discover_lookup_recent")
                  .delete()
                  .eq("user_id", cacheUserId)
                  .not("id", "in", `(${keepIds.join(",")})`);
              }
            })());
          }
        }
        tasks.push(
          safeLogRun(service, {
            user_id: userId,
            island_code: code,
            status: "ok",
            duration_ms: Date.now() - startedAt,
            cache_hit: true,
            cache_scope: cachedLookup?.id ? "user" : "shared",
          }),
        );
        await Promise.all(tasks);
      })());

      return new Response(
        JSON.stringify({
          ...payload,
          cacheHit: true,
          recentLookups,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const now = new Date();
    const to = new Date(now);
    to.setUTCHours(0, 0, 0, 0);
    const from = new Date(to);
    from.setUTCDate(from.getUTCDate() - 7);
    const from24h = new Date(now);
    from24h.setUTCHours(from24h.getUTCHours() - 24);
    const now14 = new Date();
    now14.setUTCDate(now14.getUTCDate() - 14);
    const fromDay14 = dayIso(now14);

    const dbQueriesPromise = Promise.all([
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
        .select("report_id,week_plays,week_unique,week_peak_ccu_max,week_minutes,updated_at,status,category,title,creator_code,tags")
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

    const [metaFetch, metricsFetch, hourlyFetch, dbQueries] = await Promise.all([
      fetchJsonWithTimeout(`${EPIC_API}/islands/${code}`, 8000),
      fetchJsonWithTimeout(`${EPIC_API}/islands/${code}/metrics/day?from=${from.toISOString()}&to=${to.toISOString()}`, 8000),
      fetchJsonWithTimeout(`${EPIC_API}/islands/${code}/metrics/hour?from=${from24h.toISOString()}&to=${now.toISOString()}`, 8000),
      dbQueriesPromise,
    ]);

    if (!metaFetch.ok) {
      const message = metaFetch.status === 404 ? "Island not found" : `Epic metadata failed (${metaFetch.status})`;
      await safeLogRun(service, {
        user_id: userId,
        island_code: code,
        status: "error",
        duration_ms: Date.now() - startedAt,
        error_type: classifyLookupError(message, metaFetch.status),
        error_message: message,
      });
      return new Response(JSON.stringify({ error: message }), {
        status: metaFetch.status === 404 ? 404 : 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const metadata = metaFetch.data || {};
    const metrics = metricsFetch.ok ? metricsFetch.data : null;
    const hourlyMetrics = hourlyFetch.ok ? hourlyFetch.data : null;
    const [cardRpc, rollupRes, reportIslandsRes, latestReportRes] = dbQueries;

    let eventsRes = await service
      .from("discover_link_metadata_events")
      .select("*")
      .eq("link_code", code)
      .order("ts", { ascending: false })
      .limit(200);
    if (eventsRes.error) {
      eventsRes = await service
        .from("discover_link_metadata_events")
        .select("*")
        .eq("link_code", code)
        .order("created_at", { ascending: false })
        .limit(200);
    }

    const internalCard = cardRpc?.data ?? null;
    const metadataImageUrl = pickImageUrl(
      metadata?.imageUrl,
      metadata?.image_url,
      metadata?.thumbnailUrl,
      metadata?.thumbnail_url,
      metadata?.landscapeImageUrl,
      metadata?.landscape_image_url,
      metadata?.images?.landscape,
      metadata?.images?.thumbnail,
      internalCard?.imageUrl,
      internalCard?.thumbnailUrl,
      internalCard?.thumbUrl,
      internalCard?.image_url,
      internalCard?.thumbnail_url,
      internalCard?.thumb_url,
    );
    const rollRows = (rollupRes?.data ?? []) as any[];

    const panelNames = Array.from(new Set(rollRows.map((r) => String(r.panel_name || "")).filter(Boolean)));
    const panelLabelMap = new Map<string, string>();
    if (panelNames.length > 0) {
      const { data: tierRows } = await service
        .from("discovery_panel_tiers")
        .select("panel_name,label")
        .in("panel_name", panelNames);
      for (const row of tierRows || []) {
        const panelName = String((row as any).panel_name || "");
        const label = String((row as any).label || "").trim();
        if (panelName && label) panelLabelMap.set(panelName, label);
      }
    }

    const getPanelDisplayName = (panelNameRaw: string): string => {
      const byTier = panelLabelMap.get(panelNameRaw);
      if (byTier) return byTier;
      return normalizePanelDisplayName(panelNameRaw);
    };

    type ExposureAgg = {
      panelName: string;
      surfaceName: string;
      minutesExposed: number;
      bestRank: number | null;
      avgRankSum: number;
      avgRankCount: number;
      ccuMaxSeen: number;
      daysSet: Set<string>;
    };

    const panelAggLegacy = new Map<string, ExposureAgg>();
    const dailyMinutesLegacy = new Map<string, number>();
    const panelAggV2 = new Map<string, ExposureAgg>();
    const dailyMinutesV2 = new Map<string, number>();

    const aggregateExposure = (map: Map<string, ExposureAgg>, dailyMap: Map<string, number>, row: any) => {
      const date = String(row.date || "");
      const panelName = String(row.panel_name || "");
      const surfaceName = String(row.surface_name || "");
      const key = `${surfaceName}::${panelName}`;

      if (!map.has(key)) {
        map.set(key, {
          panelName,
          surfaceName,
          minutesExposed: 0,
          bestRank: null,
          avgRankSum: 0,
          avgRankCount: 0,
          ccuMaxSeen: 0,
          daysSet: new Set<string>(),
        });
      }

      const a = map.get(key)!;
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
      if (date) dailyMap.set(date, (dailyMap.get(date) || 0) + minutes);
    };

    for (const row of rollRows) {
      aggregateExposure(panelAggLegacy, dailyMinutesLegacy, row);
      if (String(row.surface_name || "") === DISCOVERY_SURFACE) {
        aggregateExposure(panelAggV2, dailyMinutesV2, row);
      }
    }

    const exposurePanelsTopLegacy = Array.from(panelAggLegacy.values())
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

    const exposureDailyMinutesLegacy = Array.from(dailyMinutesLegacy.entries())
      .map(([date, minutesExposed]) => ({ date, minutesExposed }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const exposurePanelsTopV2 = Array.from(panelAggV2.values())
      .map((a) => ({
        panelNameRaw: a.panelName,
        panelDisplayName: getPanelDisplayName(a.panelName),
        surfaceNameRaw: a.surfaceName,
        surfaceDisplayName: surfaceDisplayName(a.surfaceName),
        minutesExposed: a.minutesExposed,
        bestRank: a.bestRank,
        avgRank: a.avgRankCount > 0 ? Number((a.avgRankSum / a.avgRankCount).toFixed(2)) : null,
        ccuMaxSeen: a.ccuMaxSeen > 0 ? a.ccuMaxSeen : null,
        daysActive: a.daysSet.size,
      }))
      .sort((x, y) => y.minutesExposed - x.minutesExposed)
      .slice(0, 25);

    const exposureDailyMinutesV2 = Array.from(dailyMinutesV2.entries())
      .map(([date, minutesExposed]) => ({ date, minutesExposed }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const discoverySummaryV2 = {
      totalPanels: panelAggV2.size,
      totalMinutesExposed: Number(Array.from(dailyMinutesV2.values()).reduce((acc, v) => acc + v, 0).toFixed(2)),
      bestRankGlobal: (() => {
        const ranks = exposurePanelsTopV2.map((p) => p.bestRank).filter((v): v is number => v != null && v > 0);
        return ranks.length > 0 ? Math.min(...ranks) : null;
      })(),
    };

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

    const rawEvents = ((eventsRes?.data ?? []) as any[])
      .map((e) => ({
        ts: e.ts ?? e.created_at ?? null,
        eventType: e.event_type ?? null,
        oldValue: e.old_value ?? null,
        newValue: e.new_value ?? null,
      }))
      .sort((a, b) => String(b.ts || "").localeCompare(String(a.ts || "")));

    const metadataEvents = rawEvents.slice(0, 20);

    const meaningfulEventTypes = new Set([
      "title_changed",
      "thumb_changed",
      "version_changed",
      "moderation_changed",
      "link_state_changed",
      "published_at_changed",
      "epic_updated",
    ]);

    const meaningfulEventsAll: Array<{
      ts: string | null;
      eventType: string | null;
      oldValue: unknown;
      newValue: unknown;
    }> = [];

    for (const ev of rawEvents) {
      const eventType = String(ev.eventType || "");
      if (!meaningfulEventTypes.has(eventType)) continue;

      if (eventType === "epic_updated" && isEquivalentInstant(extractUpdatedValue(ev.oldValue), extractUpdatedValue(ev.newValue))) {
        continue;
      }

      if (stableStringify(ev.oldValue) === stableStringify(ev.newValue)) {
        continue;
      }

      meaningfulEventsAll.push(ev);
    }

    const eventsV2 = {
      meaningful: meaningfulEventsAll.slice(0, 20),
      technicalFilteredCount: Math.max(0, rawEvents.length - meaningfulEventsAll.length),
      lastMeaningfulUpdateAt: meaningfulEventsAll.length > 0 ? meaningfulEventsAll[0].ts : null,
    };

    let competitorsV2: any = null;

    if (latestReport?.id) {
      const { data: primaryReportRow } = await service
        .from("discover_report_islands")
        .select("island_code,category,tags,title,creator_code")
        .eq("report_id", latestReport.id)
        .eq("status", "reported")
        .eq("island_code", code)
        .maybeSingle();

      const cohortCategory = String(primaryReportRow?.category || category || "").trim() || null;
      const primaryTagSet = tagsToSet(primaryReportRow?.tags ?? metadata?.tags ?? reportRows[0]?.tags ?? []);

      let cohortQuery = service
        .from("discover_report_islands")
        .select(
          "island_code,title,creator_code,category,tags,week_unique,week_plays,week_peak_ccu_max,week_minutes,week_minutes_per_player_avg,week_d1_avg,week_d7_avg,week_favorites,week_recommends",
        )
        .eq("report_id", latestReport.id)
        .eq("status", "reported");

      if (cohortCategory) cohortQuery = cohortQuery.eq("category", cohortCategory);

      const cohortRes = await cohortQuery;
      const cohortRowsAll = ((cohortRes?.data ?? []) as any[])
        .filter((r) => !isEpicCreator(r.creator_code));

      let cohortRows = cohortRowsAll;
      let fallbackApplied = false;
      let ruleApplied = "category_only";

      if (primaryTagSet.size > 0) {
        const overlapped = cohortRowsAll.filter((r) => overlapCount(primaryTagSet, tagsToSet(r.tags)) >= 1);
        if (overlapped.length >= 20) {
          cohortRows = overlapped;
          ruleApplied = "category_plus_tag_overlap";
        } else {
          fallbackApplied = true;
          ruleApplied = "category_only_fallback";
        }
      }

      const scoredRows = cohortRows.map((r) => {
        const weekUnique = asNum(r.week_unique);
        const weekPlays = asNum(r.week_plays);
        const weekPeakCcuMax = asNum(r.week_peak_ccu_max);
        const weekMinutes = asNum(r.week_minutes);
        const weekMinutesPerPlayerAvg = asNum(r.week_minutes_per_player_avg) > 0
          ? asNum(r.week_minutes_per_player_avg)
          : (weekUnique > 0 ? weekMinutes / weekUnique : 0);
        const weekD1Avg = asNum(r.week_d1_avg);
        const weekD7Avg = asNum(r.week_d7_avg);
        const retentionComposite = (weekD1Avg + weekD7Avg) / 2;
        const weekFavorites = asNum(r.week_favorites);
        const weekRecommends = asNum(r.week_recommends);
        const advocacyRate = weekUnique > 0 ? ((weekFavorites + weekRecommends) / weekUnique) * 100 : 0;

        return {
          islandCode: String(r.island_code),
          title: String(r.title || r.island_code),
          creatorCode: r.creator_code ?? null,
          tags: Array.from(tagsToSet(r.tags)),
          metrics: {
            weekUnique,
            weekPlays,
            weekPeakCcuMax,
            weekMinutes,
            weekMinutesPerPlayerAvg,
            weekD1Avg,
            weekD7Avg,
            weekFavorites,
            weekRecommends,
            retentionComposite,
            advocacyRate,
          },
        };
      });

      const pUnique = percentileArray(scoredRows.map((r) => r.metrics.weekUnique));
      const pPlays = percentileArray(scoredRows.map((r) => r.metrics.weekPlays));
      const pPeak = percentileArray(scoredRows.map((r) => r.metrics.weekPeakCcuMax));
      const pMpp = percentileArray(scoredRows.map((r) => r.metrics.weekMinutesPerPlayerAvg));
      const pRetention = percentileArray(scoredRows.map((r) => r.metrics.retentionComposite));
      const pAdvocacy = percentileArray(scoredRows.map((r) => r.metrics.advocacyRate));

      const rankedRows = scoredRows
        .map((row, i) => {
          const breakdown = {
            unique: {
              percentile: pUnique[i],
              contribution: Number((pUnique[i] * COMPETITOR_WEIGHTS.unique).toFixed(2)),
            },
            plays: {
              percentile: pPlays[i],
              contribution: Number((pPlays[i] * COMPETITOR_WEIGHTS.plays).toFixed(2)),
            },
            peakCCU: {
              percentile: pPeak[i],
              contribution: Number((pPeak[i] * COMPETITOR_WEIGHTS.peakCCU).toFixed(2)),
            },
            minutesPerPlayer: {
              percentile: pMpp[i],
              contribution: Number((pMpp[i] * COMPETITOR_WEIGHTS.minutesPerPlayer).toFixed(2)),
            },
            retentionComposite: {
              percentile: pRetention[i],
              contribution: Number((pRetention[i] * COMPETITOR_WEIGHTS.retentionComposite).toFixed(2)),
            },
            advocacy: {
              percentile: pAdvocacy[i],
              contribution: Number((pAdvocacy[i] * COMPETITOR_WEIGHTS.advocacy).toFixed(2)),
            },
          };

          const scoreTotal = Number((
            breakdown.unique.contribution +
            breakdown.plays.contribution +
            breakdown.peakCCU.contribution +
            breakdown.minutesPerPlayer.contribution +
            breakdown.retentionComposite.contribution +
            breakdown.advocacy.contribution
          ).toFixed(2));

          return {
            ...row,
            score_total: scoreTotal,
            score_breakdown: breakdown,
          };
        })
        .sort((a, b) => {
          if (b.score_total !== a.score_total) return b.score_total - a.score_total;
          if (b.metrics.weekUnique !== a.metrics.weekUnique) return b.metrics.weekUnique - a.metrics.weekUnique;
          return b.metrics.weekPlays - a.metrics.weekPlays;
        })
        .map((r, idx) => ({ ...r, rank_position: idx + 1 }));

      const primaryIslandRank = rankedRows.find((r) => r.islandCode === code)?.rank_position ?? null;
      const compareIslandRank = compareIslandCode
        ? (rankedRows.find((r) => r.islandCode === compareIslandCode)?.rank_position ?? null)
        : null;

      competitorsV2 = {
        cohortMeta: {
          ruleApplied,
          fallbackApplied,
          reportBase: {
            id: latestReport.id,
            year: latestReport.year,
            weekNumber: latestReport.week_number,
            weekStart: latestReport.week_start,
            weekEnd: latestReport.week_end,
          },
          category: cohortCategory,
          primaryTags: Array.from(primaryTagSet),
          cohortSize: rankedRows.length,
          excludedCreators: ["epic", "epic games"],
        },
        weights: COMPETITOR_WEIGHTS,
        rows: rankedRows.slice(0, 100),
        primaryIslandRank,
        compareIslandRank,
      };
    }

    const responsePayload = {
      metadata: {
        code: metadata.code,
        title: metadata.title,
        creatorCode: metadata.creatorCode,
        category: metadata.category,
        tags: metadata.tags,
        createdIn: metadata.createdIn,
        imageUrl: metadataImageUrl,
      },
      dailyMetrics: metrics,
      hourlyMetrics,
      internalCard,

      // Legacy payload (backward compatibility)
      discoverySignals: {
        panelsTop: exposurePanelsTopLegacy,
        dailyMinutes: exposureDailyMinutesLegacy,
      },
      metadataEvents,
      categoryLeaders,

      // V2 payload
      discoverySignalsV2: {
        surface: DISCOVERY_SURFACE,
        panelsTop: exposurePanelsTopV2,
        dailyMinutes: exposureDailyMinutesV2,
        summary: discoverySummaryV2,
      },
      competitorsV2,
      eventsV2,

      weeklyPerformance,
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
    };

    const nowIso = new Date().toISOString();
    writeMemory(LOOKUP_RESPONSE_MEM, fastLookupKey, responsePayload as Record<string, unknown>, lookupMemTtlMs(), 1024);
    if (!canWriteCache) {
      await safeLogRun(service, {
        user_id: userId,
        island_code: code,
        status: "ok",
        duration_ms: Date.now() - startedAt,
        has_internal_card: Boolean(internalCard),
        has_discovery_signals: exposurePanelsTopLegacy.length > 0 || exposureDailyMinutesLegacy.length > 0,
        has_weekly_performance: weeklyPerformance.length > 0,
        category_leaders_count: categoryLeaders.length,
        cache_hit: false,
      });

      return new Response(
        JSON.stringify({
          ...responsePayload,
          cacheHit: false,
          recentLookups: [],
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    await service
      .from("discover_lookup_recent")
      .upsert(
        {
          user_id: cacheUserId,
          primary_code: code,
          compare_code: compareKey,
          primary_title: metadata?.title || code,
          compare_title: compareIslandCode || null,
          payload_json: responsePayload,
          created_at: nowIso,
          last_accessed_at: nowIso,
          hit_count: 0,
        },
        { onConflict: "user_id,primary_code,compare_code" },
      );

    const recentLookupsDb = userCacheEnabled ? await getRecentLookupsCached(service, cacheUserId) : [];
    const recentLookups = userCacheEnabled
      ? prependRecentLookup(recentLookupsDb, responsePayload as Record<string, unknown>, code, compareKey)
      : [];
    if (userCacheEnabled) {
      writeMemory(RECENT_LOOKUPS_MEM, cacheUserId, recentLookups, recentMemTtlMs(), 2048);
    }

    runInBackground((async () => {
      if (cacheKeepLimit > 0) {
        const { data: keepRows } = await service
          .from("discover_lookup_recent")
          .select("id")
          .eq("user_id", cacheUserId)
          .order("last_accessed_at", { ascending: false })
          .limit(cacheKeepLimit);
        const keepIds = (keepRows || []).map((r: any) => asNum(r.id)).filter((v) => v > 0);
        if (keepIds.length > 0) {
          await service
            .from("discover_lookup_recent")
            .delete()
            .eq("user_id", cacheUserId)
            .not("id", "in", `(${keepIds.join(",")})`);
        }
      }

      await safeLogRun(service, {
        user_id: userId,
        island_code: code,
        status: "ok",
        duration_ms: Date.now() - startedAt,
        has_internal_card: Boolean(internalCard),
        has_discovery_signals: exposurePanelsTopLegacy.length > 0 || exposureDailyMinutesLegacy.length > 0,
        has_weekly_performance: weeklyPerformance.length > 0,
        category_leaders_count: categoryLeaders.length,
        cache_hit: false,
      });
    })());

    return new Response(
      JSON.stringify({
        ...responsePayload,
        cacheHit: false,
        recentLookups,
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
