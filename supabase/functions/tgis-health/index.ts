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

    const [gen24hRes, errors24hRes, genStatsRes, costTodayRes, clustersRes, activeModelsRes, latestRunsRes, latestTrainingRes, runningTrainingRes, queuedTrainingRes, configRes, heartbeatRes, taxonomyRulesRes] = await Promise.all([
      service.from("tgis_generation_log").select("id", { count: "planned", head: true }).gte("created_at", since24h),
      service.from("tgis_generation_log").select("id", { count: "planned", head: true }).gte("created_at", since24h).in("status", ["failed", "blocked", "quota_exceeded"]),
      service.from("tgis_generation_log").select("latency_ms,status,cost_usd,provider_model,context_boost").gte("created_at", since24h).order("created_at", { ascending: false }).limit(5000),
      service.from("tgis_cost_usage_daily").select("day,total_cost_usd").eq("day", new Date().toISOString().slice(0, 10)),
      service.from("tgis_cluster_registry").select("cluster_id,is_active,cluster_slug,cluster_family").order("cluster_id", { ascending: true }),
      service.from("tgis_model_versions").select("id", { count: "planned", head: true }).eq("status", "active"),
      service.from("tgis_dataset_runs").select("id,run_type,status,created_at,started_at,ended_at,summary_json,error_text").order("created_at", { ascending: false }).limit(6),
      service.from("tgis_training_runs").select("id,cluster_id,status,run_mode,target_version,training_provider,fal_request_id,provider_status,progress_pct,eta_seconds,elapsed_seconds,estimated_cost_usd,status_polled_at,created_at,started_at,ended_at,error_text").order("created_at", { ascending: false }).limit(10),
      service.from("tgis_training_runs").select("id,cluster_id,status,run_mode,target_version,training_provider,fal_request_id,provider_status,progress_pct,eta_seconds,elapsed_seconds,estimated_cost_usd,status_polled_at,created_at,started_at,error_text").eq("status", "running").order("created_at", { ascending: false }).limit(20),
      service.from("tgis_training_runs").select("id", { count: "planned", head: true }).eq("status", "queued"),
      service.from("tgis_runtime_config").select("*").eq("config_key", "default").limit(1).maybeSingle(),
      service.from("tgis_worker_heartbeat").select("worker_host,worker_source,ts,cpu_pct,mem_pct,disk_pct,queue_depth").order("ts", { ascending: false }).limit(1).maybeSingle(),
      service.from("tgis_cluster_taxonomy_rules").select("rule_id", { count: "planned", head: true }).eq("is_active", true),
    ]);

    const totalCostToday = (costTodayRes.data || []).reduce((sum: number, r: any) => sum + Number(r.total_cost_usd || 0), 0);
    const activeClusters = (clustersRes.data || []).filter((r: any) => !!r.is_active).length;
    const statRows = Array.isArray(genStatsRes.data) ? genStatsRes.data : [];
    const latencyValues = statRows
      .map((r: any) => Number(r?.latency_ms || 0))
      .filter((v: number) => Number.isFinite(v) && v > 0)
      .sort((a: number, b: number) => a - b);
    const avgLatency = latencyValues.length
      ? latencyValues.reduce((acc: number, v: number) => acc + v, 0) / latencyValues.length
      : 0;
    const p95Latency = latencyValues.length
      ? latencyValues[Math.min(latencyValues.length - 1, Math.max(0, Math.floor(latencyValues.length * 0.95) - 1))]
      : 0;
    const generations24h = Number(gen24hRes.count || 0);
    const errors24h = Number(errors24hRes.count || 0);
    const errorRate24h = generations24h > 0 ? errors24h / generations24h : 0;
    const contextBoostOn = statRows.filter((r: any) => Boolean(r?.context_boost)).length;
    const contextBoostOff = statRows.length - contextBoostOn;
    const providerDist: Record<string, number> = {};
    for (const r of statRows) {
      const m = String((r as any)?.provider_model || "unknown");
      providerDist[m] = (providerDist[m] || 0) + 1;
    }
    const familyDist: Record<string, number> = {};
    for (const r of (clustersRes.data || [])) {
      const fam = String(r?.cluster_family || "unknown");
      familyDist[fam] = (familyDist[fam] || 0) + 1;
    }

    return json({
      success: true,
      overview: {
        generations_24h: generations24h,
        errors_24h: errors24h,
        error_rate_24h: Number(errorRate24h.toFixed(4)),
        avg_latency_ms_24h: Math.round(avgLatency),
        p95_latency_ms_24h: Math.round(p95Latency),
        cost_today_usd: Number(totalCostToday.toFixed(6)),
        clusters_total: (clustersRes.data || []).length,
        clusters_active: activeClusters,
        active_models: activeModelsRes.count || 0,
        training_running: (runningTrainingRes.data || []).length,
        training_queued: queuedTrainingRes.count || 0,
        taxonomy_rules_active: taxonomyRulesRes.count || 0,
      },
      cluster_family_distribution: familyDist,
      provider_model_distribution_24h: providerDist,
      context_boost_24h: {
        on: contextBoostOn,
        off: contextBoostOff,
      },
      runtime_config: configRes.data || null,
      dataset_recent: latestRunsRes.data || [],
      training_recent: latestTrainingRes.data || [],
      training_running: runningTrainingRes.data || [],
      worker_latest: heartbeatRes.data || null,
      as_of: new Date().toISOString(),
    });
  } catch (e) {
    return json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
