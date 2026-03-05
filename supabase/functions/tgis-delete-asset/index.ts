import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, createServiceClient, json, normalizeText, resolveUser } from "../_shared/tgisThumbTools.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const service = createServiceClient();
    const auth = await resolveUser(req, service);
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const assetId = normalizeText(body.assetId || "");
    if (!assetId) return json({ success: false, error: "asset_id_required" }, 400);

    const { data: target, error: targetErr } = await service
      .from("tgis_thumb_assets")
      .select("id,user_id,image_url")
      .eq("id", assetId)
      .limit(1)
      .maybeSingle();
    if (targetErr) return json({ success: false, error: targetErr.message }, 500);
    if (!target?.id) return json({ success: false, error: "asset_not_found" }, 404);

    const ownerId = normalizeText(target.user_id || "");
    if (!auth.isAdmin && ownerId !== auth.userId) {
      return json({ success: false, error: "forbidden_asset_ownership" }, 403);
    }

    const imageUrl = normalizeText(target.image_url || "");
    if (!imageUrl) {
      const { error: delErr } = await service.from("tgis_thumb_assets").delete().eq("id", target.id);
      if (delErr) return json({ success: false, error: delErr.message }, 500);
      return json({ success: true, deleted: 1, image_url: "" });
    }

    let query = service.from("tgis_thumb_assets").delete().eq("image_url", imageUrl);
    if (!auth.isAdmin) query = query.eq("user_id", auth.userId);
    const { error: delErr } = await query;
    if (delErr) return json({ success: false, error: delErr.message }, 500);

    return json({ success: true, deleted: "all_by_image_url", image_url: imageUrl });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg === "unauthorized" ? 401 : 500;
    return json({ success: false, error: msg }, status);
  }
});

