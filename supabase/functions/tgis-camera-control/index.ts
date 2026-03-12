import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  callFalModel,
  clampNumber,
  corsHeaders,
  createServiceClient,
  createThumbAsset,
  createToolRun,
  isAllowedImageUrl,
  json,
  loadOwnedAsset,
  loadRuntimeToolConfig,
  normalizeAndStore1920x1080,
  normalizeSlug,
  normalizeText,
  pickImageUrlFromFal,
  requireCommerceGateway,
  resolveUser,
  updateToolRun,
} from "../_shared/tgisThumbTools.ts";

type CameraPreset =
  | "heroic"
  | "confronto"
  | "epicidade"
  | "overview"
  | "cinematic"
  | "god_view"
  | "custom";

type CameraValues = {
  azimuth: number;
  elevation: number;
  distance: number;
  zoom: number;
};

type ProviderCameraValues = {
  horizontalAngle: number;
  verticalAngle: number;
  zoom: number;
};

const AZIMUTH_MAX = 70;
const AZIMUTH_RESPONSE_GAMMA = 1.9;
const ELEVATION_POS_MAX = 60;
const ELEVATION_NEG_MAX = 30;
const ELEVATION_RESPONSE_GAMMA = 1.5;
const ZOOM_RESPONSE_GAMMA = 1.25;

function normalizeHorizontalAngleForFal(angle: number): number {
  const normalized = ((angle % 360) + 360) % 360;
  return Number(normalized.toFixed(2));
}

function mapAzimuthToProvider(azimuth: number): number {
  const sign = azimuth < 0 ? -1 : azimuth > 0 ? 1 : 0;
  if (!sign) return 0;
  const normalized = Math.min(1, Math.abs(azimuth) / AZIMUTH_MAX);
  const eased = Math.pow(normalized, AZIMUTH_RESPONSE_GAMMA);
  const mapped = sign * eased * AZIMUTH_MAX;
  return Number(mapped.toFixed(2));
}

function mapElevationToProvider(elevation: number): number {
  if (elevation === 0) return 0;
  if (elevation > 0) {
    const normalized = Math.min(1, elevation / ELEVATION_POS_MAX);
    const eased = Math.pow(normalized, ELEVATION_RESPONSE_GAMMA);
    return Number((eased * ELEVATION_POS_MAX).toFixed(2));
  }
  const normalized = Math.min(1, Math.abs(elevation) / ELEVATION_NEG_MAX);
  const eased = Math.pow(normalized, ELEVATION_RESPONSE_GAMMA);
  return Number((-eased * ELEVATION_NEG_MAX).toFixed(2));
}

function mapZoomToProvider(zoom: number): number {
  const normalized = Math.min(1, Math.max(0, zoom / 10));
  const eased = Math.pow(normalized, ZOOM_RESPONSE_GAMMA);
  return Number((eased * 10).toFixed(2));
}

function buildProviderCameraValues(values: CameraValues): ProviderCameraValues {
  const mappedAzimuth = mapAzimuthToProvider(values.azimuth);
  return {
    horizontalAngle: normalizeHorizontalAngleForFal(mappedAzimuth),
    verticalAngle: mapElevationToProvider(values.elevation),
    zoom: mapZoomToProvider(values.zoom),
  };
}

const PRESETS: Record<Exclude<CameraPreset, "custom">, CameraValues> = {
  heroic: { azimuth: 22, elevation: -12, distance: 0.85 },
  confronto: { azimuth: 0, elevation: -6, distance: 0.95 },
  epicidade: { azimuth: 30, elevation: -14, distance: 0.82 },
  overview: { azimuth: 0, elevation: 28, distance: 1.25 },
  cinematic: { azimuth: 18, elevation: -8, distance: 0.9 },
  god_view: { azimuth: 0, elevation: 52, distance: 1.4 },
};

function resolveCameraValues(body: Record<string, unknown>, preset: CameraPreset): CameraValues {
  const base = preset !== "custom" ? PRESETS[preset] : { azimuth: 0, elevation: 0, distance: 1 };
  const distance = clampNumber(body.distance, base.distance, 0.5, 1.5);
  return {
    azimuth: clampNumber(body.azimuth, base.azimuth, -70, 70),
    elevation: clampNumber(body.elevation, base.elevation, -30, 60),
    distance,
    // fal schema: 0 = wide/far, 10 = close
    zoom: Number(((1.5 - distance) * 10).toFixed(2)),
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startedAt = Date.now();
  const service = createServiceClient();
  let runId: number | null = null;

  try {
    const auth = await resolveUser(req, service);
    await requireCommerceGateway(req, auth, "camera_control");
    const cfg = await loadRuntimeToolConfig(service);
    const body = await req.json().catch(() => ({} as Record<string, unknown>));

    const assetId = normalizeText(body.assetId || "");
    const sourceImageUrlRaw = normalizeText(body.sourceImageUrl || "");
    const presetRaw = normalizeSlug(body.preset || "custom");
    const preset = (["heroic", "confronto", "epicidade", "overview", "cinematic", "god_view", "custom"].includes(presetRaw)
      ? presetRaw
      : "custom") as CameraPreset;
    const values = resolveCameraValues(body, preset);
    const providerValues = buildProviderCameraValues(values);

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

    runId = await createToolRun(service, {
      user_id: auth.userId,
      asset_id: parentAssetId,
      tool_name: "camera_control",
      mode: preset,
      status: "running",
      provider_model: cfg.camera_model,
      input_json: {
        asset_id: parentAssetId,
        source_image_url: sourceImageUrl,
        preset,
        azimuth: values.azimuth,
        elevation: values.elevation,
        distance: values.distance,
        zoom: values.zoom,
        provider_horizontal_angle: providerValues.horizontalAngle,
        provider_vertical_angle: providerValues.verticalAngle,
        provider_zoom: providerValues.zoom,
        camera_steps: cfg.camera_steps,
      },
    });

    const falRaw = await callFalModel({
      model: cfg.camera_model,
      input: {
        image_urls: [sourceImageUrl],
        horizontal_angle: providerValues.horizontalAngle,
        vertical_angle: providerValues.verticalAngle,
        zoom: providerValues.zoom,
        num_images: 1,
        output_format: "png",
        num_inference_steps: cfg.camera_steps,
      },
    });
    const providerImageUrl = pickImageUrlFromFal(falRaw);
    if (!providerImageUrl) throw new Error("provider_no_output_image");

    const normalized = await normalizeAndStore1920x1080(service, providerImageUrl, "camera_control");
    const newAssetId = await createThumbAsset(service, {
      user_id: auth.userId,
      parent_asset_id: parentAssetId,
      origin_tool: "camera_control",
      image_url: normalized.url,
      width: normalized.width,
      height: normalized.height,
      metadata_json: {
        preset,
        azimuth: values.azimuth,
        elevation: values.elevation,
        distance: values.distance,
        zoom: values.zoom,
        provider_horizontal_angle: providerValues.horizontalAngle,
        provider_vertical_angle: providerValues.verticalAngle,
        provider_zoom: providerValues.zoom,
        camera_steps: cfg.camera_steps,
        provider_image_url: providerImageUrl,
        provider_prompt: normalizeText(falRaw?.prompt || ""),
        storage_path: normalized.storage_path,
        raw_path: normalized.raw_path,
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
        preset,
        azimuth: values.azimuth,
        elevation: values.elevation,
        distance: values.distance,
        zoom: values.zoom,
        provider_horizontal_angle: providerValues.horizontalAngle,
        provider_vertical_angle: providerValues.verticalAngle,
        provider_zoom: providerValues.zoom,
        provider_prompt: normalizeText(falRaw?.prompt || ""),
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
    const status = msg === "unauthorized"
      ? 401
      : msg === "forbidden_asset_ownership"
        ? 403
        : msg.startsWith("commerce_gateway_")
          ? (msg === "commerce_gateway_misconfigured" ? 503 : 403)
          : 500;
    return json({ success: false, error: msg }, status);
  }
});
