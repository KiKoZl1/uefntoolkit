import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export type RuntimeToolConfig = {
  default_generation_cost_usd: number;
  nano_model: string;
  openrouter_model: string;
  context_boost_default: boolean;
  camera_model: string;
  camera_steps: number;
  layer_model: string;
  layer_default_count: number;
  layer_min_count: number;
  layer_max_count: number;
};

export type ResolvedUser = {
  userId: string;
  isAdmin: boolean;
  token: string;
};

export type CommerceGatewayContext = {
  operationId: string;
  gatewayUserId: string;
  idempotencyKey: string | null;
};

export function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

export function mustEnv(key: string): string {
  const value = Deno.env.get(key);
  if (!value) throw new Error(`Missing env var: ${key}`);
  return value;
}

export function createServiceClient() {
  return createClient(mustEnv("SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
}

export function extractBearer(req: Request): string {
  const authHeader = (req.headers.get("Authorization") || req.headers.get("authorization") || "").trim();
  return authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
}

function getEnvBool(name: string, fallback: boolean): boolean {
  const raw = String(Deno.env.get(name) || "").trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const keyData = new TextEncoder().encode(secret);
  const msgData = new TextEncoder().encode(payload);
  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, msgData);
  const bytes = new Uint8Array(signature);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function requireCommerceGateway(
  req: Request,
  auth: ResolvedUser,
  toolCode: "surprise_gen" | "edit_studio" | "camera_control" | "layer_decomposition",
): Promise<CommerceGatewayContext | null> {
  const enforce = getEnvBool("COMMERCE_GATEWAY_ENFORCE", true);
  if (!enforce || auth.isAdmin) return null;

  const secret = String(Deno.env.get("COMMERCE_GATEWAY_SECRET") || "").trim();
  if (!secret) throw new Error("commerce_gateway_misconfigured");

  const signature = String(req.headers.get("x-commerce-gateway-signature") || "").trim().toLowerCase();
  const operationId = String(req.headers.get("x-commerce-operation-id") || "").trim();
  const gatewayUserId = String(req.headers.get("x-commerce-user-id") || "").trim();
  const gatewayToolCode = String(req.headers.get("x-commerce-tool-code") || "").trim();
  const idempotencyKey = String(req.headers.get("x-commerce-idempotency-key") || "").trim() || null;

  if (!signature || !operationId || !gatewayUserId || !gatewayToolCode) {
    throw new Error("commerce_gateway_required");
  }
  if (gatewayUserId !== auth.userId) {
    throw new Error("commerce_gateway_user_mismatch");
  }
  if (gatewayToolCode !== toolCode) {
    throw new Error("commerce_gateway_tool_mismatch");
  }

  const expected = await hmacSha256Hex(secret, `${operationId}:${gatewayUserId}:${gatewayToolCode}`);
  if (!constantTimeEqual(signature, expected)) {
    throw new Error("commerce_gateway_signature_invalid");
  }

  return { operationId, gatewayUserId, idempotencyKey };
}

export async function resolveUser(req: Request, service = createServiceClient()): Promise<ResolvedUser> {
  const token = extractBearer(req);
  if (!token) throw new Error("unauthorized");

  const authClient = createClient(mustEnv("SUPABASE_URL"), mustEnv("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: userRes, error: userErr } = await authClient.auth.getUser();
  if (userErr || !userRes.user?.id) throw new Error("unauthorized");

  const { data: roleRows } = await service
    .from("user_roles")
    .select("role")
    .eq("user_id", userRes.user.id)
    .limit(1);
  const role = String(roleRows?.[0]?.role || "");
  return {
    userId: userRes.user.id,
    isAdmin: role === "admin" || role === "editor",
    token,
  };
}

export function normalizeText(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function normalizeTag(value: unknown): string {
  return normalizeText(value).toLowerCase();
}

export function normalizeSlug(value: unknown): string {
  return normalizeTag(value).replace(/[^a-z0-9_\- ]+/g, "").replace(/[\s-]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
}

export function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

export function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function parseTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => normalizeTag(v)).filter(Boolean).slice(0, 30);
  }
  const raw = normalizeText(value);
  if (!raw) return [];
  return raw.split(",").map((v) => normalizeTag(v)).filter(Boolean).slice(0, 30);
}

export function uniqueStrings(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of values) {
    const v = normalizeText(item);
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

export function isAllowedImageUrl(urlRaw: string): boolean {
  try {
    const url = new URL(urlRaw);
    if (!["https:"].includes(url.protocol)) return false;
    const host = url.hostname.toLowerCase();
    const path = url.pathname || "";

    if (host.endsWith(".supabase.co")) {
      if (path.includes("/storage/v1/object/public/")) return true;
      if (path.includes("/storage/v1/object/sign/")) return true;
      if (path.includes("/storage/v1/object/authenticated/")) return true;
      if (path.includes("/object/public/")) return true;
      if (path.includes("/object/sign/")) return true;
      return false;
    }

    if (host.endsWith(".epicgames.com")) return true;
    if (host === "fortnite-api.com" || host.endsWith(".fortnite-api.com")) return true;
    if (host.endsWith(".fal.media")) return true;
    if (host.endsWith(".fal.run")) return true;
    return false;
  } catch {
    return false;
  }
}

function parsePngDimensions(bytes: Uint8Array): [number, number] | null {
  if (bytes.length < 24) return null;
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < sig.length; i += 1) {
    if (bytes[i] !== sig[i]) return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return [view.getUint32(16, false), view.getUint32(20, false)];
}

function parseJpegDimensions(bytes: Uint8Array): [number, number] | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i += 1;
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
      return [w, h];
    }
    i += 2 + len;
  }
  return null;
}

async function imageDimensionsFromUrl(url: string): Promise<[number, number] | null> {
  const resp = await fetch(url);
  if (!resp.ok) return null;
  const bytes = new Uint8Array(await resp.arrayBuffer());
  return parsePngDimensions(bytes) || parseJpegDimensions(bytes);
}

const ensuredBuckets = new Set<string>();

export async function ensureBucket(service: ReturnType<typeof createClient>, bucketName: string, isPublic = true): Promise<void> {
  if (ensuredBuckets.has(bucketName)) return;
  ensuredBuckets.add(bucketName);
  try {
    await service.storage.createBucket(bucketName, {
      public: isPublic,
      fileSizeLimit: "25MB",
      allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
    });
  } catch {
    // likely exists
  }
}

export async function normalizeAndStore1920x1080(
  service: ReturnType<typeof createClient>,
  sourceUrl: string,
  prefix = "tool",
): Promise<{ url: string; width: number; height: number; storage_path: string; raw_path: string }> {
  await ensureBucket(service, "tgis-generated", true);

  const srcResp = await fetch(sourceUrl);
  if (!srcResp.ok) {
    throw new Error(`source_image_fetch_failed_${srcResp.status}`);
  }
  const srcContentType = (srcResp.headers.get("content-type") || "image/png").toLowerCase();
  const srcBytes = new Uint8Array(await srcResp.arrayBuffer());
  const rawExt = srcContentType.includes("jpeg") ? "jpg" : srcContentType.includes("webp") ? "webp" : "png";

  const day = new Date().toISOString().slice(0, 10);
  const rawPath = `raw/${prefix}/${day}/${crypto.randomUUID()}.${rawExt}`;
  const finalPath = `final/${prefix}/${day}/${crypto.randomUUID()}_1920x1080.png`;

  const uploadWithRetry = async (
    targetPath: string,
    bytes: Uint8Array,
    contentType: string,
    label: "raw" | "final",
  ): Promise<void> => {
    const maxAttempts = 4;
    let lastMessage = "unknown";
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const { error } = await service.storage
        .from("tgis-generated")
        .upload(targetPath, bytes, {
          contentType,
          upsert: false,
        });
      if (!error) return;

      lastMessage = normalizeText(error.message || "unknown");
      const transient =
        /timeout|timed out|temporar|rate|connection|network|fetch failed|server error|gateway/i.test(lastMessage);
      if (!transient || attempt === maxAttempts) break;
      await new Promise((resolve) => setTimeout(resolve, 600 * attempt));
    }
    throw new Error(`${label}_upload_failed:${lastMessage}`);
  };

  await uploadWithRetry(rawPath, srcBytes, srcContentType, "raw");

  const coverPublic = service.storage
    .from("tgis-generated")
    .getPublicUrl(rawPath, { transform: { width: 1920, height: 1080, resize: "cover" } });
  const coverUrl = String(coverPublic?.data?.publicUrl || "").trim();
  if (!coverUrl) throw new Error("transformed_url_missing");

  const coverResp = await fetch(coverUrl);
  if (!coverResp.ok) throw new Error(`transformed_fetch_failed_${coverResp.status}`);
  let transformedBytes = new Uint8Array(await coverResp.arrayBuffer());
  let transformedType = (coverResp.headers.get("content-type") || "image/png").toLowerCase();

  let dims = parsePngDimensions(transformedBytes) || parseJpegDimensions(transformedBytes);

  // Some providers return 1920x1072 (multiple-of-16 output). Try contain as a second pass.
  if (!dims || dims[0] !== 1920 || dims[1] !== 1080) {
    const containPublic = service.storage
      .from("tgis-generated")
      .getPublicUrl(rawPath, { transform: { width: 1920, height: 1080, resize: "contain" } });
    const containUrl = String(containPublic?.data?.publicUrl || "").trim();
    if (containUrl) {
      const containResp = await fetch(containUrl);
      if (containResp.ok) {
        const candidateBytes = new Uint8Array(await containResp.arrayBuffer());
        const candidateType = (containResp.headers.get("content-type") || "image/png").toLowerCase();
        const candidateDims = parsePngDimensions(candidateBytes) || parseJpegDimensions(candidateBytes);
        if (candidateDims && candidateDims[0] === 1920 && candidateDims[1] === 1080) {
          transformedBytes = candidateBytes;
          transformedType = candidateType;
          dims = candidateDims;
        }
      }
    }
  }

  await uploadWithRetry(finalPath, transformedBytes, transformedType, "final");

  const finalPublic = service.storage.from("tgis-generated").getPublicUrl(finalPath);
  const finalUrl = String(finalPublic?.data?.publicUrl || "").trim();
  if (!finalUrl) throw new Error("final_public_url_missing");

  // Never hard-fail tool run because of provider rounding (e.g. 1920x1072).
  const finalDims = await imageDimensionsFromUrl(finalUrl);
  const finalWidth = finalDims?.[0] ?? dims?.[0] ?? 1920;
  const finalHeight = finalDims?.[1] ?? dims?.[1] ?? 1080;

  return {
    url: finalUrl,
    width: finalWidth,
    height: finalHeight,
    storage_path: finalPath,
    raw_path: rawPath,
  };
}

export function pickImageUrlFromFal(payload: any): string {
  const direct = normalizeText(payload?.image?.url || payload?.image_url || payload?.url || "");
  if (direct.startsWith("http")) return direct;

  const images = Array.isArray(payload?.images) ? payload.images : [];
  for (const item of images) {
    const url = normalizeText(item?.url || item || "");
    if (url.startsWith("http")) return url;
  }

  const dataImages = Array.isArray(payload?.data?.images) ? payload.data.images : [];
  for (const item of dataImages) {
    const url = normalizeText(item?.url || item || "");
    if (url.startsWith("http")) return url;
  }

  const output = Array.isArray(payload?.output) ? payload.output : [];
  for (const item of output) {
    const url = normalizeText(item?.url || item || "");
    if (url.startsWith("http")) return url;
  }

  const candidate = normalizeText(payload?.output?.url || payload?.result?.url || "");
  if (candidate.startsWith("http")) return candidate;
  return "";
}

export function pickLayerUrlsFromFal(payload: any): string[] {
  const out: string[] = [];
  const add = (candidate: unknown) => {
    const url = normalizeText((candidate as any)?.url || candidate || "");
    if (url.startsWith("http")) out.push(url);
  };

  const layers = Array.isArray(payload?.layers)
    ? payload.layers
    : Array.isArray(payload?.output?.layers)
      ? payload.output.layers
      : Array.isArray(payload?.data?.layers)
        ? payload.data.layers
        : Array.isArray(payload?.images)
          ? payload.images
          : Array.isArray(payload?.output)
            ? payload.output
            : [];

  for (const item of layers) add(item);
  return uniqueStrings(out);
}

export async function callFalModel(args: {
  model: string;
  input: Record<string, unknown>;
  timeoutMs?: number;
}): Promise<any> {
  const falKey = mustEnv("FAL_API_KEY");
  const controller = new AbortController();
  const timeoutMs = args.timeoutMs ?? 180000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`https://fal.run/${args.model}`, {
      method: "POST",
      headers: {
        Authorization: `Key ${falKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args.input),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`fal_http_${resp.status}:${txt.slice(0, 320)}`);
    }
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function loadRuntimeToolConfig(service: ReturnType<typeof createClient>): Promise<RuntimeToolConfig> {
  const { data, error } = await service
    .from("tgis_runtime_config")
    .select("default_generation_cost_usd,nano_model,openrouter_model,context_boost_default,camera_model,camera_steps,layer_model,layer_default_count,layer_min_count,layer_max_count")
    .eq("config_key", "default")
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);

  return {
    default_generation_cost_usd: Number(data?.default_generation_cost_usd || 0.135),
    nano_model: normalizeText(data?.nano_model || "fal-ai/nano-banana-2/edit"),
    openrouter_model: normalizeText(data?.openrouter_model || "openai/gpt-4o"),
    context_boost_default: Boolean(data?.context_boost_default ?? true),
    camera_model: normalizeText(data?.camera_model || "fal-ai/qwen-image-edit-2511-multiple-angles"),
    camera_steps: clampInt(data?.camera_steps, 8, 1, 32),
    layer_model: normalizeText(data?.layer_model || "fal-ai/qwen-image-layered"),
    layer_default_count: clampInt(data?.layer_default_count, 4, 2, 10),
    layer_min_count: clampInt(data?.layer_min_count, 2, 2, 10),
    layer_max_count: clampInt(data?.layer_max_count, 10, 2, 10),
  };
}

export async function loadOwnedAsset(
  service: ReturnType<typeof createClient>,
  assetId: string,
  userId: string,
  isAdmin: boolean,
): Promise<any> {
  const { data, error } = await service
    .from("tgis_thumb_assets")
    .select("id,user_id,image_url,width,height,origin_tool,metadata_json,created_at")
    .eq("id", assetId)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("asset_not_found");
  if (!isAdmin && String(data.user_id || "") !== userId) throw new Error("forbidden_asset_ownership");
  return data;
}

export async function createToolRun(
  service: ReturnType<typeof createClient>,
  payload: {
    user_id: string;
    asset_id?: string | null;
    tool_name: "generate" | "edit_studio" | "camera_control" | "layer_decomposition";
    mode?: string | null;
    provider_model?: string | null;
    input_json?: Record<string, unknown>;
    status?: "queued" | "running" | "success" | "failed";
  },
): Promise<number> {
  const { data, error } = await service
    .from("tgis_thumb_tool_runs")
    .insert({
      user_id: payload.user_id,
      asset_id: payload.asset_id || null,
      tool_name: payload.tool_name,
      mode: payload.mode || null,
      status: payload.status || "queued",
      provider: "fal",
      provider_model: payload.provider_model || null,
      input_json: payload.input_json || {},
      started_at: payload.status === "running" ? new Date().toISOString() : null,
    })
    .select("id")
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const runId = Number(data?.id || 0);
  if (!runId) throw new Error("tool_run_create_failed");
  return runId;
}

export async function updateToolRun(
  service: ReturnType<typeof createClient>,
  runId: number,
  payload: {
    status?: "queued" | "running" | "success" | "failed";
    asset_id?: string | null;
    output_json?: Record<string, unknown>;
    error_text?: string | null;
    latency_ms?: number | null;
    cost_usd?: number | null;
    started_at?: string | null;
    ended_at?: string | null;
  },
): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (payload.status) patch.status = payload.status;
  if (payload.asset_id !== undefined) patch.asset_id = payload.asset_id;
  if (payload.output_json !== undefined) patch.output_json = payload.output_json;
  if (payload.error_text !== undefined) patch.error_text = payload.error_text;
  if (payload.latency_ms !== undefined) patch.latency_ms = payload.latency_ms;
  if (payload.cost_usd !== undefined) patch.cost_usd = payload.cost_usd;
  if (payload.started_at !== undefined) patch.started_at = payload.started_at;
  if (payload.ended_at !== undefined) patch.ended_at = payload.ended_at;

  const { error } = await service
    .from("tgis_thumb_tool_runs")
    .update(patch)
    .eq("id", runId);
  if (error) throw new Error(error.message);
}

export async function createThumbAsset(
  service: ReturnType<typeof createClient>,
  payload: {
    user_id: string;
    source_generation_id?: string | null;
    parent_asset_id?: string | null;
    origin_tool: "generate" | "edit_studio" | "camera_control" | "layer_decomposition";
    image_url: string;
    width: number;
    height: number;
    metadata_json?: Record<string, unknown>;
  },
): Promise<string> {
  const { data, error } = await service
    .from("tgis_thumb_assets")
    .insert({
      user_id: payload.user_id,
      source_generation_id: payload.source_generation_id || null,
      parent_asset_id: payload.parent_asset_id || null,
      origin_tool: payload.origin_tool,
      image_url: payload.image_url,
      width: payload.width,
      height: payload.height,
      metadata_json: payload.metadata_json || {},
    })
    .select("id")
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const id = normalizeText(data?.id);
  if (!id) throw new Error("asset_create_failed");
  return id;
}

function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; mime: string } {
  const normalized = normalizeText(dataUrl);
  const m = normalized.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw new Error("invalid_mask_data_url");
  const mime = m[1].toLowerCase();
  const b64 = m[2];
  if (!["image/png", "image/jpeg", "image/webp"].includes(mime)) {
    throw new Error("unsupported_data_url_mime");
  }
  const raw = atob(b64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return { bytes, mime };
}

export async function uploadDataUrlToTempAndSign(
  service: ReturnType<typeof createClient>,
  dataUrl: string,
  userId: string,
  prefix: string,
): Promise<string> {
  await ensureBucket(service, "tgis-tool-temp", false);
  const parsed = dataUrlToBytes(dataUrl);
  const ext = parsed.mime.includes("jpeg") ? "jpg" : parsed.mime.includes("webp") ? "webp" : "png";
  const day = new Date().toISOString().slice(0, 10);
  const path = `${prefix}/${userId}/${day}/${crypto.randomUUID()}.${ext}`;
  const { error: uploadErr } = await service.storage
    .from("tgis-tool-temp")
    .upload(path, parsed.bytes, {
      contentType: parsed.mime,
      upsert: false,
    });
  if (uploadErr) throw new Error(`temp_upload_failed:${uploadErr.message}`);

  const { data: signed, error: signErr } = await service.storage
    .from("tgis-tool-temp")
    .createSignedUrl(path, 3600);
  if (signErr || !signed?.signedUrl) throw new Error(`temp_sign_failed:${signErr?.message || "unknown"}`);
  return signed.signedUrl.startsWith("http")
    ? signed.signedUrl
    : `${mustEnv("SUPABASE_URL")}/storage/v1${signed.signedUrl}`;
}

export async function getSkinById(service: ReturnType<typeof createClient>, id: string): Promise<{ id: string; name: string; image_url: string } | null> {
  const skinId = normalizeText(id);
  if (!skinId) return null;

  const { data: row } = await service
    .from("tgis_skins_catalog")
    .select("skin_id,name,image_url")
    .eq("skin_id", skinId)
    .limit(1)
    .maybeSingle();
  if (row && normalizeText((row as any).image_url).startsWith("http")) {
    return {
      id: normalizeText((row as any).skin_id || skinId),
      name: normalizeText((row as any).name || skinId),
      image_url: normalizeText((row as any).image_url),
    };
  }

  const safeId = encodeURIComponent(skinId);
  const resp = await fetch(`https://fortnite-api.com/v2/cosmetics/br/search?id=${safeId}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "User-Agent": "epic-insight-engine/thumb-tools",
    },
  });
  if (!resp.ok) return null;
  const payload = await resp.json();
  const data = payload?.data;
  const imageUrl = normalizeText(data?.images?.featured || data?.images?.icon || data?.images?.smallIcon || "");
  if (!imageUrl.startsWith("http")) return null;
  return {
    id: normalizeText(data?.id || skinId),
    name: normalizeText(data?.name || skinId),
    image_url: imageUrl,
  };
}

function safeVisionText(value: unknown): string {
  const text = sanitizeVisionAppearanceText(normalizeText(value)).slice(0, 560);
  if (!text) return "";
  const low = text.toLowerCase();
  const refusalSignals = [
    "i'm sorry",
    "i am sorry",
    "can't assist",
    "cannot assist",
    "can't help",
    "cannot help",
    "unable to assist",
    "unable to help",
  ];
  if (refusalSignals.some((s) => low.includes(s))) return "";
  return text;
}

function sanitizeVisionAppearanceText(input: string): string {
  let text = normalizeText(input);
  if (!text) return "";

  // Remove explicit "with ... expression" / "showing ... expression" patterns.
  text = text
    .replace(/\b(with|showing|featuring)\s+an?\s+[^,.]{0,80}\s+expression\b/gi, "")
    .replace(/\b(an?\s+)?[^,.]{0,80}\s+expression\b/gi, "");

  const blockedTerms = [
    " expression",
    " facial ",
    " emotion",
    " emotional",
    " smile",
    " smiling",
    " grin",
    " grinning",
    " laugh",
    " laughing",
    " cry",
    " crying",
    " angry",
    " happy",
    " sad ",
    " playful",
    " scared",
    " frightened",
    " terrified",
    " shocked",
    " surprised",
    " pose",
    " posed",
    " posing",
    " crossing arms",
    " crossed arms",
    " arms crossed",
    " arms folded",
    " waving",
    " pointing",
    " holding",
    " running",
    " jumping",
    " crouching",
    " kneeling",
    " looking back",
    " looking at",
    " staring",
    " gaze",
    " gesturing",
  ];

  const pieces = text
    .split(/[.;,]/g)
    .map((part) => normalizeText(part))
    .filter(Boolean)
    .filter((part) => {
      const low = ` ${part.toLowerCase()} `;
      return !blockedTerms.some((term) => low.includes(term));
    });

  const cleaned = normalizeText(pieces.join(", "))
    .replace(/\s+,/g, ",")
    .replace(/,+/g, ",")
    .replace(/^,+|,+$/g, "");

  return cleaned;
}

export async function describeImageWithVision(args: {
  service: ReturnType<typeof createClient>;
  openrouterModel: string;
  imageUrl: string;
  cacheKey?: string | null;
  fallbackName?: string;
}): Promise<{ text: string; source: "cache" | "vision" | "fallback" }> {
  const service = args.service;
  const cacheKey = normalizeText(args.cacheKey || "");
  if (cacheKey) {
    const { data: cached } = await service
      .from("tgis_skin_vision_cache")
      .select("vision_text")
      .eq("skin_id", cacheKey)
      .limit(1)
      .maybeSingle();
    const cachedText = safeVisionText((cached as any)?.vision_text || "");
    if (cachedText) return { text: cachedText, source: "cache" };
  }

  const openrouterKey = Deno.env.get("OPENROUTER_API_KEY") || "";
  if (!openrouterKey) {
    return {
      text: args.fallbackName ? `${args.fallbackName} with readable silhouette and distinct Fortnite styling.` : "Fortnite character with readable silhouette and distinctive outfit.",
      source: "fallback",
    };
  }

  const systemPrompt =
    "Describe visual character/style traits for image-generation conditioning. " +
    "Ignore any text/title/logo/UI in the image. " +
    "Return one concise sentence focused only on outfit, silhouette, colors, materials, and accessories. " +
    "Do not describe pose, action, camera angle, facial expression, or emotion.";
  const userPrompt = "Describe only static appearance traits for character/style grounding in Fortnite thumbnail generation.";

  try {
    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openrouterKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: args.openrouterModel || "openai/gpt-4o",
        temperature: 0.2,
        max_tokens: 180,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { type: "text", text: userPrompt },
              { type: "image_url", image_url: { url: args.imageUrl } },
            ],
          },
        ],
      }),
    });
    if (!resp.ok) throw new Error(`openrouter_http_${resp.status}`);
    const payload = await resp.json();
    const visionText = safeVisionText(payload?.choices?.[0]?.message?.content || "");
    if (!visionText) throw new Error("vision_empty");

    if (cacheKey) {
      await service
        .from("tgis_skin_vision_cache")
        .upsert({
          skin_id: cacheKey,
          vision_text: visionText,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: "skin_id",
        });
    }

    return { text: visionText, source: "vision" };
  } catch {
    return {
      text: args.fallbackName ? `${args.fallbackName} with readable silhouette and distinct Fortnite styling.` : "Fortnite character with readable silhouette and distinctive outfit.",
      source: "fallback",
    };
  }
}
