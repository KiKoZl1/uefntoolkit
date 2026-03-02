import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

function isServiceRoleRequest(req: Request, serviceKey: string): boolean {
  const authHeader = (req.headers.get("Authorization") || "").trim();
  const apiKeyHeader = (req.headers.get("apikey") || "").trim();
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : authHeader;

  if (
    serviceKey &&
    (authHeader === `Bearer ${serviceKey}` || authHeader === serviceKey || apiKeyHeader === serviceKey)
  ) {
    return true;
  }

  try {
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    let b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4;
    if (pad) b64 += "=".repeat(4 - pad);
    const payload = JSON.parse(atob(b64));
    return String(payload?.role || "") === "service_role";
  } catch {
    return false;
  }
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
