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

function mustEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

function extractBearer(req: Request): string {
  const authHeader = (req.headers.get("Authorization") || req.headers.get("authorization") || "").trim();
  return authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
}

async function isServiceRoleRequest(req: Request, serviceKey: string, supabaseUrl: string): Promise<boolean> {
  const bearer = extractBearer(req);
  const apiKey = (req.headers.get("apikey") || "").trim();
  const token = bearer || apiKey;
  if (!token) return false;
  if (bearer && bearer === serviceKey) return true;
  if (apiKey && apiKey === serviceKey) return true;

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

async function requireAdminOrEditor(req: Request, sbUrl: string, serviceKey: string) {
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
  if (!token) throw new Error("forbidden");

  const anonKey = mustEnv("SUPABASE_ANON_KEY");
  const authClient = createClient(sbUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userErr } = await authClient.auth.getUser();
  if (userErr || !userData?.user?.id) throw new Error("forbidden");

  const service = createClient(sbUrl, serviceKey);
  const { data: roleRows, error: roleErr } = await service
    .from("user_roles")
    .select("role")
    .eq("user_id", userData.user.id)
    .in("role", ["admin", "editor"])
    .limit(1);
  if (roleErr || !roleRows || roleRows.length === 0) throw new Error("forbidden");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const sbUrl = mustEnv("SUPABASE_URL");
    const serviceKey = mustEnv("SUPABASE_SERVICE_ROLE_KEY");
    const serviceRoleMode = await isServiceRoleRequest(req, serviceKey, sbUrl);

    if (!serviceRoleMode) {
      await requireAdminOrEditor(req, sbUrl, serviceKey);
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
        functionName: "discover-cron-admin",
        body,
        timeoutMs: getEnvNumber("LOOKUP_DATA_TIMEOUT_MS", 7000),
      });
      if (proxied.ok) return dataProxyResponse(proxied.data, proxied.status, corsHeaders);
      return dataBridgeUnavailableResponse(corsHeaders, proxied.error);
    }

    if (shouldBlockLocalExecution(req)) {
      return dataBridgeUnavailableResponse(corsHeaders, "strict proxy mode");
    }

    const mode = String(body?.mode || "list").trim().toLowerCase();
    const service = createClient(sbUrl, serviceKey);

    if (mode === "list") {
      const { data, error } = await (service as any).rpc("admin_list_discover_crons");
      if (error) throw new Error(error.message);
      return json({ success: true, mode, rows: data || [] });
    }

    if (mode === "set") {
      const jobname = String(body?.jobname || "").trim();
      const active = Boolean(body?.active);
      if (!jobname) return json({ success: false, error: "Missing jobname" }, 400);
      const { error } = await (service as any).rpc("admin_set_discover_cron_active", {
        p_jobname: jobname,
        p_active: active,
      });
      if (error) throw new Error(error.message);
      return json({ success: true, mode, jobname, active });
    }

    if (mode === "pause") {
      const { data, error } = await (service as any).rpc("admin_pause_discover_crons");
      if (error) throw new Error(error.message);
      return json({ success: true, mode, result: data || null });
    }

    if (mode === "resume") {
      const { data, error } = await (service as any).rpc("admin_resume_discover_crons");
      if (error) throw new Error(error.message);
      return json({ success: true, mode, result: data || null });
    }

    return json({ success: false, error: "Invalid mode" }, 400);
  } catch (error) {
    return json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});
