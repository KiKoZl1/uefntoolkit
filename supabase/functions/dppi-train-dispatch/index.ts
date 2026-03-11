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

function extractBearer(req: Request): string {
  const authHeader = (req.headers.get("Authorization") || req.headers.get("authorization") || "").trim();
  return authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
}

async function resolveAuth(req: Request, serviceClient: ReturnType<typeof createClient>) {
  const serviceKey = mustEnv("SUPABASE_SERVICE_ROLE_KEY");
  const bearer = extractBearer(req);
  const apiKey = (req.headers.get("apikey") || "").trim();

  if ((bearer && bearer === serviceKey) || (apiKey && apiKey === serviceKey)) {
    return { allowed: true, isService: true, userId: null as string | null, role: "service_role" };
  }

  if (!bearer) return { allowed: false, isService: false, userId: null as string | null, role: "" };

  const authClient = createClient(mustEnv("SUPABASE_URL"), mustEnv("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: `Bearer ${bearer}` } },
  });

  const { data: userRes, error: userErr } = await authClient.auth.getUser();
  if (userErr || !userRes.user?.id) return { allowed: false, isService: false, userId: null as string | null, role: "" };

  const { data: roleRows, error: roleErr } = await serviceClient
    .from("user_roles")
    .select("role")
    .eq("user_id", userRes.user.id)
    .limit(1);

  if (roleErr || !Array.isArray(roleRows) || roleRows.length === 0) {
    return { allowed: false, isService: false, userId: userRes.user.id, role: "" };
  }

  const role = String(roleRows[0]?.role || "");
  const allowed = role === "admin" || role === "editor";
  return { allowed, isService: false, userId: userRes.user.id, role };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const service = createClient(mustEnv("SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const auth = await resolveAuth(req, service);

    if (!auth.allowed) {
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
        functionName: "dppi-train-dispatch",
        body,
        timeoutMs: getEnvNumber("LOOKUP_DATA_TIMEOUT_MS", 7000),
      });
      if (proxied.ok) return dataProxyResponse(proxied.data, proxied.status, corsHeaders);
      return dataBridgeUnavailableResponse(corsHeaders, proxied.error);
    }

    if (shouldBlockLocalExecution(req)) {
      return dataBridgeUnavailableResponse(corsHeaders, "strict proxy mode");
    }

    const taskType = String(body?.taskType || "entry").trim().toLowerCase();
    if (![
      "entry",
      "survival",
    ].includes(taskType)) {
      return json({ success: false, error: "Invalid taskType" }, 400);
    }

    const region = String(body?.region || "NAE").trim().toUpperCase() || "NAE";
    const surfaceName = String(body?.surfaceName || "CreativeDiscoverySurface_Frontend").trim() || "CreativeDiscoverySurface_Frontend";
    const minDays = Math.max(1, Math.min(365, Number(body?.minDays ?? 60) || 60));
    const force = Boolean(body?.force === true);

    if (force && !auth.isService) {
      return json({ success: false, error: "force mode requires service role" }, 403);
    }

    const { data: readiness, error: readinessErr } = await service.rpc("dppi_training_readiness", {
      p_region: region,
      p_surface_name: surfaceName,
      p_min_days: minDays,
    });

    if (readinessErr) throw new Error(readinessErr.message);

    const readinessObj = (readiness && typeof readiness === "object") ? readiness : {};
    const ready = Boolean((readinessObj as any).ready);

    if (!ready && !force) {
      return json(
        {
          success: false,
          queued: false,
          blocked: true,
          reason: (readinessObj as any).reason || "insufficient_data",
          message: "Training blocked until minimum data coverage is reached.",
          readiness: readinessObj,
        },
        409,
      );
    }

    const modelName = String(body?.modelName || `dppi_${taskType}`).trim();
    const modelVersion = String(
      body?.modelVersion || `${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`,
    ).trim();
    const payload = body?.payload && typeof body.payload === "object" ? body.payload : {};

    const { error: modelErr } = await service.from("dppi_model_registry").upsert(
      {
        model_name: modelName,
        model_version: modelVersion,
        task_type: taskType,
        status: "training",
        metrics_json: {},
        updated_at: new Date().toISOString(),
      },
      { onConflict: "model_name,model_version" },
    );
    if (modelErr) throw new Error(modelErr.message);

    const { data: runRows, error: runErr } = await service
      .from("dppi_training_log")
      .insert({
        status: "queued",
        model_name: modelName,
        model_version: modelVersion,
        task_type: taskType,
        requested_by: auth.userId,
        payload_json: {
          ...payload,
          region,
          surfaceName,
          minDays,
          force,
          readiness: readinessObj,
        },
        result_json: {},
      })
      .select("id,requested_at,status")
      .limit(1);
    if (runErr) throw new Error(runErr.message);

    const run = Array.isArray(runRows) && runRows.length > 0 ? runRows[0] : null;

    return json({
      success: true,
      queued: true,
      run_id: run?.id || null,
      requested_at: run?.requested_at || null,
      status: run?.status || "queued",
      model_name: modelName,
      model_version: modelVersion,
      task_type: taskType,
      readiness: readinessObj,
      force,
    });
  } catch (e) {
    return json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

