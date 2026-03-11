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

function asNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(mustEnv("SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    if (shouldProxyToData(req)) {
      const proxied = await invokeDataFunction({
        req,
        functionName: "discover-dppi-panel",
        body,
        timeoutMs: getEnvNumber("LOOKUP_DATA_TIMEOUT_MS", 6000),
      });
      if (proxied.ok) return dataProxyResponse(proxied.data, proxied.status, corsHeaders);
      return dataBridgeUnavailableResponse(corsHeaders, proxied.error);
    }

    if (shouldBlockLocalExecution(req)) {
      return dataBridgeUnavailableResponse(corsHeaders, "strict proxy mode");
    }

    const region = String(body?.region || "NAE").trim().toUpperCase();
    const surfaceName = String(body?.surfaceName || "CreativeDiscoverySurface_Frontend").trim();
    const panelName = String(body?.panelName || "").trim();
    const limit = Math.max(1, Math.min(50, Number(body?.limit ?? 20)));
    const windowDays = Math.max(1, Math.min(60, Number(body?.windowDays ?? 14)));

    if (!panelName) return json({ success: false, error: "Missing panelName" }, 400);

    const { data: targetRows, error: targetErr } = await supabase
      .from("discovery_exposure_targets")
      .select("id,last_ok_tick_at")
      .eq("region", region)
      .eq("surface_name", surfaceName)
      .order("last_ok_tick_at", { ascending: false, nullsFirst: false })
      .limit(1);
    if (targetErr) throw new Error(targetErr.message);
    if (!targetRows || targetRows.length === 0) {
      return json({ success: false, error: "target not found" }, 404);
    }

    const targetId = String((targetRows[0] as any).id || "");
    const { data: opportunities, error: oppErr } = await supabase
      .from("dppi_opportunities")
      .select("generated_at,as_of_bucket,island_code,enter_score_2h,enter_score_5h,enter_score_12h,opening_signal,pressure_forecast,confidence_bucket,opportunity_rank,model_name,model_version,evidence_json")
      .eq("target_id", targetId)
      .eq("panel_name", panelName)
      .order("opportunity_rank", { ascending: true })
      .limit(limit);
    if (oppErr) throw new Error(oppErr.message);

    const { data: benchmark, error: benchErr } = await supabase.rpc("dppi_get_panel_benchmark", {
      p_target_id: targetId,
      p_panel_name: panelName,
      p_window_days: windowDays,
    });
    if (benchErr) throw new Error(benchErr.message);

    const rowSet = (opportunities || []) as any[];
    const openingAvg = rowSet.length
      ? rowSet.reduce((sum, r) => sum + asNum(r.opening_signal), 0) / rowSet.length
      : 0;
    const pressureCounts = rowSet.reduce(
      (acc, row) => {
        const key = String(row.pressure_forecast || "medium").toLowerCase();
        if (key === "low" || key === "medium" || key === "high") acc[key] += 1;
        return acc;
      },
      { low: 0, medium: 0, high: 0 },
    );

    const production = await supabase
      .from("dppi_release_channels")
      .select("model_name,model_version,updated_at")
      .eq("channel_name", "production")
      .maybeSingle();

    return json({
      success: true,
      region,
      surfaceName,
      panelName,
      targetId,
      model_version_used: rowSet[0]?.model_version || production.data?.model_version || null,
      model_name_used: rowSet[0]?.model_name || production.data?.model_name || null,
      prediction_generated_at: rowSet[0]?.generated_at || null,
      panel_benchmark: benchmark || null,
      dppi_panel_opening_signal: {
        score_avg: Number(openingAvg.toFixed(4)),
        slots_likely_opening: rowSet.filter((r) => asNum(r.opening_signal) >= 0.6).length,
        pressure_distribution: pressureCounts,
      },
      dppi_panel_pressure_forecast:
        pressureCounts.high >= pressureCounts.medium && pressureCounts.high > pressureCounts.low
          ? "high"
          : pressureCounts.low > pressureCounts.medium
            ? "low"
            : "medium",
      dppi_panel_opportunities: rowSet.map((r) => ({
        island_code: String(r.island_code || ""),
        score: {
          h2: asNum(r.enter_score_2h),
          h5: asNum(r.enter_score_5h),
          h12: asNum(r.enter_score_12h),
        },
        opening_signal: asNum(r.opening_signal),
        confidence_bucket: String(r.confidence_bucket || "low"),
        pressure_forecast: String(r.pressure_forecast || "medium"),
        rank: asNum(r.opportunity_rank),
        model_name: r.model_name || null,
        model_version: r.model_version || null,
        evidence: r.evidence_json || {},
      })),
    });
  } catch (e) {
    return json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
