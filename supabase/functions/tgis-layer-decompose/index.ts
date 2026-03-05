import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  callFalModel,
  clampInt,
  corsHeaders,
  createServiceClient,
  createToolRun,
  describeImageWithVision,
  isAllowedImageUrl,
  json,
  loadOwnedAsset,
  loadRuntimeToolConfig,
  normalizeText,
  pickLayerUrlsFromFal,
  resolveUser,
  updateToolRun,
} from "../_shared/tgisThumbTools.ts";

function toLayerLabel(index: number, visionText: string): string {
  const text = normalizeText(visionText).toLowerCase();
  if (!text) return `Layer_${index}`;
  if (text.includes("background") || text.includes("sky") || text.includes("horizon")) return `Background_Layer_${index}`;
  if (text.includes("character") || text.includes("person") || text.includes("player")) return `Character_Layer_${index}`;
  if (text.includes("weapon")) return `Weapon_Layer_${index}`;
  if (text.includes("ui") || text.includes("icon")) return `Overlay_Layer_${index}`;
  if (text.includes("effect") || text.includes("explosion") || text.includes("smoke") || text.includes("light")) return `Fx_Layer_${index}`;
  return `Scene_Layer_${index}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startedAt = Date.now();
  const service = createServiceClient();
  let runId: number | null = null;

  try {
    const auth = await resolveUser(req, service);
    const cfg = await loadRuntimeToolConfig(service);
    const body = await req.json().catch(() => ({} as Record<string, unknown>));

    const assetId = normalizeText(body.assetId || "");
    const sourceImageUrlRaw = normalizeText(body.sourceImageUrl || "");
    const numLayers = clampInt(body.numLayers, cfg.layer_default_count, cfg.layer_min_count, cfg.layer_max_count);

    let sourceAssetId: string | null = null;
    let sourceImageUrl = sourceImageUrlRaw;
    if (assetId) {
      const asset = await loadOwnedAsset(service, assetId, auth.userId, auth.isAdmin);
      sourceAssetId = asset.id;
      sourceImageUrl = normalizeText(asset.image_url);
    }
    if (!sourceImageUrl || !isAllowedImageUrl(sourceImageUrl)) {
      return json({ success: false, error: "invalid_source_image_url" }, 400);
    }

    runId = await createToolRun(service, {
      user_id: auth.userId,
      asset_id: sourceAssetId,
      tool_name: "layer_decomposition",
      mode: `layers_${numLayers}`,
      status: "running",
      provider_model: cfg.layer_model,
      input_json: {
        source_asset_id: sourceAssetId,
        source_image_url: sourceImageUrl,
        num_layers: numLayers,
      },
    });

    const falRaw = await callFalModel({
      model: cfg.layer_model,
      input: {
        image_url: sourceImageUrl,
        num_layers: numLayers,
        output_format: "png",
      },
      timeoutMs: 240000,
    });
    const layerUrls = pickLayerUrlsFromFal(falRaw);
    if (!layerUrls.length) throw new Error("layer_model_no_layers");

    const layers = await Promise.all(layerUrls.map(async (url, idx) => {
      const vision = await describeImageWithVision({
        service,
        openrouterModel: cfg.openrouter_model,
        imageUrl: url,
        fallbackName: `Layer ${idx + 1}`,
      });
      return {
        index: idx + 1,
        name: toLayerLabel(idx + 1, vision.text),
        url,
        width: 1920,
        height: 1080,
        vision: vision.text,
        vision_source: vision.source,
      };
    }));

    const latencyMs = Date.now() - startedAt;
    await updateToolRun(service, runId, {
      status: "success",
      latency_ms: latencyMs,
      ended_at: new Date().toISOString(),
      output_json: {
        source_image_url: sourceImageUrl,
        layers: layers.map((l) => ({
          index: l.index,
          name: l.name,
          url: l.url,
          width: l.width,
          height: l.height,
        })),
        warning: "temporary_urls_expire",
      },
    });

    return json({
      success: true,
      runId,
      layers: layers.map((l) => ({
        index: l.index,
        name: l.name,
        url: l.url,
        width: l.width,
        height: l.height,
      })),
      warning: "temporary_urls_expire",
    });
  } catch (e) {
    if (runId) {
      try {
        await updateToolRun(service, runId, {
          status: "failed",
          error_text: e instanceof Error ? e.message : String(e),
          latency_ms: Date.now() - startedAt,
          ended_at: new Date().toISOString(),
        });
      } catch {
        // ignore
      }
    }
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg === "unauthorized" ? 401 : msg === "forbidden_asset_ownership" ? 403 : 500;
    return json({ success: false, error: msg }, status);
  }
});
