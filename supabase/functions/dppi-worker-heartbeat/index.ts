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
        functionName: "dppi-worker-heartbeat",
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

    const workerHost = String(body?.worker_host || body?.workerHost || "unknown-worker").trim() || "unknown-worker";
    const source = String(body?.source || "hetzner-cx22").trim() || "hetzner-cx22";

    const { data, error } = await supabase.rpc("dppi_report_worker_heartbeat", {
      p_worker_host: workerHost,
      p_source: source,
      p_cpu_pct: Number.isFinite(Number(body?.cpu_pct)) ? Number(body.cpu_pct) : null,
      p_mem_pct: Number.isFinite(Number(body?.mem_pct)) ? Number(body.mem_pct) : null,
      p_mem_used_mb: Number.isFinite(Number(body?.mem_used_mb)) ? Number(body.mem_used_mb) : null,
      p_mem_total_mb: Number.isFinite(Number(body?.mem_total_mb)) ? Number(body.mem_total_mb) : null,
      p_disk_pct: Number.isFinite(Number(body?.disk_pct)) ? Number(body.disk_pct) : null,
      p_queue_depth: Number.isFinite(Number(body?.queue_depth)) ? Number(body.queue_depth) : null,
      p_training_running: Boolean(body?.training_running === true),
      p_inference_running: Boolean(body?.inference_running === true),
      p_extra_json: (body?.extra_json && typeof body.extra_json === "object") ? body.extra_json : {},
    });

    if (error) throw new Error(error.message);

    return json({ success: true, heartbeat: data || null });
  } catch (e) {
    return json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
