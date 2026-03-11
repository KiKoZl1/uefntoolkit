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
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPPORTED_LOCALES = ["pt-BR"] as const;

async function requireAdminOrEditor(req: Request, supabase: any): Promise<string> {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  if (!token) throw new Error("forbidden");

  const { data: u, error: uErr } = await supabase.auth.getUser(token);
  if (uErr || !u?.user?.id) throw new Error("forbidden");
  const userId = u.user.id;

  const { data: roles, error: rErr } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .in("role", ["admin", "editor"])
    .limit(1);
  if (rErr || !roles || roles.length === 0) throw new Error("forbidden");
  return userId;
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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const sbUrl = Deno.env.get("SUPABASE_URL")!;
    const authHeader = req.headers.get("Authorization") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const serviceRoleMode = isServiceRoleRequest(req, serviceKey);
    if (!serviceRoleMode) {
      try {
        const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
        const userClient = createClient(sbUrl, anonKey, {
          global: { headers: { Authorization: authHeader } },
        });
        await requireAdminOrEditor(req, userClient);
      } catch {
        return new Response(JSON.stringify({ error: "Forbidden: admin/editor or service_role required" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    if (shouldProxyToData(req)) {
      const proxied = await invokeDataFunction({
        req,
        functionName: "discover-report-ai",
        body,
        timeoutMs: getEnvNumber("LOOKUP_DATA_TIMEOUT_MS", 12000),
      });
      if (proxied.ok) return dataProxyResponse(proxied.data, proxied.status, corsHeaders);
      return dataBridgeUnavailableResponse(corsHeaders, proxied.error);
    }

    if (shouldBlockLocalExecution(req)) {
      return dataBridgeUnavailableResponse(corsHeaders, "strict proxy mode");
    }

    const { reportId } = body;
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!reportId || !UUID_REGEX.test(reportId)) {
      return new Response(JSON.stringify({ error: "Invalid reportId format" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(sbUrl, serviceKey);

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
    const newMapsPublished = Number((kpis as any)?.newMapsThisWeekPublished ?? (kpis as any)?.newMapsThisWeek ?? 0);
    const newMapsFirstSeen = Number((kpis as any)?.newMapsThisWeek ?? 0);

    const evidenceSummary = evidence ? JSON.stringify(evidence, null, 0) : null;
    const r = rankings as any || {};
    const rankingsSummary = JSON.stringify({
      baselineAvailable: Boolean((kpis as any)?.baselineAvailable),
      // Core rankings
      topPeakCCU: r.topPeakCCU?.slice?.(0, 10) || [],
      topPeakCCU_UGC: r.topPeakCCU_UGC?.slice?.(0, 10) || [],
      topUniquePlayers: r.topUniquePlayers?.slice?.(0, 10) || [],
      topTotalPlays: r.topTotalPlays?.slice?.(0, 10) || [],
      topMinutesPlayed: r.topMinutesPlayed?.slice?.(0, 10) || [],
      topAvgMinutesPerPlayer: r.topAvgMinutesPerPlayer?.slice?.(0, 10) || [],
      // Retention
      topRetentionD1: r.topRetentionD1?.slice?.(0, 10) || [],
      topRetentionD7: r.topRetentionD7?.slice?.(0, 10) || [],
      retentionDistributionD1: r.retentionDistributionD1 || [],
      retentionDistributionD7: r.retentionDistributionD7 || [],
      // Stickiness
      topStickinessD1: r.topStickinessD1?.slice?.(0, 10) || [],
      topStickinessD7: r.topStickinessD7?.slice?.(0, 10) || [],
      topStickinessD1_UGC: r.topStickinessD1_UGC?.slice?.(0, 10) || [],
      topStickinessD7_UGC: r.topStickinessD7_UGC?.slice?.(0, 10) || [],
      // Creator performance
      topCreatorsByPlays: r.topCreatorsByPlays?.slice?.(0, 10) || [],
      topCreatorsByPlayers: r.topCreatorsByPlayers?.slice?.(0, 10) || [],
      topCreatorsByMinutes: r.topCreatorsByMinutes?.slice?.(0, 10) || [],
      topCreatorsByCCU: r.topCreatorsByCCU?.slice?.(0, 10) || [],
      // Advocacy
      topFavorites: r.topFavorites?.slice?.(0, 10) || [],
      topRecommendations: r.topRecommendations?.slice?.(0, 10) || [],
      topFavsPer100: r.topFavsPer100?.slice?.(0, 10) || [],
      topRecPer100: r.topRecPer100?.slice?.(0, 10) || [],
      // Efficiency
      topPlaysPerPlayer: r.topPlaysPerPlayer?.slice?.(0, 10) || [],
      topFavsPerPlay: r.topFavsPerPlay?.slice?.(0, 10) || [],
      topRecsPerPlay: r.topRecsPerPlay?.slice?.(0, 10) || [],
      topRetentionAdjD1: r.topRetentionAdjD1?.slice?.(0, 10) || [],
      topRetentionAdjD7: r.topRetentionAdjD7?.slice?.(0, 10) || [],
      // Trends & categories
      trendingTopics: r.trendingTopics?.slice?.(0, 20) || [],
      topTags: r.topTags?.slice?.(0, 20) || [],
      topCategoriesByPlays: r.topCategoriesByPlays?.slice?.(0, 10) || [],
      partnerSignals: r.partnerSignals?.slice?.(0, 12) || [],
      // New islands
      topNewIslandsByPlays: r.topNewIslandsByPlays?.slice?.(0, 10) || [],
      topNewIslandsByPlayers: r.topNewIslandsByPlayers?.slice?.(0, 10) || [],
      mostUpdatedIslandsThisWeek: r.mostUpdatedIslandsThisWeek?.slice?.(0, 20) || [],
      mostUpdatedIslandsWeekly: r.mostUpdatedIslandsWeekly?.slice?.(0, 20) || [],
      // Low perf
      failedIslandsList: r.failedIslandsList?.slice?.(0, 10) || [],
      lowPerfHistogram: r.lowPerfHistogram || [],
      // Lifecycle
      topRisers: r.topRisers?.slice?.(0, 10) || [],
      topDecliners: r.topDecliners?.slice?.(0, 10) || [],
      breakouts: r.breakouts?.slice?.(0, 10) || [],
      revivedIslands: r.revivedIslands?.slice?.(0, 10) || [],
      deadIslands: r.deadIslands?.slice?.(0, 10) || [],
      // NEW: Sections 20-25 data
      toolSplit: r.toolSplit || [],
      capacityAnalysis: r.capacityAnalysis || [],
      rookieCreators: r.rookieCreators?.slice?.(0, 10) || [],
      totalRookieCreators: r.totalRookieCreators || 0,
      totalRookieIslands: r.totalRookieIslands || 0,
      multiPanelPresence: r.multiPanelPresence?.slice?.(0, 10) || [],
      panelLoyalty: r.panelLoyalty?.slice?.(0, 10) || [],
      versionEnrichment: r.versionEnrichment || null,
      sacCoverage: r.sacCoverage || null,
      // Exposure and pollution
      topExposureEfficiency: r.topExposureEfficiency?.slice?.(0, 15) || [],
      worstExposureEfficiency: r.worstExposureEfficiency?.slice?.(0, 15) || [],
      exposureEfficiencyStats: r.exposureEfficiencyStats || null,
      exposureEfficiencyPanelTop: r.exposureEfficiencyPanelTop?.slice?.(0, 10) || [],
      exposureEfficiencyCreatorTop: r.exposureEfficiencyCreatorTop?.slice?.(0, 10) || [],
      exposureEfficiencyCreatorBottom: r.exposureEfficiencyCreatorBottom?.slice?.(0, 10) || [],
      discoveryPollution: r.discoveryPollution?.slice?.(0, 30) || [],
      // Additional quality/advocacy and discovery signals
      mapQualityCompositeTop: r.mapQualityCompositeTop?.slice?.(0, 10) || [],
      advocacyGapLeaders: r.advocacyGapLeaders?.slice?.(0, 10) || [],
      advocacyOverIndexedRecs: r.advocacyOverIndexedRecs?.slice?.(0, 10) || [],
      advocacySignalsStats: r.advocacySignalsStats || null,
      linkGraphHealth: r.linkGraphHealth || null,
      emergingNow: r.emergingNow?.slice?.(0, 20) || [],
      emergingNowStats: r.emergingNowStats || null,
      epicSpotlight: r.epicSpotlight || null,
    }, null, 0);
    const baselineAvailable = Boolean((kpis as any)?.baselineAvailable) || kpis.wowTotalPlays != null;

    const wowContext = kpis.wowTotalPlays != null
      ? `\n## Week-over-Week Changes
- Total Plays: ${kpis.wowTotalPlays?.toFixed(1)}% WoW
- Total Players: ${kpis.wowTotalPlayers?.toFixed(1)}% WoW
- Total Minutes: ${kpis.wowTotalMinutes?.toFixed(1)}% WoW
- Active Islands: ${kpis.wowActiveIslands?.toFixed(1)}% WoW
- Avg Retention D1: ${kpis.wowAvgRetentionD1?.toFixed(1) ?? 'N/A'}% WoW
- Avg Retention D7: ${kpis.wowAvgRetentionD7?.toFixed(1) ?? 'N/A'}% WoW
- Avg Play Duration: ${kpis.wowAvgPlayDuration?.toFixed(1) ?? 'N/A'}% WoW
- Avg CCU/Map: ${kpis.wowAvgCCUPerMap?.toFixed(1) ?? 'N/A'}% WoW
- Total Favorites: ${kpis.wowTotalFavorites?.toFixed(1) ?? 'N/A'}% WoW
- Total Recommendations: ${kpis.wowTotalRecommendations?.toFixed(1) ?? 'N/A'}% WoW
- Total Creators: ${kpis.wowTotalCreators?.toFixed(1) ?? 'N/A'}% WoW
- New Maps delta: ${kpis.wowNewMaps > 0 ? '+' : ''}${kpis.wowNewMaps}
- New Creators delta: ${kpis.wowNewCreators > 0 ? '+' : ''}${kpis.wowNewCreators}
- Revived delta: ${kpis.wowRevivedCount > 0 ? '+' : ''}${kpis.wowRevivedCount ?? 'N/A'}
- Dead delta: ${kpis.wowDeadCount > 0 ? '+' : ''}${kpis.wowDeadCount ?? 'N/A'}
- Failed Islands delta: ${kpis.wowFailedIslands > 0 ? '+' : ''}${kpis.wowFailedIslands ?? 'N/A'}

## Previous Week Absolute Values (for side-by-side comparison)
- Prev Total Plays: ${kpis.prevTotalPlays ?? 'N/A'}
- Prev Total Players: ${kpis.prevTotalPlayers ?? 'N/A'}
- Prev Active Islands: ${kpis.prevActiveIslands ?? 'N/A'}
- Prev Total Creators: ${kpis.prevTotalCreators ?? 'N/A'}
- Prev Avg Retention D1: ${kpis.prevAvgRetentionD1 ?? 'N/A'}
- Prev Avg Retention D7: ${kpis.prevAvgRetentionD7 ?? 'N/A'}
- Prev Avg Play Duration: ${kpis.prevAvgPlayDuration ?? 'N/A'}
- Prev New Maps: ${kpis.prevNewMapsThisWeek ?? 'N/A'}
- Prev New Creators: ${kpis.prevNewCreatorsThisWeek ?? 'N/A'}`
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
- **${newMapsPublished}** new maps published this week (Epic publish date, authoritative for report wording)
- **${newMapsFirstSeen}** maps first seen in our tracking this week (operational metric; never call this "published")
- **${kpis.newCreatorsThisWeek || 0}** new creators first seen this week
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
Write insightful narratives for each of the 30 sections below. Each narrative MUST be 4-6 sentences long, data-driven, and include:
- Specific numbers and percentages from the data
- Comparisons and patterns (e.g., "The top 3 islands account for X% of total plays")
- Actionable insights for creators (e.g., "Creators should consider X genre given Y trend")
- Notable standouts or anomalies worth highlighting
- When WoW data is available, mention trends and changes vs last week with specific % deltas and absolute previous values
- For "new maps this week" in publication narratives, prioritize the Epic publish-date metric (newMapsThisWeekPublished) over first-seen counts.
- HARD RULE: whenever you write "published this week" (or equivalent), you MUST use exactly ${newMapsPublished}.
- HARD RULE: never use ${newMapsFirstSeen} for published wording; if mentioned, label it only as "first seen in tracker".
- Outside the Global Peak CCU section and Epic Spotlight data, treat rankings as UGC-only (Epic maps are excluded by design). Do not use Epic examples in other sections.
- If baseline is not available (Baseline available = no), for sections that depend on WoW data (sections 16, 17, 18), write about what WILL be tracked once baseline exists. Discuss what the current snapshot reveals about the ecosystem's starting point. DO NOT write "none" or say there's no data — instead analyze the current week's absolute performance as the foundation for future comparisons.
- Always explain what values mean (e.g., "5.37 plays per unique player", "71.26 favorites per 100 players")
- For stickiness scores, explain the formula: plays × avgMinutes × retention
- For Efficiency & Conversion (section 12), ALWAYS use the topFavsPerPlay, topRecsPerPlay, topPlaysPerPlayer data — these are available even without baseline.

Write in English. Be analytical, not generic. Reference specific island names, creators, and categories from the rankings.

IMPORTANT terminology rules (MUST follow):
- CreativeDiscoverySurface_Browse MUST be referred to as "Browse" (never use the full technical name)
- CreativeDiscoverySurface_Frontend MUST be referred to as "Discovery" (never use the full technical name)
- The terms "Discover", "Browse", and "Discovery" must NEVER be translated — always keep them in English
- Keep island names, creator names, and technical terms in their original form
- In section 19, always use the provided panel display labels from exposure summary (never output raw technical panel codes)

Sections:
1. Core Activity Overview - ecosystem health, total islands/creators, active vs inactive maps, avg maps per creator, new maps/creators, WoW changes
2. Trending Topics - emerging themes detected via NLP analysis of island titles (weighted by plays). Explain what each trend means and why it's trending
3. Player Engagement Volume - total plays, total players, avg CCU/map, avg session duration, total minutes played
4. Peak CCU - top 10 peak CCU global (including Epic), top 10 UGC-only. Analyze concentration (gap between #1 and #2) and what drives peak moments
5. New Islands of the Week - standout newcomers by plays and players, what genres new creators are choosing, launch success patterns
6. Retention & Loyalty - avg D1/D7, distribution histograms (how many maps in each retention tier), what separates high-retention from low-retention maps
7. Creator Performance - top creators by plays, uniques, minutes, CCU sum. Cross-reference: who appears in multiple rankings = consistent performer
8. Map Quality - top avg minutes/player (with quality filter ≥1000 plays), top favorites, top recommendations. What makes a quality map
9. Low Performance Analysis - count of low-perf islands, histogram (<50, <100, <500 players), top 10 worst with their tags/categories, common failure patterns
10. Plays per Player (Replay Frequency) - top 10 replay frequency (≥1000 plays filter). What design patterns drive replays
11. Advocacy Metrics - favorites per 100 players, recommendations per 100 players (with quality filters). What makes players advocate for a map
12. Efficiency & Conversion - favorites/play ratio (topFavsPerPlay), recommendations/play ratio (topRecsPerPlay), plays per player (topPlaysPerPlayer). These metrics are ALWAYS available. Analyze conversion quality.
13. Stickiness (D1 & D7) - top 10 stickiness scores (plays × avgMinutes × retention) for global and UGC. Explain what stickiness means and why it matters
14. Retention-Adjusted Engagement - top 10 by avgMinutes × retention (D1 and D7, ≥1000 plays & ≥500 uniques filter). Deep engagement quality
15. Category & Tags - genre distribution, top tags by island count, top categories by plays. Include Partner Signals (internal codename candidates) using ONLY aggregated codename/project-level stats; never mention island names or island codes in this subsection.
16. Weekly Growth / Breakouts - If baseline available: biggest risers by play delta, breakout detection. If NO baseline: analyze the current week's top performers as the "starting lineup", discuss which islands show signs of breakout potential based on their absolute metrics (high plays + high retention = likely breakout candidate)
17. Risers & Decliners - If baseline available: specific WoW movers. If NO baseline: identify potential risers/decliners by analyzing metric imbalances (e.g., high plays but low retention = at risk of declining; low plays but high retention = poised to rise with more visibility)
18. Island Lifecycle - revived islands, dead islands, breakout stories. If NO baseline: describe the ecosystem's current composition as the lifecycle starting point
19. Discovery Exposure - which panels drove exposure, time-in-panel patterns, churn/stability, and actionable positioning insights (based on panel/rank timeline)
20. Multi-Panel Presence - islands appearing in the most DISTINCT panels. Analyze versatility: which islands does Epic's algorithm distribute across multiple categories? Reference multiPanelPresence data with panel_names arrays. Highlight what makes these islands algorithmically versatile.
21. Panel Loyalty (Residents) - islands with the longest cumulative exposure in a SINGLE panel. These are "category residents" that dominate a specific panel. Reference panelLoyalty data. Analyze what makes an island "own" a panel position.
22. Most Updated Islands - analyze BOTH: (a) highest total version numbers and (b) highest weekly updates count. Reference mostUpdatedIslandsThisWeek, mostUpdatedIslandsWeekly and versionEnrichment data. Explain how weekly update velocity differs from lifetime version depth, and include version distribution stats.
23. Rookie Creators - new creators (first_seen this week) with standout performance. Reference rookieCreators data. Analyze how rookies compare to established creators. Highlight total new creators and their best islands.
24. Player Capacity Analysis - performance breakdown by max_players tiers (Solo, Duo, Squad, Party, Large, Massive). Reference capacityAnalysis data. Which player count drives the best retention/engagement? Actionable insights for creators choosing party sizes.
25. UEFN vs Fortnite Creative - tool split comparison. Reference toolSplit data. Compare avg plays, retention, CCU, minutes between UEFN and FNC islands. Which tool produces better-performing islands? What does this mean for creators choosing their development tool?
26. Exposure Efficiency - best and worst conversion from Discovery exposure to plays (plays per minute exposed). Use topExposureEfficiency/worstExposureEfficiency plus section 26.1 (panel conversion) and 26.2 (creator conversion top/bottom) for actionable distribution strategy.
27. Discovery Pollution - creators flooding Discovery with duplicate/spam islands this week. Use discoveryPollution ranking (clusters, duplicate islands, spam score) to explain ecosystem impact and moderation implications.
28. Epic Spotlight - analyze Epic-authored maps separately (top peak CCU, top plays, top unique players, and WoW movers if available). Compare Epic momentum vs UGC without mixing them into UGC conclusions.
29. Link Graph Health - analyze edges between collections and children using linkGraphHealth. Explain total edges, freshness, active parents/children, and top parent collections by edge volume.
30. Emerging Now Radar - analyze emergingNow and emergingNowStats to identify fast-rising islands in the last 24h (score, minutes, panels, best rank) and what creators can learn from those patterns.`;

    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not configured");
    const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") || "gpt-4.1-mini";
    const OPENAI_TRANSLATION_MODEL = Deno.env.get("OPENAI_TRANSLATION_MODEL") || OPENAI_MODEL;

    // ── Step 1: Generate English narratives ──
    const sectionProps: Record<string, any> = {};
    for (let i = 1; i <= 30; i++) {
      sectionProps[`section${i}`] = {
        type: "object",
        properties: {
          title: { type: "string" },
          narrative: { type: "string" },
        },
        required: ["title", "narrative"],
      };
    }

    const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
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

    // ── Step 2: Auto-translate narratives to supported locales (parallel batches) ──
    for (const locale of SUPPORTED_LOCALES) {
      try {
        const localeKey = locale.replace("-", "_");
        const sectionKeys = Object.keys(narratives).filter(k => narratives[k]?.narrative);
        
        // Split into 2 parallel batches to avoid timeout
        const mid = Math.ceil(sectionKeys.length / 2);
        const batch1Keys = sectionKeys.slice(0, mid);
        const batch2Keys = sectionKeys.slice(mid);
        
        const buildBatch = (keys: string[]) => {
          const subset: Record<string, { title: string; narrative: string }> = {};
          for (const k of keys) subset[k] = { title: narratives[k].title, narrative: narratives[k].narrative };
          return subset;
        };

        const [res1, res2] = await Promise.all([
          translateNarrativesBatch(buildBatch(batch1Keys), locale, OPENAI_API_KEY, OPENAI_TRANSLATION_MODEL),
          translateNarrativesBatch(buildBatch(batch2Keys), locale, OPENAI_API_KEY, OPENAI_TRANSLATION_MODEL),
        ]);

        const merged = { ...res1, ...res2 };
        for (const [sectionKey, section] of Object.entries(merged)) {
          if (narratives[sectionKey] && (section as any)?.narrative) {
            narratives[sectionKey][`narrative_${localeKey}`] = (section as any).narrative;
          }
          if (narratives[sectionKey] && (section as any)?.title) {
            narratives[sectionKey][`title_${localeKey}`] = (section as any).title;
          }
        }
        console.log(`Translation to ${locale} OK: ${Object.keys(merged).length} sections`);
      } catch (e) {
        console.error(`Translation to ${locale} failed (non-blocking):`, e);
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

// ── Translation helper (single batch) ──
async function translateNarrativesBatch(
  toTranslate: Record<string, { title: string; narrative: string }>,
  targetLocale: string,
  apiKey: string,
  model: string,
): Promise<Record<string, { title: string; narrative: string }>> {
  if (Object.keys(toTranslate).length === 0) return {};

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

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
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
  const DISCOVERY_SURFACE = "CreativeDiscoverySurface_Frontend";
  const topByPanelAll = Array.isArray(exposure.topByPanel) ? exposure.topByPanel : [];
  const panelSummariesAll = Array.isArray(exposure.panelSummaries) ? exposure.panelSummaries : [];
  const profilesAll = Array.isArray(exposure.profiles) ? exposure.profiles : [];
  const profiles = profilesAll.filter((p: any) => String(p?.surfaceName) === DISCOVERY_SURFACE);
  const allowedTargetIds = new Set(profiles.map((p: any) => String(p.targetId)));
  const topByPanel = topByPanelAll.filter((r: any) =>
    String(r?.surfaceName) === DISCOVERY_SURFACE && allowedTargetIds.has(String(r?.targetId))
  );
  const panelSummaries = panelSummariesAll.filter((r: any) =>
    String(r?.surfaceName) === DISCOVERY_SURFACE && allowedTargetIds.has(String(r?.targetId))
  );
  const profileById = new Map<string, any>(
    profiles.map((p: any) => [String(p.targetId), p])
  );

  const topPanels = (() => {
    const m = new Map<string, { key: string; minutes: number; panelDisplayName: string }>();
    for (const r of topByPanel) {
      const key = `${r.targetId}|||${r.panelName}`;
      const cur = m.get(key) || { key, minutes: 0, panelDisplayName: String(r.panelDisplayName || r.panelName || "") };
      cur.minutes += Number(r.minutesExposed || 0);
      if (!cur.panelDisplayName) {
        cur.panelDisplayName = String(r.panelDisplayName || r.panelName || "");
      }
      m.set(key, cur);
    }
    const arr = Array.from(m.values()).sort((a, b) => b.minutes - a.minutes).slice(0, 10);
    return arr.map((x) => {
      const [targetId, panelName] = x.key.split("|||");
      const p = profileById.get(targetId);
      return {
        profile: p ? `${p.region} Discovery` : targetId,
        panel: x.panelDisplayName || panelName,
        minutes: Math.round(x.minutes),
      };
    });
  })();

  const topItems = topByPanel
    .slice()
    .sort((a: any, b: any) => Number(b.minutesExposed || 0) - Number(a.minutesExposed || 0))
    .slice(0, 15)
    .map((r: any) => ({
      profile: `${profileById.get(String(r.targetId))?.region || ""} Discovery`.trim(),
      panel: r.panelDisplayName || r.panelName,
      code: r.linkCode,
      title: r.title || null,
      creator: r.creatorCode || null, minutes: Number(r.minutesExposed || 0),
      bestRank: r.bestRank ?? null, ccuMax: r.ccuMaxSeen ?? null, type: r.linkCodeType,
    }));

  const daily = panelSummaries
    .slice(0, 50)
    .map((r: any) => ({
      date: r.date,
      profile: `${profileById.get(String(r.targetId))?.region || ""} Discovery`.trim(),
      panel: r.panelDisplayName || r.panelName,
      maps: Number(r.maps || 0),
      creators: Number(r.creators || 0),
      collections: Number(r.collections || 0),
    }));

  return {
    dateFrom: exposure?.meta?.dateFrom || (weeklyRow as any)?.date_from || null,
    dateTo: exposure?.meta?.dateTo || (weeklyRow as any)?.date_to || null,
    profiles: profiles.map((p: any) => ({ region: p.region, surfaceName: "Discovery" })),
    topPanels, topItems, dailySample: daily,
  };
}

