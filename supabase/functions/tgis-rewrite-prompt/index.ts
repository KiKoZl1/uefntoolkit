import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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

function normalizeText(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function parseTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => normalizeText(v).toLowerCase()).filter(Boolean).slice(0, 20);
  }
  const raw = normalizeText(value);
  if (!raw) return [];
  return raw.split(",").map((v) => normalizeText(v).toLowerCase()).filter(Boolean).slice(0, 20);
}

function buildFallbackRewrite(params: {
  promptRaw: string;
  tags: string[];
  mapTitle: string;
  cameraAngle: string;
  moodOverride: string;
}): string {
  const parts: string[] = [];
  parts.push(params.promptRaw);
  if (params.mapTitle) parts.push(`Map context: ${params.mapTitle}.`);
  if (params.tags.length) parts.push(`Style tags: ${params.tags.join(", ")}.`);
  if (params.cameraAngle) parts.push(`Camera: ${params.cameraAngle}.`);
  if (params.moodOverride) parts.push(`Mood: ${params.moodOverride}.`);
  parts.push("High readability, clear focal subject, dynamic composition.");
  parts.push("No text, no logos, no watermark, no UI, no HUD.");
  return normalizeText(parts.join(" "));
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const token = extractBearer(req);
    if (!token) return json({ success: false, error: "unauthorized" }, 401);

    const supabaseUrl = mustEnv("SUPABASE_URL");
    const serviceRoleKey = mustEnv("SUPABASE_SERVICE_ROLE_KEY");
    const service = createClient(supabaseUrl, serviceRoleKey);

    const { data: userRes, error: userErr } = await service.auth.getUser(token);
    if (userErr || !userRes.user?.id) return json({ success: false, error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const promptRaw = normalizeText(body.prompt);
    const tags = parseTags(body.tags);
    const mapTitle = normalizeText(body.mapTitle);
    const cameraAngle = normalizeText(body.cameraAngle) || "eye";
    const moodOverride = normalizeText(body.moodOverride);

    if (!promptRaw) return json({ success: false, error: "missing_prompt" }, 400);
    if (promptRaw.length < 10) return json({ success: false, error: "prompt_too_short" }, 400);

    // Rate limit: 10 rewrites per user per rolling hour
    try {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { data: recentRows, error: recentErr } = await service
        .from("tgis_prompt_rewrite_log")
        .select("created_at")
        .eq("user_id", userRes.user.id)
        .gte("created_at", oneHourAgo)
        .order("created_at", { ascending: true })
        .limit(20);
      if (recentErr) {
        console.warn("rewrite_rate_limit_read_error", recentErr.message);
      } else {
        const used = Array.isArray(recentRows) ? recentRows.length : 0;
        const limitPerHour = 10;
        if (used >= limitPerHour) {
          const oldest = String(recentRows?.[0]?.created_at || "");
          const oldestTs = oldest ? new Date(oldest).getTime() : Date.now();
          const retryAfterSeconds = Math.max(
            1,
            Math.ceil((oldestTs + 60 * 60 * 1000 - Date.now()) / 1000),
          );
          return json({
            success: false,
            error: "rewrite_rate_limited",
            limit_per_hour: limitPerHour,
            retry_after_seconds: retryAfterSeconds,
          }, 429);
        }
      }
    } catch (rateErr) {
      console.warn("rewrite_rate_limit_guard_error", rateErr instanceof Error ? rateErr.message : String(rateErr));
    }

    const { data: runtimeCfg, error: runtimeErr } = await service
      .from("tgis_runtime_config")
      .select("openrouter_model,rewrite_temperature,rewrite_max_tokens")
      .eq("config_key", "default")
      .limit(1)
      .maybeSingle();
    if (runtimeErr) {
      console.warn("runtime_config_read_error", runtimeErr.message);
    }

    const model = normalizeText(runtimeCfg?.openrouter_model || "openai/gpt-4o");
    const temperature = Number(runtimeCfg?.rewrite_temperature ?? 0.4);
    const maxTokens = Number(runtimeCfg?.rewrite_max_tokens ?? 300);

    const openRouterApiKey = Deno.env.get("OPENROUTER_API_KEY") || "";

    const systemPrompt =
      "You rewrite prompts for Fortnite Creative thumbnail generation. " +
      "Output only one improved prompt in plain text. " +
      "Keep it concrete and visual. " +
      "Never include instructions about text overlays, logos, titles, HUD or watermarks other than banning them. " +
      "Always end with: no text, no logos, no watermark, no UI, no HUD.";

    const userPrompt = [
      `Original prompt: ${promptRaw}`,
      tags.length ? `Tags: ${tags.join(", ")}` : "",
      mapTitle ? `Map title: ${mapTitle}` : "",
      cameraAngle ? `Camera angle: ${cameraAngle}` : "",
      moodOverride ? `Mood override: ${moodOverride}` : "",
      "Rewrite for stronger composition, clearer focal subject, stronger action readability, and thumbnail punch.",
    ].filter(Boolean).join("\n");

    let rewritten = "";
    let provider = "openrouter";
    if (openRouterApiKey) {
      try {
        const openRouterResp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${openRouterApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            temperature,
            max_tokens: maxTokens,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
          }),
        });

        if (openRouterResp.ok) {
          const payload = await openRouterResp.json();
          rewritten = normalizeText(payload?.choices?.[0]?.message?.content || "");
        } else {
          const text = await openRouterResp.text();
          console.warn(`openrouter_http_${openRouterResp.status}:${text.slice(0, 240)}`);
        }
      } catch (orErr) {
        console.warn("openrouter_request_error", orErr instanceof Error ? orErr.message : String(orErr));
      }
    } else {
      console.warn("openrouter_key_missing_using_fallback");
    }
    if (!rewritten) {
      provider = "fallback";
      rewritten = buildFallbackRewrite({
        promptRaw,
        tags,
        mapTitle,
        cameraAngle,
        moodOverride,
      });
    }

    const category = tags[0] || "general";

    const { error: logErr } = await service.from("tgis_prompt_rewrite_log").insert({
      generation_id: null,
      user_id: userRes.user.id,
      prompt_raw: promptRaw,
      prompt_rewritten: rewritten,
      category,
      cluster_id: null,
      provider,
      model_name: model,
    });
    if (logErr) {
      console.warn("rewrite_log_insert_error", logErr.message);
    }

    return json({
      success: true,
      prompt_raw: promptRaw,
      prompt_rewritten: rewritten,
      model,
      provider,
    });
  } catch (e) {
    return json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
