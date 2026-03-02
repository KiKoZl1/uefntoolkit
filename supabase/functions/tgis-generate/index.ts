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
  fal_model: string;
  rewrite_temperature: number;
  rewrite_max_tokens: number;
};

type ClusterManifestItem = {
  cluster_id: number;
  cluster_name: string;
  trigger_word: string;
  categories: string[];
  lora_fal_path: string | null;
  lora_version: string | null;
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

function extractBearer(req: Request): string {
  const authHeader = (req.headers.get("Authorization") || req.headers.get("authorization") || "").trim();
  return authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
}

function normalizeText(input: string): string {
  return input.replace(/\s+/g, " ").trim();
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

async function resolveUser(req: Request) {
  const token = extractBearer(req);
  if (!token) return { userId: null as string | null, error: "missing_auth" };

  const authClient = createClient(mustEnv("SUPABASE_URL"), mustEnv("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await authClient.auth.getUser();
  if (error || !data.user?.id) return { userId: null as string | null, error: "invalid_auth" };
  return { userId: data.user.id, error: null as string | null };
}

async function loadRuntimeConfig(service: ReturnType<typeof createClient>): Promise<RuntimeConfig> {
  const { data, error } = await service
    .from("tgis_runtime_config")
    .select("max_generations_per_user_per_day,max_variants_per_generation,default_generation_cost_usd,openrouter_model,fal_model,rewrite_temperature,rewrite_max_tokens")
    .eq("config_key", "default")
    .limit(1);

  if (error) throw new Error(error.message);
  const row = Array.isArray(data) && data[0] ? data[0] as any : {};
  return {
    max_generations_per_user_per_day: clampInt(row.max_generations_per_user_per_day, 50, 1, 200),
    max_variants_per_generation: clampInt(row.max_variants_per_generation, 4, 1, 8),
    default_generation_cost_usd: asNum(row.default_generation_cost_usd, 0.007),
    openrouter_model: String(row.openrouter_model || "openai/gpt-4o-mini"),
    fal_model: String(row.fal_model || "fal-ai/z-image/turbo/lora"),
    rewrite_temperature: asNum(row.rewrite_temperature, 0.4),
    rewrite_max_tokens: clampInt(row.rewrite_max_tokens, 220, 80, 600),
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
          is_active: c?.is_active !== false,
        }))
        .filter((c: ClusterManifestItem) => Number.isFinite(c.cluster_id) && c.cluster_name && c.is_active);
    } catch {
      // fallback to DB below
    }
  }

  const { data: dbRows, error: dbErr } = await service
    .from("tgis_cluster_registry")
    .select("cluster_id,cluster_name,trigger_word,categories_json,lora_fal_path,lora_version,is_active")
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

async function rewritePromptOpenRouter(args: {
  rawPrompt: string;
  category: string;
  cfg: RuntimeConfig;
}) {
  const openrouterKey = Deno.env.get("OPENROUTER_API_KEY");
  if (!openrouterKey) {
    return {
      rewritten: `fortnite creative ${args.category} thumbnail, ${args.rawPrompt}, uefn style, dynamic action, high contrast composition, clear focal subject`,
      provider: "fallback:no_openrouter",
    };
  }

  const system = [
    "You rewrite prompts for Fortnite Creative thumbnail generation.",
    "Return one single-line prompt only.",
    "Keep it concise, visual, vibrant and game-thumbnail oriented.",
    "Must keep Fortnite/UEFN context and category intent.",
    "Avoid real-world photography language unrelated to Fortnite gameplay thumbnails.",
    "Include strong thumbnail cues: clear focal subject, action, readable composition, high contrast.",
    "Never include literal trigger words, model tokens, ids, version tags, or debug strings.",
    "Avoid text-overlay instructions.",
    "No markdown, no explanation.",
  ].join(" ");
  const user = `Category: ${args.category}\nUser prompt: ${args.rawPrompt}`;

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openrouterKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": Deno.env.get("OPENROUTER_REFERER") || "https://surpriseradar.app",
      "X-Title": Deno.env.get("OPENROUTER_TITLE") || "SurpriseRadar-TGIS",
    },
    body: JSON.stringify({
      model: args.cfg.openrouter_model,
      temperature: args.cfg.rewrite_temperature,
      max_tokens: args.cfg.rewrite_max_tokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`openrouter_http_${response.status}:${text.slice(0, 240)}`);
  }

  const payload = await response.json();
  const out = String(payload?.choices?.[0]?.message?.content || "").trim();
  if (!out) {
    const fallback = `fortnite creative ${args.category} thumbnail, ${args.rawPrompt}, uefn style, dynamic action, high contrast composition, clear focal subject`;
    return { rewritten: normalizeText(fallback), provider: "fallback:empty_openrouter" };
  }

  const withContext = `${out}, fortnite creative ${args.category} thumbnail, uefn style`;
  const rewritten = normalizeText(withContext);
  return { rewritten, provider: `openrouter:${args.cfg.openrouter_model}` };
}

async function generateOneFal(args: {
  prompt: string;
  seed: number;
  loraPath: string | null;
  cfg: RuntimeConfig;
}) {
  const falKey = mustEnv("FAL_API_KEY");
  const body: Record<string, unknown> = {
    prompt: args.prompt,
    seed: args.seed,
    image_size: { width: 1920, height: 1080 },
    num_images: 1,
    num_inference_steps: 8,
    negative_prompt: "text, letters, words, watermark, logo, subtitle, username, UI, HUD, overlay",
  };
  if (args.loraPath) {
    body.loras = [{ path: args.loraPath, scale: 0.6 }];
  }

  const resp = await fetch(`https://fal.run/${args.cfg.fal_model}`, {
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
  return { url: urls[0], seed: args.seed, raw: payload };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startedAt = Date.now();
  const service = createClient(mustEnv("SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
  let generationId: string | null = null;

  try {
    const auth = await resolveUser(req);
    if (!auth.userId || auth.error) return json({ success: false, error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const rawPrompt = normalizeText(String(body?.prompt || ""));
    const category = normalizeText(String(body?.category || ""));
    if (!rawPrompt) return json({ success: false, error: "missing_prompt" }, 400);
    if (!category) return json({ success: false, error: "missing_category" }, 400);

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
    const cluster = resolveCluster(category, clusters);
    if (!cluster) return json({ success: false, error: "no_cluster_available" }, 503);

    // Temporary quality mode: keep prompt deterministic and avoid LLM rewrite drift.
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
        lora_version: cluster.lora_version,
        provider: "fal.ai",
        model_name: cfg.fal_model,
        variants: requestedVariants,
        status: "queued",
        metadata_json: {
          rewrite_provider: rewrite.provider,
          cluster_name: cluster.cluster_name,
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
    const results = await Promise.all(
      seeds.map((seed) =>
        generateOneFal({
          prompt: rewrite.rewritten,
          seed,
          loraPath: cluster.lora_fal_path,
          cfg,
        }),
      ),
    );

    const latencyMs = Date.now() - startedAt;
    const imageRows = results.map((r) => ({ url: r.url, seed: r.seed }));
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
        })
        .eq("id", generationId);

      await service.rpc("tgis_record_generation_cost", {
        p_generation_id: generationId,
        p_provider: "fal.ai",
        p_model_name: cfg.fal_model,
        p_cost_usd: costUsd,
        p_images_generated: requestedVariants,
      });
    }

    return json({
      success: true,
      generation_id: generationId,
      cluster_id: cluster.cluster_id,
      cluster_name: cluster.cluster_name,
      model_version: cluster.lora_version,
      images: imageRows,
      cost_usd: costUsd,
      latency_ms: latencyMs,
      rewritten_prompt: rewrite.rewritten,
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
