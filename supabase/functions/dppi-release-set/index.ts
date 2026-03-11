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

function asNum(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function metricsByHorizon(metricsJson: unknown): Record<string, Record<string, number>> {
  if (!metricsJson || typeof metricsJson !== "object") return {};
  const raw = (metricsJson as any).metrics_by_horizon;
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, Record<string, number>> = {};
  for (const [h, vals] of Object.entries(raw as Record<string, unknown>)) {
    if (!vals || typeof vals !== "object") continue;
    const row: Record<string, number> = {};
    for (const [k, v] of Object.entries(vals as Record<string, unknown>)) {
      const n = asNum(v);
      if (n != null) row[k] = n;
    }
    out[h] = row;
  }
  return out;
}

function extractBearer(req: Request): string {
  const authHeader = (req.headers.get("Authorization") || req.headers.get("authorization") || "").trim();
  return authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
}

async function isAdminOrService(req: Request, serviceClient: ReturnType<typeof createClient>): Promise<boolean> {
  const serviceKey = mustEnv("SUPABASE_SERVICE_ROLE_KEY");
  const bearer = extractBearer(req);
  const apiKey = (req.headers.get("apikey") || "").trim();
  if (bearer && bearer === serviceKey) return true;
  if (apiKey && apiKey === serviceKey) return true;
  if (!bearer) return false;

  const authClient = createClient(mustEnv("SUPABASE_URL"), mustEnv("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: `Bearer ${bearer}` } },
  });

  const { data: userRes, error: userErr } = await authClient.auth.getUser();
  if (userErr || !userRes.user?.id) return false;

  const { data: roleRows, error: roleErr } = await serviceClient
    .from("user_roles")
    .select("role")
    .eq("user_id", userRes.user.id)
    .limit(1);

  if (roleErr || !Array.isArray(roleRows) || roleRows.length === 0) return false;
  const role = String(roleRows[0]?.role || "");
  return role === "admin" || role === "editor";
}

function isServiceDirect(req: Request): boolean {
  const serviceKey = mustEnv("SUPABASE_SERVICE_ROLE_KEY");
  const bearer = extractBearer(req);
  const apiKey = (req.headers.get("apikey") || "").trim();
  return Boolean((bearer && bearer === serviceKey) || (apiKey && apiKey === serviceKey));
}

function compareRelativeGates(
  candidate: Record<string, Record<string, number>>,
  baseline: Record<string, Record<string, number>>,
  cfg: {
    prAucDropMaxPct: number;
    precision20DropMaxPct: number;
    brierWorseMaxPct: number;
  },
): string[] {
  const errors: string[] = [];
  if (!candidate || Object.keys(candidate).length === 0) {
    errors.push("missing metrics_by_horizon");
    return errors;
  }
  if (!baseline || Object.keys(baseline).length === 0) return errors;

  for (const [horizon, c] of Object.entries(candidate)) {
    const b = baseline[horizon];
    if (!b) continue;

    const cAuc = asNum(c.test_auc_pr);
    const bAuc = asNum(b.test_auc_pr);
    if (cAuc != null && bAuc != null && bAuc > 0) {
      const minAuc = bAuc * (1 - cfg.prAucDropMaxPct / 100);
      if (cAuc < minAuc) {
        errors.push(`${horizon}: test_auc_pr ${cAuc.toFixed(4)} < ${minAuc.toFixed(4)}`);
      }
    }

    const cP20 = asNum(c.test_precision_at_20);
    const bP20 = asNum(b.test_precision_at_20);
    if (cP20 != null && bP20 != null && bP20 > 0) {
      const minP20 = bP20 * (1 - cfg.precision20DropMaxPct / 100);
      if (cP20 < minP20) {
        errors.push(`${horizon}: precision@20 ${cP20.toFixed(4)} < ${minP20.toFixed(4)}`);
      }
    }

    const cBrier = asNum(c.test_brier);
    const bBrier = asNum(b.test_brier);
    if (cBrier != null && bBrier != null && bBrier > 0) {
      const maxBrier = bBrier * (1 + cfg.brierWorseMaxPct / 100);
      if (cBrier > maxBrier) {
        errors.push(`${horizon}: test_brier ${cBrier.toFixed(4)} > ${maxBrier.toFixed(4)}`);
      }
    }
  }

  return errors;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const service = createClient(mustEnv("SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
    if (!(await isAdminOrService(req, service))) {
      return json({ success: false, error: "forbidden" }, 403);
    }

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    if (shouldProxyToData(req)) {
      const proxied = await invokeDataFunction({
        req,
        functionName: "dppi-release-set",
        body,
        timeoutMs: getEnvNumber("LOOKUP_DATA_TIMEOUT_MS", 7000),
      });
      if (proxied.ok) return dataProxyResponse(proxied.data, proxied.status, corsHeaders);
      return dataBridgeUnavailableResponse(corsHeaders, proxied.error);
    }

    if (shouldBlockLocalExecution(req)) {
      return dataBridgeUnavailableResponse(corsHeaders, "strict proxy mode");
    }

    const channelName = String(body?.channelName || "").trim();
    const modelName = body?.modelName == null ? null : String(body.modelName || "").trim() || null;
    const modelVersion = body?.modelVersion == null ? null : String(body.modelVersion || "").trim() || null;
    const notes = body?.notes == null ? null : String(body.notes || "").slice(0, 600);
    const force = Boolean(body?.force === true);

    if (!["shadow", "candidate", "limited", "production"].includes(channelName)) {
      return json({ success: false, error: "invalid channel" }, 400);
    }

    if ((modelName && !modelVersion) || (!modelName && modelVersion)) {
      return json({ success: false, error: "modelName and modelVersion must be provided together" }, 400);
    }

    if (force && !isServiceDirect(req)) {
      return json({ success: false, error: "force mode requires service role token" }, 403);
    }

    const gateCfg = {
      prAucDropMaxPct: 5,
      precision20DropMaxPct: 10,
      brierWorseMaxPct: 15,
      eceMax: 0.15,
      psiMax: 0.25,
    };
    const gateErrors: string[] = [];

    let taskType: string | null = null;
    if (modelName && modelVersion) {
      const { data: modelRows, error: modelErr } = await service
        .from("dppi_model_registry")
        .select("id,status,task_type,metrics_json")
        .eq("model_name", modelName)
        .eq("model_version", modelVersion)
        .limit(1);
      if (modelErr) throw new Error(modelErr.message);
      if (!Array.isArray(modelRows) || modelRows.length === 0) {
        return json({ success: false, error: "model not found" }, 404);
      }

      const model = modelRows[0] as any;
      taskType = String(model.task_type || "");

      if (channelName === "production" && !["production_candidate", "candidate", "limited", "production"].includes(String(model.status || ""))) {
        gateErrors.push(`invalid_status_for_production:${String(model.status || "unknown")}`);
      }

      if (["candidate", "limited", "production"].includes(channelName)) {
        const candidateMetrics = metricsByHorizon(model.metrics_json || {});

        const { data: baseRows, error: baseErr } = await service
          .from("dppi_release_channels")
          .select("model_name,model_version")
          .eq("channel_name", "production")
          .limit(1);
        if (baseErr) throw new Error(baseErr.message);

        let baselineMetrics: Record<string, Record<string, number>> = {};
        const baselineModelName = Array.isArray(baseRows) && baseRows[0] ? String((baseRows[0] as any).model_name || "") : "";
        const baselineModelVersion = Array.isArray(baseRows) && baseRows[0] ? String((baseRows[0] as any).model_version || "") : "";
        if (baselineModelName && baselineModelVersion && !(baselineModelName === modelName && baselineModelVersion === modelVersion)) {
          const { data: baseModelRows, error: baseModelErr } = await service
            .from("dppi_model_registry")
            .select("metrics_json,task_type")
            .eq("model_name", baselineModelName)
            .eq("model_version", baselineModelVersion)
            .eq("task_type", taskType)
            .limit(1);
          if (baseModelErr) throw new Error(baseModelErr.message);
          if (Array.isArray(baseModelRows) && baseModelRows[0]) {
            baselineMetrics = metricsByHorizon((baseModelRows[0] as any).metrics_json || {});
          }
        }

        gateErrors.push(
          ...compareRelativeGates(candidateMetrics, baselineMetrics, {
            prAucDropMaxPct: gateCfg.prAucDropMaxPct,
            precision20DropMaxPct: gateCfg.precision20DropMaxPct,
            brierWorseMaxPct: gateCfg.brierWorseMaxPct,
          }),
        );

        const { data: calRows, error: calErr } = await service
          .from("dppi_calibration_metrics")
          .select("ece")
          .eq("model_name", modelName)
          .eq("model_version", modelVersion)
          .eq("task_type", taskType)
          .limit(200);
        if (calErr) throw new Error(calErr.message);

        if (!Array.isArray(calRows) || calRows.length === 0) {
          gateErrors.push("missing_calibration_metrics");
        } else {
          let maxEce = 0;
          for (const row of calRows as any[]) {
            const e = asNum(row.ece);
            if (e != null) maxEce = Math.max(maxEce, e);
          }
          if (maxEce > gateCfg.eceMax) gateErrors.push(`ece_above_max:${maxEce.toFixed(4)}`);
        }

        const sevenDaysAgoIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const { data: driftRows, error: driftErr } = await service
          .from("dppi_drift_metrics")
          .select("psi")
          .eq("model_name", modelName)
          .eq("model_version", modelVersion)
          .gte("measured_at", sevenDaysAgoIso)
          .limit(400);
        if (driftErr) throw new Error(driftErr.message);
        if (Array.isArray(driftRows) && driftRows.length > 0) {
          let maxPsi = 0;
          for (const row of driftRows as any[]) {
            const psi = asNum(row.psi);
            if (psi != null) maxPsi = Math.max(maxPsi, psi);
          }
          if (maxPsi > gateCfg.psiMax) gateErrors.push(`psi_above_max:${maxPsi.toFixed(4)}`);
        }
      }
    }

    if (gateErrors.length > 0 && !force) {
      return json(
        { success: false, error: "promotion_gates_failed", channelName, modelName, modelVersion, gate_errors: gateErrors },
        409,
      );
    }

    const { error: upErr } = await service
      .from("dppi_release_channels")
      .upsert({
        channel_name: channelName,
        model_name: modelName,
        model_version: modelVersion,
        notes,
        updated_at: new Date().toISOString(),
      }, { onConflict: "channel_name" });

    if (upErr) throw new Error(upErr.message);

    if (modelName && modelVersion) {
      await service
        .from("dppi_model_registry")
        .update({
          status: channelName === "production" ? "production" : channelName === "candidate" ? "production_candidate" : channelName,
          published_at: channelName === "production" ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq("model_name", modelName)
        .eq("model_version", modelVersion);
    }

    await service
      .from("dppi_feedback_events")
      .insert({
        source: "admin_dppi_release",
        event_type: "release_channel_update",
        region: "NAE",
        surface_name: "CreativeDiscoverySurface_Frontend",
        panel_name: null,
        island_code: null,
        event_value: {
          channel_name: channelName,
          model_name: modelName,
          model_version: modelVersion,
          task_type: taskType,
          force,
          notes,
          gate_errors: gateErrors,
        },
      });

    return json({
      success: true,
      channelName,
      modelName,
      modelVersion,
      gate_errors: gateErrors,
      force,
      updatedAt: new Date().toISOString(),
    });
  } catch (e) {
    return json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});


