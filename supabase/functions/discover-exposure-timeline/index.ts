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

async function requireAdminOrEditor(req: Request, supabase: any) {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  if (!token) throw new Error("forbidden");

  const { data: u, error: uErr } = await supabase.auth.getUser(token);
  if (uErr || !u?.user?.id) throw new Error("forbidden");
  const userId = u.user.id;

  const { data: roles, error: rErr } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .in("role", ["admin", "editor"])
    .limit(1);
  if (rErr || !roles || roles.length === 0) throw new Error("forbidden");
}

function toUtcStart(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00.000Z`).toISOString();
}

function toUtcEndExclusive(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00.000Z`).toISOString();
}

function durationMinutes(startIso: string, endIso: string): number {
  const a = new Date(startIso).getTime();
  const b = new Date(endIso).getTime();
  return Math.max(0, Math.round((b - a) / 60000));
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
        functionName: "discover-exposure-timeline",
        body,
        timeoutMs: getEnvNumber("LOOKUP_DATA_TIMEOUT_MS", 9000),
      });
      if (proxied.ok) return dataProxyResponse(proxied.data, proxied.status, corsHeaders);
      return dataBridgeUnavailableResponse(corsHeaders, proxied.error);
    }

    if (shouldBlockLocalExecution(req)) {
      return dataBridgeUnavailableResponse(corsHeaders, "strict proxy mode");
    }

    const weeklyReportId = String(body.weeklyReportId || "");
    const targetId = String(body.targetId || "");
    const panelName = String(body.panelName || "");
    const rankMin = Math.max(1, Number(body.rankMin ?? 1));
    const rankMaxReq = body.rankMax != null ? Number(body.rankMax) : 50;
    const rankMax = isFinite(rankMaxReq) ? Math.max(rankMin, Math.min(500, rankMaxReq)) : 50;
    const offset = Math.max(0, Number(body.offset ?? 0));
    const limitReq = body.limit != null ? Number(body.limit) : 20000;
    const limit = Math.max(1, Math.min(20000, isFinite(limitReq) ? limitReq : 20000));

    if (!weeklyReportId || !targetId || !panelName) {
      return json({ success: false, error: "Missing weeklyReportId/targetId/panelName" }, 400);
    }

    const { data: wr, error: wrErr } = await supabase
      .from("weekly_reports")
      .select("id,status,date_from,date_to")
      .eq("id", weeklyReportId)
      .single();
    if (wrErr || !wr) return json({ success: false, error: "weekly report not found" }, 404);

    if (String(wr.status) !== "published") {
      await requireAdminOrEditor(req, supabase);
    }

    const rangeStart = toUtcStart(String(wr.date_from));
    const rangeEnd = toUtcEndExclusive(String(wr.date_to));

    const q = supabase
      .from("discovery_exposure_rank_segments")
      .select("target_id,surface_name,panel_name,rank,link_code,link_code_type,start_ts,end_ts,last_seen_ts,ccu_max,ccu_start,ccu_end")
      .eq("target_id", targetId)
      .eq("panel_name", panelName)
      .gte("rank", rankMin)
      .lte("rank", rankMax)
      .lt("start_ts", rangeEnd)
      .or(`end_ts.is.null,end_ts.gt.${rangeStart}`)
      .order("rank", { ascending: true })
      .order("start_ts", { ascending: true })
      .range(offset, offset + limit - 1);

    const { data: segs, error: sErr } = await q;
    if (sErr) throw new Error(sErr.message);

    const rows = (segs || []) as any[];

    const codes = Array.from(new Set(rows.map((r) => String(r.link_code))));
    const metaMap = new Map<string, any>();
    for (let i = 0; i < codes.length; i += 1000) {
      const chunk = codes.slice(i, i + 1000);
      const { data, error } = await supabase
        .from("discover_link_metadata")
        .select("link_code,title,support_code,image_url")
        .in("link_code", chunk);
      if (error) throw new Error(error.message);
      for (const r of data || []) metaMap.set(String(r.link_code), r);
    }

    const out = rows.map((s: any) => {
      const start = String(s.start_ts);
      const end = s.end_ts ? String(s.end_ts) : String(s.last_seen_ts || s.start_ts);
      const clampedStart = start < rangeStart ? rangeStart : start;
      const clampedEnd = end > rangeEnd ? rangeEnd : end;
      const code = String(s.link_code);
      const meta = metaMap.get(code) || null;
      return {
        targetId: s.target_id,
        surfaceName: s.surface_name,
        panelName: s.panel_name,
        rank: Number(s.rank),
        start: clampedStart,
        end: clampedEnd,
        durationMinutes: durationMinutes(clampedStart, clampedEnd),
        linkCode: code,
        linkCodeType: s.link_code_type,
        ccuMax: s.ccu_max != null ? Number(s.ccu_max) : null,
        title: meta?.title ?? null,
        creatorCode: meta?.support_code ?? null,
        imageUrl: meta?.image_url ?? null,
      };
    });

    return json({
      success: true,
      weeklyReportId,
      targetId,
      panelName,
      rankMin,
      rankMax,
      offset,
      limit,
      returned: out.length,
      nextOffset: out.length === limit ? offset + limit : null,
      segments: out,
    });
  } catch (e) {
    return json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

