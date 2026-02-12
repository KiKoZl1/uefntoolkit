import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const EPIC_API = "https://api.fortnite.com/ecosystem/v1";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { islandCode } = await req.json();
    if (!islandCode) {
      return new Response(JSON.stringify({ error: "islandCode is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const code = islandCode.trim();

    // Fetch metadata
    const metaRes = await fetch(`${EPIC_API}/islands/${code}`);
    if (!metaRes.ok) {
      return new Response(JSON.stringify({ error: "Island not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const metadata = await metaRes.json();

    // Fetch daily metrics for last 7 days
    const now = new Date();
    const to = new Date(now);
    to.setUTCHours(0, 0, 0, 0);
    const from = new Date(to);
    from.setUTCDate(from.getUTCDate() - 7);

    const metricsRes = await fetch(
      `${EPIC_API}/islands/${code}/metrics/day?from=${from.toISOString()}&to=${to.toISOString()}`
    );

    let metrics = null;
    if (metricsRes.ok) {
      metrics = await metricsRes.json();
    }

    // Also fetch hourly for last 24h (for more granular view)
    const from24h = new Date(now);
    from24h.setUTCHours(from24h.getUTCHours() - 24);
    const hourlyRes = await fetch(
      `${EPIC_API}/islands/${code}/metrics/hour?from=${from24h.toISOString()}&to=${now.toISOString()}`
    );
    let hourlyMetrics = null;
    if (hourlyRes.ok) {
      hourlyMetrics = await hourlyRes.json();
    }

    return new Response(JSON.stringify({
      metadata: {
        code: metadata.code,
        title: metadata.title,
        creatorCode: metadata.creatorCode,
        category: metadata.category,
        tags: metadata.tags,
        createdIn: metadata.createdIn,
      },
      dailyMetrics: metrics,
      hourlyMetrics,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Island lookup error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
