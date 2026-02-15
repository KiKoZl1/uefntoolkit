import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const EPIC_API = "https://api.fortnite.com/ecosystem/v1/islands";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(supabaseUrl, serviceKey);

  const body = await req.json().catch(() => ({}));
  const batchSize = Math.min(body.batch_size || 100, 500);
  const concurrency = Math.min(body.concurrency || 5, 10);
  const delayMs = body.delay_ms || 1200; // delay between chunks to avoid rate limit

  // Get batch of islands without title
  const { data: islands, error: fetchErr } = await sb
    .from("discover_islands_cache")
    .select("island_code")
    .is("title", null)
    .limit(batchSize);

  if (fetchErr) {
    return new Response(JSON.stringify({ error: fetchErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!islands || islands.length === 0) {
    return new Response(
      JSON.stringify({ done: true, message: "All islands have titles", remaining: 0 }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  let updated = 0;
  let errors = 0;
  let notFound = 0;
  let noTitle = 0;
  let rateLimitHits = 0;

  for (let i = 0; i < islands.length; i += concurrency) {
    const chunk = islands.slice(i, i + concurrency);

    await Promise.allSettled(
      chunk.map(async (island) => {
        try {
          const resp = await fetch(`${EPIC_API}/${island.island_code}`);

          if (resp.status === 404) {
            notFound++;
            await sb.from("discover_islands_cache")
              .update({ title: "[not found]" })
              .eq("island_code", island.island_code);
            return;
          }
          if (resp.status === 429) {
            rateLimitHits++;
            return; // skip, will retry next invocation
          }
          if (!resp.ok) { errors++; return; }

          const data = await resp.json();
          const title = data.title || null;
          const creatorCode = data.creatorCode || null;
          const category = data.category || null;
          const createdIn = data.createdIn || null;
          const tags = data.tags || [];

          const up: Record<string, unknown> = {
            title: title || "[no title]",
          };
          if (creatorCode) up.creator_code = creatorCode;
          if (category) up.category = category;
          if (createdIn) up.created_in = createdIn;
          if (tags.length > 0) up.tags = tags;

          await sb.from("discover_islands_cache")
            .update(up)
            .eq("island_code", island.island_code);

          if (title) updated++;
          else noTitle++;
        } catch { errors++; }
      })
    );

    // Delay between chunks to respect rate limits
    if (i + concurrency < islands.length) {
      await sleep(delayMs);
    }
  }

  const { count: remaining } = await sb
    .from("discover_islands_cache")
    .select("island_code", { count: "exact", head: true })
    .is("title", null);

  return new Response(
    JSON.stringify({
      done: (remaining ?? 0) === 0,
      updated, noTitle, notFound, errors, rateLimitHits,
      remaining: remaining ?? 0,
      batch: islands.length,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
