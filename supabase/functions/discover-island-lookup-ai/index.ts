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
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};

const CODE_RE = /^\d{4}-\d{4}-\d{4}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PREWARM_CACHE_USER_ID =
  String(Deno.env.get("DISCOVERY_PREWARM_CACHE_USER_ID") || "00000000-0000-0000-0000-000000000000").trim();
const TOKEN_SUB_CACHE = new Map<string, { sub: string; expiresAt: number }>();

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

function json(res: unknown, status = 200) {
  return new Response(JSON.stringify(res), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function asNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toEpochMs(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
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

async function isServiceRoleRequest(req: Request, serviceKey: string, supabaseUrl: string): Promise<boolean> {
  const bearer = extractBearerToken(req);
  const apikey = String(req.headers.get("apikey") || "").trim();
  const token = bearer || apikey;
  if (!token) return false;
  if (token === serviceKey) return true;

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

function compactNum(v: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale || "en-US", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(asNum(v));
  } catch {
    return String(Math.round(asNum(v)));
  }
}

function percentDelta(current: number, baseline: number): number | null {
  const c = asNum(current);
  const b = asNum(baseline);
  if (b <= 0) return null;
  return ((c - b) / b) * 100;
}

function formatPercent(v: number | null, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "-";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(digits)}%`;
}

function titleOf(summary: any): string {
  return String(summary?.title || summary?.code || "island");
}

function isPt(locale: string): boolean {
  return String(locale || "").toLowerCase().startsWith("pt");
}

function weekTrendPercent(weeklyTail: any[]): number | null {
  if (!Array.isArray(weeklyTail) || weeklyTail.length < 2) return null;
  const last = asNum(weeklyTail[weeklyTail.length - 1]?.weekUnique);
  const prev = asNum(weeklyTail[weeklyTail.length - 2]?.weekUnique);
  return percentDelta(last, prev);
}

function looksGeneric(text: unknown): boolean {
  const t = String(text || "").trim().toLowerCase();
  if (!t) return true;
  if (t.includes("automated lookup insights generated")) return true;
  if (t === "no overview insight.") return true;
  if (t === "no discovery insight.") return true;
  if (t === "no history insight.") return true;
  if (t === "no competitors insight.") return true;
  if (t === "no events insight.") return true;
  return false;
}

function validActionsFromModel(actions: unknown): string[] | null {
  if (!Array.isArray(actions)) return null;
  const picked = actions
    .map((a) => String(a || "").trim())
    .filter((a) => a.length > 0)
    .slice(0, 3);
  if (picked.length < 3) return null;
  const joined = picked.join(" ").toLowerCase();
  if (
    joined.includes("review delta between unique players and plays") &&
    joined.includes("prioritize panels with higher minutes exposed")
  ) {
    return null;
  }
  return picked;
}

function buildDataDrivenInsights(primary: any, compare: any, locale: string) {
  const pt = isPt(locale);
  const aName = titleOf(primary);
  const bName = compare ? titleOf(compare) : null;

  const aUnique = asNum(primary?.unique7d);
  const aPlays = asNum(primary?.plays7d);
  const aMinutes = asNum(primary?.minutes7d);
  const aPeak = asNum(primary?.peakCcu7d);
  const aFav = asNum(primary?.favorites7d);
  const aRec = asNum(primary?.recommends7d);
  const aMpp = aUnique > 0 ? aMinutes / aUnique : 0;
  const aAdv = aUnique > 0 ? ((aFav + aRec) / aUnique) * 100 : 0;
  const aDiscPanels = asNum(primary?.discovery?.totalPanels);
  const aDiscMinutes = asNum(primary?.discovery?.totalMinutesExposed);
  const aBestRank = primary?.discovery?.bestRankGlobal;
  const aTrend = weekTrendPercent(primary?.weeklyTail || []);
  const aRank = primary?.competitorsRank;

  const bUnique = asNum(compare?.unique7d);
  const bPlays = asNum(compare?.plays7d);
  const bMinutes = asNum(compare?.minutes7d);
  const bPeak = asNum(compare?.peakCcu7d);
  const bFav = asNum(compare?.favorites7d);
  const bRec = asNum(compare?.recommends7d);
  const bMpp = bUnique > 0 ? bMinutes / bUnique : 0;
  const bAdv = bUnique > 0 ? ((bFav + bRec) / bUnique) * 100 : 0;
  const bDiscPanels = asNum(compare?.discovery?.totalPanels);
  const bDiscMinutes = asNum(compare?.discovery?.totalMinutesExposed);
  const bBestRank = compare?.discovery?.bestRankGlobal;
  const bTrend = weekTrendPercent(compare?.weeklyTail || []);
  const bRank = compare?.competitorsRank;

  const leaderByPlays = !compare || aPlays >= bPlays ? aName : bName;
  const lagByPlays = !compare || aPlays >= bPlays ? bName : aName;
  const playsGap = compare ? Math.abs(aPlays - bPlays) : 0;

  const summaryGlobal = compare
    ? pt
      ? `${leaderByPlays} lidera em plays 7d (${compactNum(Math.max(aPlays, bPlays), locale)}), com gap de ${compactNum(playsGap, locale)} vs ${lagByPlays}.`
      : `${leaderByPlays} leads 7d plays (${compactNum(Math.max(aPlays, bPlays), locale)}), with a ${compactNum(playsGap, locale)} gap vs ${lagByPlays}.`
    : pt
      ? `${aName}: ${compactNum(aUnique, locale)} unique, ${compactNum(aPlays, locale)} plays e pico de ${compactNum(aPeak, locale)} CCU em 7d.`
      : `${aName}: ${compactNum(aUnique, locale)} unique, ${compactNum(aPlays, locale)} plays and ${compactNum(aPeak, locale)} peak CCU in 7d.`;

  const overview = compare
    ? pt
      ? `${aName} vs ${bName}: unique ${compactNum(aUnique, locale)} vs ${compactNum(bUnique, locale)} (${formatPercent(percentDelta(aUnique, bUnique))}), plays ${compactNum(aPlays, locale)} vs ${compactNum(bPlays, locale)} (${formatPercent(percentDelta(aPlays, bPlays))}), minutos/player ${aMpp.toFixed(1)} vs ${bMpp.toFixed(1)}.`
      : `${aName} vs ${bName}: unique ${compactNum(aUnique, locale)} vs ${compactNum(bUnique, locale)} (${formatPercent(percentDelta(aUnique, bUnique))}), plays ${compactNum(aPlays, locale)} vs ${compactNum(bPlays, locale)} (${formatPercent(percentDelta(aPlays, bPlays))}), min/player ${aMpp.toFixed(1)} vs ${bMpp.toFixed(1)}.`
    : pt
      ? `${aName}: ${compactNum(aMinutes, locale)} minutos totais, ${aMpp.toFixed(1)} min/player e advocacy ${aAdv.toFixed(2)}%.`
      : `${aName}: ${compactNum(aMinutes, locale)} total minutes, ${aMpp.toFixed(1)} min/player and ${aAdv.toFixed(2)}% advocacy.`;

  const discovery = compare
    ? pt
      ? `Discovery: ${aName} (${aDiscPanels} paineis, ${compactNum(aDiscMinutes, locale)} min, best rank ${aBestRank ?? "-"}) vs ${bName} (${bDiscPanels} paineis, ${compactNum(bDiscMinutes, locale)} min, best rank ${bBestRank ?? "-"}).`
      : `Discovery: ${aName} (${aDiscPanels} panels, ${compactNum(aDiscMinutes, locale)} min, best rank ${aBestRank ?? "-"}) vs ${bName} (${bDiscPanels} panels, ${compactNum(bDiscMinutes, locale)} min, best rank ${bBestRank ?? "-"}).`
    : pt
      ? `Discovery: ${aDiscPanels} paineis com ${compactNum(aDiscMinutes, locale)} minutos expostos; melhor rank ${aBestRank ?? "-"}.`
      : `Discovery: ${aDiscPanels} panels with ${compactNum(aDiscMinutes, locale)} exposed minutes; best rank ${aBestRank ?? "-"}.`;

  const history = compare
    ? pt
      ? `Tendencia weekly unique: ${aName} ${formatPercent(aTrend)} WoW e ${bName} ${formatPercent(bTrend)} WoW (quando ha base suficiente).`
      : `Weekly unique trend: ${aName} ${formatPercent(aTrend)} WoW and ${bName} ${formatPercent(bTrend)} WoW (when enough baseline exists).`
    : pt
      ? `Tendencia weekly unique de ${aName}: ${formatPercent(aTrend)} WoW (com base nas ultimas semanas disponiveis).`
      : `${aName} weekly unique trend: ${formatPercent(aTrend)} WoW (using latest available weeks).`;

  const competitors = compare
    ? pt
      ? `Ranking composto: ${aName} rank ${aRank ?? "-"} e ${bName} rank ${bRank ?? "fora da coorte"} no filtro atual de coorte.`
      : `Composite ranking: ${aName} rank ${aRank ?? "-"} and ${bName} rank ${bRank ?? "outside cohort"} under the current cohort filter.`
    : pt
      ? `Ranking composto atual: ${aName} rank ${aRank ?? "-"}.`
      : `Current composite ranking: ${aName} rank ${aRank ?? "-"}.`;

  const aLastEvent = primary?.latestEventTs ? String(primary.latestEventTs) : null;
  const bLastEvent = compare?.latestEventTs ? String(compare.latestEventTs) : null;
  const events = compare
    ? pt
      ? `Ultimas atualizacoes relevantes: ${aName} ${aLastEvent || "sem evento recente"}; ${bName} ${bLastEvent || "sem evento recente"}.`
      : `Latest meaningful updates: ${aName} ${aLastEvent || "no recent event"}; ${bName} ${bLastEvent || "no recent event"}.`
    : pt
      ? `Ultima atualizacao relevante de ${aName}: ${aLastEvent || "sem evento recente no periodo"}`
      : `Latest meaningful update for ${aName}: ${aLastEvent || "no recent event in this window"}.`;

  const actionsTop3 = compare
    ? pt
      ? [
          `Fechar gap de plays: diferenca atual de ${compactNum(playsGap, locale)} em 7d entre ${aName} e ${bName}.`,
          `Priorizar paineis Discovery com melhor rank: hoje ${aName}=${aBestRank ?? "-"} e ${bName}=${bBestRank ?? "-"}.`,
          `Usar Atualizacoes para correlacionar mudancas de thumbnail/version com variacao de unique e plays.`,
        ]
      : [
          `Close the plays gap: current 7d delta is ${compactNum(playsGap, locale)} between ${aName} and ${bName}.`,
          `Prioritize Discovery panels with stronger rank: now ${aName}=${aBestRank ?? "-"} and ${bName}=${bBestRank ?? "-"}.`,
          `Use Updates to correlate thumbnail/version changes with unique and plays shifts.`,
        ]
    : pt
      ? [
          `Elevar plays por unique: baseline atual de ${aMpp.toFixed(1)} min/player e advocacy ${aAdv.toFixed(2)}%.`,
          `Ganhar mais minutos de Discovery: ${aDiscPanels} paineis e ${compactNum(aDiscMinutes, locale)} min expostos.`,
          `Monitorar Atualizacoes relevantes para validar impacto de mudancas de metadata no desempenho.`,
        ]
      : [
          `Increase plays per unique: current baseline is ${aMpp.toFixed(1)} min/player with ${aAdv.toFixed(2)}% advocacy.`,
          `Grow Discovery minutes: ${aDiscPanels} panels and ${compactNum(aDiscMinutes, locale)} exposed minutes.`,
          `Track meaningful updates to validate metadata-change impact on performance.`,
        ];

  return {
    summaryGlobal,
    sections: { overview, discovery, history, competitors, events },
    actionsTop3,
  };
}

function stripCodeFences(raw: string): string {
  const text = String(raw || "").trim();
  if (!text.startsWith("```") || !text.endsWith("```")) return text;
  return text.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "").trim();
}

function summarizeLookupPayload(payload: any) {
  const daily = payload?.dailyMetrics;
  const sumMetric = (key: string) => {
    if (!daily?.[key]) return 0;
    return (daily[key] as any[]).reduce((acc, row) => acc + asNum(row?.value), 0);
  };
  const maxMetric = (key: string) => {
    if (!daily?.[key]) return 0;
    return Math.max(0, ...(daily[key] as any[]).map((row) => asNum(row?.value)));
  };

  const events = payload?.eventsV2?.meaningful || payload?.metadataEvents || [];

  return {
    code: payload?.metadata?.code || null,
    title: payload?.metadata?.title || null,
    creator: payload?.metadata?.creatorCode || null,
    category: payload?.metadata?.category || null,
    tags: payload?.metadata?.tags || [],
    unique7d: sumMetric("uniquePlayers"),
    plays7d: sumMetric("plays"),
    minutes7d: sumMetric("minutesPlayed"),
    peakCcu7d: maxMetric("peakCCU"),
    favorites7d: sumMetric("favorites"),
    recommends7d: sumMetric("recommendations"),
    discovery: payload?.discoverySignalsV2?.summary || null,
    weeklyTail: (payload?.weeklyPerformance || []).slice(-6),
    competitorsRank: payload?.competitorsV2?.primaryIslandRank || null,
    latestEventTs: events?.[0]?.ts || null,
  };
}

async function getRecentLookups(service: any, userId: string) {
  const { data } = await service
    .from("discover_lookup_ai_recent")
    .select("primary_code,compare_code,primary_title,compare_title,created_at,last_accessed_at,hit_count")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(3);

  return (data || []).map((row: any) => ({
    primaryCode: row.primary_code,
    compareCode: row.compare_code || "",
    primaryTitle: row.primary_title || null,
    compareTitle: row.compare_title || null,
    createdAt: row.created_at,
    lastAccessedAt: row.last_accessed_at,
    hitCount: asNum(row.hit_count),
  }));
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

function normalizeSummaryInput(input: any, expectedCode: string): any | null {
  if (!input || typeof input !== "object") return null;
  const code = String((input as any)?.code || "").trim();
  if (!code || code !== expectedCode) return null;
  return {
    code,
    title: (input as any)?.title || null,
    creator: (input as any)?.creator || null,
    category: (input as any)?.category || null,
    tags: Array.isArray((input as any)?.tags) ? (input as any).tags : [],
    unique7d: asNum((input as any)?.unique7d),
    plays7d: asNum((input as any)?.plays7d),
    minutes7d: asNum((input as any)?.minutes7d),
    peakCcu7d: asNum((input as any)?.peakCcu7d),
    favorites7d: asNum((input as any)?.favorites7d),
    recommends7d: asNum((input as any)?.recommends7d),
    discovery: (input as any)?.discovery || null,
    weeklyTail: Array.isArray((input as any)?.weeklyTail) ? (input as any).weeklyTail : [],
    competitorsRank: (input as any)?.competitorsRank ?? null,
    latestEventTs: (input as any)?.latestEventTs || null,
  };
}

function isEnrichedPayload(payload: any): boolean {
  if (!payload || typeof payload !== "object") return false;
  const phase = String(payload?.phase || "").trim();
  if (phase === "enriched") return true;
  // Backward compatibility: old cached rows without explicit phase are enriched final payloads.
  return Boolean(payload?.sections && payload?.actionsTop3);
}

function isBaselinePayload(payload: any): boolean {
  if (!payload || typeof payload !== "object") return false;
  return String(payload?.phase || "").trim() === "baseline";
}

function normalizeEnrichedPayload(parsed: any, fallback: any) {
  const modelActions = validActionsFromModel(parsed?.actionsTop3);
  return {
    summaryGlobal: looksGeneric(parsed?.summaryGlobal) ? fallback.summaryGlobal : String(parsed.summaryGlobal),
    sections: {
      overview: looksGeneric(parsed?.sections?.overview)
        ? fallback.sections.overview
        : String(parsed.sections.overview),
      discovery: looksGeneric(parsed?.sections?.discovery)
        ? fallback.sections.discovery
        : String(parsed.sections.discovery),
      history: looksGeneric(parsed?.sections?.history)
        ? fallback.sections.history
        : String(parsed.sections.history),
      competitors: looksGeneric(parsed?.sections?.competitors)
        ? fallback.sections.competitors
        : String(parsed.sections.competitors),
      events: looksGeneric(parsed?.sections?.events)
        ? fallback.sections.events
        : String(parsed.sections.events),
    },
    actionsTop3: modelActions ?? fallback.actionsTop3,
    phase: "enriched",
    enriching: false,
  };
}

function withPhaseDefaults(payload: any) {
  if (!payload || typeof payload !== "object") return payload;
  const phase = isEnrichedPayload(payload) ? "enriched" : "baseline";
  return {
    ...payload,
    phase,
    enriching: phase === "baseline" ? Boolean((payload as any)?.enriching ?? true) : false,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const startedAt = Date.now();

  try {
    const internalBridge = isInternalBridgeRequest(req);
    const authHeader = req.headers.get("Authorization") || "";
    const forwardedAuthHeader = req.headers.get("x-forwarded-authorization") || "";
    const userAuthHeader = internalBridge ? forwardedAuthHeader : authHeader;

    const sbUrl = Deno.env.get("SUPABASE_URL")!;
    const sbAnon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const sbService = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    let userId = "";
    let serviceRoleMode = false;
    if (internalBridge) {
      const forwardedUserId = String(req.headers.get("x-forwarded-user-id") || "").trim();
      if (!UUID_RE.test(forwardedUserId)) return json({ error: "Unauthorized" }, 401);
      userId = forwardedUserId;
    } else {
      if (!userAuthHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
      serviceRoleMode = await isServiceRoleRequest(req, sbService, sbUrl);
      if (serviceRoleMode) {
        userId = PREWARM_CACHE_USER_ID;
      } else {
        const token = userAuthHeader.replace("Bearer ", "");
        const cachedSub = getCachedSub(token);
        if (cachedSub) {
          userId = cachedSub;
        } else {
          const userClient = createClient(sbUrl, sbAnon, { global: { headers: { Authorization: userAuthHeader } } });
          const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
          if (claimsError || !claimsData?.claims) return json({ error: "Unauthorized" }, 401);
          userId = String(claimsData?.claims?.sub || "").trim();
          if (userId) cacheSub(token, userId);
        }
        if (!userId) return json({ error: "Unauthorized" }, 401);
      }
    }

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }
    const mode = String(body?.mode || "").trim().toLowerCase();
    const includeRecent = !serviceRoleMode && body?.includeRecent !== false;

    if (shouldProxyToData(req)) {
      const proxied = await invokeDataFunction({
        req,
        functionName: "discover-island-lookup-ai",
        body,
        timeoutMs: getEnvNumber("LOOKUP_DATA_TIMEOUT_MS", 10000),
        extraHeaders: userId ? { "x-forwarded-user-id": userId } : undefined,
      });
      const timing = [
        `total;dur=${(Date.now() - startedAt).toFixed(1)}`,
        `bridge;dur=${Number(proxied.bridgeMs || 0).toFixed(1)}`,
        String(proxied.upstreamServerTiming || "").trim(),
      ].filter(Boolean).join(", ");
      if (proxied.ok) return dataProxyResponse(proxied.data, proxied.status, { ...corsHeaders, "Server-Timing": timing });
      if (proxied.status >= 400 && proxied.status < 500 && proxied.data) {
        return dataProxyResponse(proxied.data, proxied.status, { ...corsHeaders, "Server-Timing": timing });
      }
      return dataBridgeUnavailableResponse({ ...corsHeaders, "Server-Timing": timing }, proxied.error);
    }

    if (shouldBlockLocalExecution(req)) {
      return dataBridgeUnavailableResponse(
        { ...corsHeaders, "Server-Timing": `total;dur=${(Date.now() - startedAt).toFixed(1)}` },
        "strict proxy mode",
      );
    }

    const service = createClient(sbUrl, sbService);

    if (mode === "recent") {
      if (serviceRoleMode) return json({ recentLookups: [] });
      const recentLookups = await getRecentLookups(service, userId);
      return json({ recentLookups });
    }

    const primaryCode = String(body?.primaryCode || "").trim();
    const compareCode = String(body?.compareCode || "").trim();
    const locale = String(body?.locale || "pt-BR").trim() || "pt-BR";
    const windowDays = Math.max(1, Math.min(90, Number(body?.windowDays) || 7));
    let payloadFingerprint = String(body?.payloadFingerprint || "").trim();
    if (!payloadFingerprint && serviceRoleMode) {
      const now = new Date();
      const minuteBucket = Math.floor(now.getUTCMinutes() / 5) * 5;
      now.setUTCMinutes(minuteBucket, 0, 0);
      const bucket = now.toISOString().slice(0, 16); // 5-minute bucket
      payloadFingerprint = `prewarm:${primaryCode}:${compareCode || "-"}:${bucket}`;
    }

    if (!primaryCode || !payloadFingerprint || !CODE_RE.test(primaryCode)) {
      return json({ error: "Invalid payload" }, 400);
    }
    if (compareCode && !CODE_RE.test(compareCode)) {
      return json({ error: "Invalid compareCode" }, 400);
    }

    const compareKey = compareCode || "";

    const { data: cachedRow } = await service
      .from("discover_lookup_ai_recent")
      .select("id,response_json,created_at,hit_count")
      .eq("user_id", userId)
      .eq("primary_code", primaryCode)
      .eq("compare_code", compareKey)
      .eq("locale", locale)
      .eq("window_days", windowDays)
      .eq("payload_fingerprint", payloadFingerprint)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const nvidiaKey = Deno.env.get("NVIDIA_API_KEY");
    const { data: sharedRows } = await service
      .from("discover_lookup_ai_recent")
      .select("id,user_id,response_json,created_at")
      .eq("primary_code", primaryCode)
      .eq("compare_code", compareKey)
      .eq("locale", locale)
      .eq("window_days", windowDays)
      .eq("payload_fingerprint", payloadFingerprint)
      .order("created_at", { ascending: false })
      .limit(5);

    const sharedList = Array.isArray(sharedRows) ? sharedRows : [];
    const enrichedShared = sharedList.find((r: any) => isEnrichedPayload(r?.response_json));
    const activeBaseline = sharedList.find((r: any) => isBaselinePayload(r?.response_json) && Boolean((r?.response_json as any)?.enriching));
    const normalizedCached = cachedRow?.response_json ? withPhaseDefaults(cachedRow.response_json) : null;

    const hotWindowSeconds = Math.max(60, getEnvNumber("LOOKUP_AI_SHARED_HOT_WINDOW_SECONDS", 15 * 60));
    let sharedHotRows: any[] = [];
    if (!enrichedShared && !activeBaseline) {
      const { data: hotRows } = await service
        .from("discover_lookup_ai_recent")
        .select("id,user_id,response_json,created_at,payload_fingerprint")
        .eq("primary_code", primaryCode)
        .eq("compare_code", compareKey)
        .eq("locale", locale)
        .eq("window_days", windowDays)
        .order("created_at", { ascending: false })
        .limit(8);
      sharedHotRows = Array.isArray(hotRows) ? hotRows : [];
    }
    const hotThresholdMs = Date.now() - hotWindowSeconds * 1000;
    const enrichedSharedHot = sharedHotRows.find((r: any) => {
      const createdMs = toEpochMs(r?.created_at);
      return createdMs != null && createdMs >= hotThresholdMs && isEnrichedPayload(r?.response_json);
    });
    const baselineSharedHot = sharedHotRows.find((r: any) => {
      const createdMs = toEpochMs(r?.created_at);
      return createdMs != null && createdMs >= hotThresholdMs && isBaselinePayload(r?.response_json);
    });

    if (normalizedCached && isEnrichedPayload(normalizedCached)) {
      const recentLookups = includeRecent ? await getRecentLookups(service, userId) : [];
      runInBackground(
        service
          .from("discover_lookup_ai_recent")
          .update({
            hit_count: asNum(cachedRow.hit_count) + 1,
            last_accessed_at: new Date().toISOString(),
          })
          .eq("id", cachedRow.id),
      );
      return json({
        cacheHit: true,
        generatedAt: cachedRow.created_at,
        recentLookups,
        ...normalizedCached,
      });
    }

    if (enrichedShared?.response_json) {
      const normalizedShared = withPhaseDefaults(enrichedShared.response_json);
      const nowIso = new Date().toISOString();
      runInBackground(
        service
          .from("discover_lookup_ai_recent")
          .upsert(
            {
              user_id: userId,
              primary_code: primaryCode,
              compare_code: compareKey,
              primary_title: String((normalizedShared as any)?.summaryGlobal || primaryCode).slice(0, 160),
              compare_title: compareKey || null,
              locale,
              window_days: windowDays,
              payload_fingerprint: payloadFingerprint,
              response_json: normalizedShared,
              created_at: nowIso,
              last_accessed_at: nowIso,
              hit_count: asNum(cachedRow?.hit_count) + 1,
            },
            { onConflict: "user_id,primary_code,compare_code,locale,window_days,payload_fingerprint" },
          ),
      );
      const recentLookups = includeRecent ? await getRecentLookups(service, userId) : [];
      return json({
        cacheHit: true,
        generatedAt: enrichedShared.created_at,
        recentLookups,
        ...normalizedShared,
      });
    }

    if (enrichedSharedHot?.response_json) {
      const normalizedHot = withPhaseDefaults(enrichedSharedHot.response_json);
      const nowIso = new Date().toISOString();
      runInBackground(
        service
          .from("discover_lookup_ai_recent")
          .upsert(
            {
              user_id: userId,
              primary_code: primaryCode,
              compare_code: compareKey,
              primary_title: String((normalizedHot as any)?.summaryGlobal || primaryCode).slice(0, 160),
              compare_title: compareKey || null,
              locale,
              window_days: windowDays,
              payload_fingerprint: payloadFingerprint,
              response_json: normalizedHot,
              created_at: nowIso,
              last_accessed_at: nowIso,
              hit_count: asNum(cachedRow?.hit_count) + 1,
            },
            { onConflict: "user_id,primary_code,compare_code,locale,window_days,payload_fingerprint" },
          ),
      );
      const recentLookups = includeRecent ? await getRecentLookups(service, userId) : [];
      return json({
        cacheHit: true,
        generatedAt: enrichedSharedHot.created_at,
        sharedHot: true,
        recentLookups,
        ...normalizedHot,
      });
    }

    if (baselineSharedHot?.response_json) {
      const baselineHot = withPhaseDefaults(baselineSharedHot.response_json);
      const safeBaseline = {
        ...baselineHot,
        phase: "baseline",
        enriching: false,
      };
      const nowIso = new Date().toISOString();
      runInBackground(
        service
          .from("discover_lookup_ai_recent")
          .upsert(
            {
              user_id: userId,
              primary_code: primaryCode,
              compare_code: compareKey,
              primary_title: String((safeBaseline as any)?.summaryGlobal || primaryCode).slice(0, 160),
              compare_title: compareKey || null,
              locale,
              window_days: windowDays,
              payload_fingerprint: payloadFingerprint,
              response_json: safeBaseline,
              created_at: nowIso,
              last_accessed_at: nowIso,
              hit_count: asNum(cachedRow?.hit_count) + 1,
            },
            { onConflict: "user_id,primary_code,compare_code,locale,window_days,payload_fingerprint" },
          ),
      );
      const recentLookups = includeRecent ? await getRecentLookups(service, userId) : [];
      return json({
        cacheHit: true,
        generatedAt: baselineSharedHot.created_at,
        sharedHot: true,
        recentLookups,
        ...safeBaseline,
      });
    }

    const lookupEndpoint = `${sbUrl}/functions/v1/discover-island-lookup`;
    const callLookup = async (islandCode: string, compareIslandCode = "") => {
      const res = await fetch(lookupEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: serviceRoleMode ? `Bearer ${sbService}` : userAuthHeader,
          apikey: serviceRoleMode ? sbService : sbAnon,
        },
        body: JSON.stringify({ islandCode, compareCode: compareIslandCode || null }),
      });
      const raw = await res.text();
      const parsed = raw ? JSON.parse(raw) : null;
      if (!res.ok || parsed?.error) {
        throw new Error(parsed?.error || `lookup failed (${res.status})`);
      }
      return parsed;
    };

    let primarySummary = normalizeSummaryInput(body?.primarySummary, primaryCode);
    let compareSummary = compareCode ? normalizeSummaryInput(body?.compareSummary, compareCode) : null;

    if (!primarySummary || (compareCode && !compareSummary)) {
      const [primaryPayload, comparePayload] = await Promise.all([
        !primarySummary ? callLookup(primaryCode, compareCode) : Promise.resolve(null),
        compareCode && !compareSummary ? callLookup(compareCode, primaryCode) : Promise.resolve(null),
      ]);
      if (!primarySummary && primaryPayload) primarySummary = summarizeLookupPayload(primaryPayload);
      if (compareCode && !compareSummary && comparePayload) compareSummary = summarizeLookupPayload(comparePayload);
    }

    if (!primarySummary) {
      return json({ error: "Unable to build primary summary" }, 502);
    }

    const fallback = buildDataDrivenInsights(primarySummary, compareSummary, locale);
    const baselinePayload = {
      ...fallback,
      phase: "baseline",
      enriching: Boolean(nvidiaKey),
    };

    const nowIso = new Date().toISOString();
    runInBackground(
      service
        .from("discover_lookup_ai_recent")
        .upsert(
          {
            user_id: userId,
            primary_code: primaryCode,
            compare_code: compareKey,
            primary_title: primarySummary?.title || primaryCode,
            compare_title: compareSummary?.title || (compareKey ? compareKey : null),
            locale,
            window_days: windowDays,
            payload_fingerprint: payloadFingerprint,
            response_json: baselinePayload,
            created_at: nowIso,
            last_accessed_at: nowIso,
            hit_count: asNum(cachedRow?.hit_count),
          },
          { onConflict: "user_id,primary_code,compare_code,locale,window_days,payload_fingerprint" },
        ),
    );

    const aiCacheKeepLimit = serviceRoleMode
      ? Math.max(50, getEnvNumber("LOOKUP_AI_SHARED_CACHE_KEEP", 200))
      : 3;

    runInBackground((async () => {
      const { data: keepRows } = await service
        .from("discover_lookup_ai_recent")
        .select("id")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(aiCacheKeepLimit);

      const keepIds = (keepRows || []).map((r: any) => asNum(r.id)).filter((v) => v > 0);
      if (keepIds.length > 0) {
        await service
          .from("discover_lookup_ai_recent")
          .delete()
          .eq("user_id", userId)
          .not("id", "in", `(${keepIds.join(",")})`);
      }
    })());

    const hasInFlight = Boolean(activeBaseline);
    const shouldKickEnrichment = Boolean(nvidiaKey) && !hasInFlight;

    if (shouldKickEnrichment && nvidiaKey) {
      runInBackground((async () => {
        try {
          const systemPrompt =
            "You are a Fortnite island analytics strategist. Return only valid JSON with keys: summaryGlobal, sections{overview,discovery,history,competitors,events}, actionsTop3 (3 concise actions). Use concrete metrics from payload and avoid placeholders such as 'No ... insight'.";

          const userPrompt = JSON.stringify(
            {
              locale,
              windowDays,
              primary: primarySummary,
              compare: compareSummary,
            },
            null,
            2,
          );

          const model = Deno.env.get("NVIDIA_LOOKUP_MODEL") || "moonshotai/kimi-k2.5";
          const nvidiaEndpoint = Deno.env.get("NVIDIA_CHAT_COMPLETIONS_URL") || "https://integrate.api.nvidia.com/v1/chat/completions";

          const aiRes = await fetch(nvidiaEndpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${nvidiaKey}`,
            },
            body: JSON.stringify({
              model,
              stream: false,
              temperature: 0.2,
              top_p: 0.9,
              max_tokens: 1600,
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt },
              ],
            }),
          });

          const aiRaw = await aiRes.text();
          if (!aiRes.ok) throw new Error(`NVIDIA error ${aiRes.status}: ${aiRaw.slice(0, 300)}`);

          const aiJson = aiRaw ? JSON.parse(aiRaw) : {};
          const content = stripCodeFences(String(aiJson?.choices?.[0]?.message?.content || ""));

          let parsed: any = null;
          try {
            parsed = content ? JSON.parse(content) : null;
          } catch {
            parsed = null;
          }

          const enrichedPayload = normalizeEnrichedPayload(parsed, fallback);
          const enrichedNow = new Date().toISOString();
          await service
            .from("discover_lookup_ai_recent")
            .upsert(
              {
                user_id: userId,
                primary_code: primaryCode,
                compare_code: compareKey,
                primary_title: primarySummary?.title || primaryCode,
                compare_title: compareSummary?.title || (compareKey ? compareKey : null),
                locale,
                window_days: windowDays,
                payload_fingerprint: payloadFingerprint,
                response_json: enrichedPayload,
                created_at: enrichedNow,
                last_accessed_at: enrichedNow,
                hit_count: asNum(cachedRow?.hit_count),
              },
              { onConflict: "user_id,primary_code,compare_code,locale,window_days,payload_fingerprint" },
            );
        } catch {
          // Keep baseline available; mark enrichment as not running.
          await service
            .from("discover_lookup_ai_recent")
            .upsert(
              {
                user_id: userId,
                primary_code: primaryCode,
                compare_code: compareKey,
                primary_title: primarySummary?.title || primaryCode,
                compare_title: compareSummary?.title || (compareKey ? compareKey : null),
                locale,
                window_days: windowDays,
                payload_fingerprint: payloadFingerprint,
                response_json: {
                  ...baselinePayload,
                  enriching: false,
                },
                created_at: new Date().toISOString(),
                last_accessed_at: new Date().toISOString(),
                hit_count: asNum(cachedRow?.hit_count),
              },
              { onConflict: "user_id,primary_code,compare_code,locale,window_days,payload_fingerprint" },
            );
        }
      })());
    }

    const recentLookups = includeRecent ? await getRecentLookups(service, userId) : [];
    return json({
      cacheHit: Boolean(cachedRow),
      generatedAt: nowIso,
      recentLookups,
      ...baselinePayload,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: message || "Unknown error" }, 500);
  }
});




