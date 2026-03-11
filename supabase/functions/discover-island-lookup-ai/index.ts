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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const forwardedAuthHeader = req.headers.get("x-forwarded-authorization") || "";
    const userAuthHeader = isInternalBridgeRequest(req) ? forwardedAuthHeader : authHeader;
    if (!userAuthHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const sbUrl = Deno.env.get("SUPABASE_URL")!;
    const sbAnon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const sbService = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(sbUrl, sbAnon, { global: { headers: { Authorization: userAuthHeader } } });
    const token = userAuthHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) return json({ error: "Unauthorized" }, 401);
    const userId = String(claimsData?.claims?.sub || "").trim();
    if (!userId) return json({ error: "Unauthorized" }, 401);

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }
    const mode = String(body?.mode || "").trim().toLowerCase();

    if (shouldProxyToData(req)) {
      const proxied = await invokeDataFunction({
        req,
        functionName: "discover-island-lookup-ai",
        body,
        timeoutMs: getEnvNumber("LOOKUP_DATA_TIMEOUT_MS", 10000),
      });
      if (proxied.ok) return dataProxyResponse(proxied.data, proxied.status, corsHeaders);
      return dataBridgeUnavailableResponse(corsHeaders, proxied.error);
    }

    if (shouldBlockLocalExecution(req)) {
      return dataBridgeUnavailableResponse(corsHeaders, "strict proxy mode");
    }

    const service = createClient(sbUrl, sbService);

    if (mode === "recent") {
      const recentLookups = await getRecentLookups(service, userId);
      return json({ recentLookups });
    }

    const primaryCode = String(body?.primaryCode || "").trim();
    const compareCode = String(body?.compareCode || "").trim();
    const locale = String(body?.locale || "pt-BR").trim() || "pt-BR";
    const windowDays = Math.max(1, Math.min(90, Number(body?.windowDays) || 7));
    const payloadFingerprint = String(body?.payloadFingerprint || "").trim();

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

    if (cachedRow?.response_json) {
      await service
        .from("discover_lookup_ai_recent")
        .update({
          hit_count: asNum(cachedRow.hit_count) + 1,
          last_accessed_at: new Date().toISOString(),
        })
        .eq("id", cachedRow.id);

      const recentLookups = await getRecentLookups(service, userId);
      return json({
        cacheHit: true,
        generatedAt: cachedRow.created_at,
        recentLookups,
        ...(cachedRow.response_json as Record<string, unknown>),
      });
    }

    const nvidiaKey = Deno.env.get("NVIDIA_API_KEY");
    if (!nvidiaKey) {
      return json({ error: "Lookup AI unavailable: NVIDIA_API_KEY missing" }, 503);
    }

    const lookupEndpoint = `${sbUrl}/functions/v1/discover-island-lookup`;
    const callLookup = async (islandCode: string, compareIslandCode = "") => {
      const res = await fetch(lookupEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: userAuthHeader,
          apikey: sbAnon,
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

    const [primaryPayload, comparePayload] = await Promise.all([
      callLookup(primaryCode, compareCode),
      compareCode ? callLookup(compareCode, primaryCode) : Promise.resolve(null),
    ]);

    const primarySummary = summarizeLookupPayload(primaryPayload);
    const compareSummary = comparePayload ? summarizeLookupPayload(comparePayload) : null;

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
    if (!aiRes.ok) {
      return json({ error: `NVIDIA error ${aiRes.status}: ${aiRaw.slice(0, 300)}` }, 502);
    }

    const aiJson = aiRaw ? JSON.parse(aiRaw) : {};
    const content = stripCodeFences(String(aiJson?.choices?.[0]?.message?.content || ""));

    let parsed: any = null;
    try {
      parsed = content ? JSON.parse(content) : null;
    } catch {
      parsed = null;
    }

    const fallback = buildDataDrivenInsights(primarySummary, compareSummary, locale);
    const modelActions = validActionsFromModel(parsed?.actionsTop3);
    const normalized = {
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
    };

    const createdAt = new Date();

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
          response_json: normalized,
          created_at: createdAt.toISOString(),
          last_accessed_at: createdAt.toISOString(),
          hit_count: 0,
        },
        { onConflict: "user_id,primary_code,compare_code,locale,window_days,payload_fingerprint" },
      );

    const { data: keepRows } = await service
      .from("discover_lookup_ai_recent")
      .select("id")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(3);

    const keepIds = (keepRows || []).map((r: any) => asNum(r.id)).filter((v) => v > 0);
    if (keepIds.length > 0) {
      await service
        .from("discover_lookup_ai_recent")
        .delete()
        .eq("user_id", userId)
        .not("id", "in", `(${keepIds.join(",")})`);
    }

    const recentLookups = await getRecentLookups(service, userId);
    return json({
      cacheHit: false,
      generatedAt: createdAt.toISOString(),
      recentLookups,
      ...normalized,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: message || "Unknown error" }, 500);
  }
});




