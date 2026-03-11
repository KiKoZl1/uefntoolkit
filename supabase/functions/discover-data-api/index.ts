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

type AccessLevel = "public" | "authenticated" | "admin";
type Action = "read" | "write";

type RequestContext = {
  isServiceRole: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;
  userId: string | null;
};

const PUBLIC_READ_TABLES = new Set<string>([
  "weekly_reports",
  "discovery_public_premium_now",
  "discovery_public_emerging_now",
  "discovery_public_pollution_creators_now",
]);

const AUTH_READ_TABLES = new Set<string>([
  "discover_reports",
]);

const ADMIN_READ_TABLES = new Set<string>([
  "discovery_exposure_targets",
  "discovery_exposure_ticks",
  "discover_link_metadata_events",
  "discovery_panel_tiers",
  "discovery_exposure_rollup_daily",
  "system_alerts_current",
  "dppi_calibration_metrics",
  "dppi_drift_metrics",
  "dppi_feedback_events",
  "dppi_inference_log",
  "dppi_opportunities",
  "dppi_model_registry",
  "dppi_release_channels",
  "dppi_training_log",
]);

const ADMIN_WRITE_TABLES = new Set<string>([
  "discover_reports",
  "weekly_reports",
  "discovery_panel_tiers",
]);

const ALLOWED_RPC_ACCESS: Record<string, AccessLevel> = {
  get_census_stats: "admin",
  admin_list_pipeline_crons: "admin",
  admin_set_pipeline_cron_domain_active: "admin",
  admin_set_pipeline_cron_job_active: "admin",
};

function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, ...extraHeaders, "Content-Type": "application/json" },
  });
}

type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

const TOKEN_CTX_CACHE = new Map<string, CacheEntry<RequestContext>>();
const ROLE_DECISION_CACHE = new Map<string, CacheEntry<boolean>>();
const DEFAULT_TOKEN_CTX_TTL_MS = 60_000;
const DEFAULT_ROLE_CACHE_TTL_MS = 120_000;
let adminOverviewMemCache: CacheEntry<{
  data: any;
  asOf: string | null;
  cache: { hit: boolean; source: string };
}> | null = null;
const PUBLIC_REPORT_BUNDLE_MEM = new Map<string, CacheEntry<Record<string, unknown>>>();
const PUBLIC_REPORT_BUNDLE_INFLIGHT = new Map<string, Promise<{ data: Record<string, unknown> }>>();

function readCache<T>(store: Map<string, CacheEntry<T>>, key: string): T | null {
  const row = store.get(key);
  if (!row) return null;
  if (row.expiresAt <= Date.now()) {
    store.delete(key);
    return null;
  }
  return row.value;
}

function writeCache<T>(store: Map<string, CacheEntry<T>>, key: string, value: T, ttlMs: number) {
  store.set(key, { value, expiresAt: Date.now() + Math.max(1, ttlMs) });
  if (store.size > 512) {
    const now = Date.now();
    for (const [k, v] of store.entries()) {
      if (v.expiresAt <= now) store.delete(k);
      if (store.size <= 384) break;
    }
  }
}

function mustEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

function extractBearer(req: Request): string {
  const authHeader = (req.headers.get("Authorization") || req.headers.get("authorization") || "").trim();
  return authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
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

async function isServiceRoleRequest(req: Request, serviceKey: string, supabaseUrl: string): Promise<boolean> {
  const bearer = extractBearer(req);
  const apiKey = (req.headers.get("apikey") || "").trim();
  const token = bearer || apiKey;
  if (!token) return false;
  if (bearer && bearer === serviceKey) return true;
  if (apiKey && apiKey === serviceKey) return true;

  // Fast negative path for regular user JWTs to avoid an extra network hop.
  const bearerRole = bearer ? String(decodeJwtPayload(bearer)?.role || "").trim() : "";
  if (bearerRole && bearerRole !== "service_role") return false;
  if (!bearer) {
    const apiRole = apiKey ? String(decodeJwtPayload(apiKey)?.role || "").trim() : "";
    if (apiRole && apiRole !== "service_role") return false;
  }

  // Supports rotated service keys: validate token against Auth Admin endpoint.
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

async function buildRequestContext(
  req: Request,
  service: ReturnType<typeof createClient>,
): Promise<RequestContext> {
  const serviceKey = mustEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (await isServiceRoleRequest(req, serviceKey, mustEnv("SUPABASE_URL"))) {
    return { isServiceRole: true, isAuthenticated: true, isAdmin: true, userId: null };
  }

  const bearer = extractBearer(req);
  if (!bearer) return { isServiceRole: false, isAuthenticated: false, isAdmin: false, userId: null };

  const cachedCtx = readCache(TOKEN_CTX_CACHE, bearer);
  if (cachedCtx) return cachedCtx;

  const decoded = decodeJwtPayload(bearer);
  const sub = typeof decoded?.sub === "string" ? decoded.sub : null;
  const tokenExpMs = typeof decoded?.exp === "number" ? decoded.exp * 1000 : null;

  const authClient = createClient(mustEnv("SUPABASE_URL"), mustEnv("SUPABASE_ANON_KEY"), {
    global: {
      headers: {
        Authorization: `Bearer ${bearer}`,
      },
    },
  });

  const { data: userRes, error: userErr } = await authClient.auth.getUser();
  if (userErr || !userRes.user?.id) {
    const denied = { isServiceRole: false, isAuthenticated: false, isAdmin: false, userId: null } as RequestContext;
    writeCache(TOKEN_CTX_CACHE, bearer, denied, Math.min(DEFAULT_TOKEN_CTX_TTL_MS, 20_000));
    return denied;
  }

  const userId = userRes.user.id || sub;
  const roleCached = userId ? readCache(ROLE_DECISION_CACHE, userId) : null;
  let isAdmin = false;

  if (roleCached != null) {
    isAdmin = roleCached;
  } else {
    const { data: roleRows, error: roleErr } = await service
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .in("role", ["admin", "editor"])
      .limit(1);
    isAdmin = !roleErr && Array.isArray(roleRows) && roleRows.length > 0;
    if (userId) writeCache(ROLE_DECISION_CACHE, userId, isAdmin, DEFAULT_ROLE_CACHE_TTL_MS);
  }

  const ctx = { isServiceRole: false, isAuthenticated: true, isAdmin, userId } as RequestContext;
  const tokenTtl = tokenExpMs ? Math.max(5_000, Math.min(DEFAULT_TOKEN_CTX_TTL_MS, tokenExpMs - Date.now())) : DEFAULT_TOKEN_CTX_TTL_MS;
  writeCache(TOKEN_CTX_CACHE, bearer, ctx, tokenTtl);
  return ctx;
}

function requireAccess(ctx: RequestContext, level: AccessLevel): void {
  if (level === "public") return;
  if (level === "authenticated" && (ctx.isAuthenticated || ctx.isServiceRole)) return;
  if (level === "admin" && (ctx.isAdmin || ctx.isServiceRole)) return;
  throw new Error("forbidden");
}

function getTableAccessLevel(table: string, action: Action): AccessLevel | null {
  if (action === "write") {
    if (ADMIN_WRITE_TABLES.has(table)) return "admin";
    return null;
  }
  if (PUBLIC_READ_TABLES.has(table)) return "public";
  if (AUTH_READ_TABLES.has(table)) return "authenticated";
  if (ADMIN_READ_TABLES.has(table)) return "admin";
  return null;
}

function normalizeTable(input: unknown): string {
  const table = String(input || "").trim();
  if (!/^[a-z0-9_]+$/i.test(table)) throw new Error("invalid table");
  return table;
}

function normalizeColumn(input: unknown): string {
  const col = String(input || "").trim();
  if (!/^[a-z0-9_]+$/i.test(col)) throw new Error("invalid column");
  return col;
}

function hasPublishedStatusFilter(filters: any[]): boolean {
  return filters.some((f) =>
    String(f?.op || "") === "eq" &&
    String(f?.column || "") === "status" &&
    String(f?.value || "") === "published"
  );
}

function requiresPublishedWeeklyReportsFilter(
  ctx: RequestContext,
  access: AccessLevel,
  table: string,
  filters: any[],
): boolean {
  return access === "public" &&
    table === "weekly_reports" &&
    !ctx.isAdmin &&
    !ctx.isServiceRole &&
    !hasPublishedStatusFilter(filters);
}

function applyFilters(query: any, filters: any[]): any {
  for (const raw of filters) {
    const op = String(raw?.op || "").trim();
    const column = normalizeColumn(raw?.column);
    const value = raw?.value;
    switch (op) {
      case "eq":
        query = query.eq(column, value);
        break;
      case "neq":
        query = query.neq(column, value);
        break;
      case "gt":
        query = query.gt(column, value);
        break;
      case "gte":
        query = query.gte(column, value);
        break;
      case "lt":
        query = query.lt(column, value);
        break;
      case "lte":
        query = query.lte(column, value);
        break;
      case "in":
        if (!Array.isArray(value)) throw new Error("in filter requires array");
        query = query.in(column, value);
        break;
      case "is":
        query = query.is(column, value);
        break;
      case "not":
        query = query.not(column, String(raw?.operator || "eq"), value);
        break;
      case "ilike":
        query = query.ilike(column, value);
        break;
      case "contains":
        query = query.contains(column, value);
        break;
      default:
        throw new Error(`unsupported filter op: ${op}`);
    }
  }
  return query;
}

async function runAdminOverviewBundle(service: ReturnType<typeof createClient>, ctx: RequestContext, payload: any) {
  requireAccess(ctx, "admin");

  const memTtlMs = getEnvNumber("ADMIN_OVERVIEW_BUNDLE_MEM_TTL_MS", 20_000);
  const forceRefresh = Boolean(payload?.forceRefresh);
  if (!forceRefresh && adminOverviewMemCache && adminOverviewMemCache.expiresAt > Date.now()) {
    return {
      ...adminOverviewMemCache.value,
      cache: { ...(adminOverviewMemCache.value.cache || {}), hit: true, source: "memory" },
    };
  }

  if (forceRefresh) {
    const refreshRes = await (service as any).rpc("refresh_discover_admin_overview_snapshot");
    if (refreshRes.error) throw new Error(refreshRes.error.message);
  }

  let { data: snapshot, error: snapErr } = await service
    .from("discover_admin_overview_snapshot")
    .select("as_of,payload_json")
    .eq("id", 1)
    .maybeSingle();

  if (snapErr) throw new Error(snapErr.message);

  if (!snapshot?.payload_json) {
    const refreshRes = await (service as any).rpc("refresh_discover_admin_overview_snapshot");
    if (refreshRes.error) throw new Error(refreshRes.error.message);
    const fallbackPayload = refreshRes.data || {};
    const result = {
      data: fallbackPayload,
      asOf: (fallbackPayload as any)?.as_of || new Date().toISOString(),
      cache: { hit: false, source: "rpc" },
    };
    adminOverviewMemCache = { value: result, expiresAt: Date.now() + memTtlMs };
    return result;
  }

  const result = {
    data: snapshot.payload_json,
    asOf: snapshot.as_of,
    cache: { hit: true, source: "snapshot" },
  };
  adminOverviewMemCache = { value: result, expiresAt: Date.now() + memTtlMs };
  return result;
}

async function runSelect(service: ReturnType<typeof createClient>, ctx: RequestContext, payload: any) {
  const table = normalizeTable(payload?.table);
  const access = getTableAccessLevel(table, "read");
  if (!access) throw new Error("table read not allowed");
  requireAccess(ctx, access);

  const filters = Array.isArray(payload?.filters) ? payload.filters : [];
  if (requiresPublishedWeeklyReportsFilter(ctx, access, table, filters)) {
    throw new Error("public weekly_reports access requires status=published");
  }

  const columns = String(payload?.columns || "*");
  const count = payload?.count ? String(payload.count) : undefined;
  const head = Boolean(payload?.head);
  const selectOpts = count || head ? { count: (count || "exact") as "exact", head } : undefined;

  let query = service.from(table).select(columns, selectOpts as any);
  query = applyFilters(query, filters);

  if (Array.isArray(payload?.order)) {
    for (const raw of payload.order) {
      const col = normalizeColumn(raw?.column);
      query = query.order(col, { ascending: raw?.ascending !== false, nullsFirst: Boolean(raw?.nullsFirst) });
    }
  }

  if (payload?.limit != null) {
    const limit = Number(payload.limit);
    if (Number.isFinite(limit) && limit > 0) query = query.limit(Math.min(Math.floor(limit), 10000));
  }

  const singleMode = String(payload?.single || "").trim();
  if (singleMode === "single") {
    query = query.single();
  } else if (singleMode === "maybeSingle") {
    query = query.maybeSingle();
  }

  const { data, error, count: rowCount } = await query;
  if (error) throw new Error(error.message);
  return { data, count: rowCount ?? null };
}

async function runUpdate(service: ReturnType<typeof createClient>, ctx: RequestContext, payload: any) {
  const table = normalizeTable(payload?.table);
  const access = getTableAccessLevel(table, "write");
  if (!access) throw new Error("table write not allowed");
  requireAccess(ctx, access);

  const values = payload?.values;
  if (!values || typeof values !== "object" || Array.isArray(values)) throw new Error("invalid update values");

  let query = service.from(table).update(values as Record<string, unknown>);
  query = applyFilters(query, Array.isArray(payload?.filters) ? payload.filters : []);

  const returning = String(payload?.returning || "").trim();
  if (returning) query = query.select(returning);
  const singleMode = String(payload?.single || "").trim();
  if (singleMode === "single") query = query.single();
  if (singleMode === "maybeSingle") query = query.maybeSingle();

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return { data: data ?? null };
}

async function runDelete(service: ReturnType<typeof createClient>, ctx: RequestContext, payload: any) {
  const table = normalizeTable(payload?.table);
  const access = getTableAccessLevel(table, "write");
  if (!access) throw new Error("table write not allowed");
  requireAccess(ctx, access);

  let query = service.from(table).delete();
  query = applyFilters(query, Array.isArray(payload?.filters) ? payload.filters : []);

  const returning = String(payload?.returning || "").trim();
  if (returning) query = query.select(returning);
  const singleMode = String(payload?.single || "").trim();
  if (singleMode === "single") query = query.single();
  if (singleMode === "maybeSingle") query = query.maybeSingle();

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return { data: data ?? null };
}

async function runUpsert(service: ReturnType<typeof createClient>, ctx: RequestContext, payload: any) {
  const table = normalizeTable(payload?.table);
  const access = getTableAccessLevel(table, "write");
  if (!access) throw new Error("table write not allowed");
  requireAccess(ctx, access);

  const values = payload?.values;
  if (!values || typeof values !== "object") throw new Error("invalid upsert values");

  let query = service.from(table).upsert(values, {
    onConflict: payload?.onConflict ? String(payload.onConflict) : undefined,
    ignoreDuplicates: Boolean(payload?.ignoreDuplicates),
    defaultToNull: payload?.defaultToNull !== false,
  });

  const returning = String(payload?.returning || "").trim();
  if (returning) query = query.select(returning);
  const singleMode = String(payload?.single || "").trim();
  if (singleMode === "single") query = query.single();
  if (singleMode === "maybeSingle") query = query.maybeSingle();

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return { data: data ?? null };
}

async function runRpc(service: ReturnType<typeof createClient>, ctx: RequestContext, payload: any) {
  const fn = String(payload?.fn || "").trim();
  if (!fn || !/^[a-z0-9_]+$/i.test(fn)) throw new Error("invalid rpc function");
  const required = ALLOWED_RPC_ACCESS[fn];
  if (!required) throw new Error("rpc not allowed");
  requireAccess(ctx, required);

  const args = payload?.args && typeof payload.args === "object" ? payload.args : {};
  const { data, error } = await (service as any).rpc(fn, args);
  if (error) throw new Error(error.message);
  return { data: data ?? null };
}

async function runPublicReportBundle(service: ReturnType<typeof createClient>, payload: any) {
  const slug = String(payload?.slug || "").trim();
  if (!slug) throw new Error("missing slug");

  const memKey = `public_report_bundle:${slug.toLowerCase()}`;
  const memCached = readCache(PUBLIC_REPORT_BUNDLE_MEM, memKey);
  if (memCached) return { data: memCached };

  const inflight = PUBLIC_REPORT_BUNDLE_INFLIGHT.get(memKey);
  if (inflight) return await inflight;

  const queryPromise = (async (): Promise<{ data: Record<string, unknown> }> => {
    const { data: weekly, error: weeklyErr } = await service
      .from("weekly_reports")
      .select("id,discover_report_id,week_key,public_slug,title_public,subtitle_public,editor_note,date_from,date_to,kpis_json,rankings_json,ai_sections_json,editor_sections_json,cover_image_url,status")
      .eq("public_slug", slug)
      .eq("status", "published")
      .single();
    if (weeklyErr || !weekly) throw new Error(weeklyErr?.message || "report_not_found");

    let merged = weekly as Record<string, unknown>;
    const discoverReportId = String((weekly as any)?.discover_report_id || "");
    const needsFallback = !merged?.kpis_json || !merged?.rankings_json;
    if (discoverReportId && needsFallback) {
      const { data: base, error: baseErr } = await service
        .from("discover_reports")
        .select("platform_kpis,computed_rankings")
        .eq("id", discoverReportId)
        .single();
      if (!baseErr && base) {
        merged = {
          ...merged,
          kpis_json: {
            ...(base as any).platform_kpis,
            ...((weekly as any).kpis_json || {}),
          },
          rankings_json: {
            ...(base as any).computed_rankings,
            ...((weekly as any).rankings_json || {}),
          },
        };
      }
    }

    const ttlMs = Math.max(5_000, getEnvNumber("PUBLIC_REPORT_BUNDLE_MEM_TTL_MS", 90_000));
    writeCache(PUBLIC_REPORT_BUNDLE_MEM, memKey, merged, ttlMs);
    return { data: merged };
  })();

  PUBLIC_REPORT_BUNDLE_INFLIGHT.set(memKey, queryPromise);
  try {
    return await queryPromise;
  } finally {
    PUBLIC_REPORT_BUNDLE_INFLIGHT.delete(memKey);
  }
}

function authorizeOperation(ctx: RequestContext, op: string, payload: any): void {
  switch (op) {
    case "admin_overview_bundle":
      requireAccess(ctx, "admin");
      return;
    case "select": {
      const table = normalizeTable(payload?.table);
      const access = getTableAccessLevel(table, "read");
      if (!access) throw new Error("table read not allowed");
      requireAccess(ctx, access);
      const filters = Array.isArray(payload?.filters) ? payload.filters : [];
      if (requiresPublishedWeeklyReportsFilter(ctx, access, table, filters)) {
        throw new Error("public weekly_reports access requires status=published");
      }
      return;
    }
    case "update":
    case "delete":
    case "upsert": {
      const table = normalizeTable(payload?.table);
      const access = getTableAccessLevel(table, "write");
      if (!access) throw new Error("table write not allowed");
      requireAccess(ctx, access);
      return;
    }
    case "rpc": {
      const fn = String(payload?.fn || "").trim();
      if (!fn || !/^[a-z0-9_]+$/i.test(fn)) throw new Error("invalid rpc function");
      const required = ALLOWED_RPC_ACCESS[fn];
      if (!required) throw new Error("rpc not allowed");
      requireAccess(ctx, required);
      return;
    }
    case "public_report_bundle":
      return;
    default:
      throw new Error("unsupported operation");
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startedAt = Date.now();
  let authMs = 0;
  let handlerMs = 0;

  const timingHeader = (extra: string[] = []) => {
    const base = [
      `total;dur=${(Date.now() - startedAt).toFixed(1)}`,
      `auth;dur=${authMs.toFixed(1)}`,
      `handler;dur=${handlerMs.toFixed(1)}`,
      ...extra.filter(Boolean),
    ];
    return base.join(", ");
  };

  try {
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const service = createClient(mustEnv("SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const authStartedAt = Date.now();
    const ctx = await buildRequestContext(req, service);
    authMs = Date.now() - authStartedAt;

    const op = String(body?.op || "").trim();
    const payload = body?.payload && typeof body.payload === "object" ? body.payload : {};
    authorizeOperation(ctx, op, payload);

    if (shouldProxyToData(req)) {
      const bridgeStartedAt = Date.now();
      const proxied = await invokeDataFunction({
        req,
        functionName: "discover-data-api",
        body,
        timeoutMs: getEnvNumber("LOOKUP_DATA_TIMEOUT_MS", 7000),
      });
      handlerMs = Date.now() - bridgeStartedAt;
      const proxyTiming = timingHeader([
        `bridge;dur=${Number(proxied.bridgeMs || 0).toFixed(1)}`,
        String(proxied.upstreamServerTiming || "").trim(),
      ]);
      if (proxied.ok) {
        return dataProxyResponse(proxied.data, proxied.status, { ...corsHeaders, "Server-Timing": proxyTiming });
      }
      if (proxied.status >= 400 && proxied.status < 500 && proxied.data) {
        return dataProxyResponse(proxied.data, proxied.status, { ...corsHeaders, "Server-Timing": proxyTiming });
      }
      return dataBridgeUnavailableResponse({ ...corsHeaders, "Server-Timing": proxyTiming }, proxied.error);
    }

    if (shouldBlockLocalExecution(req)) {
      handlerMs = 0;
      return dataBridgeUnavailableResponse({ ...corsHeaders, "Server-Timing": timingHeader() }, "strict proxy mode");
    }

    let result: { data: unknown; count?: number | null };
    const opStartedAt = Date.now();

    switch (op) {
      case "select":
        result = await runSelect(service, ctx, payload);
        break;
      case "update":
        result = await runUpdate(service, ctx, payload);
        break;
      case "delete":
        result = await runDelete(service, ctx, payload);
        break;
      case "upsert":
        result = await runUpsert(service, ctx, payload);
        break;
      case "rpc":
        result = await runRpc(service, ctx, payload);
        break;
      case "public_report_bundle":
        result = await runPublicReportBundle(service, payload);
        break;
      case "admin_overview_bundle":
        result = await runAdminOverviewBundle(service, ctx, payload);
        break;
      default:
        throw new Error("unsupported operation");
    }
    handlerMs = Date.now() - opStartedAt;

    return json({ success: true, ...result }, 200, { "Server-Timing": timingHeader() });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message === "forbidden" ? 403 : 400;
    return json({ success: false, error: message }, status, { "Server-Timing": timingHeader() });
  }
});
