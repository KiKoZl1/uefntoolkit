import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPPORTED_LOCALES = ["pt-BR"] as const;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (authHeader !== `Bearer ${serviceKey}`) {
      return new Response(JSON.stringify({ error: "Forbidden: service_role required" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { reportId } = await req.json();
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!reportId || !UUID_REGEX.test(reportId)) {
      return new Response(JSON.stringify({ error: "Invalid reportId format" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

    const { data: report, error } = await supabase
      .from("discover_reports")
      .select("*")
      .eq("id", reportId)
      .single();

    if (error || !report) throw new Error("Report not found");

    const kpis = report.platform_kpis;
    const rankings = report.computed_rankings;

    const { data: weeklyRow } = await supabase
      .from("weekly_reports")
      .select("rankings_json,date_from,date_to")
      .eq("discover_report_id", reportId)
      .maybeSingle();

    const weeklyRankingsJson = (weeklyRow as any)?.rankings_json || null;
    const evidence = weeklyRankingsJson?.evidence || null;
    const exposure = weeklyRankingsJson?.discoveryExposure || null;
    const exposureSummary = buildExposureSummary(exposure, weeklyRow);

    const evidenceSummary = evidence ? JSON.stringify(evidence, null, 0) : null;
    const rankingsSummary = JSON.stringify({
      baselineAvailable: Boolean((kpis as any)?.baselineAvailable),
      topNewIslandsByPlaysPublished: (rankings as any)?.topNewIslandsByPlaysPublished?.slice?.(0, 10) || [],
      topNewIslandsByPlayersPublished: (rankings as any)?.topNewIslandsByPlayersPublished?.slice?.(0, 10) || [],
      mostUpdatedIslandsThisWeek: (rankings as any)?.mostUpdatedIslandsThisWeek?.slice?.(0, 20) || [],
      deadIslandsByUniqueDrop: (rankings as any)?.deadIslandsByUniqueDrop?.slice?.(0, 10) || [],
      topRisers: (rankings as any)?.topRisers?.slice?.(0, 10) || [],
      topDecliners: (rankings as any)?.topDecliners?.slice?.(0, 10) || [],
    }, null, 0);
    const baselineAvailable = Boolean((kpis as any)?.baselineAvailable) || kpis.wowTotalPlays != null;

    const wowContext = kpis.wowTotalPlays != null
      ? `\n## Week-over-Week Changes
- Total Plays: ${kpis.wowTotalPlays?.toFixed(1)}% WoW
- Total Players: ${kpis.wowTotalPlayers?.toFixed(1)}% WoW
- Total Minutes: ${kpis.wowTotalMinutes?.toFixed(1)}% WoW
- Active Islands: ${kpis.wowActiveIslands?.toFixed(1)}% WoW
- New Maps delta: ${kpis.wowNewMaps > 0 ? '+' : ''}${kpis.wowNewMaps}
- New Creators delta: ${kpis.wowNewCreators > 0 ? '+' : ''}${kpis.wowNewCreators}`
      : '';

    const lifecycleBlock = baselineAvailable
      ? `
## Island Lifecycle
- **${kpis.revivedCount || 0}** islands revived (were suppressed, now active again)
- **${kpis.deadCount || 0}** islands died (were active, now suppressed)
- Top Risers (biggest WoW play increase): ${JSON.stringify(rankings.topRisers?.slice(0, 5) || [])}
- Top Decliners (biggest WoW play decrease): ${JSON.stringify(rankings.topDecliners?.slice(0, 5) || [])}
- Breakouts (suppressed → top reported): ${JSON.stringify(rankings.breakouts?.slice(0, 5) || [])}
- Revived Islands: ${JSON.stringify(rankings.revivedIslands?.slice(0, 5) || [])}
- Dead Islands: ${JSON.stringify(rankings.deadIslands?.slice(0, 5) || [])}`
      : `
## Island Lifecycle
- Baseline not available yet for WoW/lifecycle movers (N/A on the first report).`;

    const prompt = `You are a senior Fortnite Discovery ecosystem analyst writing a comprehensive weekly trends report (Week ${report.week_number}, ${report.year}). You are writing for island creators and game developers who want actionable insights.

## Data Available
- **${kpis.totalIslands}** total islands analyzed, **${kpis.activeIslands}** active (5+ players)
- **${kpis.newMapsThisWeek || 0}** new maps this week, **${kpis.newCreatorsThisWeek || 0}** new creators
- New maps by Epic publish date (Links metadata): ${((kpis as any).newMapsThisWeekPublished ?? "N/A")}
- Baseline available for WoW/lifecycle: ${baselineAvailable ? "yes" : "no"}
- Metadata coverage (title/image): ${JSON.stringify((kpis as any).metadataCoverage || null)}
- **${kpis.failedIslands || 0}** islands with <500 unique players (low performance)
- Total Plays: ${kpis.totalPlays}, Total Players: ${kpis.totalUniquePlayers}
- Total Minutes: ${kpis.totalMinutesPlayed}, Avg Duration: ${kpis.avgPlayDuration?.toFixed(1)} min
- Avg D1 Retention: ${((kpis.avgRetentionD1 || 0) * 100).toFixed(1)}%, Avg D7: ${((kpis.avgRetentionD7 || 0) * 100).toFixed(1)}%
- Fav-to-Play: ${((kpis.favToPlayRatio || 0) * 100).toFixed(2)}%, Rec-to-Play: ${((kpis.recToPlayRatio || 0) * 100).toFixed(2)}%
${wowContext}
${lifecycleBlock}

## Rankings & Trends Data
${rankingsSummary}

## Evidence Packs (Preferred, materialized)
${evidenceSummary || "Not available yet."}

## Discovery Exposure Data (Panels/Timeline)
${exposureSummary ? JSON.stringify(exposureSummary, null, 0) : "Not available for this week (collector not running or insufficient data yet)."}

## Instructions
Write insightful narratives for each of the 14 sections below. Each narrative MUST be 4-6 sentences long, data-driven, and include:
- Specific numbers and percentages from the data
- Comparisons and patterns (e.g., "The top 3 islands account for X% of total plays")
- Actionable insights for creators (e.g., "Creators should consider X genre given Y trend")
- Notable standouts or anomalies worth highlighting
- When WoW data is available, mention trends and changes vs last week
- If baseline is not available (Baseline available = no), explicitly state that WoW/lifecycle movers are N/A and avoid inferring "stability" from missing data.

Write in English. Be analytical, not generic. Reference specific island names, creators, and categories from the rankings.

IMPORTANT terminology rules (MUST follow):
- CreativeDiscoverySurface_Browse MUST be referred to as "Browse" (never use the full technical name)
- CreativeDiscoverySurface_Frontend MUST be referred to as "Discovery" (never use the full technical name)
- The terms "Discover", "Browse", and "Discovery" must NEVER be translated — always keep them in English
- Keep island names, creator names, and technical terms in their original form

Sections:
1. Core Activity Overview - ecosystem health, new maps/creators, overall activity, WoW changes
2. Trending Topics - emerging genres, popular themes, what's gaining traction
3. Player Engagement - plays, CCU, duration patterns
4. New Islands of the Week - standout newcomers, what genres are new creators choosing
5. Retention & Loyalty - D1/D7 patterns, what keeps players coming back
6. Creator Performance - top creators, what makes them successful
7. Map Quality - duration, favorites, recommendations patterns
8. Low Performance Analysis - why islands fail, common patterns in underperforming maps
9. Ratios & Efficiency - engagement depth, conversion metrics
10. Category & Tags - genre distribution, trending categories
11. Conversion Efficiency - favorites/play, recommendations/play patterns
12. Risers & Decliners - biggest WoW movers, what's growing and what's fading
13. Island Lifecycle - revived islands, dead islands, breakout stories
14. Discovery Exposure - which panels drove exposure, time-in-panel patterns, churn/stability, and actionable positioning insights (based on panel/rank timeline)`;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    // ── Step 1: Generate English narratives ──
    const sectionProps: Record<string, any> = {};
    for (let i = 1; i <= 14; i++) {
      sectionProps[`section${i}`] = {
        type: "object",
        properties: {
          title: { type: "string" },
          narrative: { type: "string" },
        },
        required: ["title", "narrative"],
      };
    }

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You are an expert Fortnite Discovery ecosystem analyst. Always respond with valid JSON. Write detailed, data-driven narratives with specific numbers." },
          { role: "user", content: prompt },
        ],
        tools: [{
          type: "function",
          function: {
            name: "generate_narratives",
            description: "Generate detailed narrative analysis for each report section",
            parameters: {
              type: "object",
              properties: sectionProps,
              required: Object.keys(sectionProps),
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "generate_narratives" } },
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error("AI error:", aiRes.status, errText);
      throw new Error(`AI gateway error: ${aiRes.status}`);
    }

    const aiData = await aiRes.json();
    let narratives: any = {};

    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall?.function?.arguments) {
      narratives = JSON.parse(toolCall.function.arguments);
    }

    // ── Step 2: Auto-translate narratives to supported locales ──
    for (const locale of SUPPORTED_LOCALES) {
      try {
        const translated = await translateNarratives(narratives, locale, LOVABLE_API_KEY);
        // Merge translated text into each section as narrative_<locale_key>
        const localeKey = locale.replace("-", "_"); // pt-BR → pt_BR
        for (const [sectionKey, section] of Object.entries(translated)) {
          if (narratives[sectionKey] && (section as any)?.narrative) {
            narratives[sectionKey][`narrative_${localeKey}`] = (section as any).narrative;
          }
          if (narratives[sectionKey] && (section as any)?.title) {
            narratives[sectionKey][`title_${localeKey}`] = (section as any).title;
          }
        }
      } catch (e) {
        console.error(`Translation to ${locale} failed (non-blocking):`, e);
        // Non-blocking: English will be used as fallback
      }
    }

    // ── Step 3: Persist ──
    await supabase
      .from("discover_reports")
      .update({ ai_narratives: narratives, status: "completed", phase: "done", progress_pct: 100 })
      .eq("id", reportId);

    await supabase
      .from("weekly_reports")
      .update({ ai_sections_json: narratives })
      .eq("discover_report_id", reportId);

    return new Response(JSON.stringify({ success: true, narratives }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Report AI error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ── Translation helper ──
async function translateNarratives(
  narratives: Record<string, { title: string; narrative: string }>,
  targetLocale: string,
  apiKey: string,
): Promise<Record<string, { title: string; narrative: string }>> {
  // Build a compact payload: { section1: { title, narrative }, ... }
  const toTranslate: Record<string, { title: string; narrative: string }> = {};
  for (const [key, val] of Object.entries(narratives)) {
    if (val?.narrative) {
      toTranslate[key] = { title: val.title, narrative: val.narrative };
    }
  }

  const localeLabel = targetLocale === "pt-BR" ? "Brazilian Portuguese (pt-BR)" : targetLocale;

  const sectionProps: Record<string, any> = {};
  for (const key of Object.keys(toTranslate)) {
    sectionProps[key] = {
      type: "object",
      properties: {
        title: { type: "string" },
        narrative: { type: "string" },
      },
      required: ["title", "narrative"],
    };
  }

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash-lite",
      messages: [
        {
          role: "system",
          content: `You are a professional translator. Translate the following report section narratives from English to ${localeLabel}. 
Maintain the same analytical tone, all specific numbers, percentages, island names, creator names and technical terms.
CRITICAL: The terms "Discover", "Browse", and "Discovery" must NEVER be translated — always keep them in English.
Keep island codes (e.g. 1234-1234-1234) unchanged.`,
        },
        {
          role: "user",
          content: JSON.stringify(toTranslate),
        },
      ],
      tools: [{
        type: "function",
        function: {
          name: "translated_narratives",
          description: `Translated narratives in ${localeLabel}`,
          parameters: {
            type: "object",
            properties: sectionProps,
            required: Object.keys(sectionProps),
          },
        },
      }],
      tool_choice: { type: "function", function: { name: "translated_narratives" } },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Translation API error: ${res.status} ${errText}`);
  }

  const data = await res.json();
  const tc = data.choices?.[0]?.message?.tool_calls?.[0];
  if (tc?.function?.arguments) {
    return JSON.parse(tc.function.arguments);
  }
  throw new Error("No translation output");
}

// ── Exposure summary builder ──
function buildExposureSummary(exposure: any, weeklyRow: any): any {
  if (!exposure) return null;
  const topByPanel = Array.isArray(exposure.topByPanel) ? exposure.topByPanel : [];
  const panelSummaries = Array.isArray(exposure.panelSummaries) ? exposure.panelSummaries : [];
  const profiles = Array.isArray(exposure.profiles) ? exposure.profiles : [];

  const topPanels = (() => {
    const m = new Map<string, { key: string; minutes: number }>();
    for (const r of topByPanel) {
      const key = `${r.targetId}|||${r.panelName}`;
      const cur = m.get(key) || { key, minutes: 0 };
      cur.minutes += Number(r.minutesExposed || 0);
      m.set(key, cur);
    }
    const arr = Array.from(m.values()).sort((a, b) => b.minutes - a.minutes).slice(0, 10);
    return arr.map((x) => {
      const [targetId, panelName] = x.key.split("|||");
      const p = profiles.find((pp: any) => pp.targetId === targetId);
      return { profile: p ? `${p.region} ${p.surfaceName}` : targetId, panelName, minutes: Math.round(x.minutes) };
    });
  })();

  const topItems = topByPanel
    .slice()
    .sort((a: any, b: any) => Number(b.minutesExposed || 0) - Number(a.minutesExposed || 0))
    .slice(0, 15)
    .map((r: any) => ({
      profile: `${r.surfaceName} ${r.targetId}`,
      panel: r.panelName, code: r.linkCode, title: r.title || null,
      creator: r.creatorCode || null, minutes: Number(r.minutesExposed || 0),
      bestRank: r.bestRank ?? null, ccuMax: r.ccuMaxSeen ?? null, type: r.linkCodeType,
    }));

  const daily = panelSummaries.slice(0, 50);

  return {
    dateFrom: exposure?.meta?.dateFrom || (weeklyRow as any)?.date_from || null,
    dateTo: exposure?.meta?.dateTo || (weeklyRow as any)?.date_to || null,
    profiles: profiles.map((p: any) => ({ region: p.region, surfaceName: p.surfaceName })),
    topPanels, topItems, dailySample: daily,
  };
}
