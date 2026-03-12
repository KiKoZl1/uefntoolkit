import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type RuntimeConfig = {
  default_generation_cost_usd: number;
  generate_provider: string;
  nano_model: string;
  openrouter_model: string;
  context_boost_default: boolean;
  max_skin_refs: number;
  max_total_refs: number;
};

type ClusterRow = {
  cluster_id: number;
  cluster_name: string;
  cluster_slug: string | null;
  cluster_family: string | null;
  routing_tags: string[];
  categories: string[];
  reference_image_url: string | null;
  reference_tag: string | null;
};

type TaxonomyRule = {
  rule_id: number;
  cluster_slug: string;
  cluster_family: string;
  priority: number;
  include_any: string[];
  include_all: string[];
  exclude_any: string[];
};

type SkinRef = {
  id: string;
  name: string;
  image_url: string;
};

type SkinVisionContext = {
  id: string;
  name: string;
  image_url: string;
  vision_text: string;
  source: "cache" | "vision" | "fallback";
};

type ProcessedIntent = {
  main_subject_action: string;
  environment_elements: string[];
  composition_style: string;
  color_emphasis: string;
  character_pose: string;
  depth_layers: string;
};

type SanitizationChange = {
  rule: string;
  before: string;
  after: string;
  count: number;
};

type SanitizationReport = {
  original_text: string;
  sanitized_text: string;
  changed: boolean;
  changes: SanitizationChange[];
  disabled?: boolean;
  reason?: string;
};

type PromptTemplateSelection = {
  template_text: string | null;
  source: "db" | "fallback";
  version: string;
};

type PromptDepthLayers = {
  foreground: string;
  midground: string;
  background: string;
};

type PromptCharacterSlot = {
  identity: string;
  pose: string;
  position: string;
};

type PromptScene = {
  type: string;
  composition: string;
  depth_layers: PromptDepthLayers;
};

type PromptCharacters = {
  primary: PromptCharacterSlot;
  secondary?: PromptCharacterSlot;
};

type PromptEnvironment = {
  elements: string[];
  color_palette: string;
  composition_style: string;
};

type PromptPhotography = {
  style: string;
  aspect_ratio: string;
  camera_angle: string;
  depth_of_field: string;
  color_grading: string;
};

type PromptNegative = {
  text_elements: string;
  epic_policy: string;
};

type PromptJson = {
  scene: PromptScene;
  characters: PromptCharacters;
  environment: PromptEnvironment;
  photography: PromptPhotography;
  mood: string;
  negative: PromptNegative;
};

type PromptJsonValidation = {
  ok: boolean;
  reason: string | null;
};

type StyleModeId =
  | "auto"
  | "3d_cinematic_stylized"
  | "3d_cinematic_cartoon"
  | "2d_flat_illustration";

type StyleProfile = {
  mode: Exclude<StyleModeId, "auto">;
  label: string;
  prompt_directive: string;
  photography_style: string;
};

const INTENT_MODEL = (Deno.env.get("TGIS_INTENT_MODEL") || "openai/gpt-4o").trim();
const PROMPT_FORMAT_MODE = (Deno.env.get("TGIS_PROMPT_FORMAT") || "json_v1").trim().toLowerCase();
const SANITIZATION_ENABLED = ((Deno.env.get("TGIS_SANITIZATION_ENABLED") || "true").trim().toLowerCase() !== "false");
const EPIC_POLICY_ENABLED = ((Deno.env.get("TGIS_EPIC_POLICY_ENABLED") || "true").trim().toLowerCase() !== "false");

const EPIC_POLICY_CONSTRAINTS =
  "EPIC GAMES CONTENT POLICY - MANDATORY COMPLIANCE: " +
  "Absolutely no real-world currency: no dollar bills, no banknotes, no paper money, no currency symbols ($, EUR, GBP, BRL, JPY) of any kind. " +
  "No V-Bucks symbols or Battle Pass references. " +
  "No XP text, numbers, or progress bar UI elements. " +
  "No Epic Games logos, product names, or branded assets. " +
  "No console controller buttons (A/B/X/Y, L2/R2, triggers). " +
  "No photographs or realistic depictions of real people. " +
  "No alcohol bottles, drug paraphernalia, or gambling equipment. " +
  "No violent gore, realistic blood, or disturbing imagery. " +
  "No sexually suggestive poses or content. " +
  "No URLs, social media handles, or external references. " +
  "Stylized in-game gold coins are acceptable. Real-world banknotes and currency symbols are not.";

const TEXT_NEGATIVE_CONSTRAINTS =
  "no text, no titles, no numbers, no logos, no UI overlays, no HUD elements anywhere in the image";

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

async function requireCommerceGateway(req: Request, auth: { userId: string | null; isAdmin: boolean }) {
  const enforce = getEnvBool("COMMERCE_GATEWAY_ENFORCE", true);
  if (!enforce || auth.isAdmin) return;
  if (!auth.userId) throw new Error("unauthorized");

  const secret = String(Deno.env.get("COMMERCE_GATEWAY_SECRET") || "").trim();
  if (!secret) throw new Error("commerce_gateway_misconfigured");

  const signature = String(req.headers.get("x-commerce-gateway-signature") || "").trim().toLowerCase();
  const operationId = String(req.headers.get("x-commerce-operation-id") || "").trim();
  const gatewayUserId = String(req.headers.get("x-commerce-user-id") || "").trim();
  const gatewayToolCode = String(req.headers.get("x-commerce-tool-code") || "").trim();

  if (!signature || !operationId || !gatewayUserId || !gatewayToolCode) {
    throw new Error("commerce_gateway_required");
  }
  if (gatewayUserId !== auth.userId) throw new Error("commerce_gateway_user_mismatch");
  if (gatewayToolCode !== "surprise_gen") throw new Error("commerce_gateway_tool_mismatch");

  const expected = await hmacSha256Hex(secret, `${operationId}:${gatewayUserId}:${gatewayToolCode}`);
  if (!constantTimeEqual(signature, expected)) throw new Error("commerce_gateway_signature_invalid");
}

function normalizeText(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeTag(value: unknown): string {
  return normalizeText(value).toLowerCase();
}

function normalizeSlug(value: unknown): string {
  return normalizeTag(value).replace(/[^a-z0-9_\- ]+/g, "").replace(/[\s-]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function parseTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((v) => normalizeTag(v))
      .filter(Boolean)
      .slice(0, 30);
  }
  const raw = normalizeText(value);
  if (!raw) return [];
  return raw
    .split(",")
    .map((v) => normalizeTag(v))
    .filter(Boolean)
    .slice(0, 30);
}

function uniqueStrings(values: string[]): string[] {
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

function parseJsonObjectFromText(raw: string): Record<string, unknown> | null {
  const text = normalizeText(raw);
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // no-op
  }

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try {
      const parsed = JSON.parse(fenced[1].trim());
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // no-op
    }
  }

  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try {
      const parsed = JSON.parse(text.slice(first, last + 1));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // no-op
    }
  }
  return null;
}

function sanitizeUserIntentText(input: string): SanitizationReport {
  let text = normalizeText(input);
  const original = text;
  const changes: SanitizationChange[] = [];

  const replaceRule = (rule: string, pattern: RegExp, replacement: string) => {
    const matches = text.match(pattern);
    if (!matches || matches.length === 0) return;
    const before = matches[0];
    const count = matches.length;
    text = text.replace(pattern, replacement);
    changes.push({ rule, before, after: replacement, count });
  };

  // Ordered rules: handle multi-word phrases first to avoid garbled replacements.
  replaceRule(
    "currency_dollar_bills",
    /\b(dollar bills?|usd bills?)\b/gi,
    "stylized in-game gold coins and loot rewards",
  );
  replaceRule(
    "currency_banknotes",
    /\b(banknotes?|paper money)\b/gi,
    "stylized in-game gold coins and loot rewards",
  );
  replaceRule(
    "currency_cash_money",
    /\bcash money\b/gi,
    "stylized in-game gold coins and loot rewards",
  );
  // Keep "cash register" semantics intact (it is an object, not real-world currency).
  replaceRule(
    "currency_cash",
    /\bcash\b(?!\s*registers?\b)/gi,
    "stylized in-game gold coins and loot rewards",
  );
  replaceRule("currency_symbol", /\$/g, "gold coins");
  replaceRule("vbucks", /\b(v[\s-]?bucks?|vbucks?)\b/gi, "in-game rewards");
  replaceRule("battle_pass", /\b(battle\s*pass)\b/gi, "season progression rewards");
  replaceRule("xp", /\b(xp|experience\s*points?)\b/gi, "progression energy");
  replaceRule(
    "violence_gore",
    /\b(blood|bloody|gore|gory|violent|violence|brutal|brutality|dismember(?:ed|ment)?|decapitat(?:e|ed|ion)|eviscerat(?:e|ed|ion))\b/gi,
    "non-graphic high-energy action",
  );
  replaceRule("map_code_numbers", /\b\d{4}-\d{4}\b/g, "map reference");
  replaceRule("map_code_label", /\b(map code|island code)\b/gi, "map reference");
  replaceRule("text_overlay_request", /\b(write|add|include|put|show)\b[^.]{0,100}\b(text|title|letters|numbers?)\b/gi, "focus on visual action only");

  text = normalizeText(text);
  return {
    original_text: original,
    sanitized_text: text,
    changed: text !== original,
    changes,
  };
}

function normalizeIntent(raw: Record<string, unknown>, fallbackDescription: string, tags: string[]): ProcessedIntent {
  const readString = (k: string, def: string) => normalizeText(raw[k] ?? def);
  const arr = Array.isArray(raw.environment_elements) ? raw.environment_elements : [];
  const env = arr
    .map((v) => normalizeText(v))
    .filter(Boolean)
    .slice(0, 6);
  const fallbackEnv = tags.slice(0, 4).map((t) => t.replace(/_/g, " "));

  return {
    main_subject_action: readString("main_subject_action", fallbackDescription || "Dynamic gameplay action with strong readability."),
    environment_elements: env.length ? env : fallbackEnv.length ? fallbackEnv : ["Fortnite Creative environment elements"],
    composition_style: readString("composition_style", "dynamic diagonal composition with clear focal hierarchy"),
    color_emphasis: readString("color_emphasis", "vibrant saturated Fortnite palette with high contrast"),
    character_pose: readString("character_pose", "confident action-ready pose with strong silhouette clarity"),
    depth_layers: readString("depth_layers", "foreground hero subject, readable midground action, contextual background"),
  };
}

function fallbackIntent(description: string, tags: string[]): ProcessedIntent {
  const lowered = normalizeTag(description);
  const compositionStyle = lowered.includes("center")
    ? "centered composition with strong subject dominance"
    : lowered.includes("rule of thirds")
      ? "rule-of-thirds composition with clean visual balance"
      : lowered.includes("diagonal") || lowered.includes("dutch")
        ? "dynamic diagonal composition with motion energy"
        : "dynamic cinematic composition with clear focal hierarchy";

  return normalizeIntent(
    {
      main_subject_action: description || "Strong gameplay moment with immediate visual readability.",
      environment_elements: tags.slice(0, 4).map((t) => t.replace(/_/g, " ")),
      composition_style: compositionStyle,
      color_emphasis: "vibrant saturated Fortnite colors with controlled contrast",
      character_pose: "clear action pose with readable silhouette",
      depth_layers: "foreground subject, active midground, contextual background",
    },
    description,
    tags,
  );
}

function stripUiTextTerms(value: string): string {
  let out = normalizeText(value);
  const rules: Array<[RegExp, string]> = [
    [/\b(map code|island code)\b/gi, "map context"],
    [/\b\d{4}-\d{4}\b/g, "map reference"],
    [/\b(write|add|include|put|show)\b[^.]{0,100}\b(text|title|letters|numbers?)\b/gi, "focus on visual action only"],
    [/\b(text|title|logo|overlay|hud|ui|watermark|code in corner)\b/gi, ""],
  ];
  for (const [pattern, replacement] of rules) {
    out = out.replace(pattern, replacement);
  }
  return normalizeText(out);
}

function enforceClusterIntentCompatibility(args: {
  clusterSlug: string | null;
  tags: string[];
  intent: ProcessedIntent;
}): ProcessedIntent {
  const slug = normalizeSlug(args.clusterSlug || "");
  const tagBlob = args.tags.map((t) => normalizeTag(t));
  const isTycoon = slug.includes("tycoon") || hasAnyKeyword(tagBlob, ["tycoon", "simulator"]);
  const isDuel = hasAnyKeyword([slug, ...tagBlob], ["1v1", "boxfight", "zonewars", "pvp", "duel"]);

  const cleanText = (v: string) => EPIC_POLICY_ENABLED ? stripUiTextTerms(v) : normalizeText(v);
  const cleanedEnv = args.intent.environment_elements
    .map((e) => cleanText(e))
    .filter(Boolean);

  // Remove incompatible horror-only cues from tycoon intent.
  const horrorTerms = ["zombie", "blood", "gore", "apocalypse", "horror", "terrifying", "scary", "foggy horror"];
  const tycoonIncompatibleColorTerms = [
    "dark",
    "black",
    "blood",
    "crimson",
    "gore",
    "horror",
    "eerie",
    "grim",
    "desaturated",
    "washed out",
    "muted",
  ];
  const tycoonIncompatibleDepthTerms = [
    "zombie",
    "undead",
    "monster",
    "blood",
    "fog",
    "apocalypse",
    "horror",
    "grave",
    "corpse",
    "nightmare",
    "ruins",
    "destroyed city",
  ];
  const tycoonColorDefault = "bright saturated warm-gold palette with clean sky/cool accents and high contrast readability";
  const tycoonDepthDefault =
    "foreground dominant hero subject, midground progression machines/upgrades, and background rich tycoon skyline with reward context";
  const peacefulTerms = ["peaceful sunset beach", "cute house", "calm beach"];
  const hasTerm = (v: string, terms: string[]) => terms.some((t) => normalizeTag(v).includes(normalizeTag(t)));

  let mainAction = cleanText(args.intent.main_subject_action);
  let composition = cleanText(args.intent.composition_style);
  let color = cleanText(args.intent.color_emphasis);
  let pose = cleanText(args.intent.character_pose);
  let depth = cleanText(args.intent.depth_layers);
  let env = EPIC_POLICY_ENABLED
    ? cleanedEnv.filter((e) => !hasTerm(e, ["map code", "text in corner", "big letters"]))
    : cleanedEnv;

  if (isTycoon) {
    const contradictionDetected =
      hasTerm(mainAction, horrorTerms) ||
      hasTerm(composition, horrorTerms) ||
      hasTerm(color, [...horrorTerms, ...tycoonIncompatibleColorTerms]) ||
      hasTerm(depth, [...horrorTerms, ...tycoonIncompatibleDepthTerms]) ||
      env.some((e) => hasTerm(e, horrorTerms));

    mainAction = hasTerm(mainAction, horrorTerms)
      ? "Hero character showcasing progression and success in a rich tycoon environment"
      : mainAction;
    composition = hasTerm(composition, horrorTerms)
      ? "dominant foreground hero with progression-rich background and readable economy fantasy"
      : composition;
    color = contradictionDetected ? tycoonColorDefault : color;
    pose = hasTerm(pose, horrorTerms) ? "confident triumphant pose with readable silhouette" : pose;
    depth = contradictionDetected ? tycoonDepthDefault : depth;
    env = env.filter((e) => !hasTerm(e, horrorTerms));
    if (!env.length) {
      env = ["gold coins", "upgrade machines", "factory/building progression", "reward-rich background"];
    }
  }

  if (isDuel) {
    if (hasTerm(mainAction, peacefulTerms)) {
      mainAction = "Two players in direct competitive confrontation with clear action readability";
    }
    env = env.filter((e) => !hasTerm(e, ["beach", "cute house", "peaceful sunset"]));
    if (!env.length) {
      env = ["build ramp or edit structures", "competitive arena", "clear confrontation line"];
    }
  }

  return normalizeIntent(
    {
      main_subject_action: mainAction,
      environment_elements: env,
      composition_style: composition,
      color_emphasis: color,
      character_pose: pose,
      depth_layers: depth,
    },
    mainAction || args.intent.main_subject_action,
    args.tags,
  );
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function pickImageUrlFromFal(payload: any): string {
  const direct = Array.isArray(payload?.images) ? payload.images : [];
  for (const item of direct) {
    const url = String(item?.url || item || "").trim();
    if (url.startsWith("http")) return url;
  }

  const nested = Array.isArray(payload?.data?.images) ? payload.data.images : [];
  for (const item of nested) {
    const url = String(item?.url || item || "").trim();
    if (url.startsWith("http")) return url;
  }

  const output = Array.isArray(payload?.output) ? payload.output : [];
  for (const item of output) {
    const url = String(item?.url || item || "").trim();
    if (url.startsWith("http")) return url;
  }

  return "";
}

function parsePngDimensions(bytes: Uint8Array): [number, number] | null {
  if (bytes.length < 24) return null;
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < sig.length; i++) {
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

let bucketChecked = false;

async function ensureGeneratedBucket(service: ReturnType<typeof createClient>): Promise<void> {
  if (bucketChecked) return;
  bucketChecked = true;
  try {
    await service.storage.createBucket("tgis-generated", {
      public: true,
      fileSizeLimit: "25MB",
      allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
    });
  } catch {
    // bucket likely exists
  }
}

async function normalizeAndStore1920x1080(
  service: ReturnType<typeof createClient>,
  sourceUrl: string,
): Promise<{ url: string; width: number; height: number; storage_path: string; raw_path: string }> {
  await ensureGeneratedBucket(service);

  const srcResp = await fetch(sourceUrl);
  if (!srcResp.ok) {
    throw new Error(`source_image_fetch_failed_${srcResp.status}`);
  }
  const srcContentType = (srcResp.headers.get("content-type") || "image/png").toLowerCase();
  const srcBytes = new Uint8Array(await srcResp.arrayBuffer());
  const rawExt = srcContentType.includes("jpeg") ? "jpg" : srcContentType.includes("webp") ? "webp" : "png";

  const day = new Date().toISOString().slice(0, 10);
  const rawPath = `raw/${day}/${crypto.randomUUID()}.${rawExt}`;
  const finalPath = `final/${day}/${crypto.randomUUID()}_1920x1080.png`;

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

  const transformedPublic = service.storage
    .from("tgis-generated")
    .getPublicUrl(rawPath, { transform: { width: 1920, height: 1080, resize: "cover" } });
  const transformedUrl = String(transformedPublic?.data?.publicUrl || "").trim();
  if (!transformedUrl) {
    throw new Error("transformed_url_missing");
  }

  const transformedResp = await fetch(transformedUrl);
  if (!transformedResp.ok) {
    throw new Error(`transformed_fetch_failed_${transformedResp.status}`);
  }
  const transformedBytes = new Uint8Array(await transformedResp.arrayBuffer());
  const transformedType = (transformedResp.headers.get("content-type") || "image/png").toLowerCase();

  await uploadWithRetry(finalPath, transformedBytes, transformedType, "final");

  const finalPublic = service.storage.from("tgis-generated").getPublicUrl(finalPath);
  const finalUrl = String(finalPublic?.data?.publicUrl || "").trim();
  if (!finalUrl) throw new Error("final_public_url_missing");

  const dims = await imageDimensionsFromUrl(finalUrl);
  if (!dims || dims[0] !== 1920 || dims[1] !== 1080) {
    throw new Error(`final_dimension_mismatch:${dims ? `${dims[0]}x${dims[1]}` : "unknown"}`);
  }

  return {
    url: finalUrl,
    width: 1920,
    height: 1080,
    storage_path: finalPath,
    raw_path: rawPath,
  };
}

async function resolveUser(req: Request) {
  const token = extractBearer(req);
  if (!token) return { userId: null as string | null, isAdmin: false };

  const authClient = createClient(mustEnv("SUPABASE_URL"), mustEnv("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const service = createClient(mustEnv("SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
  const { data: userRes, error: userErr } = await authClient.auth.getUser();
  if (userErr || !userRes.user?.id) return { userId: null as string | null, isAdmin: false };

  const { data: roleRows } = await service
    .from("user_roles")
    .select("role")
    .eq("user_id", userRes.user.id)
    .limit(1);
  const role = String(roleRows?.[0]?.role || "");
  return { userId: userRes.user.id, isAdmin: role === "admin" || role === "editor" };
}

async function loadRuntimeConfig(service: ReturnType<typeof createClient>): Promise<RuntimeConfig> {
  const { data, error } = await service
    .from("tgis_runtime_config")
    .select("default_generation_cost_usd,generate_provider,nano_model,openrouter_model,context_boost_default,max_skin_refs,max_total_refs")
    .eq("config_key", "default")
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);

  return {
    default_generation_cost_usd: Number(data?.default_generation_cost_usd || 0.135),
    generate_provider: normalizeText(data?.generate_provider || "fal-nano-banana-2") || "fal-nano-banana-2",
    nano_model: normalizeText(data?.nano_model || "fal-ai/nano-banana-2/edit") || "fal-ai/nano-banana-2/edit",
    openrouter_model: normalizeText(data?.openrouter_model || "openai/gpt-4o") || "openai/gpt-4o",
    context_boost_default: Boolean(data?.context_boost_default ?? true),
    max_skin_refs: clampInt(data?.max_skin_refs, 2, 0, 2),
    max_total_refs: clampInt(data?.max_total_refs, 14, 1, 14),
  };
}

async function loadClusters(service: ReturnType<typeof createClient>): Promise<ClusterRow[]> {
  const { data, error } = await service
    .from("tgis_cluster_registry")
    .select("cluster_id,cluster_name,cluster_slug,cluster_family,routing_tags,categories_json,reference_image_url,reference_tag,is_active")
    .eq("is_active", true)
    .order("cluster_id", { ascending: true });
  if (error) throw new Error(error.message);

  return (Array.isArray(data) ? data : []).map((row: any) => ({
    cluster_id: Number(row.cluster_id),
    cluster_name: String(row.cluster_name || ""),
    cluster_slug: row.cluster_slug ? normalizeSlug(row.cluster_slug) : null,
    cluster_family: row.cluster_family ? normalizeSlug(row.cluster_family) : null,
    routing_tags: Array.isArray(row.routing_tags)
      ? row.routing_tags.map((x: unknown) => normalizeTag(x)).filter(Boolean)
      : [],
    categories: Array.isArray(row.categories_json)
      ? row.categories_json.map((x: unknown) => normalizeTag(x)).filter(Boolean)
      : [],
    reference_image_url: normalizeText(row.reference_image_url || "") || null,
    reference_tag: normalizeText(row.reference_tag || "") || null,
  })).filter((x) => Number.isFinite(x.cluster_id) && x.cluster_name);
}

async function loadRules(service: ReturnType<typeof createClient>): Promise<TaxonomyRule[]> {
  const { data, error } = await service
    .from("tgis_cluster_taxonomy_rules")
    .select("rule_id,cluster_slug,cluster_family,priority,include_any,include_all,exclude_any")
    .eq("is_active", true)
    .order("priority", { ascending: true })
    .order("rule_id", { ascending: true });
  if (error) throw new Error(error.message);

  return (Array.isArray(data) ? data : []).map((r: any) => ({
    rule_id: Number(r.rule_id),
    cluster_slug: normalizeSlug(r.cluster_slug),
    cluster_family: normalizeSlug(r.cluster_family),
    priority: Number(r.priority || 0),
    include_any: Array.isArray(r.include_any) ? r.include_any.map((x: unknown) => normalizeTag(x)).filter(Boolean) : [],
    include_all: Array.isArray(r.include_all) ? r.include_all.map((x: unknown) => normalizeTag(x)).filter(Boolean) : [],
    exclude_any: Array.isArray(r.exclude_any) ? r.exclude_any.map((x: unknown) => normalizeTag(x)).filter(Boolean) : [],
  }));
}

function matchRule(rule: TaxonomyRule, textBlob: string): { matched: boolean; score: number } {
  for (const t of rule.exclude_any) {
    if (t && textBlob.includes(t)) return { matched: false, score: 0 };
  }
  for (const t of rule.include_all) {
    if (t && !textBlob.includes(t)) return { matched: false, score: 0 };
  }

  let anyHits = 0;
  if (rule.include_any.length > 0) {
    for (const t of rule.include_any) {
      if (t && textBlob.includes(t)) anyHits += 1;
    }
    if (anyHits <= 0) return { matched: false, score: 0 };
  } else {
    anyHits = 1;
  }

  const allHits = rule.include_all.filter((x) => textBlob.includes(x)).length;
  const score = Math.min(0.99, 0.50 + anyHits * 0.08 + allHits * 0.1);
  return { matched: true, score };
}

function scoreCluster(textBlob: string, cluster: ClusterRow): number {
  let score = 0;

  const candidates = [
    cluster.cluster_slug ? cluster.cluster_slug.replace(/_/g, " ") : "",
    cluster.cluster_family ? cluster.cluster_family.replace(/_/g, " ") : "",
    ...(cluster.routing_tags || []).map((x) => x.replace(/_/g, " ")),
    ...(cluster.categories || []).map((x) => x.replace(/_/g, " ")),
  ].filter(Boolean);

  for (const token of candidates) {
    if (token.length < 2) continue;
    if (textBlob.includes(token)) score += 1;
  }
  return score;
}

function resolveCluster(params: {
  clusters: ClusterRow[];
  rules: TaxonomyRule[];
  prompt: string;
  tags: string[];
  mapTitle: string;
  categoryHint: string;
}): { cluster: ClusterRow; reason: string; score: number; matchedRuleId: number | null } {
  const textBlob = normalizeTag([
    params.prompt,
    params.mapTitle,
    params.categoryHint,
    ...params.tags,
  ].filter(Boolean).join(" "));

  for (const rule of params.rules) {
    const matched = matchRule(rule, textBlob);
    if (!matched.matched) continue;
    const bySlug = params.clusters.find((c) => normalizeSlug(c.cluster_slug || "") === normalizeSlug(rule.cluster_slug));
    if (bySlug) return { cluster: bySlug, reason: "taxonomy_rule_slug", score: matched.score, matchedRuleId: rule.rule_id };

    const byFamily = params.clusters.find((c) => normalizeSlug(c.cluster_family || "") === normalizeSlug(rule.cluster_family));
    if (byFamily) return { cluster: byFamily, reason: "taxonomy_rule_family", score: matched.score, matchedRuleId: rule.rule_id };
  }

  let winner = params.clusters[0];
  let winnerScore = -1;
  for (const cluster of params.clusters) {
    const score = scoreCluster(textBlob, cluster);
    if (score > winnerScore) {
      winner = cluster;
      winnerScore = score;
    }
  }
  return {
    cluster: winner,
    reason: winnerScore > 0 ? "keyword_fallback" : "default_first_active",
    score: winnerScore > 0 ? Math.min(0.89, 0.45 + winnerScore * 0.08) : 0.30,
    matchedRuleId: null,
  };
}

function isAllowedUserReferenceUrl(urlRaw: string): boolean {
  try {
    const url = new URL(urlRaw);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();

    if (host.endsWith(".supabase.co")) {
      return url.pathname.includes("/storage/v1/object/public/tgis-user-references/") || url.pathname.includes("/object/public/tgis-user-references/");
    }
    if (host.endsWith(".epicgames.com")) return true;
    if (host === "fortnite-api.com" || host.endsWith(".fortnite-api.com")) return true;
    return false;
  } catch {
    return false;
  }
}

async function getSkinById(id: string): Promise<SkinRef | null> {
  const safeId = encodeURIComponent(id);
  const resp = await fetchWithTimeout(`https://fortnite-api.com/v2/cosmetics/br/search?id=${safeId}`, {
    method: "GET",
    headers: {
      "Accept": "application/json",
      "User-Agent": "epic-insight-engine/tgis-generate",
    },
  }, 12000);
  if (!resp.ok) return null;
  const payload = await resp.json();
  const data = payload?.data;
  if (!data) return null;
  const typeVal = normalizeTag(data?.type?.value || "");
  if (typeVal && typeVal !== "outfit") return null;

  const imageUrl = normalizeText(data?.images?.featured || data?.images?.icon || data?.images?.smallIcon || "");
  if (!imageUrl.startsWith("http")) return null;

  return {
    id: normalizeText(data?.id || id),
    name: normalizeText(data?.name || id),
    image_url: imageUrl,
  };
}

async function resolveSkinRefs(ids: string[], maxCount: number): Promise<SkinRef[]> {
  const uniq = uniqueStrings(ids).slice(0, Math.max(0, maxCount));
  if (!uniq.length) return [];
  const resolved = await Promise.all(uniq.map((id) => getSkinById(id)));
  return resolved.filter((x): x is SkinRef => Boolean(x));
}

function safeVisionText(value: unknown): string {
  const text = sanitizeVisionAppearanceText(normalizeText(value)).slice(0, 520);
  if (!text) return "";

  const low = text.toLowerCase();
  const refusalSignals = [
    "i'm sorry",
    "i’m sorry",
    "i am sorry",
    "can't assist",
    "cannot assist",
    "can't help",
    "cannot help",
    "unable to help",
    "unable to assist",
    "i can’t assist",
    "i can’t help",
  ];
  if (refusalSignals.some((s) => low.includes(s))) return "";
  return text;
}

function sanitizeVisionAppearanceText(input: string): string {
  let text = normalizeText(input);
  if (!text) return "";

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

async function describeSkinWithVision(skin: SkinRef, model: string): Promise<string> {
  const openRouterApiKey = Deno.env.get("OPENROUTER_API_KEY") || "";
  if (!openRouterApiKey) throw new Error("missing_openrouter_key");

  const systemPrompt =
    "You describe Fortnite skins for image-generation conditioning. " +
    "Output one concise sentence with only visual traits: outfit, colors, silhouette, accessories, hair/helmet, and materials. " +
    "Do not mention pose, action, facial expression, emotion, camera angle, text overlays, logos, UI, game mode, or composition.";
  const userPrompt = `Skin name: ${skin.name}. Describe this skin visual identity for prompt grounding.`;

  const resp = await fetchWithTimeout("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${openRouterApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 160,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: userPrompt },
            { type: "image_url", image_url: { url: skin.image_url } },
          ],
        },
      ],
    }),
  }, 45_000);

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`openrouter_vision_http_${resp.status}:${txt.slice(0, 220)}`);
  }

  const payload = await resp.json();
  const text = safeVisionText(payload?.choices?.[0]?.message?.content || "");
  if (!text) throw new Error("openrouter_vision_empty");
  return text;
}

async function processUserIntent(args: {
  description: string;
  mapTitle: string;
  tags: string[];
  clusterSlug: string | null;
  clusterFamily: string | null;
}): Promise<{ intent: ProcessedIntent; provider: string; model: string; raw_response?: string; error?: string }> {
  const openRouterApiKey = Deno.env.get("OPENROUTER_API_KEY") || "";
  const description = normalizeText(args.description);
  const tags = args.tags.map((t) => normalizeTag(t)).filter(Boolean);
  const fallback = fallbackIntent(description, tags);

  if (!openRouterApiKey) {
    const enforced = enforceClusterIntentCompatibility({
      clusterSlug: args.clusterSlug,
      tags,
      intent: fallback,
    });
    return {
      intent: enforced,
      provider: "fallback",
      model: "fallback",
      error: "missing_openrouter_key",
    };
  }

  const systemParts = [
    "You are a visual composition assistant for Fortnite Creative thumbnails.",
    "Extract structured visual intent from user input.",
  ];
  if (EPIC_POLICY_ENABLED) {
    systemParts.push(
      "IMPORTANT COMPLIANCE RULE: if user mentions real-world currency, V-Bucks, Battle Pass, XP, convert them to safe in-game equivalents. Never keep disallowed terms.",
      "Ignore and remove any request for text, titles, numbers, logos, map codes, UI, HUD, overlays, or watermarks.",
    );
  }
  systemParts.push(
    "If the user intent conflicts with the cluster genre, adapt to a cluster-compatible visual direction while preserving useful composition hints.",
    "Return only valid JSON with fields: main_subject_action (string), environment_elements (string array), composition_style (string), color_emphasis (string), character_pose (string), depth_layers (string).",
  );
  const systemPrompt = systemParts.join(" ");

  const userPrompt = [
    `Cluster slug: ${normalizeText(args.clusterSlug || "unknown")}`,
    `Cluster family: ${normalizeText(args.clusterFamily || "unknown")}`,
    `Map title (context only): ${normalizeText(args.mapTitle || "") || "n/a"}`,
    `Tags: ${tags.join(", ") || "n/a"}`,
    `User description: ${description || "n/a"}`,
  ].join("\n");

  try {
    const resp = await fetchWithTimeout("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openRouterApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: INTENT_MODEL,
        temperature: 0.2,
        max_tokens: 420,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    }, 45_000);

    if (!resp.ok) {
      const txt = await resp.text();
      const enforced = enforceClusterIntentCompatibility({
        clusterSlug: args.clusterSlug,
        tags,
        intent: fallback,
      });
      return {
        intent: enforced,
        provider: "fallback",
        model: INTENT_MODEL,
        error: `intent_http_${resp.status}:${txt.slice(0, 220)}`,
      };
    }

    const payload = await resp.json();
    const raw = String(payload?.choices?.[0]?.message?.content || "");
    const parsed = parseJsonObjectFromText(raw);
    if (!parsed) {
      const enforced = enforceClusterIntentCompatibility({
        clusterSlug: args.clusterSlug,
        tags,
        intent: fallback,
      });
      return {
        intent: enforced,
        provider: "fallback",
        model: INTENT_MODEL,
        raw_response: raw.slice(0, 1200),
        error: "intent_invalid_json",
      };
    }

      const intent = enforceClusterIntentCompatibility({
        clusterSlug: args.clusterSlug,
        tags,
        intent: normalizeIntent(parsed, description, tags),
      });
      return {
        intent,
        provider: "openrouter",
        model: INTENT_MODEL,
        raw_response: raw.slice(0, 1200),
    };
  } catch (e) {
    const enforced = enforceClusterIntentCompatibility({
      clusterSlug: args.clusterSlug,
      tags,
      intent: fallback,
    });
    return {
      intent: enforced,
      provider: "fallback",
      model: INTENT_MODEL,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function resolveSkinVisionContexts(
  service: ReturnType<typeof createClient>,
  model: string,
  skinRefs: SkinRef[],
): Promise<SkinVisionContext[]> {
  if (!skinRefs.length) return [];

  let cacheMap = new Map<string, any>();
  try {
    const { data, error } = await service
      .from("tgis_skin_vision_cache")
      .select("skin_id,skin_name,image_url,vision_text,model_name")
      .in("skin_id", skinRefs.map((s) => s.id));
    if (!error && Array.isArray(data)) {
      for (const row of data) {
        const key = normalizeText((row as any)?.skin_id || "");
        if (key) cacheMap.set(key, row);
      }
    }
  } catch {
    // cache table may not exist yet; fallback to live vision
  }

  const out: SkinVisionContext[] = [];
  for (const skin of skinRefs) {
    const cached = cacheMap.get(skin.id);
    const cachedVision = safeVisionText((cached as any)?.vision_text || "");
    if (cachedVision) {
      out.push({
        id: skin.id,
        name: skin.name,
        image_url: skin.image_url,
        vision_text: cachedVision,
        source: "cache",
      });
      continue;
    }

    try {
      const visionText = await describeSkinWithVision(skin, model);
      out.push({
        id: skin.id,
        name: skin.name,
        image_url: skin.image_url,
        vision_text: visionText,
        source: "vision",
      });
      try {
        await service
          .from("tgis_skin_vision_cache")
          .upsert({
            skin_id: skin.id,
            skin_name: skin.name,
            image_url: skin.image_url,
            vision_text: visionText,
            model_name: model,
            updated_at: new Date().toISOString(),
          }, { onConflict: "skin_id" });
      } catch {
        // ignore cache write failures
      }
    } catch {
      const fallbackVision = `Use the exact Fortnite skin identity of ${skin.name}, preserving outfit silhouette, colors, and accessories.`;
      try {
        await service
          .from("tgis_skin_vision_cache")
          .upsert({
            skin_id: skin.id,
            skin_name: skin.name,
            image_url: skin.image_url,
            vision_text: fallbackVision,
            model_name: "fallback",
            updated_at: new Date().toISOString(),
          }, { onConflict: "skin_id" });
      } catch {
        // ignore cache write failures
      }
      out.push({
        id: skin.id,
        name: skin.name,
        image_url: skin.image_url,
        vision_text: fallbackVision,
        source: "fallback",
      });
    }
  }

  return out;
}

async function selectClusterRefs(args: {
  service: ReturnType<typeof createClient>;
  cluster: ClusterRow;
  tags: string[];
  needed: number;
}): Promise<string[]> {
  if (args.needed <= 0) return [];

  const { data, error } = await args.service
    .from("tgis_reference_images")
    .select("tag_group,rank,image_url,quality_score")
    .eq("cluster_id", args.cluster.cluster_id)
    .order("quality_score", { ascending: false })
    .order("rank", { ascending: true })
    .limit(300);
  if (error) throw new Error(error.message);

  const rows = Array.isArray(data) ? data : [];
  const urls: string[] = [];
  const seen = new Set<string>();
  const tagHints = args.tags.map((t) => normalizeTag(t));

  const pushIfValid = (url: string) => {
    const v = normalizeText(url);
    if (!v.startsWith("http")) return;
    if (seen.has(v)) return;
    seen.add(v);
    urls.push(v);
  };

  for (const row of rows) {
    const tg = normalizeTag((row as any)?.tag_group || "");
    const strong = tagHints.some((hint) => hint && (tg === hint || tg.includes(hint) || hint.includes(tg)));
    if (!strong) continue;
    pushIfValid(String((row as any)?.image_url || ""));
    if (urls.length >= args.needed) return urls;
  }

  for (const row of rows) {
    pushIfValid(String((row as any)?.image_url || ""));
    if (urls.length >= args.needed) return urls;
  }

  if (args.cluster.reference_image_url && urls.length < args.needed) {
    pushIfValid(args.cluster.reference_image_url);
  }

  if (urls.length >= args.needed) return urls.slice(0, args.needed);

  const { data: globalRows, error: globalErr } = await args.service
    .from("tgis_reference_images")
    .select("image_url,quality_score")
    .order("quality_score", { ascending: false })
    .limit(300);
  if (globalErr) throw new Error(globalErr.message);

  for (const row of (Array.isArray(globalRows) ? globalRows : [])) {
    pushIfValid(String((row as any)?.image_url || ""));
    if (urls.length >= args.needed) break;
  }

  return urls.slice(0, args.needed);
}

async function loadPromptTemplate(
  service: ReturnType<typeof createClient>,
  clusterSlug: string | null,
): Promise<PromptTemplateSelection> {
  const slug = normalizeSlug(clusterSlug || "");
  if (!slug) return { template_text: null, source: "fallback", version: "fallback" };

  const readTemplate = async (withVersion: boolean) => {
    const query = service
      .from("tgis_prompt_templates")
      .select(withVersion ? "template_text,version" : "template_text")
      .eq("cluster_slug", slug)
      .eq("is_active", true)
      .limit(1);
    return await query;
  };

  let data: any[] | null = null;
  let error: any = null;
  ({ data, error } = await readTemplate(true));
  if (error && String(error.message || "").toLowerCase().includes("version")) {
    ({ data, error } = await readTemplate(false));
  }
  if (error) return { template_text: null, source: "fallback", version: "fallback" };

  const row = Array.isArray(data) && data[0] ? (data[0] as any) : null;
  const templateText = normalizeText(row?.template_text || "");
  if (!templateText) return { template_text: null, source: "fallback", version: "fallback" };

  const version = normalizeText(row?.version || "v1") || "v1";
  return { template_text: templateText, source: "db", version };
}

function cameraInstruction(cameraAngle: string): string {
  const key = normalizeSlug(cameraAngle || "eye");
  if (key === "low") return "Low camera angle looking slightly upward, making characters appear powerful and dominant.";
  if (key === "high") return "High angle camera looking down, showing the full scene and environment.";
  if (key === "dutch") return "Dynamic dutch angle camera tilt, extreme energy and chaos, diagonal composition.";
  return "Camera at eye level, direct and confrontational perspective.";
}

function compactForMatch(v: string): string {
  return normalizeTag(v).replace(/[\s_-]+/g, "");
}

function hasAnyKeyword(values: string[], keywords: string[]): boolean {
  const blob = compactForMatch(values.join(" "));
  return keywords.some((k) => blob.includes(compactForMatch(k)));
}

function resolveStyleProfile(styleModeInput: unknown, prompt: string, tags: string[]): StyleProfile {
  const requested = normalizeSlug(styleModeInput || "auto") || "auto";
  const textBlob = normalizeTag([prompt, ...tags].join(" "));
  const autoMode = (() => {
    if (hasAnyKeyword([textBlob], ["2d", "flat", "illustration", "vector", "poster", "graphic"])) {
      return "2d_flat_illustration";
    }
    if (hasAnyKeyword([textBlob], ["cartoon", "toon", "pixar"])) {
      return "3d_cinematic_cartoon";
    }
    return "3d_cinematic_stylized";
  })();

  const resolved: Exclude<StyleModeId, "auto"> =
    requested === "3d_cinematic_stylized" ||
    requested === "3d_cinematic_cartoon" ||
    requested === "2d_flat_illustration"
      ? requested
      : autoMode;

  if (resolved === "3d_cinematic_cartoon") {
    return {
      mode: resolved,
      label: "3D Cinematic Cartoon",
      prompt_directive:
        "Render as stylized 3D cartoon while preserving cinematic lighting, depth, and thumbnail readability.",
      photography_style:
        "Fortnite cinematic 3D cartoon render, playful proportions, polished shading, vibrant readability",
    };
  }

  if (resolved === "2d_flat_illustration") {
    return {
      mode: resolved,
      label: "2D/Flat Illustration",
      prompt_directive:
        "Render as clean 2D/flat illustration with bold readable silhouettes and graphic composition clarity.",
      photography_style:
        "Fortnite-inspired 2D flat illustration look, graphic shapes, minimal volumetric shading, clean outlines",
    };
  }

  return {
    mode: "3d_cinematic_stylized",
    label: "3D Cinematic Stylized",
    prompt_directive:
      "Render as stylized 3D cinematic Fortnite artwork with believable materials, strong depth, and premium thumbnail readability.",
    photography_style:
      "Fortnite cinematic 3D stylized render, high detail materials, strong depth separation, vibrant readability",
  };
}

function inferMood(tags: string[], moodOverride: string): string {
  const overrideKey = normalizeSlug(moodOverride);
  if (overrideKey) {
    if (["intense", "intense_competitive", "competitive", "high_energy"].includes(overrideKey)) {
      return "Fierce competitive atmosphere, dramatic rim lighting, high tension.";
    }
    if (["epic", "epic_cinematic", "cinematic"].includes(overrideKey)) {
      return "Vibrant cinematic atmosphere, strong contrast, premium action readability.";
    }
    if (["fun", "fun_playful"].includes(overrideKey)) {
      return "Energetic playful mood, dynamic movement, bright vivid colors.";
    }
    if (["dark", "dark_horror", "scary", "horror"].includes(overrideKey)) {
      return "Dark moody atmosphere, deep shadows, fog, eerie lighting.";
    }
    if (["chill", "clean", "clean_minimal"].includes(overrideKey)) {
      return "Relaxed friendly atmosphere, soft warm lighting, inviting composition.";
    }
  }

  if (hasAnyKeyword(tags, ["1v1", "pvp", "boxfight", "zonewars", "zone wars"])) {
    return "Fierce competitive atmosphere, dramatic rim lighting, high tension.";
  }
  if (hasAnyKeyword(tags, ["tycoon", "simulator"])) {
    return "Vibrant cheerful energy, bright saturated colors, abundant and exciting.";
  }
  if (hasAnyKeyword(tags, ["horror", "survival_horror", "scary", "backrooms"])) {
    return "Dark moody atmosphere, deep shadows, fog, eerie lighting.";
  }
  if (hasAnyKeyword(tags, ["parkour", "race", "deathrun"])) {
    return "Energetic playful mood, dynamic movement, bright vivid colors.";
  }
  if (hasAnyKeyword(tags, ["casual", "party_game", "party"])) {
    return "Relaxed friendly atmosphere, soft warm lighting, inviting composition.";
  }
  return "Vibrant cinematic atmosphere, strong contrast, premium action readability.";
}

function defaultClusterTemplate(cluster: ClusterRow, tags: string[], mapTitle: string): string {
  const keys = [cluster.cluster_slug || "", cluster.cluster_family || "", ...tags];
  if (hasAnyKeyword(keys, ["1v1", "boxfight", "box fight"])) {
    return "Fortnite Creative duel thumbnail. Two opponents in an aggressive close-range build fight with clear line-of-action and readable confrontation.";
  }
  if (hasAnyKeyword(keys, ["zonewars", "zone wars"])) {
    return "Fortnite Creative Zone Wars final-circle thumbnail. Two opponents rotating under pressure with storm energy and tactical movement readability.";
  }
  if (hasAnyKeyword(keys, ["red_vs_blue", "red vs blue", "team deathmatch"])) {
    return "Fortnite Creative team-clash thumbnail. Opposing sides collide with clear faction separation and one dominant action beat.";
  }
  if (hasAnyKeyword(keys, ["gungame", "gun game", "free_for_all", "free for all"])) {
    return "Fortnite Creative elimination thumbnail. Fast-paced combat moment with a dominant foreground subject and reactive opponents.";
  }
  if (hasAnyKeyword(keys, ["tycoon", "simulator"])) {
    return "Fortnite Creative tycoon thumbnail. Strong hero framing in foreground with progression-rich background and high reward fantasy.";
  }
  if (hasAnyKeyword(keys, ["horror", "survival_horror", "backrooms"])) {
    return "Fortnite Creative horror thumbnail. Foreground subject under threat with dark atmosphere, fog, and high-contrast cinematic tension.";
  }
  if (hasAnyKeyword(keys, ["deathrun", "parkour", "race"])) {
    return "Fortnite Creative challenge thumbnail. Foreground subject in a high-risk movement moment with strong route readability and dynamic motion.";
  }
  const theme = mapTitle ? `inspired by "${mapTitle}"` : "with clear gameplay readability";
  return `Fortnite Creative thumbnail ${theme}. A dominant foreground subject and a clear opposing or supporting subject with cinematic depth and readable action.`;
}

function isDuelCluster(cluster: ClusterRow, tags: string[]): boolean {
  const keys = [cluster.cluster_slug || "", cluster.cluster_family || "", ...tags];
  return hasAnyKeyword(keys, ["1v1", "boxfight", "box fight", "zonewars", "zone wars", "duel", "pvp"]);
}

function deriveSceneType(cluster: ClusterRow, tags: string[]): string {
  const keys = [cluster.cluster_slug || "", cluster.cluster_family || "", ...tags];
  if (hasAnyKeyword(keys, ["1v1", "boxfight", "box fight", "zonewars", "zone wars", "duel", "pvp"])) {
    return "Fortnite Creative duel thumbnail";
  }
  if (hasAnyKeyword(keys, ["tycoon", "simulator"])) {
    return "Fortnite Creative tycoon thumbnail";
  }
  if (hasAnyKeyword(keys, ["horror", "survival_horror", "backrooms"])) {
    return "Fortnite Creative horror thumbnail";
  }
  if (hasAnyKeyword(keys, ["deathrun", "parkour", "race"])) {
    return "Fortnite Creative challenge thumbnail";
  }
  return "Fortnite Creative gameplay thumbnail";
}

function fallbackDepthLayers(cluster: ClusterRow, tags: string[]): PromptDepthLayers {
  const keys = [cluster.cluster_slug || "", cluster.cluster_family || "", ...tags];
  if (hasAnyKeyword(keys, ["tycoon", "simulator"])) {
    return {
      foreground: "dominant hero character with triumphant pose and reward cues",
      midground: "progression machines, upgrades, and readable gameplay economy elements",
      background: "rich tycoon skyline and contextual environment",
    };
  }
  if (hasAnyKeyword(keys, ["1v1", "boxfight", "zonewars", "duel", "pvp"])) {
    return {
      foreground: "dominant player action with clear confrontation",
      midground: "build/edit structures and tactical movement space",
      background: "opposing subject and arena context",
    };
  }
  if (hasAnyKeyword(keys, ["horror", "survival_horror", "backrooms"])) {
    return {
      foreground: "subject under tension with readable silhouette",
      midground: "threatening environmental elements and atmosphere",
      background: "dark contextual scene depth",
    };
  }
  return {
    foreground: "dominant gameplay subject with clear silhouette",
    midground: "supporting action elements with readable structure",
    background: "contextual environment and depth cues",
  };
}

function parseDepthLayersText(rawDepth: string): Partial<PromptDepthLayers> {
  const raw = normalizeText(rawDepth);
  if (!raw) return {};

  const out: Partial<PromptDepthLayers> = {};
  const parts = raw
    .split(/[,;]+/)
    .map((p) => normalizeText(p))
    .filter(Boolean);

  for (const part of parts) {
    const low = normalizeTag(part);
    if (low.startsWith("foreground")) {
      out.foreground = normalizeText(part.replace(/^foreground(?:\s*(?:with|:|-)\s*)?/i, "")) || "foreground gameplay subject";
      continue;
    }
    if (low.startsWith("midground")) {
      out.midground = normalizeText(part.replace(/^midground(?:\s*(?:with|:|-)\s*)?/i, "")) || "midground gameplay context";
      continue;
    }
    if (low.startsWith("background")) {
      out.background = normalizeText(part.replace(/^background(?:\s*(?:with|:|-)\s*)?/i, "")) || "background environment context";
      continue;
    }
  }

  return out;
}

function buildDepthLayers(args: {
  processedIntent: ProcessedIntent;
  cluster: ClusterRow;
  tags: string[];
  skinContexts: SkinVisionContext[];
}): PromptDepthLayers {
  const fallback = fallbackDepthLayers(args.cluster, args.tags);
  const parsed = parseDepthLayersText(args.processedIntent.depth_layers);
  const mainAction = normalizeText(args.processedIntent.main_subject_action);

  let foreground = normalizeText(parsed.foreground || fallback.foreground);
  if (mainAction) foreground = mainAction;
  let midground = normalizeText(parsed.midground || fallback.midground);
  let background = normalizeText(parsed.background || fallback.background);

  const primaryName = normalizeText(args.skinContexts[0]?.name || "");
  const secondaryName = normalizeText(args.skinContexts[1]?.name || "");
  if (primaryName && !normalizeTag(foreground).includes(normalizeTag(primaryName))) {
    foreground = `${primaryName} as dominant foreground subject. ${foreground}`;
  }
  if (secondaryName && !normalizeTag(background).includes(normalizeTag(secondaryName))) {
    background = `${secondaryName} as secondary/background subject. ${background}`;
  }

  return {
    foreground: normalizeText(foreground),
    midground: normalizeText(midground),
    background: normalizeText(background),
  };
}

function buildCharacters(args: {
  skinContexts: SkinVisionContext[];
  processedIntent: ProcessedIntent;
  cluster: ClusterRow;
  tags: string[];
}): PromptCharacters {
  const duelCluster = isDuelCluster(args.cluster, args.tags);
  const pose = normalizeText(args.processedIntent.character_pose || "clear action pose with readable silhouette");

  if (args.skinContexts.length >= 2) {
    const p = args.skinContexts[0];
    const s = args.skinContexts[1];
    return {
      primary: {
        identity: `${p.name}: ${normalizeText(p.vision_text)}`,
        pose,
        position: "dominant foreground left, large scale",
      },
      secondary: {
        identity: `${s.name}: ${normalizeText(s.vision_text)}`,
        pose: "opposing action, readable at thumbnail size",
        position: "background right, smaller scale",
      },
    };
  }

  if (args.skinContexts.length === 1) {
    const p = args.skinContexts[0];
    return {
      primary: {
        identity: `${p.name}: ${normalizeText(p.vision_text)}`,
        pose,
        position: duelCluster ? "dominant foreground left, large scale" : "dominant foreground, large scale",
      },
    };
  }

  return {
    primary: {
      identity: "generic Fortnite character, no fixed skin",
      pose: "action-ready pose with clear silhouette readability, aligned with foreground action",
      position: duelCluster ? "dominant foreground, large scale with clear confrontation line" : "dominant foreground, large scale",
    },
  };
}

function buildPhotography(cameraAngle: string, styleProfile: StyleProfile): PromptPhotography {
  return {
    style: styleProfile.photography_style,
    aspect_ratio: "16:9 widescreen 1920x1080",
    camera_angle: cameraInstruction(cameraAngle),
    depth_of_field: "shallow, strong foreground-midground-background separation",
    color_grading: "vibrant, high saturation, cinematic contrast",
  };
}

function buildPromptJson(args: {
  template: PromptTemplateSelection;
  cluster: ClusterRow;
  tags: string[];
  cameraAngle: string;
  mood: string;
  styleProfile: StyleProfile;
  processedIntent: ProcessedIntent;
  skinContexts: SkinVisionContext[];
  userRefProvided: boolean;
  clusterRefCount: number;
}): PromptJson {
  const templateResolved =
    args.template.template_text || defaultClusterTemplate(args.cluster, args.tags, "");
  const elements = args.processedIntent.environment_elements
    .map((e) => normalizeText(e))
    .filter(Boolean);
  const sceneType = deriveSceneType(args.cluster, args.tags);
  const compositionStyle = normalizeText(args.processedIntent.composition_style || "dynamic cinematic composition");
  const colorPalette = normalizeText(args.processedIntent.color_emphasis || "vibrant saturated Fortnite palette");

  return {
    scene: {
      type: sceneType,
      composition: normalizeText(templateResolved),
      depth_layers: buildDepthLayers({
        processedIntent: args.processedIntent,
        cluster: args.cluster,
        tags: args.tags,
        skinContexts: args.skinContexts,
      }),
    },
    characters: buildCharacters({
      skinContexts: args.skinContexts,
      processedIntent: args.processedIntent,
      cluster: args.cluster,
      tags: args.tags,
    }),
    environment: {
      elements: elements.length ? elements : ["Fortnite Creative gameplay environment with clean readability"],
      color_palette: colorPalette,
      composition_style: compositionStyle,
    },
    photography: buildPhotography(args.cameraAngle, args.styleProfile),
    mood: normalizeText(args.mood),
    negative: {
      text_elements: EPIC_POLICY_ENABLED ? TEXT_NEGATIVE_CONSTRAINTS : "",
      epic_policy: EPIC_POLICY_ENABLED ? EPIC_POLICY_CONSTRAINTS : "",
    },
  };
}

function buildPromptTextLegacy(args: {
  promptJson: PromptJson;
  tags: string[];
  skinContexts: SkinVisionContext[];
  userRefProvided: boolean;
  clusterRefCount: number;
}): string {
  const characters: string[] = [];
  characters.push(`Character A: ${args.promptJson.characters.primary.identity}. Pose: ${args.promptJson.characters.primary.pose}. Position: ${args.promptJson.characters.primary.position}.`);
  if (args.promptJson.characters.secondary) {
    characters.push(`Character B: ${args.promptJson.characters.secondary.identity}. Pose: ${args.promptJson.characters.secondary.pose}. Position: ${args.promptJson.characters.secondary.position}.`);
  } else if (args.skinContexts.length === 1) {
    characters.push("Character B: another opposing player with non-specific identity, readable action silhouette.");
  }

  const sections = [
    `Base direction: ${args.promptJson.scene.composition}`,
    `Scene type: ${args.promptJson.scene.type}`,
    `Depth layers: foreground=${args.promptJson.scene.depth_layers.foreground}; midground=${args.promptJson.scene.depth_layers.midground}; background=${args.promptJson.scene.depth_layers.background}.`,
    `Character and placement: ${characters.join(" ")}`,
    `Style direction: ${args.promptJson.photography.style}`,
    `Camera direction: ${args.promptJson.photography.camera_angle}`,
    `Mood and atmosphere: ${args.promptJson.mood}`,
    `Environment direction: ${args.promptJson.environment.elements.join(", ")}`,
    `Color palette: ${args.promptJson.environment.color_palette}`,
    `Composition style: ${args.promptJson.environment.composition_style}`,
    `Tag context: ${(args.tags || []).join(", ") || "fortnite creative"}`,
    "Reference mapping:",
    `- Skin refs: ${args.skinContexts.length}`,
    `- User ref: ${args.userRefProvided ? 1 : 0}`,
    `- Cluster refs: ${args.clusterRefCount}`,
    "Reference policy: identity anchors first, user reference second, cluster references third.",
    `Hard constraints: ${args.promptJson.photography.aspect_ratio}.`,
  ];
  if (normalizeText(args.promptJson.negative.text_elements)) {
    sections.push(`Hard constraints details: ${args.promptJson.negative.text_elements}.`);
  }
  if (normalizeText(args.promptJson.negative.epic_policy)) {
    sections.push(args.promptJson.negative.epic_policy);
  }

  return normalizeText(sections.join("\n"));
}

function buildPromptUserFirstJson(args: {
  userPrompt: string;
  processedIntent: ProcessedIntent;
  cameraAngle: string;
  mood: string;
  styleProfile: StyleProfile;
  skinContexts: SkinVisionContext[];
}): Record<string, unknown> {
  const userIntent = normalizeText(
    [
      args.userPrompt,
      args.processedIntent.main_subject_action,
      args.processedIntent.composition_style,
      args.processedIntent.environment_elements.length
        ? `Environment cues: ${args.processedIntent.environment_elements.join(", ")}`
        : "",
      args.processedIntent.color_emphasis ? `Color emphasis: ${args.processedIntent.color_emphasis}` : "",
    ]
      .filter(Boolean)
      .join(". "),
  );

  const primary =
    args.skinContexts[0]
      ? `${args.skinContexts[0].name}: ${normalizeText(args.skinContexts[0].vision_text)}`
      : "generic Fortnite character, no fixed skin";
  const secondary = args.skinContexts[1]
    ? `${args.skinContexts[1].name}: ${normalizeText(args.skinContexts[1].vision_text)}`
    : null;

  const payload: Record<string, unknown> = {
    user_intent: userIntent,
    style: {
      mode: args.styleProfile.mode,
      directive: args.styleProfile.prompt_directive,
    },
    characters: {
      primary,
      ...(secondary ? { secondary } : {}),
    },
    camera: cameraInstruction(args.cameraAngle),
    mood: normalizeText(args.mood),
    constraints: {
      technical: "no text, no numbers, no logos, no UI overlays, 16:9 1920x1080",
      epic_policy: EPIC_POLICY_ENABLED ? EPIC_POLICY_CONSTRAINTS : "",
      ...(secondary
        ? {
            character_visibility:
              "When two skins are selected, both characters must be clearly visible and identifiable in the final frame.",
          }
        : {}),
    },
  };
  return payload;
}

function validatePromptJson(value: PromptJson): PromptJsonValidation {
  const fail = (reason: string): PromptJsonValidation => ({ ok: false, reason });

  if (!value || typeof value !== "object") return fail("root_not_object");
  if (!value.scene || typeof value.scene !== "object") return fail("missing_scene");
  if (!value.characters || typeof value.characters !== "object") return fail("missing_characters");
  if (!value.environment || typeof value.environment !== "object") return fail("missing_environment");
  if (!value.photography || typeof value.photography !== "object") return fail("missing_photography");
  if (!normalizeText(value.mood)) return fail("missing_mood");
  if (!value.negative || typeof value.negative !== "object") return fail("missing_negative");
  if (EPIC_POLICY_ENABLED && !normalizeText(value.negative.epic_policy)) return fail("missing_negative_epic_policy");

  const depth = value.scene.depth_layers;
  if (!depth || typeof depth !== "object") return fail("missing_scene_depth_layers");
  if (!normalizeText(depth.foreground)) return fail("missing_scene_depth_layers_foreground");
  if (!normalizeText(depth.midground)) return fail("missing_scene_depth_layers_midground");
  if (!normalizeText(depth.background)) return fail("missing_scene_depth_layers_background");

  const primary = value.characters.primary;
  if (!primary || typeof primary !== "object") return fail("missing_characters_primary");
  if (!normalizeText(primary.identity)) return fail("missing_characters_primary_identity");
  if (!normalizeText(primary.pose)) return fail("missing_characters_primary_pose");
  if (!normalizeText(primary.position)) return fail("missing_characters_primary_position");

  if (value.characters.secondary) {
    const secondary = value.characters.secondary;
    if (!normalizeText(secondary.identity)) return fail("missing_characters_secondary_identity");
    if (!normalizeText(secondary.pose)) return fail("missing_characters_secondary_pose");
    if (!normalizeText(secondary.position)) return fail("missing_characters_secondary_position");
  }

  if (!Array.isArray(value.environment.elements) || value.environment.elements.length === 0) {
    return fail("missing_environment_elements");
  }
  if (!normalizeText(value.environment.color_palette)) return fail("missing_environment_color_palette");
  if (!normalizeText(value.environment.composition_style)) return fail("missing_environment_composition_style");

  if (!normalizeText(value.photography.style)) return fail("missing_photography_style");
  if (!normalizeText(value.photography.aspect_ratio)) return fail("missing_photography_aspect_ratio");
  if (!normalizeText(value.photography.camera_angle)) return fail("missing_photography_camera_angle");
  if (!normalizeText(value.photography.depth_of_field)) return fail("missing_photography_depth_of_field");
  if (!normalizeText(value.photography.color_grading)) return fail("missing_photography_color_grading");

  const asText = JSON.stringify(value).toLowerCase();
  const forbiddenLegacyFragments = [
    "reference mapping",
    "reference policy",
    "tag context",
    "composition rules",
  ];
  if (forbiddenLegacyFragments.some((x) => asText.includes(x))) {
    return fail("legacy_prompt_fragment_detected");
  }

  return { ok: true, reason: null };
}

async function callNanoBanana(args: {
  model: string;
  prompt: string;
  imageUrls: string[];
  contextBoost: boolean;
}) {
  const key = Deno.env.get("FAL_API_KEY") || Deno.env.get("FAL_KEY") || "";
  if (!key) throw new Error("Missing env var: FAL_API_KEY/FAL_KEY");
  const payload = {
    prompt: args.prompt,
    image_urls: args.imageUrls,
    resolution: "2K",
    aspect_ratio: "16:9",
    num_images: 1,
    output_format: "png",
    limit_generations: true,
    enable_web_search: args.contextBoost,
  };

  const resp = await fetchWithTimeout(`https://fal.run/${args.model}`, {
    method: "POST",
    headers: {
      "Authorization": `Key ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  }, 120_000);

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`nano_http_${resp.status}:${txt.slice(0, 280)}`);
  }

  const data = await resp.json();
  const imageUrl = pickImageUrlFromFal(data);
  if (!imageUrl) throw new Error("nano_no_output_image");
  return { imageUrl, raw: data };
}

async function checkPromptBlocked(service: ReturnType<typeof createClient>, prompt: string): Promise<string | null> {
  const { data, error } = await service
    .from("tgis_blocklist_terms")
    .select("term")
    .eq("is_active", true)
    .limit(2000);
  if (error) return null;
  const normalized = normalizeTag(prompt);
  for (const row of (Array.isArray(data) ? data : [])) {
    const term = normalizeTag((row as any)?.term || "");
    if (term && normalized.includes(term)) return term;
  }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startedAt = Date.now();
  const service = createClient(mustEnv("SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
  let generationId: string | null = null;
  let toolRunId: number | null = null;
  let assetId: string | null = null;

  try {
    const auth = await resolveUser(req);
    if (!auth.userId) return json({ success: false, error: "unauthorized" }, 401);
    await requireCommerceGateway(req, auth);

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const prompt = normalizeText(body.prompt);
    const categoryHint = normalizeTag(body.category || "");
    const tags = parseTags(body.tags);
    const mapTitle = normalizeText(body.mapTitle || "");
    const cameraAngle = normalizeSlug(body.cameraAngle || "eye") || "eye";
    const moodOverride = normalizeText(body.moodOverride || "");
    const styleMode = normalizeSlug(body.styleMode || "auto") || "auto";
    const skinIds = Array.isArray(body.skinIds) ? body.skinIds.map((x) => normalizeText(x)).filter(Boolean) : [];
    const referenceImageUrl = normalizeText(body.referenceImageUrl || "");

    if (!prompt) return json({ success: false, error: "missing_prompt" }, 400);
    if (!tags.length) return json({ success: false, error: "missing_tags" }, 400);
    const sanitizationReport: SanitizationReport = SANITIZATION_ENABLED
      ? sanitizeUserIntentText(prompt)
      : {
          original_text: prompt,
          sanitized_text: prompt,
          changed: false,
          changes: [],
          disabled: true,
          reason: "sanitization_disabled_for_test",
        };

    const cfg = await loadRuntimeConfig(service);
    const contextBoost = body.contextBoost == null ? cfg.context_boost_default : Boolean(body.contextBoost);

    const allowance = await service.rpc("tgis_can_generate", { p_user_id: auth.userId });
    if (allowance.error) throw new Error(allowance.error.message);
    const allowed = Boolean((allowance.data as any)?.allowed);
    if (!allowed) {
      const reason = String((allowance.data as any)?.reason || "blocked");
      return json(
        { success: false, error: reason, allowance: allowance.data || null },
        reason === "beta_closed" ? 403 : 429,
      );
    }

    const blockedTerm = await checkPromptBlocked(service, prompt);
    if (blockedTerm) {
      return json({ success: false, error: "prompt_blocked", reason: `blocked_term:${blockedTerm}` }, 400);
    }

    const [clusters, rules] = await Promise.all([loadClusters(service), loadRules(service)]);
    if (!clusters.length) return json({ success: false, error: "no_cluster_available" }, 503);

    const routing = resolveCluster({
      clusters,
      rules,
      prompt,
      tags,
      mapTitle,
      categoryHint,
    });
    const cluster = routing.cluster;
    const clusterSlug = cluster.cluster_slug || null;
    const clusterFamily = cluster.cluster_family || null;
    const intentResult = await processUserIntent({
      description: sanitizationReport.sanitized_text,
      mapTitle,
      tags,
      clusterSlug,
      clusterFamily,
    });

    if (referenceImageUrl && !isAllowedUserReferenceUrl(referenceImageUrl)) {
      return json({ success: false, error: "invalid_reference_image_url" }, 400);
    }

    const skinRefs = await resolveSkinRefs(skinIds, cfg.max_skin_refs);
    const skinVisionContexts = await resolveSkinVisionContexts(service, cfg.openrouter_model, skinRefs);
    const userRefCount = referenceImageUrl ? 1 : 0;
    const clusterRefsNeeded = Math.max(0, cfg.max_total_refs - skinRefs.length - userRefCount);
    const clusterRefs = await selectClusterRefs({
      service,
      cluster,
      tags,
      needed: clusterRefsNeeded,
    });

    const imageUrls = uniqueStrings([
      ...skinRefs.map((x) => x.image_url),
      ...(referenceImageUrl ? [referenceImageUrl] : []),
      ...clusterRefs,
    ]).slice(0, cfg.max_total_refs);

    if (!imageUrls.length) {
      return json({ success: false, error: "no_reference_image_available" }, 409);
    }

    const styleProfile = resolveStyleProfile(styleMode, sanitizationReport.sanitized_text, tags);
    const mood = inferMood(tags, moodOverride);
    const templateSelection = await loadPromptTemplate(service, clusterSlug);
    const promptJson = buildPromptJson({
      template: templateSelection,
      cluster,
      tags,
      cameraAngle,
      mood,
      styleProfile,
      processedIntent: intentResult.intent,
      skinContexts: skinVisionContexts,
      userRefProvided: Boolean(referenceImageUrl),
      clusterRefCount: Math.max(0, imageUrls.length - skinRefs.length - userRefCount),
    });
    const promptValidation = validatePromptJson(promptJson);
    const useLegacyTextPrompt = PROMPT_FORMAT_MODE === "text_v0" || PROMPT_FORMAT_MODE === "legacy_text";
    const useUserFirstPrompt = PROMPT_FORMAT_MODE === "user_first_json";
    const userFirstPromptObj = useUserFirstPrompt
      ? buildPromptUserFirstJson({
          userPrompt: sanitizationReport.sanitized_text,
          processedIntent: intentResult.intent,
          cameraAngle,
          mood,
          styleProfile,
          skinContexts: skinVisionContexts,
        })
      : null;
    const promptUsed = useUserFirstPrompt
      ? JSON.stringify(userFirstPromptObj)
      : useLegacyTextPrompt
      ? buildPromptTextLegacy({
          promptJson,
          tags,
          skinContexts: skinVisionContexts,
          userRefProvided: Boolean(referenceImageUrl),
          clusterRefCount: Math.max(0, imageUrls.length - skinRefs.length - userRefCount),
        })
      : JSON.stringify(promptJson);
    const promptFormat = useUserFirstPrompt ? "user_first_json_v1" : useLegacyTextPrompt ? "text_v0" : "json_v1";
    if (!promptValidation.ok) {
      const { data: failedRows } = await service
        .from("tgis_generation_log")
        .insert({
          user_id: auth.userId,
          prompt_raw: prompt,
          prompt_rewritten: promptUsed,
          category: clusterFamily || categoryHint || "general",
          cluster_id: cluster.cluster_id,
          cluster_slug: clusterSlug,
          provider: "fal.ai",
          model_name: cfg.nano_model,
          provider_model: cfg.nano_model,
          variants: 1,
          status: "failed",
          error_text: `prompt_json_invalid:${promptValidation.reason}`,
          context_boost: contextBoost,
          skin_ids: skinRefs.map((x) => x.id),
          slots_json: {
            skins: skinRefs.length,
            user_ref: userRefCount,
            cluster_refs: Math.max(0, imageUrls.length - skinRefs.length - userRefCount),
            image_urls: imageUrls,
            skin_ids: skinRefs.map((x) => x.id),
            skin_names: skinRefs.map((x) => x.name),
          },
          routing_debug_json: {
            reason: routing.reason,
            score: routing.score,
            matched_rule_id: routing.matchedRuleId,
            tags,
            map_title: mapTitle || null,
          },
          processed_intent_json: intentResult.intent as unknown as Record<string, unknown>,
          sanitization_report_json: sanitizationReport as unknown as Record<string, unknown>,
          metadata_json: {
            camera_angle: cameraAngle,
            mood,
            style_mode: styleProfile.mode,
            context_boost: contextBoost,
            cluster_name: cluster.cluster_name,
            cluster_slug: clusterSlug,
            cluster_family: clusterFamily,
            template_source: templateSelection.source,
            template_version: templateSelection.version,
            prompt_format: promptFormat,
            prompt_json_obj: promptJson,
            prompt_user_first_obj: userFirstPromptObj,
            prompt_json_serialized_length: promptUsed.length,
            prompt_json_validation_ok: false,
            prompt_json_validation_error: promptValidation.reason,
          },
        })
        .select("id")
        .limit(1);
      generationId = failedRows?.[0]?.id || null;
      return json({ success: false, error: "prompt_json_invalid", reason: promptValidation.reason }, 500);
    }

    const { data: insertRows, error: insertErr } = await service
      .from("tgis_generation_log")
      .insert({
        user_id: auth.userId,
        prompt_raw: prompt,
        prompt_rewritten: promptUsed,
        category: clusterFamily || categoryHint || "general",
        cluster_id: cluster.cluster_id,
        cluster_slug: clusterSlug,
        provider: "fal.ai",
        model_name: cfg.nano_model,
        provider_model: cfg.nano_model,
        variants: 1,
        status: "queued",
        context_boost: contextBoost,
        skin_ids: skinRefs.map((x) => x.id),
        slots_json: {
          skins: skinRefs.length,
          user_ref: userRefCount,
          cluster_refs: Math.max(0, imageUrls.length - skinRefs.length - userRefCount),
          image_urls: imageUrls,
          skin_ids: skinRefs.map((x) => x.id),
          skin_names: skinRefs.map((x) => x.name),
          skin_vision_sources: skinVisionContexts.map((x) => ({ id: x.id, source: x.source })),
          max_total_refs: cfg.max_total_refs,
        },
        routing_debug_json: {
          reason: routing.reason,
          score: routing.score,
          matched_rule_id: routing.matchedRuleId,
          tags,
          map_title: mapTitle || null,
        },
        processed_intent_json: intentResult.intent as unknown as Record<string, unknown>,
        sanitization_report_json: sanitizationReport as unknown as Record<string, unknown>,
        metadata_json: {
          camera_angle: cameraAngle,
          mood,
          style_mode: styleProfile.mode,
          context_boost: contextBoost,
          cluster_name: cluster.cluster_name,
          cluster_slug: clusterSlug,
          cluster_family: clusterFamily,
          template_source: templateSelection.source,
          template_version: templateSelection.version,
          skin_refs: skinRefs,
          skin_vision_contexts: skinVisionContexts,
          intent_provider: intentResult.provider,
          intent_model: intentResult.model,
          intent_error: intentResult.error || null,
          intent_raw_response: intentResult.raw_response || null,
          prompt_format: promptFormat,
          prompt_json_obj: promptJson,
          prompt_user_first_obj: userFirstPromptObj,
          prompt_json_serialized_length: promptUsed.length,
          prompt_json_validation_ok: true,
        },
      })
      .select("id")
      .limit(1);
    if (insertErr) throw new Error(insertErr.message);
    generationId = insertRows?.[0]?.id || null;

    if (generationId) {
      try {
        const { data: runRow } = await service
          .from("tgis_thumb_tool_runs")
          .insert({
            user_id: auth.userId,
            asset_id: null,
            tool_name: "generate",
            mode: "generate",
            status: "running",
            provider: "fal",
            provider_model: cfg.nano_model,
            started_at: new Date().toISOString(),
            input_json: {
              generation_id: generationId,
              tags,
              camera_angle: cameraAngle,
              mood,
              style_mode: styleProfile.mode,
              context_boost: contextBoost,
              cluster_id: cluster.cluster_id,
              cluster_slug: clusterSlug,
              slots: {
                skins: skinRefs.length,
                user_ref: userRefCount,
                cluster_refs: Math.max(0, imageUrls.length - skinRefs.length - userRefCount),
              },
            },
          })
          .select("id")
          .limit(1)
          .maybeSingle();
        toolRunId = Number(runRow?.id || 0) || null;
      } catch {
        // do not break generation if thumb-tools schema is not available yet
      }
    }

    const nano = await callNanoBanana({
      model: cfg.nano_model,
      prompt: promptUsed,
      imageUrls,
      contextBoost,
    });

    const normalized = await normalizeAndStore1920x1080(service, nano.imageUrl);

    const latencyMs = Date.now() - startedAt;
    const estimatedCost = Number((contextBoost ? 0.135 : 0.120).toFixed(6));
    const finalCost = Number((cfg.default_generation_cost_usd > 0.03 ? cfg.default_generation_cost_usd : estimatedCost).toFixed(6));

    if (generationId) {
      try {
        const { data: assetRow } = await service
          .from("tgis_thumb_assets")
          .insert({
            user_id: auth.userId,
            source_generation_id: generationId,
            parent_asset_id: null,
            origin_tool: "generate",
            image_url: normalized.url,
            width: normalized.width,
            height: normalized.height,
            metadata_json: {
              generation_id: generationId,
              cluster_slug: clusterSlug,
              cluster_family: clusterFamily,
              provider_model: cfg.nano_model,
              storage_path: normalized.storage_path,
              raw_path: normalized.raw_path,
            },
          })
          .select("id")
          .limit(1)
          .maybeSingle();
        assetId = String(assetRow?.id || "").trim() || null;
      } catch {
        // do not break generation if thumb-tools schema is not available yet
      }
    }

    if (generationId) {
      await service
        .from("tgis_generation_log")
        .update({
          status: "success",
          images_json: [
            {
              url: normalized.url,
              width: normalized.width,
              height: normalized.height,
              provider_url: nano.imageUrl,
            },
          ],
          latency_ms: latencyMs,
          cost_usd: finalCost,
          asset_id: assetId,
          normalized_image_url: normalized.url,
          normalized_width: normalized.width,
          normalized_height: normalized.height,
          updated_at: new Date().toISOString(),
          metadata_json: {
            camera_angle: cameraAngle,
            mood,
            style_mode: styleProfile.mode,
            context_boost: contextBoost,
            cluster_name: cluster.cluster_name,
            cluster_slug: clusterSlug,
            cluster_family: clusterFamily,
            template_source: templateSelection.source,
            template_version: templateSelection.version,
            skin_refs: skinRefs,
            skin_vision_contexts: skinVisionContexts,
            intent_provider: intentResult.provider,
            intent_model: intentResult.model,
            intent_error: intentResult.error || null,
            intent_raw_response: intentResult.raw_response || null,
            prompt_format: promptFormat,
            prompt_json_obj: promptJson,
            prompt_user_first_obj: userFirstPromptObj,
            prompt_json_serialized_length: promptUsed.length,
            prompt_json_validation_ok: true,
            provider_image_url: nano.imageUrl,
            storage_path: normalized.storage_path,
            raw_path: normalized.raw_path,
          },
        })
        .eq("id", generationId);

      await service.rpc("tgis_record_generation_cost", {
        p_generation_id: generationId,
        p_provider: "fal.ai",
        p_model_name: cfg.nano_model,
        p_cost_usd: finalCost,
        p_images_generated: 1,
      });

      for (const skin of skinRefs) {
        await service.rpc("tgis_increment_skin_usage", {
          p_skin_id: skin.id,
          p_day: new Date().toISOString().slice(0, 10),
          p_inc: 1,
        });
      }
    }

    if (toolRunId) {
      try {
        await service
          .from("tgis_thumb_tool_runs")
          .update({
            status: "success",
            asset_id: assetId,
            latency_ms: latencyMs,
            cost_usd: finalCost,
            ended_at: new Date().toISOString(),
            output_json: {
              generation_id: generationId,
              image: {
                url: normalized.url,
                width: normalized.width,
                height: normalized.height,
              },
              provider_image_url: nano.imageUrl,
              cluster_slug: clusterSlug,
              cluster_family: clusterFamily,
            },
          })
          .eq("id", toolRunId);
      } catch {
        // no-op
      }
    }

    return json({
      success: true,
      generation_id: generationId,
      asset_id: assetId,
      image: {
        url: normalized.url,
        width: 1920,
        height: 1080,
      },
      images: [
        {
          url: normalized.url,
          seed: 0,
          width: 1920,
          height: 1080,
        },
      ],
      cluster_slug: clusterSlug,
      cluster_family: clusterFamily,
      cluster_name: cluster.cluster_name,
      slots_used: {
        skins: skinRefs.length,
        user_ref: userRefCount,
        cluster_refs: Math.max(0, imageUrls.length - skinRefs.length - userRefCount),
      },
      cost_usd: finalCost,
      latency_ms: latencyMs,
      prompt_used: promptUsed,
      context_boost: contextBoost,
      provider_model: cfg.nano_model,
      prompt_format: promptFormat,
      style_mode: styleProfile.mode,
      routing_reason: routing.reason,
      routing_score: routing.score,
      template_source: templateSelection.source,
      template_version: templateSelection.version,
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
        // ignore secondary failure
      }
    }
    if (toolRunId) {
      try {
        await service
          .from("tgis_thumb_tool_runs")
          .update({
            status: "failed",
            error_text: e instanceof Error ? e.message : String(e),
            latency_ms: Date.now() - startedAt,
            ended_at: new Date().toISOString(),
          })
          .eq("id", toolRunId);
      } catch {
        // ignore secondary failure
      }
    }
    const errorMsg = e instanceof Error ? e.message : String(e);
    const status = errorMsg === "unauthorized"
      ? 401
      : errorMsg.startsWith("commerce_gateway_")
        ? (errorMsg === "commerce_gateway_misconfigured" ? 503 : 403)
        : 500;
    return json({ success: false, error: errorMsg }, status);
  }
});
