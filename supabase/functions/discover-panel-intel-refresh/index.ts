import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  dataBridgeUnavailableResponse,
  dataProxyResponse,
  getEnvNumber,
  invokeDataFunction,
  shouldBlockLocalExecution,
  shouldProxyToData,
} from "../_shared/dataBridge.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(res: unknown, status = 200) {
  return new Response(JSON.stringify(res), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function mustEnv(key: string): string {
  const v = Deno.env.get(key);
  if (!v) throw new Error(`Missing env var: ${key}`);
  return v;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

async function isServiceRoleRequest(req: Request, serviceKey: string, supabaseUrl: string): Promise<boolean> {
  const authHeader = (req.headers.get("Authorization") || "").trim();
  const apiKeyHeader = (req.headers.get("apikey") || "").trim();
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : (authHeader || apiKeyHeader);
  if (!token) return false;

  if (token === serviceKey || authHeader === `Bearer ${serviceKey}` || apiKeyHeader === serviceKey) return true;

  // Supports rotated service keys: validate token against Auth Admin endpoint.
  try {
    const resp = await fetch(`${supabaseUrl}/auth/v1/admin/users?per_page=1&page=1`, {
      method: "GET",
      headers: {
        apikey: token,
        Authorization: `Bearer ${token}`,
      },
    });
    return resp.ok;
  } catch {
    return false;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    if (shouldProxyToData(req)) {
      const proxied = await invokeDataFunction({
        req,
        functionName: "discover-panel-intel-refresh",
        body,
        timeoutMs: getEnvNumber("LOOKUP_DATA_TIMEOUT_MS", 7000),
      });
      if (proxied.ok) return dataProxyResponse(proxied.data, proxied.status, corsHeaders);
      return dataBridgeUnavailableResponse(corsHeaders, proxied.error);
    }

    if (shouldBlockLocalExecution(req)) {
      return dataBridgeUnavailableResponse(corsHeaders, "strict proxy mode");
    }

    const serviceKey = mustEnv("SUPABASE_SERVICE_ROLE_KEY");
    const supabaseUrl = mustEnv("SUPABASE_URL");
    if (!(await isServiceRoleRequest(req, serviceKey, supabaseUrl))) {
      return json({ success: false, error: "forbidden" }, 403);
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    const defaultRegions = ["NAE", "EU", "BR", "ASIA"];
    const regions = Array.isArray(body?.regions)
      ? body.regions.map((r: unknown) => String(r || "").trim()).filter(Boolean)
      : [String(body?.region || "").trim()].filter(Boolean);
    const regionList = regions.length ? regions : defaultRegions;

    const surfaceName = String(body?.surfaceName || "CreativeDiscoverySurface_Frontend").trim();
    const windowDays = clampInt(body?.windowDays, 14, 1, 60);
    const batchTargets = clampInt(body?.batchTargets, 8, 1, 64);
    const activeWithinHours = clampInt(body?.activeWithinHours, 6, 1, 48);
    const maxPanelsPerTarget = clampInt(body?.maxPanelsPerTarget, 24, 1, 80);

    const activeAfterIso = new Date(Date.now() - activeWithinHours * 3600_000).toISOString();

    const { data: targetRows, error: targetErr } = await supabase
      .from("discovery_exposure_targets")
      .select("id,region,surface_name,last_ok_tick_at")
      .eq("surface_name", surfaceName)
      .in("region", regionList)
      .not("last_ok_tick_at", "is", null)
      .gte("last_ok_tick_at", activeAfterIso)
      .order("last_ok_tick_at", { ascending: false, nullsFirst: false })
      .limit(batchTargets);

    if (targetErr) throw new Error(targetErr.message);

    const targets = (targetRows || []) as Array<{ id: string; region: string; surface_name: string; last_ok_tick_at: string }>;

    let processedTargets = 0;
    let processedPanels = 0;
    const errors: Array<{ targetId: string; panelName: string | null; error: string }> = [];

    for (const target of targets) {
      const fromIso = new Date(Date.now() - windowDays * 24 * 3600_000).toISOString();
      const { data: panelRows, error: panelErr } = await supabase
        .from("discovery_exposure_presence_segments")
        .select("panel_name")
        .eq("target_id", target.id)
        .eq("link_code_type", "island")
        .gte("start_ts", fromIso)
        .order("start_ts", { ascending: false })
        .limit(5000);

      if (panelErr) {
        errors.push({ targetId: target.id, panelName: null, error: panelErr.message || "panel query failed" });
        continue;
      }

      const panelNames = Array.from(
        new Set(
          (panelRows || [])
            .map((r: any) => String(r?.panel_name || "").trim())
            .filter(Boolean),
        ),
      ).slice(0, maxPanelsPerTarget);

      if (panelNames.length === 0) {
        continue;
      }

      let okForTarget = 0;
      for (const panelName of panelNames) {
        const { error } = await supabase.rpc("compute_discovery_panel_intel_snapshot", {
          p_target_id: target.id,
          p_window_days: windowDays,
          p_panel_name: panelName,
        });

        if (error) {
          errors.push({ targetId: target.id, panelName, error: error.message || "unknown" });
          continue;
        }

        okForTarget += 1;
        processedPanels += 1;
      }

      if (okForTarget > 0) {
        processedTargets += 1;
      }
    }

    return json({
      success: true,
      region_scope: regionList,
      surfaceName,
      windowDays,
      batchTargets,
      activeWithinHours,
      maxPanelsPerTarget,
      processed_targets: processedTargets,
      processed_panels: processedPanels,
      errors,
    });
  } catch (e) {
    return json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
