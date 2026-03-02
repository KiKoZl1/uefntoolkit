import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type RuntimeConfig = {
  max_generations_per_user_per_day: number;
  max_variants_per_generation: number;
  default_generation_cost_usd: number;
  openrouter_model: string;
  fal_generate_model: string;
  rewrite_temperature: number;
  rewrite_max_tokens: number;
  i2i_strength_default: number;
  lora_scale_default: number;
};

type ClusterManifestItem = {
  cluster_id: number;
  cluster_name: string;
  trigger_word: string;
  categories: string[];
  lora_fal_path: string | null;
  lora_version: string | null;
  reference_image_url: string | null;
  reference_tag: string | null;
  is_active: boolean;
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function mustEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

function asNum(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clampInt(v: unknown, fallback: number, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function clampFloat(v: unknown, fallback: number, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function extractBearer(req: Request): string {
  const authHeader = (req.headers.get("Authorization") || req.headers.get("authorization") || "").trim();
  return authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
}

function normalizeText(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function normalizeTagHint(input: string): string {
  return normalizeText((input || "").toLowerCase());
}

function pickImageUrls(payload: any): string[] {
  const direct = payload?.images;
  if (Array.isArray(direct)) {
    const urls = direct.map((x: any) => String(x?.url || x || "")).filter((x: string) => x.startsWith("http"));
    if (urls.length > 0) return urls;
  }
  const nested = payload?.data?.images;
  if (Array.isArray(nested)) {
    const urls = nested.map((x: any) => String(x?.url || x || "")).filter((x: string) => x.startsWith("http"));
    if (urls.length > 0) return urls;
  }
  const output = payload?.output;
  if (Array.isArray(output)) {
    const urls = output.map((x: any) => String(x?.url || x || "")).filter((x: string) => x.startsWith("http"));
    if (urls.length > 0) return urls;
  }
  return [];
}

function parsePngDimensions(bytes: Uint8Array): [number, number] | null {
  if (bytes.length < 24) return null;
  const pngSig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < pngSig.length; i++) {
    if (bytes[i] !== pngSig[i]) return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const w = view.getUint32(16, false);
  const h = view.getUint32(20, false);
  if (!w || !h) return null;
  return [w, h];
}

function parseJpegDimensions(bytes: Uint8Array): [number, number] | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = bytes[i + 1];
    if (marker === 0xd9 || marker === 0xda) break;
    const len = (bytes[i + 2] << 8) + bytes[i + 3];
    if (len < 2 || i + 1 + len >= bytes.length) break;
    if (
      marker === 0xc0 || marker === 0xc1 || marker === 0xc2 || marker === 0xc3 ||
      marker === 0xc5 || marker === 0xc6 || marker === 0xc7 || marker === 0xc9 ||
      marker === 0xca || marker === 0xcb || marker === 0xcd || marker === 0xce || marker === 0xcf
    ) {
      const h = (bytes[i + 5] << 8) + bytes[i + 6];
      const w = (bytes[i + 7] << 8) + bytes[i + 8];
      if (w > 0 && h > 0) return [w, h];
      return null;
    }
    i += 2 + len;
  }
  return null;
}

function parseWebpDimensions(bytes: Uint8Array): [number, number] | null {
  if (bytes.length < 30) return null;
  const tag = (start: number, len: number) => new TextDecoder().decode(bytes.slice(start, start + len));
  if (tag(0, 4) !== "RIFF" || tag(8, 4) !== "WEBP") return null;
  const chunk = tag(12, 4);

  if (chunk === "VP8 ") {
    // Lossy bitstream width/height in frame header offsets.
    if (bytes.length < 30) return null;
    const w = (bytes[26] | ((bytes[27] & 0x3f) << 8)) >>> 0;
    const h = (bytes[28] | ((bytes[29] & 0x3f) << 8)) >>> 0;
    if (w > 0 && h > 0) return [w, h];
    return null;
  }
  if (chunk === "VP8L") {
    if (bytes.length < 25) return null;
    const b0 = bytes[21];
    const b1 = bytes[22];
    const b2 = bytes[23];
    const b3 = bytes[24];
    const w = 1 + (((b1 & 0x3f) << 8) | b0);
    const h = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
    if (w > 0 && h > 0) return [w, h];
    return null;
  }
  if (chunk === "VP8X") {
    if (bytes.length < 30) return null;
    const w = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
    const h = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
    if (w > 0 && h > 0) return [w, h];
    return null;
  }
  return null;
}

async function fetchImageDimensions(url: string): Promise<[number, number] | null> {
  const r = await fetch(url);
  if (!r.ok) return null;
  const bytes = new Uint8Array(await r.arrayBuffer());
  return parsePngDimensions(bytes) || parseJpegDimensions(bytes) || parseWebpDimensions(bytes);
}

let ensuredGeneratedBucket = false;

async function ensureGeneratedBucket(service: ReturnType<typeof createClient>): Promise<void> {
  if (ensuredGeneratedBucket) return;
  ensuredGeneratedBucket = true;
  try {
    await service.storage.createBucket("tgis-generated", {
      public: true,
      fileSizeLimit: "20MB",
      allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
    });
  } catch {
    // Bucket likely already exists. Ignore and continue.
  }
}

async function normalizeOutput1920x1080(
  service: ReturnType<typeof createClient>,
  imageUrl: string,
  variantIndex: number,
): Promise<{
  url: string;
  width: number;
  height: number;
  transformed: boolean;
  original_width: number | null;
  original_height: number | null;
  storage_path?: string;
  normalization_error?: string | null;
}> {
  const originalDims = await fetchImageDimensions(imageUrl);
  if (originalDims && originalDims[0] === 1920 && originalDims[1] === 1080) {
    return {
      url: imageUrl,
      width: 1920,
      height: 1080,
      transformed: false,
      original_width: 1920,
      original_height: 1080,
      normalization_error: null,
    };
  }

  try {
    const r = await fetch(imageUrl);
    if (!r.ok) {
      throw new Error(`fallback_fetch_failed_${r.status}`);
    }
    const contentType = (r.headers.get("content-type") || "image/png").toLowerCase();
    const buf = new Uint8Array(await r.arrayBuffer());

    await ensureGeneratedBucket(service);
    const ext = contentType.includes("jpeg") ? "jpg" : contentType.includes("webp") ? "webp" : "png";
    const objectPath = `normalized/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}_${variantIndex + 1}.${ext}`;

    const { error: uploadErr } = await service.storage
      .from("tgis-generated")
      .upload(objectPath, buf, { contentType, upsert: false });
    if (uploadErr) {
      throw new Error(`fallback_upload_failed:${uploadErr.message}`);
    }

    const { data: transformed } = service.storage
      .from("tgis-generated")
      .getPublicUrl(objectPath, { transform: { width: 1920, height: 1080, resize: "cover" } });
    const transformedUrl = String(transformed?.publicUrl || "");
    if (!transformedUrl) {
      throw new Error("fallback_public_url_failed");
    }

    const finalDims = await fetchImageDimensions(transformedUrl);
    if (!finalDims || finalDims[0] !== 1920 || finalDims[1] !== 1080) {
      throw new Error(`fallback_unexpected_output_dimensions:${finalDims ? `${finalDims[0]}x${finalDims[1]}` : "unknown"}`);
    }

    return {
      url: transformedUrl,
      width: finalDims[0],
      height: finalDims[1],
      transformed: true,
      original_width: originalDims ? originalDims[0] : null,
      original_height: originalDims ? originalDims[1] : null,
      storage_path: objectPath,
      normalization_error: null,
    };
  } catch (e) {
    // Do not fail generation on normalization; return provider output.
    const msg = e instanceof Error ? e.message : String(e);
    return {
      url: imageUrl,
      width: originalDims ? originalDims[0] : 1920,
      height: originalDims ? originalDims[1] : 1080,
      transformed: false,
      original_width: originalDims ? originalDims[0] : null,
      original_height: originalDims ? originalDims[1] : null,
      normalization_error: msg,
    };
  }
}

async function resolveUser(req: Request, service: ReturnType<typeof createClient>) {
  const token = extractBearer(req);
  if (!token) return { userId: null as string | null, error: "missing_auth" };

  const authClient = createClient(mustEnv("SUPABASE_URL"), mustEnv("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await authClient.auth.getUser();
  if (error || !data.user?.id) return { userId: null as string | null, error: "invalid_auth" };

  const { data: roleRows } = await service
    .from("user_roles")
    .select("role")
    .eq("user_id", data.user.id)
    .limit(1);
  const role = String(roleRows?.[0]?.role || "");
  const isAdmin = role === "admin" || role === "editor";

  return { userId: data.user.id, error: null as string | null, isAdmin };
}

async function loadRuntimeConfig(service: ReturnType<typeof createClient>): Promise<RuntimeConfig> {
  const { data, error } = await service
    .from("tgis_runtime_config")
    .select("max_generations_per_user_per_day,max_variants_per_generation,default_generation_cost_usd,openrouter_model,fal_model,fal_generate_model,rewrite_temperature,rewrite_max_tokens,i2i_strength_default,lora_scale_default")
    .eq("config_key", "default")
    .limit(1);

  if (error) throw new Error(error.message);
  const row = Array.isArray(data) && data[0] ? data[0] as any : {};
  const fallbackFalModel = String(row.fal_model || "fal-ai/z-image/turbo/image-to-image/lora");
  return {
    max_generations_per_user_per_day: clampInt(row.max_generations_per_user_per_day, 50, 1, 200),
    max_variants_per_generation: clampInt(row.max_variants_per_generation, 4, 1, 8),
    default_generation_cost_usd: asNum(row.default_generation_cost_usd, 0.007),
    openrouter_model: String(row.openrouter_model || "openai/gpt-4o-mini"),
    fal_generate_model: String(row.fal_generate_model || fallbackFalModel),
    rewrite_temperature: asNum(row.rewrite_temperature, 0.4),
    rewrite_max_tokens: clampInt(row.rewrite_max_tokens, 220, 80, 600),
    i2i_strength_default: clampFloat(row.i2i_strength_default, 0.6, 0.0, 1.5),
    lora_scale_default: clampFloat(row.lora_scale_default, 0.6, 0.0, 2.0),
  };
}

async function loadManifest(service: ReturnType<typeof createClient>): Promise<ClusterManifestItem[]> {
  const { data, error } = await service.storage.from("tgis").download("cluster_manifest.json");
  if (!error && data) {
    const txt = await data.text();
    try {
      const parsed = JSON.parse(txt);
      const clusters = Array.isArray(parsed?.clusters) ? parsed.clusters : [];
      return clusters
        .map((c: any) => ({
          cluster_id: Number(c?.cluster_id),
          cluster_name: String(c?.cluster_name || ""),
          trigger_word: String(c?.trigger_word || ""),
          categories: Array.isArray(c?.categories) ? c.categories.map((x: any) => String(x)) : [],
          lora_fal_path: c?.lora_fal_path ? String(c.lora_fal_path) : null,
          lora_version: c?.lora_version ? String(c.lora_version) : null,
          reference_image_url: c?.reference_image_url ? String(c.reference_image_url) : null,
          reference_tag: c?.reference_tag ? String(c.reference_tag) : null,
          is_active: c?.is_active !== false,
        }))
        .filter((c: ClusterManifestItem) => Number.isFinite(c.cluster_id) && c.cluster_name && c.is_active);
    } catch {
      // fallback to DB below
    }
  }

  const { data: dbRows, error: dbErr } = await service
    .from("tgis_cluster_registry")
    .select("cluster_id,cluster_name,trigger_word,categories_json,lora_fal_path,lora_version,reference_image_url,reference_tag,is_active")
    .eq("is_active", true)
    .order("cluster_id", { ascending: true });
  if (dbErr) throw new Error(dbErr.message);

  return (dbRows || []).map((r: any) => ({
    cluster_id: Number(r.cluster_id),
    cluster_name: String(r.cluster_name || ""),
    trigger_word: String(r.trigger_word || ""),
    categories: Array.isArray(r.categories_json) ? r.categories_json.map((x: any) => String(x)) : [],
    lora_fal_path: r.lora_fal_path ? String(r.lora_fal_path) : null,
    lora_version: r.lora_version ? String(r.lora_version) : null,
    reference_image_url: r.reference_image_url ? String(r.reference_image_url) : null,
    reference_tag: r.reference_tag ? String(r.reference_tag) : null,
    is_active: Boolean(r.is_active),
  })).filter((c: ClusterManifestItem) => Number.isFinite(c.cluster_id) && c.cluster_name);
}

function resolveCluster(category: string, clusters: ClusterManifestItem[]): ClusterManifestItem | null {
  if (!clusters.length) return null;
  const normalized = category.toLowerCase().trim();
  const exact = clusters.find((c) =>
    c.categories.some((x) => String(x).toLowerCase().trim() === normalized),
  );
  if (exact) return exact;

  const partial = clusters.find((c) =>
    c.cluster_name.toLowerCase().includes(normalized) ||
    c.categories.some((x) => String(x).toLowerCase().includes(normalized)),
  );
  if (partial) return partial;

  return clusters[0];
}

async function checkPromptSafety(service: ReturnType<typeof createClient>, prompt: string) {
  const lowered = prompt.toLowerCase();
  const { data, error } = await service
    .from("tgis_blocklist_terms")
    .select("term")
    .eq("is_active", true)
    .limit(500);
  if (error) throw new Error(error.message);
  const terms = (data || []).map((r: any) => String(r.term || "").toLowerCase().trim()).filter(Boolean);
  const hit = terms.find((term: string) => lowered.includes(term));
  return { blocked: Boolean(hit), term: hit || null };
}

function isAllowedReferenceUrl(url: string): boolean {
  if (!url.startsWith("http")) return false;
  const supabaseUrl = mustEnv("SUPABASE_URL");
  const bucketPrefix = `${supabaseUrl}/storage/v1/object/public/tgis-user-references/`;
  if (url.startsWith(bucketPrefix)) return true;

  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    return /^cdn-\d+\.qstv\.on\.epicgames\.com$/.test(host);
  } catch {
    return false;
  }
}

async function pickReferenceImage(args: {
  service: ReturnType<typeof createClient>;
  cluster: ClusterManifestItem;
  userReferenceUrl: string;
  tagHint: string;
}) {
  const userRef = args.userReferenceUrl.trim();
  if (userRef) {
    if (!isAllowedReferenceUrl(userRef)) {
      throw new Error("invalid_reference_image_url");
    }
    return { url: userRef, source: "user_upload", tag: args.tagHint || null };
  }

  const normalizedTag = normalizeTagHint(args.tagHint);
  const { data: refRows, error: refErr } = await args.service
    .from("tgis_reference_images")
    .select("tag_group,rank,image_url,quality_score")
    .eq("cluster_id", args.cluster.cluster_id)
    .lte("rank", 3)
    .order("rank", { ascending: true });
  if (refErr) throw new Error(refErr.message);

  const refs = Array.isArray(refRows) ? refRows as any[] : [];
  if (normalizedTag && refs.length) {
    const byHint = refs.filter((r) => {
      const tg = normalizeTagHint(String(r.tag_group || ""));
      return tg === normalizedTag || tg.includes(normalizedTag) || normalizedTag.includes(tg);
    });
    if (byHint[0]?.image_url) {
      return {
        url: String(byHint[0].image_url),
        source: "reference_top3_tag",
        tag: String(byHint[0].tag_group || ""),
      };
    }
  }

  if (args.cluster.reference_image_url) {
    return {
      url: args.cluster.reference_image_url,
      source: "cluster_default",
      tag: args.cluster.reference_tag,
    };
  }

  const { data: dbRows, error: dbErr } = await args.service
    .from("tgis_cluster_registry")
    .select("reference_image_url,reference_tag")
    .eq("cluster_id", args.cluster.cluster_id)
    .limit(1);
  if (dbErr) throw new Error(dbErr.message);
  const row = Array.isArray(dbRows) && dbRows[0] ? dbRows[0] as any : null;
  if (row?.reference_image_url) {
    return {
      url: String(row.reference_image_url),
      source: "cluster_registry",
      tag: row.reference_tag ? String(row.reference_tag) : null,
    };
  }

  return null;
}

async function generateOneFal(args: {
  prompt: string;
  seed: number;
  referenceImageUrl: string;
  strength: number;
  loraPath: string;
  loraScale: number;
  cfg: RuntimeConfig;
}) {
  const falKey = Deno.env.get("FAL_API_KEY") || Deno.env.get("FAL_KEY") || "";
  if (!falKey) throw new Error("Missing env var: FAL_API_KEY/FAL_KEY");
  const body: Record<string, unknown> = {
    prompt: args.prompt,
    image_url: args.referenceImageUrl,
    strength: args.strength,
    seed: args.seed,
    image_size: { width: 1920, height: 1080 },
    num_images: 1,
    num_inference_steps: 8,
    negative_prompt: "text, letters, words, watermark, logo, subtitle, username, UI, HUD, overlay",
    loras: [{ path: args.loraPath, scale: args.loraScale }],
  };

  const resp = await fetch(`https://fal.run/${args.cfg.fal_generate_model}`, {
    method: "POST",
    headers: {
      Authorization: `Key ${falKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`fal_http_${resp.status}:${txt.slice(0, 240)}`);
  }
  const payload = await resp.json();
  const urls = pickImageUrls(payload);
  if (!urls.length) throw new Error("fal_no_image_url");

  const firstUrl = urls[0];
  const dims = await fetchImageDimensions(firstUrl);
  return {
    url: firstUrl,
    seed: args.seed,
    raw: payload,
    width: dims ? dims[0] : null,
    height: dims ? dims[1] : null,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startedAt = Date.now();
  const service = createClient(mustEnv("SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
  let generationId: string | null = null;

  try {
    const auth = await resolveUser(req, service);
    if (!auth.userId || auth.error) return json({ success: false, error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const rawPrompt = normalizeText(String(body?.prompt || ""));
    const categoryRaw = normalizeText(String(body?.category || ""));
    const tagHint = normalizeTagHint(String(body?.tagHint || ""));
    const referenceImageUrl = normalizeText(String(body?.referenceImageUrl || ""));
    const clusterIdOverride = Number(body?.clusterIdOverride);
    const loraPathOverride = normalizeText(String(body?.loraPathOverride || ""));
    const loraVersionOverride = normalizeText(String(body?.loraVersionOverride || ""));
    const strengthOverride = Number(body?.strengthOverride);
    const loraScaleOverride = Number(body?.loraScaleOverride);
    const hasAdminOverride = Boolean(
      Number.isFinite(clusterIdOverride) || loraPathOverride || loraVersionOverride || Number.isFinite(strengthOverride) || Number.isFinite(loraScaleOverride),
    );
    if (hasAdminOverride && !auth.isAdmin) {
      return json({ success: false, error: "admin_override_forbidden" }, 403);
    }

    let category = categoryRaw;
    if (!rawPrompt) return json({ success: false, error: "missing_prompt" }, 400);
    if (!category && !Number.isFinite(clusterIdOverride)) return json({ success: false, error: "missing_category" }, 400);

    const cfg = await loadRuntimeConfig(service);
    const requestedVariants = clampInt(body?.variants, cfg.max_variants_per_generation, 1, cfg.max_variants_per_generation);

    const { data: allowance, error: allowanceErr } = await service.rpc("tgis_can_generate", {
      p_user_id: auth.userId,
    });
    if (allowanceErr) throw new Error(allowanceErr.message);
    const allowed = Boolean((allowance as any)?.allowed);
    if (!allowed) {
      const reason = String((allowance as any)?.reason || "blocked");
      return json(
        { success: false, error: reason, allowance: allowance || null },
        reason === "beta_closed" ? 403 : 429,
      );
    }

    const safety = await checkPromptSafety(service, rawPrompt);
    if (safety.blocked) {
      const { data: blockedRows } = await service
        .from("tgis_generation_log")
        .insert({
          user_id: auth.userId,
          prompt_raw: rawPrompt,
          category,
          status: "blocked",
          error_text: `blocked_term:${safety.term}`,
        })
        .select("id")
        .limit(1);
      generationId = blockedRows?.[0]?.id || null;
      return json({ success: false, error: "prompt_blocked", reason: `blocked_term:${safety.term}` }, 400);
    }

    const clusters = await loadManifest(service);
    let cluster: ClusterManifestItem | null = null;
    if (Number.isFinite(clusterIdOverride)) {
      cluster = clusters.find((c) => c.cluster_id === Number(clusterIdOverride)) || null;
    } else {
      cluster = resolveCluster(category, clusters);
    }
    if (!cluster) return json({ success: false, error: "no_cluster_available" }, 503);
    if (!category) {
      category = (cluster.categories && cluster.categories[0]) || cluster.cluster_name.replace(/^cluster_/, "") || "fortnite";
    }

    let loraPath = cluster.lora_fal_path ? String(cluster.lora_fal_path) : "";
    let loraVersion = cluster.lora_version ? String(cluster.lora_version) : null;

    if (loraVersionOverride) {
      const { data: modelRows, error: modelErr } = await service
        .from("tgis_model_versions")
        .select("lora_fal_path,version")
        .eq("cluster_id", cluster.cluster_id)
        .eq("version", loraVersionOverride)
        .limit(1);
      if (modelErr) throw new Error(modelErr.message);
      const modelRow = Array.isArray(modelRows) && modelRows[0] ? modelRows[0] as any : null;
      if (!modelRow?.lora_fal_path) return json({ success: false, error: "override_model_not_found" }, 404);
      loraPath = String(modelRow.lora_fal_path);
      loraVersion = String(modelRow.version || loraVersionOverride);
    }
    if (loraPathOverride) {
      loraPath = loraPathOverride;
      loraVersion = loraVersionOverride || loraVersion || "override";
    }
    if (!loraPath) return json({ success: false, error: "cluster_model_missing" }, 409);

    const i2iStrength = Number.isFinite(strengthOverride)
      ? clampFloat(strengthOverride, cfg.i2i_strength_default, 0.0, 1.5)
      : cfg.i2i_strength_default;
    const loraScale = Number.isFinite(loraScaleOverride)
      ? clampFloat(loraScaleOverride, cfg.lora_scale_default, 0.0, 2.0)
      : cfg.lora_scale_default;

    const pickedRef = await pickReferenceImage({
      service,
      cluster,
      userReferenceUrl: referenceImageUrl,
      tagHint,
    });
    if (!pickedRef?.url) return json({ success: false, error: "no_reference_image_available" }, 409);

    const rewrite = {
      rewritten: normalizeText(
        `fortnite creative ${category} thumbnail, ${rawPrompt}, uefn style, dynamic action, high contrast composition, clear focal subject, no text overlay`,
      ),
      provider: "rewrite_disabled_deterministic",
    };

    const { data: genRows, error: genErr } = await service
      .from("tgis_generation_log")
      .insert({
        user_id: auth.userId,
        prompt_raw: rawPrompt,
        prompt_rewritten: rewrite.rewritten,
        category,
        cluster_id: cluster.cluster_id,
        model_base: "Tongyi-MAI/Z-Image-Turbo",
        lora_version: loraVersion,
        provider: "fal.ai",
        model_name: cfg.fal_generate_model,
        variants: requestedVariants,
        status: "queued",
        metadata_json: {
          rewrite_provider: rewrite.provider,
          cluster_name: cluster.cluster_name,
          reference_source: pickedRef.source,
          reference_url: pickedRef.url,
          reference_tag: pickedRef.tag,
          i2i_strength: i2iStrength,
          lora_scale: loraScale,
          override_used: hasAdminOverride,
          override_lora_version: loraVersionOverride || null,
          override_lora_path: loraPathOverride || null,
          tag_hint: tagHint || null,
        },
      })
      .select("id")
      .limit(1);
    if (genErr) throw new Error(genErr.message);
    generationId = genRows?.[0]?.id || null;

    if (generationId) {
      await service.from("tgis_prompt_rewrite_log").insert({
        generation_id: generationId,
        user_id: auth.userId,
        prompt_raw: rawPrompt,
        prompt_rewritten: rewrite.rewritten,
        category,
        cluster_id: cluster.cluster_id,
        provider: rewrite.provider,
        model_name: cfg.openrouter_model,
      });
    }

    const seeds = Array.from({ length: requestedVariants }, (_, i) => Math.floor(Date.now() / 1000) + i * 17);
    const rawResults = await Promise.all(
      seeds.map((seed) =>
        generateOneFal({
          prompt: rewrite.rewritten,
          seed,
          referenceImageUrl: pickedRef.url,
          strength: i2iStrength,
          loraPath,
          loraScale,
          cfg,
        }),
      ),
    );

    const results = await Promise.all(
      rawResults.map(async (r, idx) => {
        const normalized = await normalizeOutput1920x1080(service, r.url, idx);
        return {
          ...r,
          ...normalized,
        };
      }),
    );

    const latencyMs = Date.now() - startedAt;
    const imageRows = results.map((r) => ({
      url: r.url,
      seed: r.seed,
      width: r.width,
      height: r.height,
      transformed: r.transformed,
      original_width: r.original_width,
      original_height: r.original_height,
      normalization_error: r.normalization_error || null,
    }));
    const costUsd = Number((cfg.default_generation_cost_usd * (requestedVariants / cfg.max_variants_per_generation)).toFixed(6));

    if (generationId) {
      await service
        .from("tgis_generation_log")
        .update({
          status: "success",
          images_json: imageRows,
          latency_ms: latencyMs,
          cost_usd: costUsd,
          updated_at: new Date().toISOString(),
          metadata_json: {
            rewrite_provider: rewrite.provider,
            cluster_name: cluster.cluster_name,
            reference_source: pickedRef.source,
            reference_url: pickedRef.url,
            reference_tag: pickedRef.tag,
            i2i_strength: i2iStrength,
            lora_scale: loraScale,
            override_used: hasAdminOverride,
            override_lora_version: loraVersionOverride || null,
            override_lora_path: loraPathOverride || null,
            enforced_output_width: 1920,
            enforced_output_height: 1080,
            transformed_variants: results.filter((r) => r.transformed).length,
            normalization_errors: results.filter((r) => r.normalization_error).map((r) => r.normalization_error),
            tag_hint: tagHint || null,
          },
        })
        .eq("id", generationId);

      await service.rpc("tgis_record_generation_cost", {
        p_generation_id: generationId,
        p_provider: "fal.ai",
        p_model_name: cfg.fal_generate_model,
        p_cost_usd: costUsd,
        p_images_generated: requestedVariants,
      });
    }

    return json({
      success: true,
      generation_id: generationId,
      cluster_id: cluster.cluster_id,
      cluster_name: cluster.cluster_name,
      model_version: loraVersion,
      images: imageRows,
      cost_usd: costUsd,
      latency_ms: latencyMs,
      rewritten_prompt: rewrite.rewritten,
      reference_source: pickedRef.source,
      reference_tag: pickedRef.tag,
      reference_url: pickedRef.url,
    });
  } catch (e) {
    if (generationId) {
      try {
        await service
          .from("tgis_generation_log")
          .update({
            status: "failed",
            error_text: e instanceof Error ? e.message : String(e),
            latency_ms: Date.now() - startedAt,
            updated_at: new Date().toISOString(),
          })
          .eq("id", generationId);
      } catch {
        // swallow
      }
    }
    return json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
