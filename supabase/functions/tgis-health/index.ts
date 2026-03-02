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
    return payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function isAdminOrService(req: Request, serviceClient: ReturnType<typeof createClient>) {
  const serviceKey = mustEnv("SUPABASE_SERVICE_ROLE_KEY");
  const bearer = extractBearer(req);
  const apiKey = (req.headers.get("apikey") || "").trim();
  if ((bearer && bearer === serviceKey) || (apiKey && apiKey === serviceKey)) return true;
  const bearerPayload = bearer ? decodeJwtPayload(bearer) : null;
  const apiPayload = apiKey ? decodeJwtPayload(apiKey) : null;
  if (String(bearerPayload?.role || "") === "service_role") return true;
  if (String(apiPayload?.role || "") === "service_role") return true;
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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const service = createClient(mustEnv("SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
    if (!(await isAdminOrService(req, service))) {
      return json({ success: false, error: "forbidden" }, 403);
    }

    const since24h = new Date(Date.now() - 24 * 3600_000).toISOString();

    const [gen24hRes, errors24hRes, costTodayRes, clustersRes, activeModelsRes, latestRunsRes, latestTrainingRes, configRes, heartbeatRes] = await Promise.all([
      service.from("tgis_generation_log").select("id", { count: "exact", head: true }).gte("created_at", since24h),
      service.from("tgis_generation_log").select("id", { count: "exact", head: true }).gte("created_at", since24h).in("status", ["failed", "blocked", "quota_exceeded"]),
      service.from("tgis_cost_usage_daily").select("day,total_cost_usd").eq("day", new Date().toISOString().slice(0, 10)),
      service.from("tgis_cluster_registry").select("cluster_id,is_active").order("cluster_id", { ascending: true }),
      service.from("tgis_model_versions").select("id", { count: "exact", head: true }).eq("status", "active"),
      service.from("tgis_dataset_runs").select("id,run_type,status,created_at,started_at,ended_at,summary_json,error_text").order("created_at", { ascending: false }).limit(10),
      service.from("tgis_training_runs").select("id,cluster_id,status,run_mode,target_version,created_at,started_at,ended_at,error_text").order("created_at", { ascending: false }).limit(10),
      service.from("tgis_runtime_config").select("*").eq("config_key", "default").limit(1).maybeSingle(),
      service.from("tgis_worker_heartbeat").select("worker_host,worker_source,ts,cpu_pct,mem_pct,disk_pct,queue_depth").order("ts", { ascending: false }).limit(1).maybeSingle(),
    ]);

    const totalCostToday = (costTodayRes.data || []).reduce((sum: number, r: any) => sum + Number(r.total_cost_usd || 0), 0);
    const activeClusters = (clustersRes.data || []).filter((r: any) => !!r.is_active).length;

    return json({
      success: true,
      overview: {
        generations_24h: gen24hRes.count || 0,
        errors_24h: errors24hRes.count || 0,
        cost_today_usd: Number(totalCostToday.toFixed(6)),
        clusters_total: (clustersRes.data || []).length,
        clusters_active: activeClusters,
        active_models: activeModelsRes.count || 0,
      },
      runtime_config: configRes.data || null,
      dataset_recent: latestRunsRes.data || [],
      training_recent: latestTrainingRes.data || [],
      worker_latest: heartbeatRes.data || null,
      as_of: new Date().toISOString(),
    });
  } catch (e) {
    return json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
