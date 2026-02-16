import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Collect ALL islands from cache ordered by plays (no artificial limit)
    const codes: string[] = [];
    let offset = 0;
    const PAGE = 1000;
    while (true) {
      const { data, error } = await supabase
        .from("discover_islands_cache")
        .select("island_code")
        .order("last_week_plays", { ascending: false, nullsFirst: false })
        .range(offset, offset + PAGE - 1);

      if (error) throw error;
      if (!data?.length) break;
      codes.push(...data.map((d: { island_code: string }) => d.island_code));
      if (data.length < PAGE) break; // last page
      offset += PAGE;
    }

    if (codes.length === 0) {
      return new Response(
        JSON.stringify({ success: true, submitted: 0, enqueued: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Enqueue via RPC in chunks (RPC accepts arrays but we chunk to avoid payload limits)
    let totalInserted = 0;
    let totalUpdated = 0;
    const CHUNK = 5000;
    for (let i = 0; i < codes.length; i += CHUNK) {
      const chunk = codes.slice(i, i + CHUNK);
      const { data: enq, error: rpcError } = await supabase.rpc(
        "enqueue_discover_link_metadata",
        { p_link_codes: chunk, p_due_within_minutes: 0 }
      );
      if (rpcError) throw rpcError;
      if (enq) {
        totalInserted += Number(enq.inserted || 0);
        totalUpdated += Number(enq.updated || 0);
      }
    }

    return new Response(
      JSON.stringify({ success: true, submitted: codes.length, inserted: totalInserted, updated: totalUpdated }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
