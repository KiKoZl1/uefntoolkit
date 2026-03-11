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

function decodeJwtPayload(token: string): Record<string, unknown> | null {
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
}

async function isAdminOrService(req: Request, serviceClient: ReturnType<typeof createClient>): Promise<boolean> {
  const serviceKey = mustEnv("SUPABASE_SERVICE_ROLE_KEY");
  const bearer = extractBearer(req);
  const apiKey = (req.headers.get("apikey") || "").trim();
  if (bearer && bearer === serviceKey) return true;
  if (apiKey && apiKey === serviceKey) return true;
  const bearerPayload = bearer ? decodeJwtPayload(bearer) : null;
  const apiPayload = apiKey ? decodeJwtPayload(apiKey) : null;
  if (String(bearerPayload?.role || "") === "service_role") return true;
  if (String(apiPayload?.role || "") === "service_role") return true;
  if (!bearer) return false;

  const authClient = createClient(mustEnv("SUPABASE_URL"), mustEnv("SUPABASE_ANON_KEY"), {
    global: {
      headers: {
        Authorization: `Bearer ${bearer}`,
      },
    },
  });

  const { data: userRes, error: userErr } = await authClient.auth.getUser();
  if (userErr || !userRes.user?.id) return false;

  const { data: roleRow, error: roleErr } = await serviceClient
    .from("user_roles")
    .select("role")
    .eq("user_id", userRes.user.id)
    .limit(1)
    .single();
  if (roleErr) return false;
  return roleRow?.role === "admin" || roleRow?.role === "editor";
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
        functionName: "dppi-health",
        body,
        timeoutMs: getEnvNumber("LOOKUP_DATA_TIMEOUT_MS", 6000),
      });
      if (proxied.ok) return dataProxyResponse(proxied.data, proxied.status, corsHeaders);
      return dataBridgeUnavailableResponse(corsHeaders, proxied.error);
    }

    if (shouldBlockLocalExecution(req)) {
      return dataBridgeUnavailableResponse(corsHeaders, "strict proxy mode");
    }
    const [overviewRpc, latestInference, latestTraining, releaseChannels, cronJobs, readinessRpc, workerLatest, workerRecent] = await Promise.all([
      service.rpc("admin_dppi_overview"),
      service.from("dppi_inference_log").select("ts,mode,processed_rows,failed_rows,error_text").order("ts", { ascending: false }).limit(10),
      service.from("dppi_training_log").select("id,requested_at,started_at,ended_at,status,model_name,model_version,task_type,error_text").order("requested_at", { ascending: false }).limit(10),
      service.from("dppi_release_channels").select("channel_name,model_name,model_version,updated_at,notes").order("channel_name", { ascending: true }),
      service.rpc("admin_list_discover_cron_jobs"),
      service.rpc("dppi_training_readiness", {
        p_region: "NAE",
        p_surface_name: "CreativeDiscoverySurface_Frontend",
        p_min_days: 60,
      }),
      service.from("dppi_worker_heartbeat").select("ts,worker_host,source,cpu_pct,mem_pct,mem_used_mb,mem_total_mb,disk_pct,queue_depth,training_running,inference_running,extra_json").order("ts", { ascending: false }).limit(1).maybeSingle(),
      service.from("dppi_worker_heartbeat").select("ts,worker_host,cpu_pct,mem_pct,disk_pct,queue_depth,training_running,inference_running").order("ts", { ascending: false }).limit(20),
    ]);

    if (overviewRpc.error) throw new Error(overviewRpc.error.message);
    if (cronJobs.error) throw new Error(cronJobs.error.message);
    if (readinessRpc.error) throw new Error(readinessRpc.error.message);

    const dppiCronRows = Array.isArray(cronJobs.data) ? (cronJobs.data as any[]) : [];

    return json({
      success: true,
      overview: overviewRpc.data || {},
      training_readiness: readinessRpc.data || null,
      inference_recent: latestInference.data || [],
      training_recent: latestTraining.data || [],
      release_channels: releaseChannels.data || [],
      cron_jobs: dppiCronRows,
      worker_latest: workerLatest.data || null,
      worker_recent: workerRecent.data || [],
      as_of: new Date().toISOString(),
    });
  } catch (e) {
    return json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

