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

function isServiceRoleRequest(req: Request, serviceKey: string): boolean {
  const authHeader = (req.headers.get("Authorization") || "").trim();
  const apiKeyHeader = (req.headers.get("apikey") || "").trim();
  const authToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : authHeader;

  const decodeJwtPayload = (token: string): Record<string, unknown> | null => {
    try {
      const parts = token.split(".");
      if (parts.length !== 3) return null;
      let b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const pad = b64.length % 4;
      if (pad) b64 += "=".repeat(4 - pad);
      const payload = JSON.parse(atob(b64));
      return payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
    } catch {
      return null;
    }
  };

  if (
    serviceKey &&
    (authHeader === `Bearer ${serviceKey}` || authHeader === serviceKey || apiKeyHeader === serviceKey)
  ) {
    return true;
  }

  const payload = decodeJwtPayload(authToken) || decodeJwtPayload(apiKeyHeader);
  return String(payload?.role || "") === "service_role";
}

async function selectTargets(
  supabase: ReturnType<typeof createClient>,
  params: {
    region?: string;
    surfaceName?: string;
    batchTargets: number;
    activeWithinHours: number;
  },
) {
  const activeAfterIso = new Date(Date.now() - params.activeWithinHours * 3600_000).toISOString();

  let query = supabase
    .from("discovery_exposure_targets")
    .select("id,region,surface_name,last_ok_tick_at")
    .not("last_ok_tick_at", "is", null)
    .gte("last_ok_tick_at", activeAfterIso)
    .order("last_ok_tick_at", { ascending: false, nullsFirst: false })
    .limit(params.batchTargets);

  if (params.region) query = query.eq("region", params.region);
  if (params.surfaceName) query = query.eq("surface_name", params.surfaceName);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data || []) as Array<{ id: string; region: string; surface_name: string }>;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const serviceKey = mustEnv("SUPABASE_SERVICE_ROLE_KEY");
    if (!isServiceRoleRequest(req, serviceKey)) {
      return json({ success: false, error: "forbidden" }, 403);
    }

    const supabase = createClient(mustEnv("SUPABASE_URL"), serviceKey);

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    if (shouldProxyToData(req)) {
      const proxied = await invokeDataFunction({
        req,
        functionName: "dppi-refresh-batch",
        body,
        timeoutMs: getEnvNumber("LOOKUP_DATA_TIMEOUT_MS", 9000),
      });
      if (proxied.ok) return dataProxyResponse(proxied.data, proxied.status, corsHeaders);
      return dataBridgeUnavailableResponse(corsHeaders, proxied.error);
    }

    if (shouldBlockLocalExecution(req)) {
      return dataBridgeUnavailableResponse(corsHeaders, "strict proxy mode");
    }

    const mode = String(body?.mode || "refresh").trim().toLowerCase();
    const region = String(body?.region || "").trim().toUpperCase() || undefined;
    const surfaceName = String(body?.surfaceName || "").trim() || undefined;
    const batchTargets = clampInt(body?.batchTargets, 8, 1, 128);
    const activeWithinHours = clampInt(body?.activeWithinHours, 8, 1, 72);
    const keepDays = clampInt(body?.keepDays, 90, 7, 365);
    const asOfBucket = new Date();
    asOfBucket.setUTCMinutes(0, 0, 0);

    if (mode === "cleanup") {
      const { data: cleanupRes, error: cleanupErr } = await supabase.rpc("dppi_cleanup_old_data", {
        p_keep_days: keepDays,
      });
      if (cleanupErr) throw new Error(cleanupErr.message);
      return json({ success: true, mode: "cleanup", keepDays, result: cleanupRes });
    }

    const targets = await selectTargets(supabase, {
      region,
      surfaceName,
      batchTargets,
      activeWithinHours,
    });

    const errors: Array<{ stage: string; targetId: string | null; error: string }> = [];
    const counters = {
      feature_hourly_targets: 0,
      feature_daily_targets: 0,
      labels_entry_targets: 0,
      labels_survival_targets: 0,
      opportunities_targets: 0,
    };

    const runFeatureHourly = async (targetId: string, targetRegion?: string, targetSurface?: string) => {
      const { error } = await supabase.rpc("compute_dppi_feature_store_hourly", {
        p_target_id: targetId,
        p_region: targetRegion || null,
        p_surface_name: targetSurface || null,
        p_panel_name: null,
        p_as_of: asOfBucket.toISOString(),
      });
      if (error) throw error;
      counters.feature_hourly_targets += 1;
    };

    const runFeatureDaily = async (targetId: string, targetRegion?: string, targetSurface?: string) => {
      const { error } = await supabase.rpc("compute_dppi_feature_store_daily", {
        p_target_id: targetId,
        p_region: targetRegion || null,
        p_surface_name: targetSurface || null,
        p_panel_name: null,
        p_as_of: asOfBucket.toISOString().slice(0, 10),
      });
      if (error) throw error;
      counters.feature_daily_targets += 1;
    };

    const runLabels = async (targetId: string) => {
      const { error: entryErr } = await supabase.rpc("compute_dppi_labels_entry", {
        p_target_id: targetId,
        p_as_of_bucket: asOfBucket.toISOString(),
      });
      if (entryErr) throw entryErr;
      counters.labels_entry_targets += 1;

      const { error: survivalErr } = await supabase.rpc("compute_dppi_labels_survival", {
        p_target_id: targetId,
        p_since: new Date(Date.now() - 7 * 24 * 3600_000).toISOString(),
      });
      if (survivalErr) throw survivalErr;
      counters.labels_survival_targets += 1;
    };

    const runOpportunities = async (targetId: string, targetRegion?: string, targetSurface?: string) => {
      const { error: seedErr } = await supabase.rpc("seed_dppi_heuristic_predictions", {
        p_target_id: targetId,
        p_region: targetRegion || null,
        p_surface_name: targetSurface || null,
        p_panel_name: null,
        p_as_of_bucket: asOfBucket.toISOString(),
      });
      if (seedErr) throw seedErr;

      const { error } = await supabase.rpc("materialize_dppi_opportunities", {
        p_target_id: targetId,
        p_region: targetRegion || null,
        p_surface_name: targetSurface || null,
        p_panel_name: null,
        p_as_of_bucket: asOfBucket.toISOString(),
      });
      if (error) throw error;
      counters.opportunities_targets += 1;
    };

    for (const target of targets) {
      const targetId = String(target.id || "");
      if (!targetId) continue;

      const runAll = mode === "refresh";
      const shouldHourly = runAll || mode === "feature_hourly";
      const shouldDaily = runAll || mode === "feature_daily";
      const shouldLabels = runAll || mode === "labels_daily";
      const shouldOpportunities = runAll || mode === "opportunities";

      if (shouldHourly) {
        try {
          await runFeatureHourly(targetId, target.region, target.surface_name);
        } catch (err) {
          errors.push({ stage: "feature_hourly", targetId, error: err instanceof Error ? err.message : String(err) });
          if (!runAll) continue;
        }
      }

      if (shouldDaily) {
        try {
          await runFeatureDaily(targetId, target.region, target.surface_name);
        } catch (err) {
          errors.push({ stage: "feature_daily", targetId, error: err instanceof Error ? err.message : String(err) });
        }
      }

      if (shouldLabels) {
        try {
          await runLabels(targetId);
        } catch (err) {
          errors.push({ stage: "labels", targetId, error: err instanceof Error ? err.message : String(err) });
        }
      }

      if (shouldOpportunities) {
        try {
          await runOpportunities(targetId, target.region, target.surface_name);
        } catch (err) {
          errors.push({ stage: "opportunities", targetId, error: err instanceof Error ? err.message : String(err) });
        }
      }
    }

    return json({
      success: true,
      mode,
      region: region || null,
      surfaceName: surfaceName || null,
      as_of_bucket: asOfBucket.toISOString(),
      targets_scanned: targets.length,
      ...counters,
      errors,
    });
  } catch (e) {
    return json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

