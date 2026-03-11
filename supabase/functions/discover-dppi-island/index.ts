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

const ISLAND_CODE_RE = /^\d{4}-\d{4}-\d{4}$/;

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
        functionName: "discover-dppi-island",
        body,
        timeoutMs: getEnvNumber("LOOKUP_DATA_TIMEOUT_MS", 6000),
      });
      if (proxied.ok) return dataProxyResponse(proxied.data, proxied.status, corsHeaders);
      return dataBridgeUnavailableResponse(corsHeaders, proxied.error);
    }

    if (shouldBlockLocalExecution(req)) {
      return dataBridgeUnavailableResponse(corsHeaders, "strict proxy mode");
    }

    const islandCode = String(body?.islandCode || "").trim();
    const region = String(body?.region || "NAE").trim().toUpperCase();
    const surfaceName = String(body?.surfaceName || "CreativeDiscoverySurface_Frontend").trim();
    const maxPanels = Math.max(1, Math.min(20, Number(body?.maxPanels ?? 8)));

    if (!ISLAND_CODE_RE.test(islandCode)) return json({ success: false, error: "Invalid island code" }, 400);

    const { data: targetRows, error: targetErr } = await supabase
      .from("discovery_exposure_targets")
      .select("id,last_ok_tick_at")
      .eq("region", region)
      .eq("surface_name", surfaceName)
      .order("last_ok_tick_at", { ascending: false, nullsFirst: false })
      .limit(1);
    if (targetErr) throw new Error(targetErr.message);
    if (!targetRows || targetRows.length === 0) return json({ success: false, error: "target not found" }, 404);
    const targetId = String((targetRows[0] as any).id || "");

    const { data: opportunities, error: oppErr } = await supabase
      .from("dppi_opportunities")
      .select("generated_at,panel_name,enter_score_2h,enter_score_5h,enter_score_12h,opening_signal,pressure_forecast,confidence_bucket,model_name,model_version,evidence_json")
      .eq("target_id", targetId)
      .eq("island_code", islandCode)
      .order("enter_score_2h", { ascending: false })
      .limit(maxPanels);
    if (oppErr) throw new Error(oppErr.message);

    const { data: survivalPredRows, error: survErr } = await supabase
      .from("dppi_survival_predictions")
      .select("generated_at,panel_name,prediction_horizon,score,confidence_bucket,model_name,model_version,evidence_json")
      .eq("target_id", targetId)
      .eq("island_code", islandCode)
      .order("generated_at", { ascending: false })
      .limit(60);
    if (survErr) throw new Error(survErr.message);

    const attemptsSince = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const reentrySince = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    const [attemptsRes, entries48Res] = await Promise.all([
      supabase
        .from("discovery_exposure_presence_segments")
        .select("panel_name,start_ts,end_ts,closed_reason")
        .eq("target_id", targetId)
        .eq("link_code", islandCode)
        .eq("link_code_type", "island")
        .gte("start_ts", attemptsSince)
        .order("start_ts", { ascending: false })
        .limit(250),
      supabase
        .from("discovery_exposure_presence_events")
        .select("panel_name,ts,event_type")
        .eq("target_id", targetId)
        .eq("link_code", islandCode)
        .eq("link_code_type", "island")
        .gte("ts", reentrySince)
        .order("ts", { ascending: false })
        .limit(250),
    ]);
    if (attemptsRes.error) throw new Error(attemptsRes.error.message);
    if (entries48Res.error) throw new Error(entries48Res.error.message);

    const attempts = (attemptsRes.data || []) as any[];
    const events48 = (entries48Res.data || []) as any[];

    const attemptsByPanel = new Map<string, number>();
    for (const attempt of attempts) {
      const panel = String(attempt.panel_name || "");
      if (!panel) continue;
      attemptsByPanel.set(panel, (attemptsByPanel.get(panel) || 0) + 1);
    }

    const topAttempts = Array.from(attemptsByPanel.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([panel_name, attempts_count]) => ({ panel_name, attempts_count }));

    const lastGeneratedAt = (opportunities || [])[0]?.generated_at || null;
    const modelVersionUsed = (opportunities || [])[0]?.model_version || (survivalPredRows || [])[0]?.model_version || null;

    const mostLikelyPanel = (opportunities || [])[0] as any;

    return json({
      success: true,
      region,
      surfaceName,
      islandCode,
      targetId,
      model_version_used: modelVersionUsed,
      prediction_generated_at: lastGeneratedAt,
      dppi_radar: {
        top_panel_opportunities: (opportunities || []).map((row: any) => ({
          panel_name: String(row.panel_name || ""),
          score: {
            h2: asNum(row.enter_score_2h),
            h5: asNum(row.enter_score_5h),
            h12: asNum(row.enter_score_12h),
          },
          opening_signal: asNum(row.opening_signal),
          pressure_forecast: String(row.pressure_forecast || "medium"),
          confidence_bucket: String(row.confidence_bucket || "low"),
          evidence: row.evidence_json || {},
        })),
        survival_signals: (survivalPredRows || []).map((row: any) => ({
          panel_name: String(row.panel_name || ""),
          horizon: String(row.prediction_horizon || ""),
          score: asNum(row.score),
          confidence_bucket: String(row.confidence_bucket || "low"),
          model_name: row.model_name || null,
          model_version: row.model_version || null,
          evidence: row.evidence_json || {},
          generated_at: row.generated_at || null,
        })),
        attempts: {
          total_14d: attempts.length,
          events_48h: events48.length,
          entries_48h: events48.filter((e: any) => e.event_type === "enter").length,
          exits_48h: events48.filter((e: any) => e.event_type === "exit").length,
          top_panels_14d: topAttempts,
        },
        headline: mostLikelyPanel
          ? {
              panel_name: String(mostLikelyPanel.panel_name || ""),
              score_h2: asNum(mostLikelyPanel.enter_score_2h),
              opening_signal: asNum(mostLikelyPanel.opening_signal),
              pressure_forecast: String(mostLikelyPanel.pressure_forecast || "medium"),
              confidence_bucket: String(mostLikelyPanel.confidence_bucket || "low"),
            }
          : null,
      },
    });
  } catch (e) {
    return json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
