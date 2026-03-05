import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

type SkinRow = {
  skin_id: string;
  name: string;
  rarity: string;
  image_url: string;
  usage_30d: number;
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function mustEnv(key: string): string {
  const value = Deno.env.get(key);
  if (!value) throw new Error(`Missing env var: ${key}`);
  return value;
}

function toInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function normalizeText(v: unknown): string {
  return String(v || "").trim();
}

function mapSkinRow(row: Partial<SkinRow>) {
  return {
    id: normalizeText(row.skin_id),
    name: normalizeText(row.name),
    rarity: normalizeText(row.rarity || "unknown").toLowerCase(),
    image_url: normalizeText(row.image_url),
    usage_30d: Number(row.usage_30d || 0),
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const url = new URL(req.url);

    const q = normalizeText(body?.q ?? url.searchParams.get("q") ?? "");
    const page = toInt(body?.page ?? url.searchParams.get("page"), 1, 1, 5000);
    const limit = toInt(body?.limit ?? url.searchParams.get("limit"), 100, 1, 200);
    const offset = (page - 1) * limit;

    const service = createClient(mustEnv("SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));

    const [itemsRes, countRes] = await Promise.all([
      service.rpc("tgis_get_top_skins", {
        p_query: q || null,
        p_limit: limit,
        p_offset: offset,
        p_days: 30,
      }),
      service.rpc("tgis_count_skins", {
        p_query: q || null,
      }),
    ]);

    if (itemsRes.error) throw new Error(itemsRes.error.message);
    if (countRes.error) throw new Error(countRes.error.message);

    const rows = Array.isArray(itemsRes.data) ? itemsRes.data : [];
    const items = rows.map((row) => mapSkinRow(row as Partial<SkinRow>)).filter((x) => x.id && x.name && x.image_url);
    const total = Number(countRes.data || 0);

    return json({
      success: true,
      q,
      page,
      limit,
      total,
      items,
    });
  } catch (e) {
    return json({
      success: false,
      error: e instanceof Error ? e.message : String(e),
    }, 500);
  }
});
