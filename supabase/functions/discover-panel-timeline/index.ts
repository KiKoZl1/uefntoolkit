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

const PANEL_INTEL_STALE_MINUTES = 20;

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

function floorToHour(date: Date): Date {
  const d = new Date(date);
  d.setUTCMinutes(0, 0, 0);
  return d;
}

function addHours(date: Date, h: number): Date {
  return new Date(date.getTime() + h * 3600_000);
}

function isTechnicalToken(code: string): boolean {
  const c = String(code || "").toLowerCase();
  return c.startsWith("reference_") || c.startsWith("ref_panel_");
}

function overlapMinutes(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): number {
  const start = Math.max(aStart.getTime(), bStart.getTime());
  const end = Math.min(aEnd.getTime(), bEnd.getTime());
  if (end <= start) return 0;
  return (end - start) / 60000;
}

function clampWindowDays(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 14;
  return Math.min(60, Math.max(1, Math.floor(n)));
}

function maybeNum(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function titleizeWords(input: string): string {
  return String(input || "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function normalizePanelDisplayName(panelName: string): string {
  const raw = String(panelName || "").trim();
  if (!raw) return raw;

  if (/^ForYou[_A-Z]/.test(raw)) return "For You";

  if (/^Experiences[_A-Z]/.test(raw)) {
    const rest = raw
      .replace(/^Experiences_?/, "")
      .replace(/_Flat$/i, "")
      .replace(/_Rows?$/i, "");
    return titleizeWords(rest.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2"));
  }

  if (/^Nested[_A-Z]/.test(raw)) {
    const rest = raw.replace(/^Nested_?/, "");
    return titleizeWords(rest.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2"));
  }

  if (/^Browse[_A-Z]/.test(raw)) {
    const rest = raw.replace(/^Browse_?/, "");
    return titleizeWords(rest.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2"));
  }

  if (/^GameCollections[_A-Z]/.test(raw)) {
    const rest = raw.replace(/^GameCollections_?/, "");
    const label = titleizeWords(
      rest
        .replace(/_Group\d+$/i, "")
        .replace(/^Split_?/i, "")
        .replace(/_/g, " ")
        .replace(/([a-z])([A-Z])/g, "$1 $2"),
    );
    return `Game Collections ${label}`.trim();
  }

  return titleizeWords(raw.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\bDefault\b/gi, "").trim());
}

function cleanPanelLabel(labelValue: string, panelName: string): string {
  const rawLabel = String(labelValue || "").trim();
  if (!rawLabel) return normalizePanelDisplayName(panelName);

  const looksTechnical =
    /^Nested[_A-Z]/.test(rawLabel) ||
    /^Browse[_A-Z]/.test(rawLabel) ||
    /^Experiences[_A-Z]/.test(rawLabel) ||
    /^ForYou[_A-Z]/.test(rawLabel) ||
    /^GameCollections[_A-Z]/.test(rawLabel);

  if (looksTechnical) {
    return normalizePanelDisplayName(rawLabel);
  }

  const spaced = rawLabel
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();

  return spaced || normalizePanelDisplayName(panelName);
}

function parsePanelRows(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const r = row as Record<string, unknown>;
      const panelName = String(r.panel_name || "").trim();
      if (!panelName) return null;
      return {
        panel_name: panelName,
        panel_display_name: String(r.panel_display_name || "").trim() || null,
        count: asNum(r.count),
        share_pct: maybeNum(r.share_pct),
        median_gap_minutes: maybeNum(r.median_gap_minutes),
      };
    })
    .filter(Boolean)
    .slice(0, 5);
}

function parseNeighborFlowRows(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const r = row as Record<string, unknown>;
      const panelName = String(r.panel_name || "").trim();
      if (!panelName) return null;
      return {
        panel_name: panelName,
        panel_display_name: String(r.panel_display_name || "").trim() || null,
        count_out: asNum(r.count_out),
        count_in: asNum(r.count_in),
        net_flow: asNum(r.net_flow),
        out_share_pct: maybeNum(r.out_share_pct),
        in_share_pct: maybeNum(r.in_share_pct),
        median_gap_minutes_out: maybeNum(r.median_gap_minutes_out),
        median_gap_minutes_in: maybeNum(r.median_gap_minutes_in),
      };
    })
    .filter(Boolean)
    .slice(0, 8);
}

function isSnapshotStale(updatedAt: string | null | undefined): boolean {
  const ts = updatedAt ? Date.parse(updatedAt) : NaN;
  if (!Number.isFinite(ts)) return true;
  return Date.now() - ts > PANEL_INTEL_STALE_MINUTES * 60_000;
}

function snapshotNeedsUpgrade(snapshot: any): boolean {
  if (!snapshot || typeof snapshot !== "object") return true;
  const payload = snapshot.payload_json;
  if (!payload || typeof payload !== "object") return true;
  const p = payload as Record<string, unknown>;
  return (
    p.transitions_out_total === undefined ||
    p.transitions_in_total === undefined ||
    p.transitions_out_total_24h === undefined ||
    p.transitions_in_total_24h === undefined ||
    p.neighbor_net_flow_top === undefined ||
    p.directionality_totals === undefined ||
    p.attempts_avg_per_island === undefined ||
    p.reentry_48h_pct === undefined
  );
}

function buildPanelIntel(snapshot: any, fallbackWindowDays: number) {
  if (!snapshot) return null;

  const payload = (snapshot.payload_json && typeof snapshot.payload_json === "object")
    ? snapshot.payload_json
    : {};

  return {
    as_of: String(snapshot.as_of || ""),
    window_days: Number(snapshot.window_days || fallbackWindowDays),
    sample_stints: asNum(snapshot.sample_stints),
    sample_closed_stints: asNum(snapshot.sample_closed_stints),
    active_maps_now: asNum(snapshot.active_maps_now),
    panel_avg_ccu: maybeNum(payload.panel_avg_ccu),
    avg_exposure_minutes_per_stint: maybeNum(payload.avg_exposure_minutes_per_stint),
    avg_exposure_minutes_per_map: maybeNum(payload.avg_exposure_minutes_per_map),
    entries_24h: asNum(payload.entries_24h),
    exits_24h: asNum(payload.exits_24h),
    replacements_24h: asNum(payload.replacements_24h),
    ccu_bands: {
      ruim_lt: maybeNum(payload?.ccu_bands?.ruim_lt),
      bom_gte: maybeNum(payload?.ccu_bands?.bom_gte),
      excelente_gte: maybeNum(payload?.ccu_bands?.excelente_gte),
    },
    exposure_bands_minutes: {
      ruim_lt: maybeNum(payload?.exposure_bands_minutes?.ruim_lt),
      bom_gte: maybeNum(payload?.exposure_bands_minutes?.bom_gte),
      excelente_gte: maybeNum(payload?.exposure_bands_minutes?.excelente_gte),
    },
    removal_risk_ccu_floor: maybeNum(payload.removal_risk_ccu_floor),
    typical_exit_minutes: maybeNum(payload.typical_exit_minutes),
    keep_alive_targets: {
      ccu_min: maybeNum(payload?.keep_alive_targets?.ccu_min),
      minutes_min: maybeNum(payload?.keep_alive_targets?.minutes_min),
    },
    transitions_out_total: asNum(payload.transitions_out_total),
    transitions_out_total_6h: asNum(payload.transitions_out_total_6h),
    transitions_out_total_24h: asNum(payload.transitions_out_total_24h),
    top_next_panels: parsePanelRows(payload.top_next_panels),
    transitions_in_total: asNum(payload.transitions_in_total),
    transitions_in_total_6h: asNum(payload.transitions_in_total_6h),
    transitions_in_total_24h: asNum(payload.transitions_in_total_24h),
    top_prev_panels: parsePanelRows(payload.top_prev_panels),
    neighbor_net_flow_top: parseNeighborFlowRows(payload.neighbor_net_flow_top),
    directionality_totals: {
      out_24h: asNum(payload?.directionality_totals?.out_24h),
      in_24h: asNum(payload?.directionality_totals?.in_24h),
      net_24h: asNum(payload?.directionality_totals?.net_24h),
    },
    entry_prev_ccu_p50: maybeNum(payload.entry_prev_ccu_p50),
    entry_prev_ccu_p80: maybeNum(payload.entry_prev_ccu_p80),
    entry_prev_gap_minutes_p50: maybeNum(payload.entry_prev_gap_minutes_p50),
    attempts_avg_per_island: maybeNum(payload.attempts_avg_per_island),
    attempts_p50_per_island: maybeNum(payload.attempts_p50_per_island),
    islands_single_attempt_pct: maybeNum(payload.islands_single_attempt_pct),
    islands_multi_attempt_pct: maybeNum(payload.islands_multi_attempt_pct),
    reentry_48h_pct: maybeNum(payload.reentry_48h_pct),
    abandon_48h_pct: maybeNum(payload.abandon_48h_pct),
    attempts_before_abandon_avg: maybeNum(payload.attempts_before_abandon_avg),
    attempts_before_abandon_p50: maybeNum(payload.attempts_before_abandon_p50),
  };
}

async function resolvePanelDisplayNames(
  supabase: ReturnType<typeof createClient>,
  panelNames: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = Array.from(new Set(panelNames.map((n) => String(n || "").trim()).filter(Boolean)));
  if (!unique.length) return map;

  const { data: tierRows, error: tierErr } = await supabase
    .from("discovery_panel_tiers")
    .select("panel_name,label")
    .in("panel_name", unique);

  if (!tierErr) {
    for (const row of tierRows || []) {
      const key = String((row as any).panel_name || "").trim();
      const label = String((row as any).label || "").trim();
      if (key && label) map.set(key, cleanPanelLabel(label, key));
    }
  }

  for (const panelName of unique) {
    if (map.has(panelName)) continue;
    const { data: rpcData, error: rpcErr } = await supabase.rpc("get_panel_display_name", {
      p_panel_name: panelName,
    });
    if (!rpcErr) {
      const label = String(rpcData || "").trim();
      if (label) {
        map.set(panelName, cleanPanelLabel(label, panelName));
        continue;
      }
    }
    map.set(panelName, cleanPanelLabel("", panelName));
  }

  return map;
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
        functionName: "discover-panel-timeline",
        body,
        timeoutMs: getEnvNumber("LOOKUP_DATA_TIMEOUT_MS", 4000),
      });
      if (proxied.ok) return dataProxyResponse(proxied.data, proxied.status, corsHeaders);
      return dataBridgeUnavailableResponse(corsHeaders, proxied.error);
    }

    if (shouldBlockLocalExecution(req)) {
      return dataBridgeUnavailableResponse(corsHeaders, "strict proxy mode");
    }

    const supabase = createClient(mustEnv("SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));

    const region = String(body.region || "NAE");
    const surfaceName = String(body.surfaceName || "CreativeDiscoverySurface_Frontend");
    const panelName = String(body.panelName || "").trim();
    const hours = Math.max(1, Math.min(168, Number(body.hours ?? 24)));
    const windowDays = clampWindowDays(body.windowDays);

    if (!panelName) return json({ success: false, error: "Missing panelName" }, 400);

    const { data: targetRows, error: tErr } = await supabase
      .from("discovery_exposure_targets")
      .select("id,region,surface_name,last_ok_tick_at")
      .eq("region", region)
      .eq("surface_name", surfaceName)
      .order("last_ok_tick_at", { ascending: false, nullsFirst: false })
      .limit(1);
    if (tErr) throw new Error(tErr.message);
    if (!targetRows || targetRows.length === 0) {
      return json({ success: false, error: "target not found" }, 404);
    }

    const target = targetRows[0] as any;
    const targetId = String(target.id);

    const to = new Date();
    const from = new Date(to.getTime() - hours * 3600_000);

    const { data: segs, error: sErr } = await supabase
      .from("discovery_exposure_rank_segments")
      .select("link_code,start_ts,end_ts,last_seen_ts,ccu_max,ccu_start,ccu_end")
      .eq("target_id", targetId)
      .eq("panel_name", panelName)
      .lt("start_ts", to.toISOString())
      .or(`end_ts.is.null,end_ts.gt.${from.toISOString()}`)
      .order("start_ts", { ascending: true })
      .limit(50000);
    if (sErr) throw new Error(sErr.message);

    const rows = (segs || []) as any[];

    const bucketStart = floorToHour(from);
    const bucketEndExclusive = addHours(floorToHour(to), 1);

    const buckets = new Map<string, {
      ts: string;
      ccuWeighted: number;
      minutes_exposed: number;
      activeSet: Set<string>;
      itemsMinutes: Map<string, number>;
    }>();

    for (let cursor = new Date(bucketStart); cursor < bucketEndExclusive; cursor = addHours(cursor, 1)) {
      buckets.set(cursor.toISOString(), {
        ts: cursor.toISOString(),
        ccuWeighted: 0,
        minutes_exposed: 0,
        activeSet: new Set<string>(),
        itemsMinutes: new Map<string, number>(),
      });
    }

    for (const seg of rows) {
      const segStart = new Date(String(seg.start_ts));
      const segEnd = new Date(String(seg.end_ts || seg.last_seen_ts || to.toISOString()));
      if (!(segStart < segEnd)) continue;

      for (let cursor = new Date(bucketStart); cursor < bucketEndExclusive; cursor = addHours(cursor, 1)) {
        const bStart = cursor;
        const bEnd = addHours(cursor, 1);
        const mins = overlapMinutes(segStart, segEnd, bStart, bEnd);
        if (mins <= 0) continue;

        const key = bStart.toISOString();
        const bucket = buckets.get(key);
        if (!bucket) continue;

        const linkCode = String(seg.link_code || "");
        const ccu = Number(seg.ccu_end ?? seg.ccu_max ?? seg.ccu_start ?? 0) || 0;

        bucket.minutes_exposed += mins;
        bucket.ccuWeighted += ccu * (mins / 60);
        if (linkCode) {
          bucket.activeSet.add(linkCode);
          bucket.itemsMinutes.set(linkCode, (bucket.itemsMinutes.get(linkCode) || 0) + mins);
        }
      }
    }

    const series = Array.from(buckets.values())
      .map((b) => {
        const activeItems = b.activeSet.size;
        return {
          ts: b.ts,
          ccu: Number(b.ccuWeighted.toFixed(2)),
          minutes_exposed: Number(b.minutes_exposed.toFixed(2)),
          active_items: activeItems,
        };
      })
      .filter((p) => p.ts >= from.toISOString() && p.ts <= to.toISOString())
      .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

    const totalByCode = new Map<string, number>();
    for (const b of buckets.values()) {
      for (const [code, mins] of b.itemsMinutes.entries()) {
        totalByCode.set(code, (totalByCode.get(code) || 0) + mins);
      }
    }

    const sampleCodes = Array.from(totalByCode.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([code]) => code);

    const metaMap = new Map<string, any>();
    if (sampleCodes.length) {
      const { data: metaRows, error: mErr } = await supabase
        .from("discover_link_metadata")
        .select("link_code,title,image_url,support_code")
        .in("link_code", sampleCodes);
      if (!mErr) {
        for (const row of metaRows || []) {
          metaMap.set(String((row as any).link_code), row as any);
        }
      }
    }

    const sampleTopItems = sampleCodes.map((code) => {
      const m = metaMap.get(code) || null;
      const fallbackTitle = isTechnicalToken(code) ? "Unknown item" : code;
      return {
        link_code: code,
        title: m?.title ?? fallbackTitle,
        image_url: m?.image_url ?? null,
        creator_code: m?.support_code ?? null,
        minutes_exposed: Number((totalByCode.get(code) || 0).toFixed(2)),
      };
    });

    const readSnapshot = async () => {
      const { data, error } = await supabase
        .from("discovery_panel_intel_snapshot")
        .select("as_of,window_days,payload_json,sample_stints,sample_closed_stints,active_maps_now,confidence,updated_at")
        .eq("target_id", targetId)
        .eq("panel_name", panelName)
        .eq("window_days", windowDays)
        .maybeSingle();

      if (error) throw new Error(error.message);
      return data as any;
    };

    let snapshot = await readSnapshot();

    if (!snapshot || isSnapshotStale(String(snapshot.updated_at || snapshot.as_of || "")) || snapshotNeedsUpgrade(snapshot)) {
      const { error: recalcErr } = await supabase.rpc("compute_discovery_panel_intel_snapshot", {
        p_target_id: targetId,
        p_window_days: windowDays,
        p_panel_name: panelName,
      });

      if (!recalcErr) {
        snapshot = await readSnapshot();
      }
    }

    const panelIntel = buildPanelIntel(snapshot, windowDays);
    const namesToResolve: string[] = [panelName];
    if (panelIntel) {
      namesToResolve.push(...(panelIntel.top_next_panels || []).map((r: any) => String(r.panel_name || "")));
      namesToResolve.push(...(panelIntel.top_prev_panels || []).map((r: any) => String(r.panel_name || "")));
      namesToResolve.push(...(panelIntel.neighbor_net_flow_top || []).map((r: any) => String(r.panel_name || "")));
    }
    const panelDisplayNames = await resolvePanelDisplayNames(supabase, namesToResolve);

    if (panelIntel) {
      panelIntel.top_next_panels = (panelIntel.top_next_panels || []).map((row: any) => ({
        ...row,
        panel_display_name: panelDisplayNames.get(String(row.panel_name || "")) || String(row.panel_name || ""),
      }));
      panelIntel.top_prev_panels = (panelIntel.top_prev_panels || []).map((row: any) => ({
        ...row,
        panel_display_name: panelDisplayNames.get(String(row.panel_name || "")) || String(row.panel_name || ""),
      }));
      panelIntel.neighbor_net_flow_top = (panelIntel.neighbor_net_flow_top || []).map((row: any) => ({
        ...row,
        panel_display_name: panelDisplayNames.get(String(row.panel_name || "")) || String(row.panel_name || ""),
      }));
    }

    const { data: dppiRows, error: dppiErr } = await supabase
      .from("dppi_opportunities")
      .select("generated_at,island_code,enter_score_2h,enter_score_5h,enter_score_12h,opening_signal,pressure_forecast,confidence_bucket,opportunity_rank,model_name,model_version,evidence_json")
      .eq("target_id", targetId)
      .eq("panel_name", panelName)
      .order("opportunity_rank", { ascending: true })
      .limit(10);

    let dppi: any = null;
    if (!dppiErr) {
      const rows = (dppiRows || []) as any[];
      const openingAvg = rows.length
        ? rows.reduce((sum, r) => sum + asNum(r.opening_signal), 0) / rows.length
        : 0;
      const pressureCounts = rows.reduce(
        (acc, r) => {
          const key = String(r.pressure_forecast || "medium").toLowerCase();
          if (key === "low" || key === "medium" || key === "high") acc[key] += 1;
          return acc;
        },
        { low: 0, medium: 0, high: 0 },
      );

      dppi = {
        model_version_used: rows[0]?.model_version || null,
        model_name_used: rows[0]?.model_name || null,
        prediction_generated_at: rows[0]?.generated_at || null,
        panel_opening_signal: {
          score_avg: Number(openingAvg.toFixed(4)),
          slots_likely_opening: rows.filter((r) => asNum(r.opening_signal) >= 0.6).length,
          pressure_distribution: pressureCounts,
        },
        panel_pressure_forecast: pressureCounts.high > pressureCounts.medium && pressureCounts.high > pressureCounts.low
          ? "high"
          : pressureCounts.low > pressureCounts.medium
            ? "low"
            : "medium",
        panel_opportunities: rows.map((r) => ({
          island_code: String(r.island_code || ""),
          rank: asNum(r.opportunity_rank),
          score: {
            h2: asNum(r.enter_score_2h),
            h5: asNum(r.enter_score_5h),
            h12: asNum(r.enter_score_12h),
          },
          opening_signal: asNum(r.opening_signal),
          pressure_forecast: String(r.pressure_forecast || "medium"),
          confidence_bucket: String(r.confidence_bucket || "low"),
          evidence: r.evidence_json || {},
        })),
      };
    }

    return json({
      success: true,
      region,
      surfaceName,
      panelName,
      panelDisplayName: panelDisplayNames.get(panelName) || panelName,
      targetId,
      from: from.toISOString(),
      to: to.toISOString(),
      hours,
      series,
      sample_top_items: sampleTopItems,
      panel_intel: panelIntel,
      dppi,
    });
  } catch (e) {
    return json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
