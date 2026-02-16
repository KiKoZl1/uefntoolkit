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

    // Collect top 5000 islands from cache by plays (5 batches of 1000)
    const codes: string[] = [];
    for (let offset = 0; offset < 5000; offset += 1000) {
      const { data, error } = await supabase
        .from("discover_islands_cache")
        .select("island_code")
        .order("last_week_plays", { ascending: false, nullsFirst: false })
        .range(offset, offset + 999);

      if (error) throw error;
      if (!data?.length) break;
      codes.push(...data.map((d: { island_code: string }) => d.island_code));
    }

    if (codes.length === 0) {
      return new Response(
        JSON.stringify({ success: true, submitted: 0, enqueued: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Enqueue via RPC (bump-controlled; returns jsonb)
    const { data: enq, error: rpcError } = await supabase.rpc(
      "enqueue_discover_link_metadata",
      { p_link_codes: codes, p_due_within_minutes: 0 }
    );

    if (rpcError) throw rpcError;

    return new Response(
      JSON.stringify({ success: true, submitted: codes.length, enqueued: enq ?? null }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
