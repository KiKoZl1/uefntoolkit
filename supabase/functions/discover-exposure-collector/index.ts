import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const EPIC_ACCOUNT_OAUTH_TOKEN = "https://account-public-service-prod.ol.epicgames.com/account/api/oauth/token";
const EPIC_FORTNITE_VERSION = "https://fngw-mcp-gc-livefn.ol.epicgames.com/fortnite/api/version";
const EPIC_DISCOVERY_ACCESS_TOKEN_BASE =
  "https://fngw-mcp-gc-livefn.ol.epicgames.com/fortnite/api/discovery/accessToken";
const FN_DISCOVERY_V2_SURFACE_BASE =
  "https://fn-service-discovery-live-public.ogs.live.on.epicgames.com/api/v2/discovery/surface";

const ISLAND_CODE_RE = /^\d{4}-\d{4}-\d{4}$/;

type Mode =
  | "orchestrate"
  | "tick"
  | "maintenance"
  | "intel_refresh"
  | "diagnose_rating"
  | "config_status"
  | "set_paused"
  | "bootstrap_device_auth";

type TargetClaim = {
  id: string;
  region: string;
  surface_name: string;
  platform: string;
  locale: string;
  interval_minutes: number;
  lock_id: string;
};

type GuardRails = {
  maxPagesPerPanel: number;
  maxTotalEntries: number;
  budgetMs: number;
};

const DEFAULT_GUARD_RAILS: GuardRails = {
  maxPagesPerPanel: 50,
  maxTotalEntries: 20000,
  budgetMs: 45000,
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

function hasEnv(key: string): boolean {
  const v = Deno.env.get(key);
  return Boolean(v && String(v).trim().length > 0);
}

async function requireAdminOrEditor(req: Request, supabase: any) {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  if (!token) throw new Error("forbidden: missing Authorization");

  const { data: u, error: uErr } = await supabase.auth.getUser(token);
  if (uErr || !u?.user?.id) throw new Error("forbidden: invalid user");
  const userId = u.user.id;

  const { data: roles, error: rErr } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .in("role", ["admin", "editor"])
    .limit(1);
  if (rErr) throw new Error("forbidden: role check failed");
  if (!roles || roles.length === 0) throw new Error("forbidden: not admin/editor");
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<{ ok: boolean; status: number; json: any; headers: Headers }> {
  const timeoutMs = init.timeoutMs ?? 20000;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    let body: any = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { ok: res.ok, status: res.status, json: body, headers: res.headers };
  } finally {
    clearTimeout(t);
  }
}

class EpicHttpError extends Error {
  status: number;
  errorCode?: string;
  correlationId?: string;
  constructor(message: string, args: { status: number; errorCode?: string; correlationId?: string }) {
    super(message);
    this.name = "EpicHttpError";
    this.status = args.status;
    this.errorCode = args.errorCode;
    this.correlationId = args.correlationId;
  }
}

function epicCorrelationIdFromHeaders(h: Headers): string | null {
  return h.get("x-epic-correlation-id") || h.get("X-Epic-Correlation-Id");
}

async function getEg1Token(): Promise<{ accountId: string; accessToken: string }> {
  const clientId = mustEnv("EPIC_OAUTH_CLIENT_ID");
  const clientSecret = mustEnv("EPIC_OAUTH_CLIENT_SECRET");
  const deviceAccountId = mustEnv("EPIC_DEVICE_AUTH_ACCOUNT_ID");
  const deviceId = mustEnv("EPIC_DEVICE_AUTH_DEVICE_ID");
  const deviceSecret = mustEnv("EPIC_DEVICE_AUTH_SECRET");

  const basic = btoa(`${clientId}:${clientSecret}`);
  const form = new URLSearchParams();
  form.set("grant_type", "device_auth");
  form.set("account_id", deviceAccountId);
  form.set("device_id", deviceId);
  form.set("secret", deviceSecret);
  form.set("token_type", "eg1");

  const res = await fetchJson(EPIC_ACCOUNT_OAUTH_TOKEN, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
    timeoutMs: 20000,
  });
  if (!res.ok) {
    const msg = res.json?.errorMessage || res.json?.error || `HTTP ${res.status}`;
    throw new Error(`Epic OAuth device_auth failed: ${msg}`);
  }
  const accessToken = String(res.json?.access_token || "");
  const accountId = String(res.json?.account_id || deviceAccountId);
  if (!accessToken) throw new Error("Epic OAuth returned empty access_token");
  return { accountId, accessToken };
}

async function bootstrapDeviceAuth(authorizationCode: string): Promise<{
  account_id: string;
  device_id: string;
  secret: string;
}> {
  const clientId = mustEnv("EPIC_OAUTH_CLIENT_ID");
  const clientSecret = mustEnv("EPIC_OAUTH_CLIENT_SECRET");
  const basic = btoa(`${clientId}:${clientSecret}`);

  const form = new URLSearchParams();
  form.set("grant_type", "authorization_code");
  form.set("code", authorizationCode);
  form.set("token_type", "eg1");

  const tokRes = await fetchJson(EPIC_ACCOUNT_OAUTH_TOKEN, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
    timeoutMs: 20000,
  });
  if (!tokRes.ok) {
    const msg = tokRes.json?.errorMessage || tokRes.json?.error || `HTTP ${tokRes.status}`;
    throw new Error(`Epic OAuth authorization_code failed: ${msg}`);
  }

  const accessToken = String(tokRes.json?.access_token || "");
  const accountId = String(tokRes.json?.account_id || "");
  if (!accessToken || !accountId) throw new Error("Epic OAuth returned empty access_token/account_id");

  const devRes = await fetchJson(
    `https://account-public-service-prod.ol.epicgames.com/account/api/public/account/${encodeURIComponent(accountId)}/deviceAuth`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: "{}",
      timeoutMs: 20000,
    },
  );
  if (!devRes.ok) {
    const msg = devRes.json?.errorMessage || devRes.json?.errorCode || `HTTP ${devRes.status}`;
    throw new Error(`deviceAuth create failed: ${msg}`);
  }

  const deviceId = String(devRes.json?.deviceId || "");
  const secret = String(devRes.json?.secret || "");
  if (!deviceId || !secret) throw new Error("deviceAuth returned empty deviceId/secret");

  return { account_id: accountId, device_id: deviceId, secret };
}

async function getLiveBranchStr(): Promise<string> {
  const res = await fetchJson(EPIC_FORTNITE_VERSION, { timeoutMs: 15000 });
  if (!res.ok) {
    const corr = epicCorrelationIdFromHeaders(res.headers) || undefined;
    const code = res.json?.errorCode || res.json?.error || undefined;
    throw new EpicHttpError(`fortnite/api/version failed (HTTP ${res.status})`, {
      status: res.status,
      errorCode: code ? String(code) : undefined,
      correlationId: corr ? String(corr) : undefined,
    });
  }
  const version = String(res.json?.version || "");
  if (!version) throw new Error("fortnite/api/version returned empty version");
  return `++Fortnite+Release-${version}`;
}

async function getDiscoveryAccessToken(branchStr: string, eg1AccessToken: string): Promise<string> {
  const branchEnc = encodeURIComponent(branchStr);
  const url = `${EPIC_DISCOVERY_ACCESS_TOKEN_BASE}/${branchEnc}`;
  const res = await fetchJson(url, {
    headers: {
      Authorization: `Bearer ${eg1AccessToken}`,
      Accept: "application/json",
      "User-Agent": `Fortnite/${branchStr} Windows/10`,
    },
    timeoutMs: 20000,
  });
  if (!res.ok) {
    const corr = epicCorrelationIdFromHeaders(res.headers) || undefined;
    const msg = res.json?.errorMessage || res.json?.errorCode || `HTTP ${res.status}`;
    const code = res.json?.errorCode || res.json?.numericErrorCode || undefined;
    throw new EpicHttpError(`discovery/accessToken failed: ${msg}`, {
      status: res.status,
      errorCode: code ? String(code) : undefined,
      correlationId: corr ? String(corr) : undefined,
    });
  }
  const tok = String(res.json?.token || "");
  if (!tok) throw new Error("discovery/accessToken returned empty token");
  return tok;
}

function buildProfileBody(accountId: string, region: string, platform: string, locale: string) {
  return {
    playerId: accountId,
    partyMemberIds: [accountId],
    locale,
    matchmakingRegion: region,
    platform,
    isCabined: false,
    ratingAuthority: "ESRB",
    rating: "TEEN",
    numLocalPlayers: 1,
  };
}

async function fetchSurface(
  surfaceName: string,
  branchStr: string,
  eg1AccessToken: string,
  discAccessToken: string,
  body: any,
): Promise<any> {
  const streamEnc = encodeURIComponent(branchStr);
  const url = `${FN_DISCOVERY_V2_SURFACE_BASE}/${encodeURIComponent(surfaceName)}?appId=Fortnite&stream=${streamEnc}`;
  const res = await fetchJson(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${eg1AccessToken}`,
      "X-Epic-Access-Token": discAccessToken,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
    timeoutMs: 25000,
  });
  if (!res.ok) {
    const corr = epicCorrelationIdFromHeaders(res.headers) || undefined;
    const msg = res.json?.errorMessage || res.json?.errorCode || `HTTP ${res.status}`;
    const code = res.json?.errorCode || res.json?.numericErrorCode || undefined;
    throw new EpicHttpError(`v2/surface failed: ${msg}`, {
      status: res.status,
      errorCode: code ? String(code) : undefined,
      correlationId: corr ? String(corr) : undefined,
    });
  }
  return { json: res.json, correlationId: epicCorrelationIdFromHeaders(res.headers) };
}

async function fetchPage(
  surfaceName: string,
  branchStr: string,
  eg1AccessToken: string,
  discAccessToken: string,
  body: any,
): Promise<any> {
  const streamEnc = encodeURIComponent(branchStr);
  const url =
    `${FN_DISCOVERY_V2_SURFACE_BASE}/${encodeURIComponent(surfaceName)}/page?appId=Fortnite&stream=${streamEnc}`;
  const res = await fetchJson(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${eg1AccessToken}`,
      "X-Epic-Access-Token": discAccessToken,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
    timeoutMs: 25000,
  });
  if (!res.ok) {
    const corr = epicCorrelationIdFromHeaders(res.headers) || undefined;
    const msg = res.json?.errorMessage || res.json?.errorCode || `HTTP ${res.status}`;
    const code = res.json?.errorCode || res.json?.numericErrorCode || undefined;
    throw new EpicHttpError(`v2/page failed: ${msg}`, {
      status: res.status,
      errorCode: code ? String(code) : undefined,
      correlationId: corr ? String(corr) : undefined,
    });
  }
  return { json: res.json, correlationId: epicCorrelationIdFromHeaders(res.headers) };
}

function classifyLinkCode(linkCode: string): "island" | "collection" {
  return ISLAND_CODE_RE.test(linkCode) ? "island" : "collection";
}

type AuthContext = {
  accountId: string;
  accessToken: string;
  branchStr: string;
  discAccessToken: string;
};

async function getAuthContext(): Promise<AuthContext> {
  const { accountId, accessToken } = await getEg1Token();
  const branchStr = await getLiveBranchStr();
  const discAccessToken = await getDiscoveryAccessToken(branchStr, accessToken);
  return { accountId, accessToken, branchStr, discAccessToken };
}

async function runTick(
  supabase: any,
  claim: TargetClaim,
  rails: GuardRails,
  auth?: AuthContext,
): Promise<{
  ok: boolean;
  tickId: string;
  panelsCount: number;
  entriesCount: number;
  durationMs: number;
  branch: string;
  error?: string;
  error_code?: string;
  correlation_id?: string;
}> {
  const startedAt = Date.now();
  const tickTs = new Date().toISOString();
  let lastCorrelationId: string | null = null;
  let lastErrorCode: string | null = null;

  const { data: tickRow, error: tickInsertErr } = await supabase
    .from("discovery_exposure_ticks")
    .insert({
      target_id: claim.id,
      ts_start: tickTs,
      status: "running",
    })
    .select("id")
    .single();

  if (tickInsertErr || !tickRow?.id) {
    throw new Error(`Failed to create tick row: ${tickInsertErr?.message || "unknown"}`);
  }
  const tickId = String(tickRow.id);

  try {
    const { accountId, accessToken, branchStr, discAccessToken: discTok } = auth || await getAuthContext();

    const profile = buildProfileBody(accountId, claim.region, claim.platform, claim.locale);
    const surfaceResp = await fetchSurface(claim.surface_name, branchStr, accessToken, discTok, profile);
    const surfaceJson = surfaceResp.json;
    lastCorrelationId = surfaceResp.correlationId || lastCorrelationId;

    const testVariantName = String(surfaceJson?.testVariantName || "Baseline");
    const testName = surfaceJson?.testName ? String(surfaceJson.testName) : null;
    const testAnalyticsId = surfaceJson?.testAnalyticsId ? String(surfaceJson.testAnalyticsId) : null;
    const panels = Array.isArray(surfaceJson?.panels) ? surfaceJson.panels : [];

    const rowsForDb: any[] = [];

    for (const p of panels) {
      if (Date.now() - startedAt > rails.budgetMs) throw new Error("budget_exceeded");

      const panelName = String(p?.panelName || "");
      if (!panelName) continue;

      const panelDisplayName = p?.panelDisplayName != null ? String(p.panelDisplayName) : null;
      const panelType = p?.panelType != null ? String(p.panelType) : null;
      const featureTags = Array.isArray(p?.featureTags) ? p.featureTags.map((t: any) => String(t)) : null;

      let rankCounter = 1;
      const firstPage = p?.firstPage || {};
      const firstResults = Array.isArray(firstPage?.results) ? firstPage.results : [];
      const firstHasMore = Boolean(firstPage?.hasMore);

      for (let i = 0; i < firstResults.length; i++) {
        const r = firstResults[i];
        const linkCode = String(r?.linkCode || "");
        if (!linkCode) continue;
        rowsForDb.push({
          surface_name: claim.surface_name,
          panel_name: panelName,
          panel_display_name: panelDisplayName,
          panel_type: panelType,
          feature_tags: featureTags,
          page_index: 0,
          rank: rankCounter++,
          link_code: linkCode,
          link_code_type: classifyLinkCode(linkCode),
          global_ccu: r?.globalCCU ?? null,
          is_visible: r?.isVisible ?? null,
          lock_status: r?.lockStatus ?? null,
          lock_status_reason: r?.lockStatusReason ?? null,
        });
        if (rowsForDb.length > rails.maxTotalEntries) throw new Error("guard_max_total_entries");
      }

      if (firstHasMore) {
        for (let pageIndex = 1; pageIndex <= rails.maxPagesPerPanel; pageIndex++) {
          if (Date.now() - startedAt > rails.budgetMs) throw new Error("budget_exceeded");

          const pageBody = {
            testVariantName,
            panelName,
            pageIndex,
            ...profile,
          };
          const pageResp = await fetchPage(claim.surface_name, branchStr, accessToken, discTok, pageBody);
          lastCorrelationId = pageResp.correlationId || lastCorrelationId;
          const pageJson = pageResp.json;
          const results = Array.isArray(pageJson?.results) ? pageJson.results : [];
          for (let i = 0; i < results.length; i++) {
            const r = results[i];
            const linkCode = String(r?.linkCode || "");
            if (!linkCode) continue;
            rowsForDb.push({
              surface_name: claim.surface_name,
              panel_name: panelName,
              panel_display_name: panelDisplayName,
              panel_type: panelType,
              feature_tags: featureTags,
              page_index: pageIndex,
              rank: rankCounter++,
              link_code: linkCode,
              link_code_type: classifyLinkCode(linkCode),
              global_ccu: r?.globalCCU ?? null,
              is_visible: r?.isVisible ?? null,
              lock_status: r?.lockStatus ?? null,
              lock_status_reason: r?.lockStatusReason ?? null,
            });
            if (rowsForDb.length > rails.maxTotalEntries) throw new Error("guard_max_total_entries");
          }
          const hasMore = Boolean(pageJson?.hasMore);
          if (!hasMore) break;
          if (pageIndex === rails.maxPagesPerPanel) throw new Error("guard_max_pages_per_panel");
          await sleep(0);
        }
      }
    }

    const durationMs = Date.now() - startedAt;
    const { data: applied, error: applyErr } = await supabase.rpc("apply_discovery_exposure_tick", {
      p_target_id: claim.id,
      p_tick_id: tickId,
      p_tick_ts: tickTs,
      p_branch: branchStr,
      p_test_variant_name: testVariantName,
      p_test_name: testName,
      p_test_analytics_id: testAnalyticsId,
      p_rows: rowsForDb,
      p_duration_ms: durationMs,
      p_correlation_id: lastCorrelationId,
    });
    if (applyErr) throw new Error(`apply tick failed: ${applyErr.message}`);

    // Update discover_islands_cache stubs (best-effort, outside the atomic tick apply).
    const islandCodes = Array.from(new Set(rowsForDb.filter((r) => r.link_code_type === "island").map((r) => r.link_code)));
    for (let i = 0; i < islandCodes.length; i += 500) {
      const chunk = islandCodes.slice(i, i + 500).map((code) => ({
        island_code: code,
        first_seen_at: tickTs,
        last_seen_at: tickTs,
      }));
      const { error } = await supabase.from("discover_islands_cache").upsert(chunk, { onConflict: "island_code" });
      if (error) console.log(`[tick] cache stub upsert warning: ${error.message}`);
    }

    // Enqueue Links Service metadata refresh for anything that appeared in this tick (islands + collections).
    // Best-effort; never fails the tick.
    try {
      const linkCodes = Array.from(new Set(rowsForDb.map((r) => r.link_code))).slice(0, 5000);
      if (linkCodes.length) {
        const { error } = await supabase.functions.invoke("discover-links-metadata-collector", {
          body: { mode: "refresh_link_codes", linkCodes, dueWithinMinutes: 360 },
        });
        if (error) console.log(`[tick] metadata enqueue warning: ${error.message}`);
      }
    } catch (e) {
      console.log(`[tick] metadata enqueue exception: ${e instanceof Error ? e.message : String(e)}`);
    }

    const panelsCount = Number(applied?.panels_count || panels.length || 0);
    const entriesCount = Number(applied?.entries_count || rowsForDb.length || 0);
    return { ok: true, tickId, panelsCount, entriesCount, durationMs, branch: branchStr, correlation_id: lastCorrelationId || undefined };
  } catch (e) {
    const durationMs = Date.now() - startedAt;
    const msg = e instanceof Error ? e.message : String(e);
    if (e instanceof EpicHttpError) {
      lastCorrelationId = e.correlationId || lastCorrelationId;
      lastErrorCode = e.errorCode || lastErrorCode;
    }
    await supabase
      .from("discovery_exposure_ticks")
      .update({
        ts_end: new Date().toISOString(),
        status: "failed",
        duration_ms: durationMs,
        error_code: lastErrorCode,
        error_message: msg,
        correlation_id: lastCorrelationId,
      })
      .eq("id", tickId);
    return {
      ok: false,
      tickId,
      panelsCount: 0,
      entriesCount: 0,
      durationMs,
      branch: "",
      error: msg,
      error_code: lastErrorCode || undefined,
      correlation_id: lastCorrelationId || undefined,
    };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Auth guard: require service_role key for all modes except those with their own user-level auth
    const authHeader = req.headers.get("Authorization") || "";
    const serviceKey = mustEnv("SUPABASE_SERVICE_ROLE_KEY");

    const supabase = createClient(mustEnv("SUPABASE_URL"), serviceKey);

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const mode: Mode = (body.mode || "orchestrate") as Mode;

    // Modes that use user-level auth (requireAdminOrEditor) handle their own auth
    const userAuthModes: Mode[] = ["set_paused", "bootstrap_device_auth"];
    if (!userAuthModes.includes(mode)) {
      if (authHeader !== `Bearer ${serviceKey}`) {
        return json({ error: "Forbidden: service_role required" }, 403);
      }
    }

    if (mode === "config_status") {
      return json({
        success: true,
        mode,
        epicOauthClient: hasEnv("EPIC_OAUTH_CLIENT_ID") && hasEnv("EPIC_OAUTH_CLIENT_SECRET"),
        epicDeviceAuth: hasEnv("EPIC_DEVICE_AUTH_ACCOUNT_ID") && hasEnv("EPIC_DEVICE_AUTH_DEVICE_ID") && hasEnv("EPIC_DEVICE_AUTH_SECRET"),
      });
    }

    if (mode === "set_paused") {
      await requireAdminOrEditor(req, supabase);
      const paused = Boolean(body.paused);
      const farFuture = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();

      const { error } = await supabase
        .from("discovery_exposure_targets")
        .update({
          next_due_at: paused ? farFuture : new Date().toISOString(),
          last_status: paused ? "paused" : "idle",
          locked_at: null,
          lock_id: null,
          last_error: null,
        })
        // Ensure a WHERE clause exists (PostgREST safety).
        .neq("id", "00000000-0000-0000-0000-000000000000");
      if (error) return json({ success: false, error: error.message }, 500);
      return json({ success: true, mode, paused });
    }

    if (mode === "bootstrap_device_auth") {
      await requireAdminOrEditor(req, supabase);
      const code = String(body.authorizationCode || "").trim();
      if (!code) return json({ success: false, error: "Missing authorizationCode" }, 400);
      const device = await bootstrapDeviceAuth(code);
      return json({
        success: true,
        mode,
        device,
        // We can't set function secrets programmatically; user must paste these into Lovable/Supabase secrets.
        env: {
          EPIC_OAUTH_CLIENT_ID: Deno.env.get("EPIC_OAUTH_CLIENT_ID") || null,
          EPIC_DEVICE_AUTH_ACCOUNT_ID: device.account_id,
          EPIC_DEVICE_AUTH_DEVICE_ID: device.device_id,
          EPIC_DEVICE_AUTH_SECRET: device.secret,
        },
      });
    }

    if (mode === "maintenance") {
      const rawHours = Number(body.rawHours ?? 48);
      const segmentDays = Number(body.segmentDays ?? 30);
      const deleteBatch = body.deleteBatch != null ? Number(body.deleteBatch) : undefined;
      const doRollup = body.doRollup != null ? Boolean(body.doRollup) : true;

      const args: Record<string, unknown> = {
        p_raw_hours: rawHours,
        p_segment_days: segmentDays,
        p_do_rollup: doRollup,
      };
      if (deleteBatch != null && isFinite(deleteBatch)) args.p_delete_batch = deleteBatch;

      const { data, error } = await supabase.rpc("discovery_exposure_run_maintenance", args);
      if (error) return json({ success: false, error: error.message }, 500);

      // V1 cleanup piggyback: link metadata events retention (best-effort)
      let linkMetaCleanup: any = null;
      try {
        const { data: cData, error: cErr } = await supabase.rpc("cleanup_discover_link_metadata_events", {
          p_days: 90,
          p_delete_batch: deleteBatch != null && isFinite(deleteBatch) ? deleteBatch : undefined,
        });
        if (!cErr) linkMetaCleanup = cData;
      } catch (_e) {
        // ignore
      }

      return json({ success: true, maintenance: data, linkMetaCleanup });
    }

    if (mode === "intel_refresh") {
      const asOf = body.asOf ? new Date(String(body.asOf)).toISOString() : undefined;
      const args: Record<string, unknown> = {};
      if (asOf) args.p_as_of = asOf;

      const { data, error } = await supabase.rpc("compute_discovery_public_intel", args);
      if (error) return json({ success: false, error: error.message }, 500);

      // Best-effort: bump metadata for current Tier1 items to keep thumbs/titles fresh.
      try {
        const { data: rows, error: rErr } = await supabase
          .from("discovery_public_premium_now")
          .select("link_code")
          .order("rank", { ascending: true })
          .limit(500);
        if (!rErr && rows?.length) {
          const codes = Array.from(new Set(rows.map((r: any) => String(r.link_code)).filter(Boolean)));
          if (codes.length) {
            await supabase.rpc("enqueue_discover_link_metadata", { p_link_codes: codes, p_due_within_minutes: 60 });
          }
        }
      } catch (_e) {
        // ignore
      }

      return json({ success: true, mode, intel: data });
    }

    if (mode === "diagnose_rating") {
      await requireAdminOrEditor(req, supabase);
      const regions = Array.isArray(body.regions) ? body.regions : ["BR", "NAE", "EU"];
      const surfaceName = String(body.surfaceName || "CreativeDiscoverySurface_Frontend");
      const auth = await getAuthContext();

      const diagnosticResults: any[] = [];
      for (const region of regions) {
        try {
          // Build body WITHOUT ratingAuthority and rating
          const bodyNoRating: any = {
            playerId: auth.accountId,
            partyMemberIds: [auth.accountId],
            locale: "en",
            matchmakingRegion: region,
            platform: "Windows",
            isCabined: false,
            numLocalPlayers: 1,
          };
          const surfResp = await fetchSurface(surfaceName, auth.branchStr, auth.accessToken, auth.discAccessToken, bodyNoRating);
          const sj = surfResp.json;
          const panels = Array.isArray(sj?.panels) ? sj.panels : [];
          const panelSummaries = panels.map((p: any) => ({
            panelName: p?.panelName || null,
            panelDisplayName: p?.panelDisplayName || null,
            panelType: p?.panelType || null,
            featureTags: p?.featureTags || null,
            resultsCount: Array.isArray(p?.firstPage?.results) ? p.firstPage.results.length : 0,
            hasMore: p?.firstPage?.hasMore || false,
          }));

          // Also run WITH rating for comparison
          const bodyWithRating = { ...bodyNoRating, ratingAuthority: "ESRB", rating: "TEEN" };
          const surfRespWith = await fetchSurface(surfaceName, auth.branchStr, auth.accessToken, auth.discAccessToken, bodyWithRating);
          const sjWith = surfRespWith.json;
          const panelsWith = Array.isArray(sjWith?.panels) ? sjWith.panels : [];
          const panelSummariesWith = panelsWith.map((p: any) => ({
            panelName: p?.panelName || null,
            panelDisplayName: p?.panelDisplayName || null,
            panelType: p?.panelType || null,
            featureTags: p?.featureTags || null,
            resultsCount: Array.isArray(p?.firstPage?.results) ? p.firstPage.results.length : 0,
            hasMore: p?.firstPage?.hasMore || false,
          }));

          // Find panels that exist in one but not the other
          const namesNoRating = new Set(panelSummaries.map((p: any) => p.panelName));
          const namesWithRating = new Set(panelSummariesWith.map((p: any) => p.panelName));
          const onlyWithoutRating = panelSummaries.filter((p: any) => !namesWithRating.has(p.panelName));
          const onlyWithRating = panelSummariesWith.filter((p: any) => !namesNoRating.has(p.panelName));

          diagnosticResults.push({
            region,
            testVariantName_noRating: sj?.testVariantName || null,
            testVariantName_withRating: sjWith?.testVariantName || null,
            panels_noRating_count: panelSummaries.length,
            panels_withRating_count: panelSummariesWith.length,
            panels_noRating: panelSummaries,
            panels_withRating: panelSummariesWith,
            diff: {
              onlyWithoutRating,
              onlyWithRating,
            },
          });
        } catch (e) {
          diagnosticResults.push({
            region,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }

      console.log("[diagnose_rating] results:", JSON.stringify(diagnosticResults, null, 2));
      return json({ success: true, mode, branch: auth.branchStr, diagnostics: diagnosticResults });
    }

    if (mode === "tick") {
      await requireAdminOrEditor(req, supabase);
      const targetId = body.targetId as string | undefined;
      if (!targetId) return json({ success: false, error: "Missing targetId" }, 400);
      const rails = { ...DEFAULT_GUARD_RAILS, ...(body.guardRails || {}) };
      const lockId = body.lockId as string | undefined;

      const { data: t, error: tErr } = await supabase
        .from("discovery_exposure_targets")
        .select("id,region,surface_name,platform,locale,interval_minutes,lock_id,last_status")
        .eq("id", targetId)
        .single();
      if (tErr || !t) return json({ success: false, error: tErr?.message || "Target not found" }, 404);
      if (lockId && String(t.lock_id || "") !== lockId) return json({ success: false, error: "lock_id mismatch" }, 409);

      const claim: TargetClaim = {
        id: String(t.id),
        region: String(t.region),
        surface_name: String(t.surface_name),
        platform: String(t.platform),
        locale: String(t.locale),
        interval_minutes: Number(t.interval_minutes || 10),
        lock_id: String(t.lock_id || lockId || ""),
      };

      const result = await runTick(supabase, claim, rails);
      await supabase
        .from("discovery_exposure_targets")
        .update({
          last_status: "idle",
          locked_at: null,
          lock_id: null,
          last_ok_tick_at: result.ok ? new Date().toISOString() : undefined,
          last_failed_tick_at: result.ok ? undefined : new Date().toISOString(),
          last_error: result.ok ? null : result.error,
        })
        .eq("id", claim.id);

      return json({ success: true, mode, ...result });
    }

    // mode=orchestrate
    const cfgOk = hasEnv("EPIC_OAUTH_CLIENT_ID") &&
      hasEnv("EPIC_OAUTH_CLIENT_SECRET") &&
      hasEnv("EPIC_DEVICE_AUTH_ACCOUNT_ID") &&
      hasEnv("EPIC_DEVICE_AUTH_DEVICE_ID") &&
      hasEnv("EPIC_DEVICE_AUTH_SECRET");
    if (!cfgOk) {
      return json({
        success: true,
        mode,
        claimed: false,
        configured: false,
        missing: [
          !hasEnv("EPIC_OAUTH_CLIENT_ID") ? "EPIC_OAUTH_CLIENT_ID" : null,
          !hasEnv("EPIC_OAUTH_CLIENT_SECRET") ? "EPIC_OAUTH_CLIENT_SECRET" : null,
          !hasEnv("EPIC_DEVICE_AUTH_ACCOUNT_ID") ? "EPIC_DEVICE_AUTH_ACCOUNT_ID" : null,
          !hasEnv("EPIC_DEVICE_AUTH_DEVICE_ID") ? "EPIC_DEVICE_AUTH_DEVICE_ID" : null,
          !hasEnv("EPIC_DEVICE_AUTH_SECRET") ? "EPIC_DEVICE_AUTH_SECRET" : null,
        ].filter(Boolean),
      });
    }

    const rails = DEFAULT_GUARD_RAILS;

    // Sequential orchestrate: claim one target at a time and run it, repeating until
    // we run out of due targets or we are close to the Edge Function timeout.
    const orchestrateStartedAt = Date.now();
    const orchestrateBudgetMs = 48_000; // keep a couple seconds of margin vs ~50s limit
    const minRemainingMsToStartTick = 8_000; // guard against starting a tick we can't finish

    // Fetch auth once and reuse across sequential ticks in this invocation.
    const auth = await getAuthContext();

    const results: Array<Record<string, unknown>> = [];
    let claimedAny = false;

    while (Date.now() - orchestrateStartedAt < orchestrateBudgetMs) {
      const remaining = orchestrateBudgetMs - (Date.now() - orchestrateStartedAt);
      if (remaining < minRemainingMsToStartTick) break;

      const { data: claimed, error: claimErr } = await supabase.rpc("claim_discovery_exposure_target", {
        p_stale_after_seconds: 180,
        p_take: 1,
      });
      if (claimErr) return json({ success: false, error: claimErr.message }, 500);

      const claims = (Array.isArray(claimed) ? claimed : []) as TargetClaim[];
      if (!claims.length) break;

      const claim = claims[0];
      claimedAny = true;

      const result = await runTick(supabase, claim, rails, auth);

      // Release the logical lock (best-effort, guard by lock_id).
      await supabase
        .from("discovery_exposure_targets")
        .update({
          last_status: "idle",
          locked_at: null,
          lock_id: null,
          last_ok_tick_at: result.ok ? new Date().toISOString() : undefined,
          last_failed_tick_at: result.ok ? undefined : new Date().toISOString(),
          last_error: result.ok ? null : result.error,
        })
        .eq("id", claim.id)
        .eq("lock_id", claim.lock_id);

      results.push({
        target: { id: claim.id, region: claim.region, surface_name: claim.surface_name },
        ...result,
      });
    }

    // Piggyback: compute system alerts once per orchestrate invocation (best-effort).
    try {
      await supabase.rpc("compute_system_alerts", {});
    } catch (_e) {
      // ignore
    }

    return json({
      success: true,
      mode,
      claimed: claimedAny,
      targets_count: results.length,
      results,
      orchestrate_duration_ms: Date.now() - orchestrateStartedAt,
    });
  } catch (e) {
    return json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
