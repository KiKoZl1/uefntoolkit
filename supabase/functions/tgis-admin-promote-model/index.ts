import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function mustEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function extractBearer(req: Request): string {
  const authHeader = (req.headers.get("Authorization") || req.headers.get("authorization") || "").trim();
  return authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    let b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4;
    if (pad) b64 += "=".repeat(4 - pad);
    const payload = JSON.parse(atob(b64));
    return payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function resolveAuth(req: Request, serviceClient: ReturnType<typeof createClient>) {
  const serviceKey = mustEnv("SUPABASE_SERVICE_ROLE_KEY");
  const bearer = extractBearer(req);
  const apiKey = (req.headers.get("apikey") || "").trim();
  if ((bearer && bearer === serviceKey) || (apiKey && apiKey === serviceKey)) {
    return { allowed: true, userId: null as string | null };
  }
  const bearerPayload = bearer ? decodeJwtPayload(bearer) : null;
  const apiPayload = apiKey ? decodeJwtPayload(apiKey) : null;
  if (String(bearerPayload?.role || "") === "service_role") {
    return { allowed: true, userId: null as string | null };
  }
  if (String(apiPayload?.role || "") === "service_role") {
    return { allowed: true, userId: null as string | null };
  }
  if (!bearer) return { allowed: false, userId: null as string | null };

  const authClient = createClient(mustEnv("SUPABASE_URL"), mustEnv("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: `Bearer ${bearer}` } },
  });
  const { data: userRes, error: userErr } = await authClient.auth.getUser();
  if (userErr || !userRes.user?.id) return { allowed: false, userId: null as string | null };

  const { data: roleRows, error: roleErr } = await serviceClient
    .from("user_roles")
    .select("role")
    .eq("user_id", userRes.user.id)
    .limit(1);
  if (roleErr || !Array.isArray(roleRows) || roleRows.length === 0) return { allowed: false, userId: userRes.user.id };
  const role = String(roleRows[0]?.role || "");
  return { allowed: role === "admin" || role === "editor", userId: userRes.user.id };
}

async function syncManifest(service: ReturnType<typeof createClient>) {
  const { data: rows, error } = await service
    .from("tgis_cluster_registry")
    .select("cluster_id,cluster_name,cluster_slug,cluster_family,routing_tags,trigger_word,categories_json,lora_fal_path,lora_version,is_active,updated_at")
    .eq("is_active", true)
    .order("cluster_id", { ascending: true });
  if (error) throw new Error(error.message);

  const clusters = (rows || []).map((r: any) => ({
    cluster_id: Number(r.cluster_id),
    cluster_name: String(r.cluster_name || ""),
    cluster_slug: r.cluster_slug ? String(r.cluster_slug) : null,
    cluster_family: r.cluster_family ? String(r.cluster_family) : null,
    routing_tags: Array.isArray(r.routing_tags) ? r.routing_tags.map((x: any) => String(x)) : [],
    trigger_word: String(r.trigger_word || ""),
    categories: Array.isArray(r.categories_json) ? r.categories_json.map((x: any) => String(x)) : [],
    lora_fal_path: r.lora_fal_path || null,
    lora_version: r.lora_version || null,
    is_active: Boolean(r.is_active),
  }));

  const manifest = {
    version: "1.0.0",
    updated_at: new Date().toISOString(),
    n_clusters: clusters.length,
    clusters,
  };

  const payload = JSON.stringify(manifest, null, 2);
  const { error: upErr } = await service.storage.from("tgis").upload(
    "cluster_manifest.json",
    new Blob([payload], { type: "application/json" }),
    { upsert: true, contentType: "application/json" },
  );
  if (upErr) throw new Error(upErr.message);
  return manifest;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const service = createClient(mustEnv("SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const auth = await resolveAuth(req, service);
    if (!auth.allowed) return json({ success: false, error: "forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    const clusterId = Number(body?.clusterId);
    const version = String(body?.version || "").trim();
    const doSync = body?.syncManifest !== false;
    if (!Number.isFinite(clusterId) || !version) return json({ success: false, error: "missing_cluster_or_version" }, 400);

    const { data: result, error: rpcErr } = await service.rpc("tgis_set_active_model", {
      p_cluster_id: clusterId,
      p_version: version,
      p_updated_by: auth.userId,
    });
    if (rpcErr) throw new Error(rpcErr.message);

    const { error: modelErr } = await service
      .from("tgis_model_versions")
      .update({
        status: "active",
        promoted_by: auth.userId,
        promoted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("cluster_id", clusterId)
      .eq("version", version);
    if (modelErr) throw new Error(modelErr.message);

    let manifest: unknown = null;
    if (doSync) manifest = await syncManifest(service);

    return json({
      success: true,
      promoted: result || { cluster_id: clusterId, version },
      manifest_synced: doSync,
      manifest,
    });
  } catch (e) {
    return json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
