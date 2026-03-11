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

const EPIC_ACCOUNT_OAUTH_TOKEN = "https://account-public-service-prod.ol.epicgames.com/account/api/oauth/token";
const EPIC_LINKS_MNEMONIC_BASE = "https://links-public-service-live.ol.epicgames.com/links/api/fn/mnemonic";
const EPIC_LINKS_MNEMONIC_RELATED_BASE = "https://links-public-service-live.ol.epicgames.com/links/api/fn/mnemonic";
const EPIC_FORTNITE_VERSION = "https://fngw-mcp-gc-livefn.ol.epicgames.com/fortnite/api/version";
const EPIC_DISCOVERY_ACCESS_TOKEN_BASE =
  "https://fngw-mcp-gc-livefn.ol.epicgames.com/fortnite/api/discovery/accessToken";
const FN_DISCOVERY_V2_SURFACE_BASE =
  "https://fn-service-discovery-live-public.ogs.live.on.epicgames.com/api/v2/discovery/surface";

const ISLAND_CODE_RE = /^\d{4}-\d{4}-\d{4}$/;

type Mode = "orchestrate" | "refresh_link_codes" | "backfill_recent_collections" | "config_status";

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

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function toEpochMs(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v).trim();
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function sameInstant(a: unknown, b: unknown): boolean {
  const ta = toEpochMs(a);
  const tb = toEpochMs(b);
  return ta != null && tb != null && ta === tb;
}

async function requireAdminOrEditor(req: Request) {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  if (!token) throw new Error("forbidden: missing Authorization");

  const supabaseAuth = createClient(mustEnv("SUPABASE_URL"), mustEnv("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: auth } },
  });

  const { data: userData, error: uErr } = await supabaseAuth.auth.getUser();
  if (uErr || !userData?.user?.id) throw new Error("forbidden: invalid user");
  const userId = userData.user.id;

  const svc = createClient(mustEnv("SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
  const { data: roles, error: rErr } = await svc
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .in("role", ["admin", "editor"])
    .limit(1);
  if (rErr) throw new Error("forbidden: role check failed");
  if (!roles || roles.length === 0) throw new Error("forbidden: not admin/editor");
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

async function getLiveBranchStr(): Promise<string> {
  const res = await fetchJson(EPIC_FORTNITE_VERSION, { timeoutMs: 15000 });
  if (!res.ok) {
    const msg = res.json?.errorMessage || res.json?.errorCode || `HTTP ${res.status}`;
    throw new Error(`fortnite/api/version failed: ${msg}`);
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
    const msg = res.json?.errorMessage || res.json?.errorCode || `HTTP ${res.status}`;
    throw new Error(`discovery/accessToken failed: ${msg}`);
  }
  const tok = String(res.json?.token || "");
  if (!tok) throw new Error("discovery/accessToken returned empty token");
  return tok;
}

function buildDiscoveryProfileBody(accountId: string, region: string, platform: string, locale: string) {
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

function normalizePositiveCcu(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n;
}

function computeSurfaceCcu(surfaceJson: any): { sumUnique: number; maxUnique: number; uniqueCount: number; panelCount: number } {
  const panels = Array.isArray(surfaceJson?.panels) ? surfaceJson.panels : [];
  const byCode = new Map<string, number>();
  for (const p of panels) {
    const results = Array.isArray(p?.firstPage?.results) ? p.firstPage.results : [];
    for (const r of results) {
      const code = String(r?.linkCode || "").trim();
      if (!code) continue;
      const ccu = normalizePositiveCcu(r?.globalCCU);
      const prev = byCode.get(code) || 0;
      if (ccu > prev) byCode.set(code, ccu);
    }
  }
  const values = Array.from(byCode.values());
  const sumUnique = values.reduce((a, b) => a + b, 0);
  const maxUnique = values.reduce((a, b) => Math.max(a, b), 0);
  return { sumUnique, maxUnique, uniqueCount: byCode.size, panelCount: panels.length };
}

function extractFields(payload: any) {
  const top = payload || {};
  const m = top.metadata || {};
  const mmv2 = m.matchmakingV2 || {};
  const ratings = m.ratings || null;

  const imageUrls = m.image_urls || m.imageUrls || null;
  const extraImages = m.extra_image_urls || m.extraImageUrls || null;
  const pickImageUrl = (...candidates: any[]): string | null => {
    for (const c of candidates) {
      if (!c) continue;
      if (typeof c === "string") {
        const v = c.trim();
        if (v) return v;
        continue;
      }
      if (Array.isArray(c)) {
        for (const item of c) {
          if (typeof item === "string" && item.trim()) return item.trim();
          if (item && typeof item === "object") {
            const u = (item.url ?? item.src ?? item.image_url ?? item.imageUrl) ?? null;
            if (typeof u === "string" && u.trim()) return u.trim();
          }
        }
        continue;
      }
      if (typeof c === "object") {
        const u = (c.url ?? c.src ?? c.image_url ?? c.imageUrl) ?? null;
        if (typeof u === "string" && u.trim()) return u.trim();
      }
    }
    return null;
  };
  const resolvedImageUrl = pickImageUrl(
    m.image_url,
    m.imageUrl,
    imageUrls,
    extraImages,
    m.tile_background_image_urls,
    m.pop_out_image_urls,
    m.logo_image_urls,
    m.surface_banner_image_urls,
    m.surface_background_image_urls,
    m.surface_logo_image_urls,
    m.icon_image_urls,
  );

  return {
    namespace: top.namespace ?? null,
    linkType: top.linkType ?? null,
    accountId: top.accountId ?? null,
    creatorName: top.creatorName ?? null,
    supportCode: m.supportCode ?? null,
    title: m.title ?? null,
    tagline: m.tagline ?? null,
    introduction: m.introduction ?? null,
    locale: m.locale ?? null,
    imageUrl: resolvedImageUrl,
    imageUrls,
    extraImageUrls: extraImages,
    videoVuid: m.video_vuid ?? m.videoVuid ?? null,
    maxPlayers: mmv2.maxPlayers ?? null,
    minPlayers: mmv2.minPlayers ?? null,
    maxSocialPartySize: mmv2.maxSocialPartySize ?? null,
    ratings,
    version: top.version ?? null,
    createdAtEpic: top.created ?? null,
    publishedAtEpic: top.published ?? null,
    updatedAtEpic: top.updated ?? null,
    lastActivatedAtEpic: top.lastActivatedDate ?? null,
    moderationStatus: top.moderationStatus ?? null,
    linkState: top.linkState ?? null,
    discoveryIntent: top.discoveryIntent ?? null,
    active: top.active ?? null,
    disabled: top.disabled ?? null,
    refId: m.ref_id ?? m.refId ?? null,
    refType: m.ref_type ?? m.refType ?? null,
    interestType: m.interest_type ?? m.interestType ?? null,
  };
}

function isLikelyLinkCode(v: string): boolean {
  return ISLAND_CODE_RE.test(v) ||
    v.startsWith("playlist_") ||
    v.startsWith("set_") ||
    v.startsWith("reference_") ||
    v.startsWith("ref_panel_") ||
    v.startsWith("experience_");
}

type RelatedEdge = {
  parent_link_code: string;
  child_link_code: string;
  edge_type: string;
  sort_order: number | null;
  source: string;
  last_seen_at: string;
  updated_at: string;
  metadata?: any;
};

function parseRelatedPayload(parentCode: string, payload: any, nowIso: string): {
  edges: RelatedEdge[];
  metadataRows: any[];
  discoveredCodes: string[];
} {
  const edges: RelatedEdge[] = [];
  const metadataRowsMap = new Map<string, any>();
  const discovered = new Set<string>();

  const putMeta = (linkObj: any) => {
    if (!linkObj || typeof linkObj !== "object") return;
    const code = String(linkObj.mnemonic || "");
    if (!code) return;
    discovered.add(code);

    const linkCodeType = ISLAND_CODE_RE.test(code) ? "island" : "collection";
    const f = extractFields(linkObj);

    metadataRowsMap.set(code, {
      link_code: code,
      link_code_type: linkCodeType,
      namespace: f.namespace,
      link_type: f.linkType,
      account_id: f.accountId,
      creator_name: f.creatorName,
      support_code: f.supportCode,
      title: f.title,
      tagline: f.tagline,
      introduction: f.introduction,
      locale: f.locale,
      image_url: f.imageUrl,
      image_urls: f.imageUrls,
      extra_image_urls: f.extraImageUrls,
      video_vuid: f.videoVuid,
      max_players: f.maxPlayers,
      min_players: f.minPlayers,
      max_social_party_size: f.maxSocialPartySize,
      ratings: f.ratings,
      version: f.version,
      created_at_epic: f.createdAtEpic,
      published_at_epic: f.publishedAtEpic,
      updated_at_epic: f.updatedAtEpic,
      last_activated_at_epic: f.lastActivatedAtEpic,
      moderation_status: f.moderationStatus,
      link_state: f.linkState,
      discovery_intent: f.discoveryIntent,
      active: f.active,
      disabled: f.disabled,
      last_fetched_at: nowIso,
      last_error: null,
      raw: {
        ...(f.refId ? { ref_id: f.refId } : {}),
        ...(f.refType ? { ref_type: f.refType } : {}),
        ...(f.interestType ? { interest_type: f.interestType } : {}),
      },
      updated_at: nowIso,
    });
  };

  const pushEdge = (
    parentCodeRaw: unknown,
    childCodeRaw: unknown,
    edgeType: string,
    sortOrder: number | null = null,
  ) => {
    const parent = String(parentCodeRaw || "").trim();
    const childCode = String(childCodeRaw || "").trim();
    if (!parent || !childCode || childCode === parent || !isLikelyLinkCode(childCode)) return;
    discovered.add(childCode);
    edges.push({
      parent_link_code: parent,
      child_link_code: childCode,
      edge_type: edgeType,
      sort_order: sortOrder,
      source: "links_related",
      last_seen_at: nowIso,
      updated_at: nowIso,
    });
  };

  const parseMetadataHints = (ownerCodeRaw: unknown, metadata: any) => {
    const ownerCode = String(ownerCodeRaw || "").trim();
    if (!ownerCode || !metadata || typeof metadata !== "object") return;

    if (Array.isArray(metadata.sub_link_codes)) {
      metadata.sub_link_codes.forEach((c: any, i: number) => pushEdge(ownerCode, c, "sub_link_code", i));
    }
    if (metadata.default_sub_link_code) {
      pushEdge(ownerCode, metadata.default_sub_link_code, "default_sub_link_code", 0);
    }
    if (metadata.fallback_links && typeof metadata.fallback_links === "object") {
      let idx = 0;
      for (const v of Object.values(metadata.fallback_links)) {
        pushEdge(ownerCode, v, "fallback_link", idx++);
      }
    }
  };

  // Requested mnemonic may come as a full link object at top-level.
  if (payload?.mnemonic) putMeta(payload);

  // Related links map.
  if (payload?.links && typeof payload.links === "object") {
    let idx = 0;
    for (const code of Object.keys(payload.links)) {
      pushEdge(parentCode, code, "related_link", idx++);
      const linked = payload.links[code];
      putMeta(linked);
      parseMetadataHints(code, linked?.metadata);
    }
  }

  // Parents relation.
  if (Array.isArray(payload?.parentLinks)) {
    let idx = 0;
    for (const p of payload.parentLinks) {
      const code = String(p?.mnemonic || "");
      pushEdge(parentCode, code, "parent_link", idx++);
      putMeta(p);
      parseMetadataHints(code, p?.metadata);
    }
  }

  // Parse child hints from metadata.
  const meta = payload?.metadata || (payload?.links?.[parentCode]?.metadata ?? null);
  parseMetadataHints(parentCode, meta);

  return {
    edges,
    metadataRows: Array.from(metadataRowsMap.values()),
    discoveredCodes: Array.from(discovered),
  };
}

function nextDueFromSignals(args: { isPremiumNow: boolean; lastSeenAt: string | null; now: Date }): Date {
  const { isPremiumNow, lastSeenAt, now } = args;
  if (isPremiumNow) return new Date(now.getTime() + 60 * 60 * 1000);
  if (lastSeenAt) {
    const ls = new Date(lastSeenAt).getTime();
    if (isFinite(ls) && ls >= now.getTime() - 24 * 60 * 60 * 1000) {
      return new Date(now.getTime() + 6 * 60 * 60 * 1000);
    }
  }
  return new Date(now.getTime() + 24 * 60 * 60 * 1000);
}

function backoffNextDue(now: Date, status: number, prevError: string | null): Date {
  // Simple conservative backoff; we don't track attempt counts yet.
  const baseMin = status === 429 ? 15 : 10;
  const bump = prevError ? 15 : 0;
  return new Date(now.getTime() + (baseMin + bump) * 60 * 1000);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Auth guard: require service_role key OR admin for specific modes
    const serviceKey = mustEnv("SUPABASE_SERVICE_ROLE_KEY");
    
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }
    const mode = String(body.mode || "orchestrate") as Mode;
    const userAuthModes = ["backfill_recent_collections", "config_status"];
    // orchestrate/collect are called by cron with anon key - allow them through
    const cronSafeModes = ["orchestrate", "collect"];

    if (!isServiceRoleRequest(req, serviceKey)) {
       if (userAuthModes.includes(mode)) {
          await requireAdminOrEditor(req);
       } else if (!cronSafeModes.includes(mode)) {
          return json({ error: "Forbidden: service_role required" }, 403);
       }
    }

    const supabase = createClient(mustEnv("SUPABASE_URL"), serviceKey);

    if (shouldProxyToData(req)) {
      const proxied = await invokeDataFunction({
        req,
        functionName: "discover-links-metadata-collector",
        body,
        timeoutMs: getEnvNumber("LOOKUP_DATA_TIMEOUT_MS", 9000),
      });
      if (proxied.ok) return dataProxyResponse(proxied.data, proxied.status, corsHeaders);
      return dataBridgeUnavailableResponse(corsHeaders, proxied.error);
    }

    if (shouldBlockLocalExecution(req)) {
      return dataBridgeUnavailableResponse(corsHeaders, "strict proxy mode");
    }

    if (mode === "config_status") {
      const cfgOk = hasEnv("EPIC_OAUTH_CLIENT_ID") &&
        hasEnv("EPIC_OAUTH_CLIENT_SECRET") &&
        hasEnv("EPIC_DEVICE_AUTH_ACCOUNT_ID") &&
        hasEnv("EPIC_DEVICE_AUTH_DEVICE_ID") &&
        hasEnv("EPIC_DEVICE_AUTH_SECRET");
      return json({
        success: true,
        configured: cfgOk,
        missing: [
          !hasEnv("EPIC_OAUTH_CLIENT_ID") ? "EPIC_OAUTH_CLIENT_ID" : null,
          !hasEnv("EPIC_OAUTH_CLIENT_SECRET") ? "EPIC_OAUTH_CLIENT_SECRET" : null,
          !hasEnv("EPIC_DEVICE_AUTH_ACCOUNT_ID") ? "EPIC_DEVICE_AUTH_ACCOUNT_ID" : null,
          !hasEnv("EPIC_DEVICE_AUTH_DEVICE_ID") ? "EPIC_DEVICE_AUTH_DEVICE_ID" : null,
          !hasEnv("EPIC_DEVICE_AUTH_SECRET") ? "EPIC_DEVICE_AUTH_SECRET" : null,
        ].filter(Boolean),
      });
    }

    if (mode === "refresh_link_codes") {
      const linkCodes = Array.isArray(body.linkCodes) ? body.linkCodes.map((x: any) => String(x)) : [];
      if (!linkCodes.length) return json({ success: false, error: "Missing linkCodes[]" }, 400);
      const dueWithinMinutesRaw = body.dueWithinMinutes != null ? Number(body.dueWithinMinutes) : 0;
      const dueWithinMinutes = isFinite(dueWithinMinutesRaw) ? Math.max(0, Math.min(24 * 60, dueWithinMinutesRaw)) : 0;

      const { data, error } = await supabase.rpc("enqueue_discover_link_metadata", {
        p_link_codes: linkCodes,
        p_due_within_minutes: dueWithinMinutes,
      });
      if (error) return json({ success: false, error: error.message }, 500);
      return json({ success: true, mode, enqueued: data, submitted: linkCodes.length, dueWithinMinutes });
    }

    if (mode === "backfill_recent_collections") {
      const lookbackHoursRaw = Number(body.lookbackHours ?? 72);
      const maxCodesRaw = Number(body.maxCodes ?? 5000);
      const dueWithinMinutesRaw = Number(body.dueWithinMinutes ?? 0);
      const lookbackHours = isFinite(lookbackHoursRaw) ? Math.max(1, Math.min(24 * 30, lookbackHoursRaw)) : 72;
      const maxCodes = isFinite(maxCodesRaw) ? Math.max(1, Math.min(20000, maxCodesRaw)) : 5000;
      const dueWithinMinutes = isFinite(dueWithinMinutesRaw)
        ? Math.max(0, Math.min(24 * 60, dueWithinMinutesRaw))
        : 0;

      const sinceIso = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();
      const { data: segs, error: sErr } = await supabase
        .from("discovery_exposure_rank_segments")
        .select("link_code")
        .eq("link_code_type", "collection")
        .gte("last_seen_ts", sinceIso)
        .order("last_seen_ts", { ascending: false })
        .limit(maxCodes * 2);
      if (sErr) return json({ success: false, error: sErr.message }, 500);

      const codes = Array.from(
        new Set((segs || []).map((r: any) => String(r.link_code)).filter(Boolean)),
      ).slice(0, maxCodes);

      if (!codes.length) {
        return json({
          success: true,
          mode,
          lookbackHours,
          dueWithinMinutes,
          found: 0,
          enqueued: { inserted: 0, updated: 0 },
        });
      }

      const { data, error } = await supabase.rpc("enqueue_discover_link_metadata", {
        p_link_codes: codes,
        p_due_within_minutes: dueWithinMinutes,
      });
      if (error) return json({ success: false, error: error.message }, 500);

      return json({
        success: true,
        mode,
        lookbackHours,
        dueWithinMinutes,
        found: codes.length,
        enqueued: data,
      });
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

    const budgetMs = Number(body.budgetMs ?? 45_000);
    const maxItems = Math.min(1000, Math.max(1, Number(body.maxItems ?? 500)));

    const startedAt = Date.now();
    const now = new Date();

    const { data: claims, error: claimErr } = await supabase.rpc("claim_discover_link_metadata", {
      p_take: maxItems,
      p_stale_after_seconds: 180,
    });
    if (claimErr) return json({ success: false, error: claimErr.message }, 500);
    const claimed = Array.isArray(claims) ? claims : [];
    if (!claimed.length) {
      try {
        await supabase.rpc("compute_system_alerts", {});
      } catch (_e) {
        // ignore
      }
      return json({ success: true, mode, claimed: false, processed: 0 });
    }

    const lockByCode = new Map<string, string>();
    const codes = claimed.map((c: any) => String(c.link_code));
    for (const c of claimed) lockByCode.set(String(c.link_code), String(c.lock_id));

    // Fetch current rows for diff/events and existing last_error
    const existingMap = new Map<string, any>();
    for (let i = 0; i < codes.length; i += 100) {
      const chunk = codes.slice(i, i + 100);
      const { data, error } = await supabase
        .from("discover_link_metadata")
        .select("link_code,title,image_url,updated_at_epic,moderation_status,link_state,last_error,version,raw")
        .in("link_code", chunk);
      if (error) return json({ success: false, error: error.message }, 500);
      for (const r of data || []) existingMap.set(String(r.link_code), r);
    }

    // Signals for next_due_at
    const premiumNow = new Set<string>();
    {
      const segRows: any[] = [];
      for (let i = 0; i < codes.length; i += 100) {
        const chunk = codes.slice(i, i + 100);
        const { data, error } = await supabase
          .from("discovery_exposure_rank_segments")
          .select("link_code,panel_name,end_ts")
          .in("link_code", chunk)
          .is("end_ts", null)
          .limit(5000);
        if (error) continue;
        segRows.push(...(data || []));
      }
      const panelNames = Array.from(new Set(segRows.map((r: any) => String(r.panel_name))));
      if (panelNames.length) {
        // Only treat tier1 panels as premium (lookup once)
        const { data: tiers } = await supabase
          .from("discovery_panel_tiers")
          .select("panel_name,tier")
          .in("panel_name", panelNames);
        const tier1 = new Set((tiers || []).filter((t: any) => Number(t.tier) === 1).map((t: any) => String(t.panel_name)));
        for (const r of segRows) {
          if (tier1.has(String(r.panel_name))) premiumNow.add(String(r.link_code));
        }
      }
    }

    const lastSeenMap = new Map<string, string>();
    {
      const stateRows: any[] = [];
      for (let i = 0; i < codes.length; i += 100) {
        const chunk = codes.slice(i, i + 100);
        const { data, error } = await supabase
          .from("discovery_exposure_link_state")
          .select("link_code,last_seen_at")
          .in("link_code", chunk)
          .order("last_seen_at", { ascending: false })
          .limit(20000);
        if (error) continue;
        stateRows.push(...(data || []));
      }
      for (const r of stateRows) {
        const code = String(r.link_code);
        if (!lastSeenMap.has(code)) lastSeenMap.set(code, String(r.last_seen_at));
      }
    }

    const auth = await getEg1Token();
    const ccuRegion = String(body.ccuRegion || "NAE");
    const ccuPlatform = String(body.ccuPlatform || "Windows");
    const ccuLocale = String(body.ccuLocale || "en-US");
    const discoveryProfile = buildDiscoveryProfileBody(auth.accountId, ccuRegion, ccuPlatform, ccuLocale);

    let discoveryCtxPromise: Promise<{ branchStr: string; discAccessToken: string }> | null = null;
    const getDiscoveryCtx = async (): Promise<{ branchStr: string; discAccessToken: string }> => {
      if (!discoveryCtxPromise) {
        discoveryCtxPromise = (async () => {
          const branchStr = await getLiveBranchStr();
          const discAccessToken = await getDiscoveryAccessToken(branchStr, auth.accessToken);
          return { branchStr, discAccessToken };
        })();
      }
      return await discoveryCtxPromise;
    };

    const surfaceCcuCache = new Map<string, { sumUnique: number; maxUnique: number; uniqueCount: number; panelCount: number } | null>();
    const isReferenceSurfaceCcuCandidate = (linkCode: string, refId: string | null): boolean => {
      const code = String(linkCode || "").toLowerCase();
      const surface = String(refId || "");
      if (!surface.startsWith("CreativeDiscoverySurface_")) return false;
      return code.startsWith("reference_surface_collab_") || code.startsWith("reference_surface_category_");
    };
    const fetchReferenceSurfaceCcu = async (
      linkCode: string,
      refId: string | null,
    ): Promise<{ sumUnique: number; maxUnique: number; uniqueCount: number; panelCount: number } | null> => {
      const surfaceName = String(refId || "").trim();
      if (!isReferenceSurfaceCcuCandidate(linkCode, surfaceName)) return null;
      if (surfaceCcuCache.has(surfaceName)) return surfaceCcuCache.get(surfaceName) || null;
      if (Date.now() - startedAt > budgetMs - 5000) {
        surfaceCcuCache.set(surfaceName, null);
        return null;
      }
      try {
        const { branchStr, discAccessToken } = await getDiscoveryCtx();
        const streamEnc = encodeURIComponent(branchStr);
        const url = `${FN_DISCOVERY_V2_SURFACE_BASE}/${encodeURIComponent(surfaceName)}?appId=Fortnite&stream=${streamEnc}`;
        const res = await fetchJson(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${auth.accessToken}`,
            "X-Epic-Access-Token": discAccessToken,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(discoveryProfile),
          timeoutMs: 25000,
        });
        if (!res.ok) {
          surfaceCcuCache.set(surfaceName, null);
          return null;
        }
        const ccu = computeSurfaceCcu(res.json);
        surfaceCcuCache.set(surfaceName, ccu);
        return ccu;
      } catch {
        surfaceCcuCache.set(surfaceName, null);
        return null;
      }
    };

    const updates: any[] = [];
    const events: any[] = [];
    const results: any[] = [];
    const edgeMapByParent = new Map<string, RelatedEdge[]>();
    const relatedMetaMap = new Map<string, any>();
    const relatedCodesToEnqueue = new Set<string>();
    let relatedFetchOk = 0;
    let relatedFetchFailed = 0;
    const relatedFailuresByStatus = new Map<string, number>();
    const unresolvedTokensByType = new Map<string, number>();

    const classifyCollectionToken = (value: string): string => {
      const v = String(value || "").toLowerCase();
      if (v.startsWith("reference_")) return "reference";
      if (v.startsWith("ref_panel_")) return "ref_panel";
      if (v.startsWith("set_")) return "set";
      if (v.startsWith("playlist_")) return "playlist";
      if (v.startsWith("gamecollections_")) return "gamecollections";
      return "other_collection";
    };

    for (const code of codes) {
      if (Date.now() - startedAt > budgetMs - 1500) break;

      const prev = existingMap.get(code) || {};
      const prevError = prev.last_error ? String(prev.last_error) : null;

      const url = `${EPIC_LINKS_MNEMONIC_BASE}/${encodeURIComponent(code)}`;
      const res = await fetchJson(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${auth.accessToken}`,
          Accept: "application/json",
        },
        timeoutMs: 20000,
      });

      const correlationId = epicCorrelationIdFromHeaders(res.headers);
      const linkCodeType = ISLAND_CODE_RE.test(code) ? "island" : "collection";

      if (!res.ok) {
        const err = res.json?.errorMessage || res.json?.detail || res.json?.error || `HTTP ${res.status}`;
        const nextDue = backoffNextDue(now, res.status, prevError).toISOString();
        updates.push({
          link_code: code,
          link_code_type: linkCodeType,
          last_fetched_at: now.toISOString(),
          next_due_at: nextDue,
          last_error: String(err),
          locked_at: null,
          lock_id: null,
          raw: {},
          updated_at: now.toISOString(),
        });
        results.push({ linkCode: code, ok: false, status: res.status, correlationId, error: String(err) });
        continue;
      }

      const p = res.json;
      const f = extractFields(p);
      const refSurfaceCcu = await fetchReferenceSurfaceCcu(code, f.refId);
      const prevRaw = (prev?.raw && typeof prev.raw === "object") ? prev.raw as Record<string, unknown> : {};
      const mergedRaw: Record<string, unknown> = {
        ...prevRaw,
        ...(f.refId ? { ref_id: f.refId } : {}),
        ...(f.refType ? { ref_type: f.refType } : {}),
        ...(f.interestType ? { interest_type: f.interestType } : {}),
      };
      if (refSurfaceCcu) {
        mergedRaw.surface_ref_ccu_sum = refSurfaceCcu.sumUnique;
        mergedRaw.surface_ref_ccu_max = refSurfaceCcu.maxUnique;
        mergedRaw.surface_ref_unique_count = refSurfaceCcu.uniqueCount;
        mergedRaw.surface_ref_panel_count = refSurfaceCcu.panelCount;
        mergedRaw.surface_ref_ccu_computed_at = now.toISOString();
      }
      const nextDue = nextDueFromSignals({
        isPremiumNow: premiumNow.has(code),
        lastSeenAt: lastSeenMap.get(code) || null,
        now,
      }).toISOString();

      // Events
      const prevTitle = prev.title != null ? String(prev.title) : null;
      const prevImage = prev.image_url != null ? String(prev.image_url) : null;
      const prevUpdated = prev.updated_at_epic != null ? String(prev.updated_at_epic) : null;
      const prevVersionRaw = prev.version != null ? Number(prev.version) : null;
      const prevVersion = prevVersionRaw != null && Number.isFinite(prevVersionRaw) ? prevVersionRaw : null;
      const nextVersionRaw = f.version != null ? Number(f.version) : null;
      const nextVersion = nextVersionRaw != null && Number.isFinite(nextVersionRaw) ? nextVersionRaw : null;
      const prevMod = prev.moderation_status != null ? String(prev.moderation_status) : null;
      const prevState = prev.link_state != null ? String(prev.link_state) : null;

      if (prevImage && f.imageUrl && prevImage !== String(f.imageUrl)) {
        events.push({ link_code: code, event_type: "thumb_changed", old_value: { image_url: prevImage }, new_value: { image_url: f.imageUrl } });
      }
      if (prevTitle && f.title && prevTitle !== String(f.title)) {
        events.push({ link_code: code, event_type: "title_changed", old_value: { title: prevTitle }, new_value: { title: f.title } });
      }
      if (prevUpdated && f.updatedAtEpic && !sameInstant(prevUpdated, f.updatedAtEpic)) {
        events.push({ link_code: code, event_type: "epic_updated", old_value: { updated: prevUpdated }, new_value: { updated: f.updatedAtEpic } });
      }
      if (prevVersion != null && nextVersion != null && prevVersion !== nextVersion) {
        events.push({
          link_code: code,
          event_type: "version_changed",
          old_value: { version: prevVersion },
          new_value: { version: nextVersion },
        });
      }
      if ((prevMod && f.moderationStatus && prevMod !== String(f.moderationStatus)) || (prevState && f.linkState && prevState !== String(f.linkState))) {
        events.push({
          link_code: code,
          event_type: "moderation_changed",
          old_value: { moderation_status: prevMod, link_state: prevState },
          new_value: { moderation_status: f.moderationStatus, link_state: f.linkState },
        });
      }

      updates.push({
        link_code: code,
        link_code_type: linkCodeType,
        namespace: f.namespace,
        link_type: f.linkType,
        account_id: f.accountId,
        creator_name: f.creatorName,
        support_code: f.supportCode,
        title: f.title,
        tagline: f.tagline,
        introduction: f.introduction,
        locale: f.locale,
        image_url: f.imageUrl,
        image_urls: f.imageUrls,
        extra_image_urls: f.extraImageUrls,
        video_vuid: f.videoVuid,
        max_players: f.maxPlayers,
        min_players: f.minPlayers,
        max_social_party_size: f.maxSocialPartySize,
        ratings: f.ratings,
        version: f.version,
        created_at_epic: f.createdAtEpic,
        published_at_epic: f.publishedAtEpic,
        updated_at_epic: f.updatedAtEpic,
        last_activated_at_epic: f.lastActivatedAtEpic,
        moderation_status: f.moderationStatus,
        link_state: f.linkState,
        discovery_intent: f.discoveryIntent,
        active: f.active,
        disabled: f.disabled,
        last_fetched_at: now.toISOString(),
        next_due_at: nextDue,
        last_error: null,
        locked_at: null,
        lock_id: null,
        // Persist selected canonical reference context used by resolver/UI.
        raw: mergedRaw,
        updated_at: now.toISOString(),
      });

      // Resolve related graph for collections/reference/set/playlist so Homebar-like containers can be expanded.
      if (linkCodeType === "collection") {
        try {
          const relatedRes = await fetchJson(
            `${EPIC_LINKS_MNEMONIC_RELATED_BASE}/${encodeURIComponent(code)}/related`,
            {
              method: "GET",
              headers: {
                Authorization: `Bearer ${auth.accessToken}`,
                Accept: "application/json",
              },
              timeoutMs: 20000,
            },
          );
          if (relatedRes.ok && relatedRes.json && typeof relatedRes.json === "object") {
            const parsed = parseRelatedPayload(code, relatedRes.json, now.toISOString());
            edgeMapByParent.set(code, parsed.edges);
            relatedFetchOk++;
            for (const row of parsed.metadataRows) {
              if (!row?.link_code || row.link_code === code) continue;
              relatedMetaMap.set(String(row.link_code), row);
            }
            for (const rc of parsed.discoveredCodes) {
              if (rc && rc !== code) relatedCodesToEnqueue.add(rc);
            }
            if (!parsed.edges.length) {
              const kind = classifyCollectionToken(code);
              unresolvedTokensByType.set(kind, (unresolvedTokensByType.get(kind) || 0) + 1);
            }
          } else {
            relatedFetchFailed++;
            const statusKey = String(relatedRes.status || 0);
            relatedFailuresByStatus.set(statusKey, (relatedFailuresByStatus.get(statusKey) || 0) + 1);
            const kind = classifyCollectionToken(code);
            unresolvedTokensByType.set(kind, (unresolvedTokensByType.get(kind) || 0) + 1);
            results.push({
              linkCode: code,
              relatedOk: false,
              relatedStatus: relatedRes.status,
              relatedCorrelationId: epicCorrelationIdFromHeaders(relatedRes.headers),
            });
          }
        } catch (_e) {
          relatedFetchFailed++;
          relatedFailuresByStatus.set("exception", (relatedFailuresByStatus.get("exception") || 0) + 1);
          const kind = classifyCollectionToken(code);
          unresolvedTokensByType.set(kind, (unresolvedTokensByType.get(kind) || 0) + 1);
          // Ignore related failures: base metadata still succeeded.
        }
      }

      results.push({ linkCode: code, ok: true, status: 200, correlationId, premiumNow: premiumNow.has(code) });

      // Write-back (islands only) for legacy cache consumers (best-effort).
      if (linkCodeType === "island") {
        try {
          await supabase
            .from("discover_islands_cache")
            .update({
              image_url: f.imageUrl,
              published_at_epic: f.publishedAtEpic,
              updated_at_epic: f.updatedAtEpic,
              moderation_status: f.moderationStatus,
              link_state: f.linkState,
              max_players: f.maxPlayers,
              min_players: f.minPlayers,
              last_metadata_fetch_at: now.toISOString(),
            })
            .eq("island_code", code);
        } catch (_e) {
          // ignore
        }
      }

      // Be nice to the upstream.
      await sleep(25);
    }

    // Write events then upsert metadata
    if (events.length) {
      for (let i = 0; i < events.length; i += 500) {
        await supabase.from("discover_link_metadata_events").insert(events.slice(i, i + 500));
      }
    }
    for (let i = 0; i < updates.length; i += 200) {
      const chunk = updates.slice(i, i + 200);
      const { error } = await supabase.from("discover_link_metadata").upsert(chunk, { onConflict: "link_code" });
      if (error) return json({ success: false, error: error.message }, 500);
    }

    // Opportunistically upsert metadata from /related payloads to speed up coverage.
    const relatedMetaRows = Array.from(relatedMetaMap.values());
    for (let i = 0; i < relatedMetaRows.length; i += 200) {
      const chunk = relatedMetaRows.slice(i, i + 200);
      const { error } = await supabase.from("discover_link_metadata").upsert(chunk, { onConflict: "link_code" });
      if (error) {
        // best-effort only
        console.warn("related metadata upsert warning:", error.message);
        break;
      }
    }

    // Keep link graph edges current for each processed parent.
    let edgesWritten = 0;
    for (const [parentCode, edges] of edgeMapByParent.entries()) {
      if (!edges.length) continue;
      try {
        const dbRows = edges.map((e) => ({
          parent_link_code: e.parent_link_code,
          child_link_code: e.child_link_code,
          edge_type: e.edge_type,
          sort_order: e.sort_order,
          first_seen_at: e.last_seen_at,
          last_seen_at: e.last_seen_at,
        }));
        console.log(`[edges] parent=${parentCode} rows=${dbRows.length} sample=${JSON.stringify(dbRows[0])}`);
        for (let i = 0; i < dbRows.length; i += 500) {
          const chunk = dbRows.slice(i, i + 500);
          const { data: edgeData, error: edgeErr, count: edgeCount, status: edgeStatus, statusText: edgeStatusText } = await supabase.from("discover_link_edges").upsert(chunk, {
            onConflict: "parent_link_code,child_link_code,edge_type",
          });
          console.log(`[edges] upsert status=${edgeStatus} statusText=${edgeStatusText} error=${edgeErr?.message || 'none'} data=${JSON.stringify(edgeData)}`);
          if (edgeErr) console.error("discover_link_edges upsert ERROR:", edgeErr.message);
          else edgesWritten += chunk.length;
        }
      } catch (e) {
        console.warn("discover_link_edges upsert warning:", e instanceof Error ? e.message : String(e));
      }
    }

    // Ensure discovered child codes get scheduled too.
    if (relatedCodesToEnqueue.size) {
      try {
        await supabase.rpc("enqueue_discover_link_metadata", {
          p_link_codes: Array.from(relatedCodesToEnqueue),
          p_due_within_minutes: 60,
        });
      } catch (_e) {
        // ignore
      }
    }

    // Keep command-center alerts fresh even when metadata collector is the active pipeline.
    try {
      await supabase.rpc("compute_system_alerts", {});
    } catch (_e) {
      // ignore
    }

    return json({
      success: true,
      mode,
      claimed: true,
      processed: updates.length,
      events: events.length,
      edges_parents: edgeMapByParent.size,
      related_meta_rows: relatedMetaRows.length,
      related_codes_enqueued: relatedCodesToEnqueue.size,
      related_fetch: {
        ok: relatedFetchOk,
        failed: relatedFetchFailed,
        failure_by_status: Object.fromEntries(relatedFailuresByStatus.entries()),
      },
      unresolved_collection_tokens: Object.fromEntries(unresolvedTokensByType.entries()),
      duration_ms: Date.now() - startedAt,
      sample: results.slice(0, 10),
    });
  } catch (e) {
    return json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
