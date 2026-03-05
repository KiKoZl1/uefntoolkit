import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  callFalModel,
  clampInt,
  corsHeaders,
  createServiceClient,
  createThumbAsset,
  createToolRun,
  describeImageWithVision,
  getSkinById,
  isAllowedImageUrl,
  json,
  loadOwnedAsset,
  loadRuntimeToolConfig,
  normalizeAndStore1920x1080,
  normalizeText,
  parseTags,
  pickImageUrlFromFal,
  resolveUser,
  updateToolRun,
  uploadDataUrlToTempAndSign,
} from "../_shared/tgisThumbTools.ts";

type EditMode = "mask_edit" | "character_replace" | "custom_character";

const EPIC_POLICY_CONSTRAINTS =
  "EPIC policy hard constraints: no text, no titles, no numbers, no logos, no UI/HUD overlays, " +
  "no real-world currency banknotes, no V-Bucks symbols, no XP bars, no graphic blood/gore, no real people.";

function buildEditPrompt(args: {
  mode: EditMode;
  userPrompt: string;
  tags: string[];
  replacementVision?: string;
  customVision?: string;
}): string {
  const tagsText = args.tags.length ? `Tags: ${args.tags.join(", ")}.` : "";

  if (args.mode === "mask_edit") {
    return normalizeText([
      "Fortnite thumbnail localized edit task.",
      "Edit only the masked area; preserve all non-masked regions, perspective, and lighting.",
      args.userPrompt || "Improve clarity and visual impact while keeping style coherence.",
      tagsText,
      "Keep composition readable at thumbnail size.",
      EPIC_POLICY_CONSTRAINTS,
    ].join(" "));
  }

  if (args.mode === "character_replace") {
    return normalizeText([
      "Fortnite thumbnail character replacement task.",
      "Replace the masked character with the requested replacement while preserving pose, camera, and scene lighting.",
      args.replacementVision ? `Replacement character identity: ${args.replacementVision}.` : "",
      args.userPrompt || "Keep action readability and preserve environment consistency.",
      tagsText,
      "Do not alter non-masked background structure except natural contact shadows.",
      EPIC_POLICY_CONSTRAINTS,
    ].join(" "));
  }

  return normalizeText([
    "Fortnite thumbnail custom character insertion task.",
    "Use the custom character reference to replace or edit only in masked region while preserving scene composition and lighting.",
    args.customVision ? `Custom character guidance: ${args.customVision}.` : "",
    args.userPrompt || "Maintain cinematic readability and coherent stylized 3D Fortnite look.",
    tagsText,
    EPIC_POLICY_CONSTRAINTS,
  ].join(" "));
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
    const modeRaw = normalizeText(body.mode || "");
    const mode = (["mask_edit", "character_replace", "custom_character"].includes(modeRaw) ? modeRaw : "") as EditMode;
    const prompt = normalizeText(body.prompt || "");
    const maskDataUrl = normalizeText(body.maskDataUrl || "");
    const replacementSkinId = normalizeText(body.replacementSkinId || "");
    const customCharacterImageUrl = normalizeText(body.customCharacterImageUrl || "");
    const tags = parseTags(body.tags);
    const contextBoost = body.contextBoost == null ? cfg.context_boost_default : Boolean(body.contextBoost);

    if (!mode) return json({ success: false, error: "invalid_mode" }, 400);

    let parentAssetId: string | null = null;
    let sourceImageUrl = sourceImageUrlRaw;
    if (assetId) {
      const asset = await loadOwnedAsset(service, assetId, auth.userId, auth.isAdmin);
      parentAssetId = asset.id;
      sourceImageUrl = normalizeText(asset.image_url);
    }
    if (!sourceImageUrl || !isAllowedImageUrl(sourceImageUrl)) {
      return json({ success: false, error: "invalid_source_image_url" }, 400);
    }

    if (["mask_edit", "character_replace"].includes(mode) && !maskDataUrl) {
      return json({ success: false, error: "mask_required" }, 400);
    }
    if (mode === "character_replace" && !replacementSkinId) {
      return json({ success: false, error: "replacement_skin_required" }, 400);
    }
    if (mode === "custom_character" && (!customCharacterImageUrl || !isAllowedImageUrl(customCharacterImageUrl))) {
      return json({ success: false, error: "invalid_custom_character_image_url" }, 400);
    }

    runId = await createToolRun(service, {
      user_id: auth.userId,
      asset_id: parentAssetId,
      tool_name: "edit_studio",
      mode,
      status: "running",
      provider_model: cfg.nano_model,
      input_json: {
        asset_id: parentAssetId,
        source_image_url: sourceImageUrl,
        mode,
        prompt,
        tags,
        context_boost: contextBoost,
        replacement_skin_id: replacementSkinId || null,
        custom_character_image_url: customCharacterImageUrl || null,
      },
    });

    let maskUrl: string | null = null;
    if (maskDataUrl) {
      maskUrl = await uploadDataUrlToTempAndSign(service, maskDataUrl, auth.userId, "mask");
    }

    let replacementVision = "";
    let replacementImageUrl = "";
    if (mode === "character_replace") {
      const skin = await getSkinById(service, replacementSkinId);
      if (!skin || !isAllowedImageUrl(skin.image_url)) {
        throw new Error("replacement_skin_not_found");
      }
      replacementImageUrl = skin.image_url;
      const desc = await describeImageWithVision({
        service,
        openrouterModel: cfg.openrouter_model,
        imageUrl: skin.image_url,
        cacheKey: skin.id,
        fallbackName: skin.name,
      });
      replacementVision = `${skin.name}: ${desc.text}`;
    }

    let customVision = "";
    if (mode === "custom_character") {
      const desc = await describeImageWithVision({
        service,
        openrouterModel: cfg.openrouter_model,
        imageUrl: customCharacterImageUrl,
        fallbackName: "Custom character",
      });
      customVision = desc.text;
    }

    const promptUsed = buildEditPrompt({
      mode,
      userPrompt: prompt,
      tags,
      replacementVision,
      customVision,
    });

    const imageUrls = [sourceImageUrl];
    if (maskUrl) imageUrls.push(maskUrl);
    if (mode === "character_replace" && replacementImageUrl) imageUrls.push(replacementImageUrl);
    if (mode === "custom_character" && customCharacterImageUrl) imageUrls.push(customCharacterImageUrl);

    const falRaw = await callFalModel({
      model: cfg.nano_model,
      input: {
        prompt: promptUsed,
        image_urls: imageUrls,
        num_images: 1,
        output_format: "png",
        aspect_ratio: "16:9",
        resolution: "2K",
        enable_web_search: contextBoost,
      },
    });
    const providerImageUrl = pickImageUrlFromFal(falRaw);
    if (!providerImageUrl) throw new Error("provider_no_output_image");

    const normalized = await normalizeAndStore1920x1080(service, providerImageUrl, "edit_studio");

    const newAssetId = await createThumbAsset(service, {
      user_id: auth.userId,
      parent_asset_id: parentAssetId,
      origin_tool: "edit_studio",
      image_url: normalized.url,
      width: normalized.width,
      height: normalized.height,
      metadata_json: {
        mode,
        prompt_used: promptUsed,
        source_image_url: sourceImageUrl,
        provider_image_url: providerImageUrl,
        storage_path: normalized.storage_path,
        raw_path: normalized.raw_path,
        replacement_skin_id: replacementSkinId || null,
        custom_character_image_url: customCharacterImageUrl || null,
      },
    });

    const latencyMs = Date.now() - startedAt;
    const costUsd = Number((cfg.default_generation_cost_usd > 0 ? cfg.default_generation_cost_usd : 0.135).toFixed(6));
    await updateToolRun(service, runId, {
      status: "success",
      asset_id: newAssetId,
      latency_ms: latencyMs,
      cost_usd: costUsd,
      ended_at: new Date().toISOString(),
      output_json: {
        image: {
          url: normalized.url,
          width: normalized.width,
          height: normalized.height,
        },
        provider_image_url: providerImageUrl,
        prompt_used: promptUsed,
      },
    });

    return json({
      success: true,
      runId,
      assetId: newAssetId,
      image: {
        url: normalized.url,
        width: normalized.width,
        height: normalized.height,
      },
      latency_ms: latencyMs,
      error: null,
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
