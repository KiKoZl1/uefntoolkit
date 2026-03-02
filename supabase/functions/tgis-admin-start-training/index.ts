import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
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

async function resolveAuth(req: Request, serviceClient: ReturnType<typeof createClient>) {
  const serviceKey = mustEnv("SUPABASE_SERVICE_ROLE_KEY");
  const bearer = extractBearer(req);
  const apiKey = (req.headers.get("apikey") || "").trim();
  if ((bearer && bearer === serviceKey) || (apiKey && apiKey === serviceKey)) {
    return { allowed: true, userId: null as string | null, isService: true };
  }
  const bearerPayload = bearer ? decodeJwtPayload(bearer) : null;
  const apiPayload = apiKey ? decodeJwtPayload(apiKey) : null;
  if (String(bearerPayload?.role || "") === "service_role") {
    return { allowed: true, userId: null as string | null, isService: true };
  }
  if (String(apiPayload?.role || "") === "service_role") {
    return { allowed: true, userId: null as string | null, isService: true };
  }
  if (!bearer) return { allowed: false, userId: null as string | null, isService: false };

  const authClient = createClient(mustEnv("SUPABASE_URL"), mustEnv("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: `Bearer ${bearer}` } },
  });
  const { data: userRes, error: userErr } = await authClient.auth.getUser();
  if (userErr || !userRes.user?.id) return { allowed: false, userId: null as string | null, isService: false };

  const { data: roleRows, error: roleErr } = await serviceClient
    .from("user_roles")
    .select("role")
    .eq("user_id", userRes.user.id)
    .limit(1);
  if (roleErr || !Array.isArray(roleRows) || roleRows.length === 0) return { allowed: false, userId: userRes.user.id, isService: false };

  const role = String(roleRows[0]?.role || "");
  return { allowed: role === "admin" || role === "editor", userId: userRes.user.id, isService: false };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const service = createClient(mustEnv("SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const auth = await resolveAuth(req, service);
    if (!auth.allowed) return json({ success: false, error: "forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    const clusterId = body?.clusterId == null ? null : Number(body.clusterId);
    const runMode = String(body?.runMode || "manual").trim().toLowerCase();
    const dryRun = Boolean(body?.dryRun === true);

    if (!["manual", "scheduled", "dry_run"].includes(runMode)) {
      return json({ success: false, error: "invalid_runMode" }, 400);
    }
    if (clusterId != null && !Number.isFinite(clusterId)) {
      return json({ success: false, error: "invalid_clusterId" }, 400);
    }

    const { data: cfgRows, error: cfgErr } = await service
      .from("tgis_runtime_config")
      .select("training_enabled")
      .eq("config_key", "default")
      .limit(1);
    if (cfgErr) throw new Error(cfgErr.message);
    const trainingEnabled = Boolean(cfgRows?.[0]?.training_enabled);
    if (!trainingEnabled && !dryRun && !auth.isService) {
      return json({ success: false, error: "training_disabled_in_runtime_config" }, 409);
    }

    const targetVersion = String(
      body?.targetVersion || `v${new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 12)}`,
    );

    let payloadRows: Array<Record<string, unknown>> = [];
    if (clusterId == null) {
      const { data: clusterRows, error: clusterErr } = await service
        .from("tgis_cluster_registry")
        .select("cluster_id")
        .eq("is_active", true)
        .order("cluster_id", { ascending: true });
      if (clusterErr) throw new Error(clusterErr.message);
      const clusterIds = (clusterRows || []).map((r: any) => Number(r.cluster_id)).filter((n: number) => Number.isFinite(n));
      if (!clusterIds.length) return json({ success: false, error: "no_active_clusters" }, 409);
      payloadRows = clusterIds.map((cid) => ({
        cluster_id: cid,
        requested_by: auth.userId,
        status: "queued",
        run_mode: dryRun ? "dry_run" : runMode,
        model_base: "Tongyi-MAI/Z-Image-Turbo",
        target_version: targetVersion,
        quality_gate_json: {},
        result_json: { source: "tgis-admin-start-training", dryRun },
      }));
    } else {
      payloadRows = [{
        cluster_id: clusterId,
        requested_by: auth.userId,
        status: "queued",
        run_mode: dryRun ? "dry_run" : runMode,
        model_base: "Tongyi-MAI/Z-Image-Turbo",
        target_version: targetVersion,
        quality_gate_json: {},
        result_json: { source: "tgis-admin-start-training", dryRun },
      }];
    }

    const { data, error } = await service
      .from("tgis_training_runs")
      .insert(payloadRows)
      .select("id,cluster_id,status,run_mode,target_version,created_at");
    if (error) throw new Error(error.message);

    return json({
      success: true,
      queued: true,
      runs: data || [],
      note: "run(s) queued; worker tick processes queue",
    });
  } catch (e) {
    return json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
