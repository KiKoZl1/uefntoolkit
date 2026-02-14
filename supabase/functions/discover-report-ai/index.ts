import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { reportId } = await req.json();
    if (!reportId) throw new Error("reportId is required");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: report, error } = await supabase
      .from("discover_reports")
      .select("*")
      .eq("id", reportId)
      .single();

    if (error || !report) throw new Error("Report not found");

    const kpis = report.platform_kpis;
    const rankings = report.computed_rankings;

    // Build a rich data summary for the AI
    const rankingsSummary = JSON.stringify(rankings, null, 0);

    const prompt = `You are a senior Fortnite Discovery ecosystem analyst writing a comprehensive weekly trends report (Week ${report.week_number}, ${report.year}). You are writing for island creators and game developers who want actionable insights.

## Data Available
- **${kpis.totalIslands}** total islands analyzed, **${kpis.activeIslands}** active (5+ players)
- **${kpis.newMapsThisWeek || 0}** new maps this week, **${kpis.newCreatorsThisWeek || 0}** new creators
- **${kpis.failedIslands || 0}** islands with <500 unique players (low performance)
- Total Plays: ${kpis.totalPlays}, Total Players: ${kpis.totalUniquePlayers}
- Total Minutes: ${kpis.totalMinutesPlayed}, Avg Duration: ${kpis.avgPlayDuration?.toFixed(1)} min
- Avg D1 Retention: ${((kpis.avgRetentionD1 || 0) * 100).toFixed(1)}%, Avg D7: ${((kpis.avgRetentionD7 || 0) * 100).toFixed(1)}%
- Fav-to-Play: ${((kpis.favToPlayRatio || 0) * 100).toFixed(2)}%, Rec-to-Play: ${((kpis.recToPlayRatio || 0) * 100).toFixed(2)}%

## Rankings & Trends Data
${rankingsSummary}

## Instructions
Write insightful narratives for each of the 11 sections below. Each narrative MUST be 4-6 sentences long, data-driven, and include:
- Specific numbers and percentages from the data
- Comparisons and patterns (e.g., "The top 3 islands account for X% of total plays")
- Actionable insights for creators (e.g., "Creators should consider X genre given Y trend")
- Notable standouts or anomalies worth highlighting

Write in English. Be analytical, not generic. Reference specific island names, creators, and categories from the rankings.

Sections:
1. Core Activity Overview - ecosystem health, new maps/creators, overall activity
2. Trending Topics - emerging genres, popular themes, what's gaining traction
3. Player Engagement - plays, CCU, duration patterns
4. New Islands of the Week - standout newcomers, what genres are new creators choosing
5. Retention & Loyalty - D1/D7 patterns, what keeps players coming back
6. Creator Performance - top creators, what makes them successful
7. Map Quality - duration, favorites, recommendations patterns
8. Low Performance Analysis - why islands fail, common patterns in underperforming maps
9. Ratios & Efficiency - engagement depth, conversion metrics
10. Category & Tags - genre distribution, trending categories
11. Conversion Efficiency - favorites/play, recommendations/play patterns`;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const sectionProps: Record<string, any> = {};
    for (let i = 1; i <= 11; i++) {
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

    await supabase
      .from("discover_reports")
      .update({ ai_narratives: narratives, status: "completed", phase: "done", progress_pct: 100 })
      .eq("id", reportId);

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
