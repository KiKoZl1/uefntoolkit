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

async function requireAdminOrEditor(req: Request, supabase: any): Promise<string> {
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
  return userId;
}

function isServiceRoleRequest(req: Request, serviceKey: string): boolean {
  const authHeader = (req.headers.get("Authorization") || "").trim();
  const apiKeyHeader = (req.headers.get("apikey") || "").trim();
  const authToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : authHeader;

  const isServiceRoleJwt = (token: string): boolean => {
    try {
      const parts = token.split(".");
      if (parts.length !== 3) return false;
      let b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const pad = b64.length % 4;
      if (pad) b64 += "=".repeat(4 - pad);
      const payload = JSON.parse(atob(b64));
      return payload?.role === "service_role";
    } catch {
      return false;
    }
  };

  if (serviceKey && (
    authHeader === `Bearer ${serviceKey}` ||
    authHeader === serviceKey ||
    apiKeyHeader === serviceKey
  )) return true;

  return isServiceRoleJwt(authToken) || isServiceRoleJwt(apiKeyHeader);
}

function toUtcStart(dateStr: string): string {
  // dateStr is YYYY-MM-DD
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

function envInt(name: string, fallback: number): number {
  const raw = Deno.env.get(name);
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

function titleizeWords(input: string): string {
  return input
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

async function fetchAll<T>(
  q: any,
  pageSize = 1000,
  maxRows = 100000,
): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const { data, error } = await q.range(offset, offset + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = (data || []) as T[];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Auth guard: allow service_role OR admin/editor user
    const sbUrl = mustEnv("SUPABASE_URL");
    const authHeader = req.headers.get("Authorization") || "";
    const serviceKey = mustEnv("SUPABASE_SERVICE_ROLE_KEY");
    const serviceRoleMode = isServiceRoleRequest(req, serviceKey);
    if (!serviceRoleMode) {
      try {
        const anonKey = mustEnv("SUPABASE_ANON_KEY");
        const userClient = createClient(sbUrl, anonKey, {
          global: { headers: { Authorization: authHeader } },
        });
        await requireAdminOrEditor(req, userClient);
      } catch {
        return json({ error: "Forbidden: admin/editor or service_role required" }, 403);
      }
    }

    const supabase = createClient(sbUrl, serviceKey);

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    if (shouldProxyToData(req)) {
      const proxied = await invokeDataFunction({
        req,
        functionName: "discover-exposure-report",
        body,
        timeoutMs: getEnvNumber("LOOKUP_DATA_TIMEOUT_MS", 9000),
      });
      if (proxied.ok) return dataProxyResponse(proxied.data, proxied.status, corsHeaders);
      return dataBridgeUnavailableResponse(corsHeaders, proxied.error);
    }

    if (shouldBlockLocalExecution(req)) {
      return dataBridgeUnavailableResponse(corsHeaders, "strict proxy mode");
    }

    const weeklyReportId = body.weeklyReportId as string | undefined;
    if (!weeklyReportId) return json({ success: false, error: "Missing weeklyReportId" }, 400);

    const { data: wr, error: wrErr } = await supabase
      .from("weekly_reports")
      .select("id,date_from,date_to,rankings_json")
      .eq("id", weeklyReportId)
      .single();
    if (wrErr || !wr) return json({ success: false, error: wrErr?.message || "weekly report not found" }, 404);

    const dateFrom = String(wr.date_from);
    const dateTo = String(wr.date_to);
    const rangeStart = toUtcStart(dateFrom);
    const rangeEnd = toUtcEndExclusive(dateTo);

    const includeBrowse = body.includeBrowse != null ? Boolean(body.includeBrowse) : false;
    const allowedSurfaces = includeBrowse
      ? ["CreativeDiscoverySurface_Frontend", "CreativeDiscoverySurface_Browse"]
      : ["CreativeDiscoverySurface_Frontend"];
    const allowedSurfaceSet = new Set(allowedSurfaces);

    const { data: targets, error: tErr } = await supabase
      .from("discovery_exposure_targets")
      .select("id,region,surface_name,platform,locale,interval_minutes,last_ok_tick_at")
      .in("surface_name", allowedSurfaces);
    if (tErr) throw new Error(tErr.message);

    // Default: include all active targets (so adding BR/ASIA automatically shows up in reports)
    // Caller can override by passing regions: ["NAE","EU",...].
    const reqRegions = Array.isArray(body.regions) ? body.regions.map((r: any) => String(r)) : null;
    const targetRows = (targets || [])
      .filter((t: any) => (reqRegions ? reqRegions.includes(String(t.region)) : true))
      .filter((t: any) => t.last_ok_tick_at != null) as any[];

    const targetIds = targetRows.map((t) => String(t.id));
    const targetIdSet = new Set(targetIds);
    const includeCollections = body.includeCollections != null ? Boolean(body.includeCollections) : true;
    const embedTimelineLimitRaw = body.embedTimelineLimit != null
      ? Number(body.embedTimelineLimit)
      : envInt("DISCOVERY_EXPOSURE_EMBED_TIMELINE_LIMIT", 600);
    const embedTimelineLimit = Number.isFinite(embedTimelineLimitRaw)
      ? Math.max(0, Math.floor(embedTimelineLimitRaw))
      : 600;
    const needsRankSegments = includeCollections || embedTimelineLimit > 0;

    // Preflight using DB-side aggregation.
    const { data: topByPanelData, error: topByPanelErr } = await supabase.rpc("discovery_exposure_top_by_panel", {
      p_date_from: dateFrom,
      p_date_to: dateTo,
      p_limit_per_panel: 3,
    });
    if (topByPanelErr) throw new Error(topByPanelErr.message);
    const topByPanelRows: any[] = (Array.isArray(topByPanelData) ? topByPanelData : [])
      .filter((r: any) => targetIdSet.has(String(r.target_id)))
      .filter((r: any) => allowedSurfaceSet.has(String(r.surface_name)));

    const { data: panelDailyData, error: panelDailyErr } = await supabase.rpc("discovery_exposure_panel_daily_summaries", {
      p_date_from: dateFrom,
      p_date_to: dateTo,
    });
    if (panelDailyErr) throw new Error(panelDailyErr.message);
    const panelDailyRows: any[] = (Array.isArray(panelDailyData) ? panelDailyData : [])
      .filter((r: any) => targetIdSet.has(String(r.target_id)))
      .filter((r: any) => allowedSurfaceSet.has(String(r.surface_name)));

    const panelNames = Array.from(new Set<string>([
      ...panelDailyRows.map((r: any) => String(r.panel_name)),
      ...topByPanelRows.map((r: any) => String(r.panel_name)),
    ]));

    const tierLabelByName = new Map<string, string>();
    if (panelNames.length > 0) {
      const { data: tierRows, error: tierErr } = await supabase
        .from("discovery_panel_tiers")
        .select("panel_name,label")
        .in("panel_name", panelNames);
      if (tierErr) throw new Error(tierErr.message);
      for (const row of tierRows || []) {
        const key = String((row as any).panel_name || "");
        const label = String((row as any).label || "").trim();
        if (key && label) tierLabelByName.set(key, label);
      }
    }

    const panelDisplay = (panelName: string, panelDisplayName?: string | null): string => {
      const byTier = tierLabelByName.get(panelName);
      if (byTier) return byTier;
      const fromData = String(panelDisplayName || "").trim();
      if (fromData) return fromData;
      return normalizePanelDisplayName(panelName);
    };

    const profiles = targetRows.map((t) => ({
      targetId: String(t.id),
      region: t.region,
      surfaceName: t.surface_name,
      platform: t.platform,
      locale: t.locale,
      intervalMinutes: t.interval_minutes,
    }));

    // Panels metadata (from daily rows first; enriched from rank segments when needed).
    const panelMetaByKey = new Map<string, any>();
    for (const r of panelDailyRows) {
      const key = `${r.target_id}|||${r.panel_name}`;
      if (!panelMetaByKey.has(key)) {
        panelMetaByKey.set(key, {
          target_id: r.target_id,
          surface_name: r.surface_name,
          panelName: r.panel_name,
          panelDisplayName: panelDisplay(String(r.panel_name)),
          panelType: null,
          featureTags: null,
        });
      }
    }
    for (const r of topByPanelRows) {
      const key = `${r.target_id}|||${r.panel_name}`;
      if (!panelMetaByKey.has(key)) {
        panelMetaByKey.set(key, {
          target_id: r.target_id,
          surface_name: r.surface_name,
          panelName: r.panel_name,
          panelDisplayName: panelDisplay(String(r.panel_name)),
          panelType: null,
          featureTags: null,
        });
      }
    }

    // Rank timeline segments (#1..#10) overlapping the report range.
    const rankSegs: any[] = [];
    if (needsRankSegments) {
      for (const tid of targetIds) {
        const q = supabase
          .from("discovery_exposure_rank_segments")
          .select("target_id,surface_name,panel_name,panel_display_name,panel_type,feature_tags,rank,link_code,link_code_type,start_ts,end_ts,last_seen_ts,ccu_max,ccu_start,ccu_end")
          .eq("target_id", tid)
          .lte("rank", 10)
          .lt("start_ts", rangeEnd)
          .or(`end_ts.is.null,end_ts.gt.${rangeStart}`);
        const rows = await fetchAll<any>(q, 1000, 100000);
        rankSegs.push(...rows);
        for (const r of rows) {
          const key = `${r.target_id}|||${r.panel_name}`;
          if (!panelMetaByKey.has(key)) {
            panelMetaByKey.set(key, {
              target_id: r.target_id,
              surface_name: r.surface_name,
              panelName: r.panel_name,
              panelDisplayName: panelDisplay(String(r.panel_name), r.panel_display_name),
              panelType: r.panel_type ?? null,
              featureTags: r.feature_tags ?? null,
            });
          }
        }
      }
    }

    // Panels can also exist only in rank segments; resolve missing tier labels after loading them.
    const allPanelNames = Array.from(new Set<string>([
      ...panelNames,
      ...rankSegs.map((r: any) => String(r.panel_name)),
    ]));
    const missingTierPanelNames = allPanelNames.filter((n) => n && !tierLabelByName.has(n));
    if (missingTierPanelNames.length > 0) {
      const { data: tierRows, error: tierErr } = await supabase
        .from("discovery_panel_tiers")
        .select("panel_name,label")
        .in("panel_name", missingTierPanelNames);
      if (tierErr) throw new Error(tierErr.message);
      for (const row of tierRows || []) {
        const key = String((row as any).panel_name || "");
        const label = String((row as any).label || "").trim();
        if (key && label) tierLabelByName.set(key, label);
      }
      for (const meta of panelMetaByKey.values()) {
        meta.panelDisplayName = panelDisplay(String(meta.panelName), String(meta.panelDisplayName || ""));
      }
    }

    const allCodes = Array.from(new Set([
      ...topByPanelRows.map((r: any) => String(r.link_code)),
      ...rankSegs.map((s) => String(s.link_code)),
    ]));
    const collectionCodes = includeCollections
      ? Array.from(new Set(rankSegs
          .filter((s) => String(s.link_code_type) === "collection")
          .map((s) => String(s.link_code))))
      : [];

    // Canonical card metadata (islands + collections)
    const linkMeta = new Map<string, { title: string | null; creator_code: string | null; image_url: string | null }>();
    for (let i = 0; i < allCodes.length; i += 1000) {
      const chunk = allCodes.slice(i, i + 1000);
      const { data, error } = await supabase
        .from("discover_link_metadata")
        .select("link_code,title,support_code,image_url")
        .in("link_code", chunk);
      if (error) throw new Error(error.message);
      for (const r of data || []) {
        linkMeta.set(String(r.link_code), {
          title: r.title ?? null,
          creator_code: (r as any).support_code ?? null,
          image_url: (r as any).image_url ?? null,
        });
      }
    }

    // Fallback for islands (legacy cache might still have creator_code/category)
    const islandCodes = Array.from(
      new Set([
        ...rankSegs.filter((s) => String(s.link_code_type) === "island").map((s) => String(s.link_code)),
        ...topByPanelRows.filter((r: any) => String(r.link_code_type) === "island").map((r: any) => String(r.link_code)),
      ]),
    );
    const islandFallback = new Map<string, { title: string | null; creator_code: string | null }>();
    for (let i = 0; i < islandCodes.length; i += 1000) {
      const chunk = islandCodes.slice(i, i + 1000);
      const { data, error } = await supabase
        .from("discover_islands_cache")
        .select("island_code,title,creator_code")
        .in("island_code", chunk);
      if (error) throw new Error(error.message);
      for (const r of data || []) {
        islandFallback.set(String(r.island_code), { title: r.title ?? null, creator_code: r.creator_code ?? null });
      }
    }

    // Build JSON payload

    const panels = Array.from(panelMetaByKey.values());

    const panelSummaries: any[] = (panelDailyRows || []).map((r: any) => ({
      date: r.date,
      targetId: r.target_id,
      surfaceName: r.surface_name,
      panelName: r.panel_name,
      panelDisplayName: panelDisplay(String(r.panel_name)),
      maps: Number(r.maps || 0),
      creators: Number(r.creators || 0),
      collections: Number(r.collections || 0),
    }));

    const topByPanel: any[] = (topByPanelRows || []).map((r: any) => {
      const code = String(r.link_code);
      const m = linkMeta.get(code);
      const fb = r.link_code_type === "island" ? islandFallback.get(code) : null;
      return {
        targetId: r.target_id,
        surfaceName: r.surface_name,
        panelName: r.panel_name,
        panelDisplayName: panelDisplay(String(r.panel_name)),
        linkCode: code,
        linkCodeType: r.link_code_type,
        minutesExposed: Number(r.minutes_exposed || 0),
        ccuMaxSeen: r.ccu_max_seen != null ? Number(r.ccu_max_seen) : null,
        bestRank: r.best_rank != null ? Number(r.best_rank) : null,
        avgRank: r.avg_rank != null ? Number(r.avg_rank) : null,
        title: m?.title ?? fb?.title ?? null,
        creatorCode: m?.creator_code ?? fb?.creator_code ?? null,
        imageUrl: m?.image_url ?? null,
      };
    });

    // Resolve collection containers (reference_*, ref_panel_*, set_*) to child links.
    const currentCcuMap = new Map<string, number | null>();
    for (const s of rankSegs) {
      const code = String(s.link_code);
      const ccu = s.ccu_end ?? s.ccu_max ?? null;
      const n = ccu != null ? Number(ccu) : null;
      if (!currentCcuMap.has(code)) currentCcuMap.set(code, n);
      else if (n != null && currentCcuMap.get(code) != null) currentCcuMap.set(code, Math.max(currentCcuMap.get(code)!, n));
      else if (n != null && currentCcuMap.get(code) == null) currentCcuMap.set(code, n);
    }

    const edgesByParent = new Map<string, any[]>();
    if (includeCollections && collectionCodes.length) {
      const { data: edges } = await supabase
        .from("discover_link_edges")
        .select("parent_link_code,child_link_code,edge_type,sort_order,last_seen_at")
        .in("parent_link_code", collectionCodes);
      for (const e of edges || []) {
        const p = String((e as any).parent_link_code);
        const arr = edgesByParent.get(p) || [];
        arr.push(e);
        edgesByParent.set(p, arr);
      }
    }

    const childCodes = Array.from(
      new Set(Array.from(edgesByParent.values()).flat().map((e: any) => String(e.child_link_code))),
    );
    if (includeCollections && childCodes.length) {
      for (let i = 0; i < childCodes.length; i += 1000) {
        const chunk = childCodes.slice(i, i + 1000);
        const { data, error } = await supabase
          .from("discover_link_metadata")
          .select("link_code,title,support_code,image_url")
          .in("link_code", chunk);
        if (error) throw new Error(error.message);
        for (const r of data || []) {
          if (!linkMeta.has(String(r.link_code))) {
            linkMeta.set(String(r.link_code), {
              title: r.title ?? null,
              creator_code: (r as any).support_code ?? null,
              image_url: (r as any).image_url ?? null,
            });
          }
        }
      }
    }

    const resolvedCollections: any[] = [];
    const segByCode = new Map<string, any[]>();
    for (const s of rankSegs) {
      const code = String(s.link_code);
      const arr = segByCode.get(code) || [];
      arr.push(s);
      segByCode.set(code, arr);
    }

    for (const parentCode of collectionCodes) {
      const edges = (edgesByParent.get(parentCode) || []).slice().sort((a: any, b: any) => {
        const ea = String(a.edge_type || "");
        const eb = String(b.edge_type || "");
        const pa = ea === "default_sub_link_code" ? 0 : ea === "sub_link_code" ? 1 : ea === "related_link" ? 2 : 9;
        const pb = eb === "default_sub_link_code" ? 0 : eb === "sub_link_code" ? 1 : eb === "related_link" ? 2 : 9;
        if (pa !== pb) return pa - pb;
        const sa = a.sort_order == null ? 999999 : Number(a.sort_order);
        const sb = b.sort_order == null ? 999999 : Number(b.sort_order);
        if (sa !== sb) return sa - sb;
        return String(a.child_link_code).localeCompare(String(b.child_link_code));
      });

      const parentSeg = (segByCode.get(parentCode) || [])[0] || null;
      const parentMeta = linkMeta.get(parentCode);
      const seen = new Set<string>();
      const children = [];
      for (const e of edges) {
        const child = String((e as any).child_link_code);
        if (!child || seen.has(child)) continue;
        seen.add(child);
        const m = linkMeta.get(child);
        children.push({
          linkCode: child,
          title: m?.title ?? child,
          creatorCode: m?.creator_code ?? null,
          imageUrl: m?.image_url ?? null,
          ccu: currentCcuMap.get(child) ?? null,
          edgeType: (e as any).edge_type ?? null,
          sortOrder: (e as any).sort_order ?? null,
        });
        if (children.length >= 20) break;
      }

      resolvedCollections.push({
        linkCode: parentCode,
        title: parentMeta?.title ?? parentCode,
        creatorCode: parentMeta?.creator_code ?? null,
        imageUrl: parentMeta?.image_url ?? null,
        panelName: parentSeg?.panel_name ?? null,
        panelDisplayName: panelMetaByKey.get(`${parentSeg?.target_id}|||${parentSeg?.panel_name}`)?.panelDisplayName ?? null,
        targetId: parentSeg?.target_id ?? null,
        rank: parentSeg?.rank != null ? Number(parentSeg.rank) : null,
        children,
        childrenCount: children.length,
      });
    }

    const panelRankTimelineAll: any[] = embedTimelineLimit > 0 ? rankSegs.map((s: any) => {
      const start = String(s.start_ts);
      const end = s.end_ts ? String(s.end_ts) : String(s.last_seen_ts || s.start_ts);
      const clampedStart = start < rangeStart ? rangeStart : start;
      const clampedEnd = end > rangeEnd ? rangeEnd : end;
      const code = String(s.link_code);
      const m = linkMeta.get(code);
      const fb = String(s.link_code_type) === "island" ? islandFallback.get(code) : null;
      return {
        targetId: s.target_id,
        surfaceName: s.surface_name,
        panelName: s.panel_name,
        panelDisplayName: panelDisplay(String(s.panel_name), s.panel_display_name),
        rank: Number(s.rank),
        start: clampedStart,
        end: clampedEnd,
        durationMinutes: durationMinutes(clampedStart, clampedEnd),
        linkCode: code,
        linkCodeType: s.link_code_type,
        ccuMax: s.ccu_max != null ? Number(s.ccu_max) : null,
        title: m?.title ?? fb?.title ?? null,
        creatorCode: m?.creator_code ?? fb?.creator_code ?? null,
        imageUrl: m?.image_url ?? null,
      };
    }) : [];

    // Keep embedded timeline compact for report payload size/perf.
    const panelRankTimeline = panelRankTimelineAll
      .slice()
      .sort((a: any, b: any) => Number(b.durationMinutes || 0) - Number(a.durationMinutes || 0))
      .slice(0, embedTimelineLimit);

    const discoveryExposure = {
      meta: {
        dateFrom,
        dateTo,
        rangeStart,
        rangeEnd,
        includeCollections,
        includeBrowse,
        surfaces: allowedSurfaces,
        embedTimelineLimit,
        embeddedTimelineTotal: panelRankTimelineAll.length,
        embeddedTimelineReturned: panelRankTimeline.length,
        embeddedTimelineTruncated: panelRankTimeline.length < panelRankTimelineAll.length,
      },
      profiles,
      panels,
      panelSummaries,
      topByPanel,
      panelRankTimeline,
      resolvedCollections,
    };

    // Re-read rankings_json to get the latest version (rebuild may have updated it after our initial read)
    const { data: wrFresh } = await supabase
      .from("weekly_reports")
      .select("rankings_json")
      .eq("id", weeklyReportId)
      .single();
    const existing = ((wrFresh?.rankings_json || wr.rankings_json) || {}) as any;
    const mergedRankings = { ...existing, discoveryExposure };

    const { error: updErr } = await supabase
      .from("weekly_reports")
      .update({ rankings_json: mergedRankings })
      .eq("id", weeklyReportId);
    if (updErr) throw new Error(updErr.message);

    return json({ success: true, weeklyReportId, injected: true });
  } catch (e) {
    return json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
