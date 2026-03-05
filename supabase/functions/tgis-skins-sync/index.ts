import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-tgis-skins-sync-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

type SkinCatalogRow = {
  skin_id: string;
  name: string;
  rarity: string;
  image_url: string;
  is_active: boolean;
  sync_batch_id: string;
  source: string;
  updated_at: string;
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

function extractBearer(req: Request): string {
  const authHeader = (req.headers.get("Authorization") || req.headers.get("authorization") || "").trim();
  return authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
}

function normalizeText(v: unknown): string {
  return String(v || "").trim();
}

function normalizeItem(raw: any) {
  const id = normalizeText(raw?.id);
  const name = normalizeText(raw?.name);
  const typeVal = normalizeText(raw?.type?.value).toLowerCase();
  // Prefer portrait-like images for UI browsing (icon/smallIcon), fallback to featured.
  const image = normalizeText(raw?.images?.icon || raw?.images?.smallIcon || raw?.images?.featured);

  if (!id || !name) return null;
  if (typeVal && typeVal !== "outfit") return null;
  if (!image.startsWith("http")) return null;

  return {
    skin_id: id,
    name,
    rarity: normalizeText(raw?.rarity?.value || raw?.rarity?.displayValue || "unknown").toLowerCase(),
    image_url: image,
  };
}

async function fetchOutfitCatalog(): Promise<any[]> {
  const resp = await fetch("https://fortnite-api.com/v2/cosmetics/br?type=outfit&language=en", {
    headers: {
      Accept: "application/json",
      "User-Agent": "epic-insight-engine/tgis-skins-sync",
    },
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`fortnite_catalog_http_${resp.status}:${txt.slice(0, 220)}`);
  }
  const payload = await resp.json();
  return Array.isArray(payload?.data) ? payload.data : [];
}

async function upsertInBatches(
  service: ReturnType<typeof createClient>,
  rows: SkinCatalogRow[],
  batchSize = 500,
) {
  let upserted = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const { error } = await service
      .from("tgis_skins_catalog")
      .upsert(chunk, { onConflict: "skin_id" });
    if (error) throw new Error(`upsert_chunk_failed:${error.message}`);
    upserted += chunk.length;
  }
  return upserted;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startedAt = Date.now();
  try {
    if (req.method !== "POST") {
      return json({ success: false, error: "method_not_allowed" }, 405);
    }

    const serviceRoleKey = mustEnv("SUPABASE_SERVICE_ROLE_KEY");
    const token = extractBearer(req);
    const secretHeader = normalizeText(req.headers.get("x-tgis-skins-sync-secret") || "");
    const secretEnv = normalizeText(Deno.env.get("TGIS_SKINS_SYNC_SECRET") || "");
    const anonKey = normalizeText(Deno.env.get("SUPABASE_ANON_KEY") || "");

    // Auth policy:
    // - If TGIS_SKINS_SYNC_SECRET is configured, it is mandatory.
    // - Otherwise, allow service role token OR anonymous/internal call.
    if (secretEnv) {
      if (!secretHeader || secretHeader !== secretEnv) {
        return json({ success: false, error: "unauthorized" }, 401);
      }
    } else {
      const tokenLc = normalizeText(token);
      const allowed =
        (tokenLc && tokenLc === normalizeText(serviceRoleKey)) ||
        (tokenLc && anonKey && tokenLc === anonKey) ||
        !tokenLc;
      if (!allowed) {
        return json({ success: false, error: "unauthorized" }, 401);
      }
    }

    const service = createClient(mustEnv("SUPABASE_URL"), serviceRoleKey);
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const source = normalizeText(body?.source || "manual");
    const batchId = crypto.randomUUID();
    const nowIso = new Date().toISOString();

    const rawRows = await fetchOutfitCatalog();
    const dedup = new Map<string, any>();
    for (const raw of rawRows) {
      const item = normalizeItem(raw);
      if (!item) continue;
      if (!dedup.has(item.skin_id)) dedup.set(item.skin_id, item);
    }

    const rows: SkinCatalogRow[] = Array.from(dedup.values()).map((item) => ({
      skin_id: item.skin_id,
      name: item.name,
      rarity: item.rarity,
      image_url: item.image_url,
      is_active: true,
      sync_batch_id: batchId,
      source: `fortnite_api:${source}`,
      updated_at: nowIso,
    }));

    const upserted = await upsertInBatches(service, rows, 500);

    const { data: staleRows, error: staleSelectErr } = await service
      .from("tgis_skins_catalog")
      .select("skin_id")
      .eq("is_active", true)
      .neq("sync_batch_id", batchId);
    if (staleSelectErr) throw new Error(`stale_select_failed:${staleSelectErr.message}`);
    const staleIds = Array.isArray(staleRows) ? staleRows.map((r: any) => normalizeText(r.skin_id)).filter(Boolean) : [];

    let deactivated = 0;
    for (let i = 0; i < staleIds.length; i += 500) {
      const chunk = staleIds.slice(i, i + 500);
      const { error } = await service
        .from("tgis_skins_catalog")
        .update({ is_active: false, updated_at: nowIso, source: `fortnite_api:${source}` })
        .in("skin_id", chunk);
      if (error) throw new Error(`deactivate_chunk_failed:${error.message}`);
      deactivated += chunk.length;
    }

    const durationMs = Date.now() - startedAt;
    return json({
      success: true,
      synced_rows: rows.length,
      upserted_rows: upserted,
      deactivated_rows: deactivated,
      batch_id: batchId,
      duration_ms: durationMs,
    });
  } catch (e) {
    return json(
      {
        success: false,
        error: e instanceof Error ? e.message : String(e),
      },
      500,
    );
  }
});
