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

    // Load report data
    const { data: report, error } = await supabase
      .from("discover_reports")
      .select("*")
      .eq("id", reportId)
      .single();

    if (error || !report) throw new Error("Report not found");

    const kpis = report.platform_kpis;
    const rankings = report.computed_rankings;

    const sections = [
      "Core Activity Metrics",
      "Player Engagement Metrics",
      "Retention & Loyalty Metrics",
      "Creator Performance Metrics",
      "Map-Level Quality Metrics",
      "Ratios & Derived Metrics",
      "Category & Tag Analytics",
      "Efficiency / Conversion Metrics",
    ];

    const prompt = `You are a Fortnite Discovery ecosystem analyst. Analyze this weekly report data (Week ${report.week_number}, ${report.year}) and write a brief, insightful narrative (2-3 sentences) for each of the 8 sections. Focus on trends, standouts, and actionable insights for creators.

Platform KPIs: ${JSON.stringify(kpis)}

Top Rankings (summarized): ${JSON.stringify(rankings, null, 0).slice(0, 4000)}

Return a JSON object with keys "section1" through "section8", each containing a "title" and "narrative" field. Keep narratives concise and data-driven.`;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: "You are an expert Fortnite Discovery ecosystem analyst. Always respond with valid JSON." },
          { role: "user", content: prompt },
        ],
        tools: [{
          type: "function",
          function: {
            name: "generate_narratives",
            description: "Generate narrative analysis for each report section",
            parameters: {
              type: "object",
              properties: {
                section1: { type: "object", properties: { title: { type: "string" }, narrative: { type: "string" } }, required: ["title", "narrative"] },
                section2: { type: "object", properties: { title: { type: "string" }, narrative: { type: "string" } }, required: ["title", "narrative"] },
                section3: { type: "object", properties: { title: { type: "string" }, narrative: { type: "string" } }, required: ["title", "narrative"] },
                section4: { type: "object", properties: { title: { type: "string" }, narrative: { type: "string" } }, required: ["title", "narrative"] },
                section5: { type: "object", properties: { title: { type: "string" }, narrative: { type: "string" } }, required: ["title", "narrative"] },
                section6: { type: "object", properties: { title: { type: "string" }, narrative: { type: "string" } }, required: ["title", "narrative"] },
                section7: { type: "object", properties: { title: { type: "string" }, narrative: { type: "string" } }, required: ["title", "narrative"] },
                section8: { type: "object", properties: { title: { type: "string" }, narrative: { type: "string" } }, required: ["title", "narrative"] },
              },
              required: ["section1", "section2", "section3", "section4", "section5", "section6", "section7", "section8"],
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

    // Save narratives
    await supabase
      .from("discover_reports")
      .update({ ai_narratives: narratives, status: "completed" })
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
