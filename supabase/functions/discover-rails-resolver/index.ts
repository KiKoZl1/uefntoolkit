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

const DEFAULT_PANEL_DESCRIPTIONS: Record<string, string> = {
  homebar: "Top live maps in Discovery right now.",
  trending_variety: "Most played and fastest-rising maps in Variety.",
  epics_picks: "Curated maps hand-picked by Epic.",
  game_collections: "IP collections and branded experiences.",
  battle_royales_by_epic: "Official Battle Royale experiences by Epic.",
  sponsored: "Promoted placements paid by developers.",
  popular: "Currently popular maps with strong live player demand.",
  fan_favorites: "Highly replayed and community-favorite combat maps.",
  most_engaging: "Maps with deep engagement and replay behavior.",
  new: "Recently released maps gaining traction.",
  updated: "Recently updated maps with renewed activity.",
  new_experiences: "New experiences from broader discovery pools.",
  new_released: "Recently released maps gaining traction.",
};

const DEFAULT_PANEL_LABELS: Record<string, string> = {
  new_released: "New",
  updated: "Updated",
  new_experiences: "New Experiences",
};

const DEFAULT_PANEL_ORDER: Record<string, number> = {
  new_released: 100,
  updated: 110,
  new_experiences: 115,
};

type EdgeRow = {
  parent_link_code: string;
  child_link_code: string;
  edge_type: string;
  sort_order: number | null;
  last_seen_at: string | null;
};

type SegmentRow = {
  target_id: string;
  surface_name: string;
  panel_name: string;
  panel_display_name: string | null;
  panel_type: string | null;
  feature_tags: string[] | null;
  rank: number;
  link_code: string;
  link_code_type: string;
  ccu_max: number | null;
  ccu_end: number | null;
  last_seen_ts: string | null;
  start_ts: string;
};

type MetaRow = {
  link_code: string;
  title: string | null;
  image_url: string | null;
  support_code: string | null;
  link_type: string | null;
  created_at_epic?: string | null;
  published_at_epic?: string | null;
  updated_at_epic?: string | null;
  raw?: Record<string, unknown> | null;
};

type PanelConfigRow = {
  panel_key: string;
  label: string;
  description: string | null;
  display_order: number;
  enabled: boolean;
  row_kind: "island" | "collection" | "mixed";
  is_premium: boolean;
};

type PanelAliasRow = {
  alias_token: string;
  target_panel_name: string;
  resolver_hint: string | null;
  priority: number;
};

type OutputRailItem = {
  rank: number;
  linkCode: string;
  rawLinkCode?: string;
  linkCodeType: string;
  resolvedType: "island" | "collection" | "neutral";
  resolvedFrom: "direct" | "edge_graph" | "panel_reference" | "neutral_fallback";
  isPlaceholder: boolean;
  debugTokenRaw?: string | null;
  hoverIslandCode?: string | null;
  title: string;
  imageUrl: string | null;
  creatorCode: string | null;
  publicSubtitle: string;
  ccu: number | null;
  uptimeMinutes: number;
  createdAtEpic?: string | null;
  publishedAtEpic?: string | null;
  updatedAtEpic?: string | null;
  linkType?: string | null;
  children?: any[];
  childrenCount?: number;
};

type OutputRail = {
  panelName: string;
  panelKey: string;
  panelDisplayName: string;
  panelType: string | null;
  featureTags: string[] | null;
  rowKind: "island" | "collection" | "mixed";
  displayOrder: number;
  isPremium: boolean;
  description: string | null;
  timelineKey: string;
  items: OutputRailItem[];
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

function isIslandCode(code: string): boolean {
  return ISLAND_CODE_RE.test(code);
}

function edgePriority(edgeType: string): number {
  if (edgeType === "default_sub_link_code") return 0;
  if (edgeType === "sub_link_code") return 1;
  if (edgeType === "related_link") return 2;
  if (edgeType === "fallback_link") return 3;
  if (edgeType === "parent_link") return 9;
  return 5;
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

function toPanelKey(panelName: string, panelDisplayName?: string | null): string {
  const rawPanel = String(panelName || "");
  if (/nested[_]?popularvariety/i.test(rawPanel)) return "trending_variety";
  if (/nested[_]?newupdatesthisweek/i.test(rawPanel)) return "updated";
  if (/newandupdated/i.test(rawPanel)) return "new_released";
  if (/newexperiences/i.test(rawPanel)) return "new_experiences";

  const source = String(panelDisplayName || normalizePanelDisplayName(panelName) || panelName || "").toLowerCase();
  const compact = source.replace(/[^a-z0-9]+/g, " ").trim();

  if (/homebar/.test(compact)) return "homebar";
  if (/trending in discover|trending variety/.test(compact)) return "trending_variety";
  if (/epic s picks|epics picks/.test(compact)) return "epics_picks";
  if (/game collections/.test(compact)) return "game_collections";
  if (/battle royales? by epic/.test(compact)) return "battle_royales_by_epic";
  if (/sponsored|paid for by developers/.test(compact)) return "sponsored";
  if (/^popular$|^popular in/.test(compact)) return "popular";
  if (/fan favorites/.test(compact)) return "fan_favorites";
  if (/most engaging/.test(compact)) return "most_engaging";
  if (/\bnew\b|recently released|new experiences/.test(compact)) return "new";
  if (/updated|new updates/.test(compact)) return "updated";

  return compact.replace(/\s+/g, "_");
}

function parseRankHint(hint: string | null | undefined): number {
  const raw = String(hint || "").trim().toLowerCase();
  if (!raw) return 1;
  const m = raw.match(/rank\s*[:=]\s*(\d{1,3})/);
  if (!m) return 1;
  const r = Number(m[1]);
  if (!Number.isFinite(r)) return 1;
  return Math.max(1, Math.min(250, r));
}

function extractTrailingRank(token: string): number {
  const m = String(token || "").match(/_(\d{1,3})$/);
  if (!m) return 1;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(250, n));
}

function safeNumber(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeCcu(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function extractCollectionDerivedCcu(meta: MetaRow | null | undefined): number | null {
  const raw = meta?.raw;
  if (!raw || typeof raw !== "object") return null;
  const sum = normalizeCcu((raw as any).surface_ref_ccu_sum);
  if (sum != null && sum > 0) return sum;
  const max = normalizeCcu((raw as any).surface_ref_ccu_max);
  if (max != null && max > 0) return max;
  return null;
}

function computeUptimeMinutes(startIso: string | null | undefined, endIso: string | null | undefined): number {
  if (!startIso) return 0;
  const startMs = new Date(startIso).getTime();
  if (!Number.isFinite(startMs)) return 0;
  const endMs = endIso ? new Date(endIso).getTime() : Date.now();
  if (!Number.isFinite(endMs)) return 0;
  return Math.max(0, Math.round((endMs - startMs) / 60000));
}

function isPersonalPanel(panelName: string, panelDisplayName?: string | null): boolean {
  const src = `${String(panelName || "")} ${String(panelDisplayName || "")}`.toLowerCase();
  if (!src.trim()) return false;
  return src.includes("recentlyplayed") ||
    src.includes("recently played") ||
    src.includes("playerfavorites") ||
    src.includes("player favorites") ||
    src.includes("favorites") ||
    src.includes("updatedislandsfromcreators") ||
    src.includes("for you");
}

function clampUptimeByPanel(panelKey: string, minutes: number): number {
  const m = Math.max(0, Number(minutes || 0));
  const key = String(panelKey || "").toLowerCase();
  if (!m) return 0;
  if (key === "game_collections" || key === "featured_collections") return 0;
  if (key === "battle_royales_by_epic" || key === "other_experiences_by_epic") return Math.min(m, 300 * 60);
  return Math.min(m, 24 * 60);
}

function isTechnicalToken(code: string): boolean {
  const c = String(code || "").toLowerCase();
  return c.startsWith("reference_") || c.startsWith("ref_panel_");
}

function isHomebarIgnoredToken(code: string): boolean {
  const c = String(code || "").toLowerCase();
  if (!isTechnicalToken(c)) return false;
  return c === "reference_current_island" ||
    c.startsWith("reference_nestedrecentlyplayed");
}

function isGameCollectionCode(code: string): boolean {
  return String(code || "").toLowerCase().startsWith("gamecollections_");
}

function mergeRowKind(
  a: "island" | "collection" | "mixed",
  b: "island" | "collection" | "mixed",
): "island" | "collection" | "mixed" {
  if (a === b) return a;
  if (a === "mixed" || b === "mixed") return "mixed";
  return "mixed";
}

function itemUniqKey(item: OutputRailItem): string {
  const code = String(item.linkCode || "").trim().toLowerCase();
  const raw = String(item.rawLinkCode || "").trim().toLowerCase();
  const title = String(item.title || "").trim().toLowerCase();
  if (code) return `${item.resolvedType}:${code}`;
  if (raw) return `${item.resolvedType}:raw:${raw}`;
  return `${item.resolvedType}:title:${title}`;
}

function mergeRailsByPanelKey(input: OutputRail[], maxItemsPerPanel: number): OutputRail[] {
  const out = new Map<string, OutputRail & { _itemSeen: Set<string> }>();
  for (const rail of input) {
    const key = String(rail.panelKey || rail.panelName || "").toLowerCase();
    if (!key) continue;

    const existing = out.get(key);
    if (!existing) {
      const seen = new Set<string>();
      const items: OutputRailItem[] = [];
      for (const item of rail.items || []) {
        const k = itemUniqKey(item);
        if (seen.has(k)) continue;
        seen.add(k);
        items.push(item);
      }
      out.set(key, {
        ...rail,
        items,
        _itemSeen: seen,
      });
      continue;
    }

    existing.displayOrder = Math.min(Number(existing.displayOrder || 9999), Number(rail.displayOrder || 9999));
    existing.isPremium = Boolean(existing.isPremium || rail.isPremium);
    existing.rowKind = mergeRowKind(existing.rowKind, rail.rowKind);
    if (!existing.description && rail.description) existing.description = rail.description;
    if (!existing.panelType && rail.panelType) existing.panelType = rail.panelType;
    if ((!existing.featureTags || existing.featureTags.length === 0) && rail.featureTags?.length) {
      existing.featureTags = rail.featureTags;
    }

    for (const item of rail.items || []) {
      const k = itemUniqKey(item);
      if (existing._itemSeen.has(k)) continue;
      existing._itemSeen.add(k);
      existing.items.push(item);
    }
  }

  const rows = Array.from(out.values()).map((rail) => {
    const limited = (rail.items || []).slice(0, maxItemsPerPanel).map((item, idx) => ({ ...item, rank: idx + 1 }));
    const { _itemSeen, ...clean } = rail;
    return { ...clean, items: limited };
  });

  rows.sort((a, b) => {
    if (a.displayOrder !== b.displayOrder) return a.displayOrder - b.displayOrder;
    return String(a.panelDisplayName || a.panelName).localeCompare(String(b.panelDisplayName || b.panelName));
  });
  return rows;
}

function isCollectionCode(code: string): boolean {
  if (isIslandCode(code)) return false;
  const c = String(code || "").toLowerCase();
  return c.startsWith("set_") || c.startsWith("playlist_") || c.startsWith("gamecollections_") || c.startsWith("experience_") || c.startsWith("reference_") || c.startsWith("ref_panel_");
}

async function fetchAllMetadata(supabase: any, codes: string[]): Promise<Map<string, MetaRow>> {
  const out = new Map<string, MetaRow>();
  const unique = Array.from(new Set(codes.map((c) => String(c || "")).filter(Boolean)));
  for (let i = 0; i < unique.length; i += 1000) {
    const chunk = unique.slice(i, i + 1000);
    const { data, error } = await supabase
      .from("discover_link_metadata")
      .select("link_code,title,image_url,support_code,link_type,created_at_epic,published_at_epic,updated_at_epic,raw")
      .in("link_code", chunk);
    if (error) throw new Error(error.message);
    for (const row of data || []) out.set(String((row as any).link_code), row as MetaRow);
  }
  return out;
}

async function fetchCurrentCcuMap(supabase: any, targetId: string, codes: string[]): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  const unique = Array.from(new Set(codes.map((c) => String(c || "")).filter(Boolean)));
  for (let i = 0; i < unique.length; i += 1000) {
    const chunk = unique.slice(i, i + 1000);
    const { data, error } = await supabase
      .from("discovery_exposure_rank_segments")
      .select("link_code,ccu_max,ccu_end")
      .eq("target_id", targetId)
      .is("end_ts", null)
      .in("link_code", chunk);
    if (error) continue;
    for (const row of data || []) {
      const code = String((row as any).link_code);
      const ccu = (row as any).ccu_end ?? (row as any).ccu_max ?? null;
      out.set(code, ccu != null ? Number(ccu) : null);
    }
  }
  return out;
}

function sortEdges(edges: EdgeRow[]): EdgeRow[] {
  const clone = [...edges];
  clone.sort((a, b) => {
    const ep = edgePriority(String(a.edge_type)) - edgePriority(String(b.edge_type));
    if (ep !== 0) return ep;
    const sa = a.sort_order == null ? 999999 : Number(a.sort_order);
    const sb = b.sort_order == null ? 999999 : Number(b.sort_order);
    if (sa !== sb) return sa - sb;
    return String(a.child_link_code).localeCompare(String(b.child_link_code));
  });
  return clone;
}

async function fetchEdgesRecursive(
  supabase: any,
  rootCodes: string[],
  maxDepth: number,
): Promise<{ edgeMap: Map<string, EdgeRow[]>; discoveredCodes: Set<string> }> {
  const edgeMap = new Map<string, EdgeRow[]>();
  const discoveredCodes = new Set<string>(rootCodes);
  const queriedParents = new Set<string>();

  let frontier = Array.from(new Set(rootCodes.filter((c) => isCollectionCode(c))));

  for (let depth = 0; depth < maxDepth; depth++) {
    if (!frontier.length) break;
    const batchParents = frontier.filter((p) => !queriedParents.has(p));
    if (!batchParents.length) break;

    for (const p of batchParents) queriedParents.add(p);

    const edgesFound: EdgeRow[] = [];
    for (let i = 0; i < batchParents.length; i += 1000) {
      const chunk = batchParents.slice(i, i + 1000);
      const { data, error } = await supabase
        .from("discover_link_edges")
        .select("parent_link_code,child_link_code,edge_type,sort_order,last_seen_at")
        .in("parent_link_code", chunk);
      if (error) continue;
      for (const row of data || []) edgesFound.push(row as EdgeRow);
    }

    const nextSet = new Set<string>();
    for (const edge of edgesFound) {
      const parent = String(edge.parent_link_code);
      const child = String(edge.child_link_code);
      const arr = edgeMap.get(parent) || [];
      arr.push(edge);
      edgeMap.set(parent, arr);
      discoveredCodes.add(child);
      if (isCollectionCode(child) && !queriedParents.has(child)) nextSet.add(child);
    }

    frontier = Array.from(nextSet);
  }

  for (const [k, list] of edgeMap.entries()) edgeMap.set(k, sortEdges(list));

  return { edgeMap, discoveredCodes };
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
        functionName: "discover-rails-resolver",
        body,
        timeoutMs: getEnvNumber("LOOKUP_DATA_TIMEOUT_MS", 3500),
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
    const maxPanels = Math.max(1, Math.min(100, Number(body.maxPanels ?? 40)));
    const maxItemsPerPanel = Math.max(1, Math.min(250, Number(body.maxItemsPerPanel ?? 60)));
    const maxChildrenPerCollection = Math.max(1, Math.min(200, Number(body.maxChildrenPerCollection ?? 24)));
    const includeChildren = body.includeChildren != null ? Boolean(body.includeChildren) : true;
    const includeDebug = body.debug === true;
    const maxResolveDepth = Math.max(1, Math.min(8, Number(body.maxResolveDepth ?? 4)));

    const { data: targetRows, error: tErr } = await supabase
      .from("discovery_exposure_targets")
      .select("id,region,surface_name,platform,locale,last_ok_tick_at")
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

    const { data: segs, error: sErr } = await supabase
      .from("discovery_exposure_rank_segments")
      .select("target_id,surface_name,panel_name,panel_display_name,panel_type,feature_tags,rank,link_code,link_code_type,ccu_max,ccu_end,last_seen_ts,start_ts")
      .eq("target_id", targetId)
      .is("end_ts", null)
      .order("panel_name", { ascending: true })
      .order("rank", { ascending: true })
      .limit(maxPanels * maxItemsPerPanel + 1000);
    if (sErr) throw new Error(sErr.message);

    const rows = (segs || []) as SegmentRow[];
    if (!rows.length) {
      return json({
        success: true,
        target,
        rails: [],
        meta: { region, surfaceName, targetId, generatedAt: new Date().toISOString() },
      });
    }

    let configRows: PanelConfigRow[] = [];
    {
      const { data, error } = await supabase
        .from("discovery_live_panel_config")
        .select("panel_key,label,description,display_order,enabled,row_kind,is_premium")
        .eq("enabled", true)
        .order("display_order", { ascending: true });
      if (!error && Array.isArray(data)) configRows = data as PanelConfigRow[];
    }

    let aliasRows: PanelAliasRow[] = [];
    {
      const { data, error } = await supabase
        .from("discovery_live_panel_alias")
        .select("alias_token,target_panel_name,resolver_hint,priority")
        .order("priority", { ascending: true });
      if (!error && Array.isArray(data)) aliasRows = data as PanelAliasRow[];
    }

    const configByKey = new Map(configRows.map((r) => [String(r.panel_key), r]));
    const aliasByToken = new Map<string, PanelAliasRow[]>();
    for (const row of aliasRows) {
      const key = String(row.alias_token || "").toLowerCase();
      if (!key) continue;
      const arr = aliasByToken.get(key) || [];
      arr.push(row);
      aliasByToken.set(key, arr);
    }

    const filteredRows = rows.filter((r) => {
      const panelName = String(r.panel_name || "");
      const panelDisplay = String(r.panel_display_name || "");
      return !isPersonalPanel(panelName, panelDisplay);
    });

    const panelRowsByName = new Map<string, SegmentRow[]>();
    for (const r of filteredRows) {
      const key = String(r.panel_name || "");
      const arr = panelRowsByName.get(key) || [];
      arr.push(r);
      panelRowsByName.set(key, arr);
    }
    for (const [k, arr] of panelRowsByName.entries()) {
      arr.sort((a, b) => Number(a.rank) - Number(b.rank));
      panelRowsByName.set(k, arr);
    }

    const topCodes = Array.from(new Set(rows.map((r) => String(r.link_code))));
    const { edgeMap, discoveredCodes } = await fetchEdgesRecursive(supabase, topCodes, maxResolveDepth);

    const allCodes = Array.from(new Set([...topCodes, ...Array.from(discoveredCodes)]));
    const metaMap = await fetchAllMetadata(supabase, allCodes);
    const ccuMap = await fetchCurrentCcuMap(supabase, targetId, allCodes);

    const resolveCache = new Map<string, any>();

    const isRichCollection = (code: string, rawType?: string): boolean => {
      const treatAsCollection = rawType === "collection" || isCollectionCode(code);
      if (!treatAsCollection) return false;
      const m = metaMap.get(code);
      const hasVisual = Boolean(m?.image_url);
      const hasTitle = Boolean(String(m?.title || "").trim());
      return hasVisual || hasTitle || isGameCollectionCode(code) || String(code).toLowerCase().startsWith("playlist_") || String(code).toLowerCase().startsWith("set_");
    };

    const resolveFromGraph = (startCode: string): any => {
      const cacheKey = `graph:${startCode}`;
      if (resolveCache.has(cacheKey)) return resolveCache.get(cacheKey);

      const visited = new Set<string>();
      let bestCollection: any = null;

      const dfs = (code: string, depth: number): any => {
        if (!code || visited.has(code) || depth > maxResolveDepth) return null;
        visited.add(code);

        if (isIslandCode(code)) {
          return { resolvedCode: code, resolvedType: "island", depth };
        }

        if (depth > 0 && isRichCollection(code) && !isTechnicalToken(code)) {
          bestCollection = bestCollection || { resolvedCode: code, resolvedType: "collection", depth };
        }

        const edges = edgeMap.get(code) || [];
        for (const e of edges) {
          const child = String(e.child_link_code || "");
          const found = dfs(child, depth + 1);
          if (found && found.resolvedType === "island") return found;
          if (found && found.resolvedType === "collection" && !bestCollection) bestCollection = found;
        }

        return null;
      };

      const direct = dfs(startCode, 0);
      const out = direct || bestCollection || null;
      resolveCache.set(cacheKey, out);
      return out;
    };

    const normalizePanelToken = (v: string): string => String(v || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const panelNamesNormalized = new Map<string, string[]>();
    for (const panel of panelRowsByName.keys()) {
      const key = normalizePanelToken(panel);
      const arr = panelNamesNormalized.get(key) || [];
      arr.push(panel);
      panelNamesNormalized.set(key, arr);
    }

    const findPanelByTokenBase = (baseRaw: string): string | null => {
      const base = normalizePanelToken(baseRaw);
      if (!base) return null;
      const exact = panelNamesNormalized.get(base);
      if (exact?.length) return exact[0];

      const candidates = Array.from(panelRowsByName.keys());
      const includes = candidates.find((p) => normalizePanelToken(p).includes(base));
      if (includes) return includes;
      const reverse = candidates.find((p) => base.includes(normalizePanelToken(p)));
      return reverse || null;
    };

    const deriveTokenPanelCandidate = (tokenNorm: string): { panel: string; rankWanted: number } | null => {
      if (!isTechnicalToken(tokenNorm)) return null;
      const rankWanted = extractTrailingRank(tokenNorm);

      if (/^reference_nested[a-z0-9_]*_\d+$/i.test(tokenNorm)) {
        const base = tokenNorm.replace(/^reference_/, "").replace(/_\d+$/, "");
        const panel = findPanelByTokenBase(base);
        return panel ? { panel, rankWanted } : null;
      }

      if (/^ref_panel_[a-z0-9_]+_\d+$/i.test(tokenNorm)) {
        const base = tokenNorm.replace(/^ref_panel_/, "").replace(/_\d+$/, "").replace(/_+$/, "");
        const panel = findPanelByTokenBase(base);
        return panel ? { panel, rankWanted } : null;
      }

      return null;
    };

    const resolveFromAlias = (token: string): any => {
      const tokenNorm = String(token || "").toLowerCase();
      const aliasList = aliasByToken.get(tokenNorm) || [];

      const candidates: Array<{ panel: string; rankWanted: number }> = [];
      for (const alias of aliasList) {
        const panel = String(alias.target_panel_name || "").trim();
        if (!panel) continue;
        const rankWanted = parseRankHint(alias.resolver_hint);
        if (candidates.some((c) => c.panel === panel && c.rankWanted === rankWanted)) continue;
        candidates.push({ panel, rankWanted });
      }
      const dynamic = deriveTokenPanelCandidate(tokenNorm);
      if (dynamic && !candidates.some((c) => c.panel === dynamic.panel && c.rankWanted === dynamic.rankWanted)) {
        candidates.push(dynamic);
      }

      for (const candidateAlias of candidates) {
        const panel = candidateAlias.panel;
        const rankWanted = candidateAlias.rankWanted;
        const panelRows = panelRowsByName.get(panel) || [];
        if (!panelRows.length) continue;
        const candidate = panelRows.find((r) => Number(r.rank) === rankWanted);
        if (!candidate) continue;

        const candidateCode = String(candidate.link_code || "");
        if (!candidateCode) continue;
        if (candidateCode.toLowerCase() === tokenNorm) continue;

        if (isIslandCode(candidateCode)) {
          return {
            resolvedCode: candidateCode,
            resolvedType: "island",
            resolvedFrom: "panel_reference",
            sourcePanelName: panel,
            sourceStartTs: candidate.start_ts ?? null,
            sourceLastSeenTs: candidate.last_seen_ts ?? null,
          };
        }

        const viaGraph = resolveFromGraph(candidateCode);
        if (viaGraph) {
          return {
            ...viaGraph,
            resolvedFrom: "panel_reference",
            sourcePanelName: panel,
            sourceStartTs: candidate.start_ts ?? null,
            sourceLastSeenTs: candidate.last_seen_ts ?? null,
          };
        }

        if (isRichCollection(candidateCode, String(candidate.link_code_type || ""))) {
          return {
            resolvedCode: candidateCode,
            resolvedType: "collection",
            resolvedFrom: "panel_reference",
            sourcePanelName: panel,
            sourceStartTs: candidate.start_ts ?? null,
            sourceLastSeenTs: candidate.last_seen_ts ?? null,
          };
        }
      }
      return null;
    };

    const panelNames = Array.from(panelRowsByName.keys());

    const railsRaw = panelNames.map((panelName, panelIdx) => {
        const panelRows = (panelRowsByName.get(panelName) || []).slice(0, maxItemsPerPanel);
        const first = panelRows[0] || ({} as SegmentRow);
        const panelDisplay = String(first.panel_display_name || "").trim() || normalizePanelDisplayName(panelName);
        const panelKey = toPanelKey(panelName, panelDisplay);
      const panelCfg = configByKey.get(panelKey);

      if (panelKey === "homebar") {
        const seen = new Set<string>();
        const items: any[] = [];

        for (const row of panelRows) {
          if (items.length >= Math.max(1, Math.min(12, maxItemsPerPanel))) break;

          const rawCode = String(row.link_code || "");
          const rawType = String(row.link_code_type || "");
          const rawMeta = metaMap.get(rawCode) || null;
          if (!rawCode) continue;
          if (isHomebarIgnoredToken(rawCode)) continue;

          let resolvedCode = rawCode;
          let resolvedType: "island" | "collection" | "neutral" = isIslandCode(rawCode) ? "island" : "collection";
          let resolvedFrom: "direct" | "edge_graph" | "panel_reference" | "neutral_fallback" = "direct";
          let uptimeStartTs = row.start_ts;
          let uptimeLastSeenTs = row.last_seen_ts;

          if (isIslandCode(rawCode)) {
            resolvedType = "island";
            resolvedFrom = "direct";
          } else if (isGameCollectionCode(rawCode)) {
            resolvedType = "collection";
            resolvedFrom = "direct";
          } else {
            const aliasResolved = resolveFromAlias(rawCode);
            if (aliasResolved?.resolvedCode) {
              resolvedCode = String(aliasResolved.resolvedCode);
              resolvedType = aliasResolved.resolvedType;
              resolvedFrom = aliasResolved.resolvedFrom || "panel_reference";
              if (aliasResolved.sourceStartTs) uptimeStartTs = aliasResolved.sourceStartTs;
              if (aliasResolved.sourceLastSeenTs) uptimeLastSeenTs = aliasResolved.sourceLastSeenTs;
            } else {
              const graphResolved = resolveFromGraph(rawCode);
              if (graphResolved?.resolvedCode) {
                resolvedCode = String(graphResolved.resolvedCode);
                resolvedType = graphResolved.resolvedType;
                resolvedFrom = "edge_graph";
              } else {
                continue;
              }
            }
          }

          if (resolvedType === "neutral") continue;
          if (seen.has(resolvedCode)) continue;

          const resolvedMeta = metaMap.get(resolvedCode) || rawMeta;
          const rawCcu = row.ccu_end != null ? Number(row.ccu_end) : (row.ccu_max != null ? Number(row.ccu_max) : null);
          let resolvedCcu = normalizeCcu(ccuMap.get(resolvedCode) ?? ccuMap.get(rawCode) ?? rawCcu);
          if ((resolvedCcu == null || resolvedCcu <= 0) && resolvedType === "collection") {
            resolvedCcu = extractCollectionDerivedCcu(resolvedMeta) ?? extractCollectionDerivedCcu(rawMeta);
          }
          if (resolvedCcu == null || resolvedCcu <= 0) continue;

          const imageUrl = resolvedMeta?.image_url ?? null;

          const title = String(resolvedMeta?.title || "").trim() || resolvedCode;
          seen.add(resolvedCode);

          items.push({
            rank: items.length + 1,
            linkCode: resolvedCode,
            rawLinkCode: rawCode,
            linkCodeType: rawType,
            resolvedType,
            resolvedFrom,
            isPlaceholder: false,
            debugTokenRaw: includeDebug ? rawCode : null,
            hoverIslandCode: resolvedType === "island" && isIslandCode(resolvedCode) ? resolvedCode : null,
            title,
            imageUrl,
            creatorCode: resolvedType === "island" ? (resolvedMeta?.support_code ?? null) : null,
            publicSubtitle: resolvedType === "island" ? (resolvedMeta?.support_code ? `@${String(resolvedMeta.support_code)}` : "") : "",
            ccu: resolvedCcu,
            uptimeMinutes: clampUptimeByPanel(panelKey, computeUptimeMinutes(uptimeStartTs, uptimeLastSeenTs)),
            createdAtEpic: resolvedMeta?.created_at_epic ?? null,
            publishedAtEpic: resolvedMeta?.published_at_epic ?? null,
            updatedAtEpic: resolvedMeta?.updated_at_epic ?? null,
            linkType: resolvedMeta?.link_type ?? null,
            children: undefined,
            childrenCount: 0,
          });
        }

        return {
          panelName,
          panelKey,
          panelDisplayName: panelCfg?.label || DEFAULT_PANEL_LABELS[panelKey] || panelDisplay,
          panelType: first.panel_type ?? null,
          featureTags: first.feature_tags ?? null,
          rowKind: panelCfg?.row_kind || "mixed",
          displayOrder: panelCfg?.display_order ?? DEFAULT_PANEL_ORDER[panelKey] ?? 1000 + panelIdx,
          isPremium: panelCfg?.is_premium ?? false,
          description: panelCfg?.description || DEFAULT_PANEL_DESCRIPTIONS[panelKey] || null,
          timelineKey: `${region}:${surfaceName}:${panelName}`,
          items,
        };
      }

      const items = panelRows.map((row) => {
        const rawCode = String(row.link_code || "");
        const rawType = String(row.link_code_type || "");
        const rawMeta = metaMap.get(rawCode) || null;

        let resolvedCode = rawCode;
        let resolvedType: "island" | "collection" | "neutral" = isIslandCode(rawCode) ? "island" : "collection";
        let resolvedFrom: "direct" | "edge_graph" | "panel_reference" | "neutral_fallback" = "direct";
        let uptimeStartTs = row.start_ts;
        let uptimeLastSeenTs = row.last_seen_ts;

        if (isIslandCode(rawCode)) {
          resolvedType = "island";
          resolvedFrom = "direct";
        } else if (isGameCollectionCode(rawCode)) {
          resolvedType = "collection";
          resolvedFrom = "direct";
        } else {
          const aliasResolved = resolveFromAlias(rawCode);
          if (aliasResolved?.resolvedCode) {
            resolvedCode = String(aliasResolved.resolvedCode);
            resolvedType = aliasResolved.resolvedType;
            resolvedFrom = aliasResolved.resolvedFrom || "panel_reference";
            if (aliasResolved.sourceStartTs) uptimeStartTs = aliasResolved.sourceStartTs;
            if (aliasResolved.sourceLastSeenTs) uptimeLastSeenTs = aliasResolved.sourceLastSeenTs;
          } else {
            const graphResolved = resolveFromGraph(rawCode);
            if (graphResolved?.resolvedCode) {
              resolvedCode = String(graphResolved.resolvedCode);
              resolvedType = graphResolved.resolvedType;
              resolvedFrom = "edge_graph";
            } else if (isRichCollection(rawCode, rawType)) {
              resolvedCode = rawCode;
              resolvedType = "collection";
              resolvedFrom = "direct";
            } else {
              // Never invent synthetic fallback rows for unresolved technical tokens.
              return null;
            }
          }
        }

        const resolvedMeta = metaMap.get(resolvedCode) || rawMeta;
        const rawCcu = row.ccu_end != null ? Number(row.ccu_end) : (row.ccu_max != null ? Number(row.ccu_max) : null);
        let resolvedCcu = normalizeCcu(ccuMap.get(resolvedCode) ?? rawCcu);
        if ((resolvedCcu == null || resolvedCcu <= 0) && resolvedType === "collection") {
          resolvedCcu = extractCollectionDerivedCcu(resolvedMeta) ?? extractCollectionDerivedCcu(rawMeta);
        }

        const imageUrl = resolvedType === "neutral" ? null : (resolvedMeta?.image_url ?? null);

        const title =
          resolvedType === "neutral"
            ? "Resolving data..."
            : String(resolvedMeta?.title || "").trim() || (resolvedType === "collection" ? panelDisplay : resolvedCode);

        const publicSubtitle = resolvedType === "island"
          ? (resolvedMeta?.support_code ? `@${String(resolvedMeta.support_code)}` : "")
          : "";

        let children: any[] | undefined;
        if (includeChildren && resolvedType === "collection") {
          const edges = edgeMap.get(resolvedCode) || edgeMap.get(rawCode) || [];
          const seen = new Set<string>();
          children = [];
          for (const edge of edges) {
            const childCode = String(edge.child_link_code || "");
            if (!childCode || seen.has(childCode)) continue;
            seen.add(childCode);
            const childMeta = metaMap.get(childCode) || null;
            children.push({
              linkCode: childCode,
              title: String(childMeta?.title || childCode),
              imageUrl: childMeta?.image_url ?? null,
              creatorCode: childMeta?.support_code ?? null,
              ccu: ccuMap.get(childCode) ?? null,
              edgeType: edge.edge_type,
              sortOrder: edge.sort_order,
            });
            if (children.length >= maxChildrenPerCollection) break;
          }
        }

        return {
          rank: Number(row.rank),
          linkCode: resolvedCode,
          rawLinkCode: rawCode,
          linkCodeType: rawType,
          resolvedType,
          resolvedFrom,
          isPlaceholder: resolvedType === "neutral",
          debugTokenRaw: includeDebug ? rawCode : null,
          hoverIslandCode: resolvedType === "island" && isIslandCode(resolvedCode) ? resolvedCode : null,
          title,
          imageUrl,
          creatorCode: resolvedType === "island" ? (resolvedMeta?.support_code ?? null) : null,
          publicSubtitle,
          ccu: resolvedCcu,
          uptimeMinutes: clampUptimeByPanel(panelKey, computeUptimeMinutes(uptimeStartTs, uptimeLastSeenTs)),
          createdAtEpic: resolvedMeta?.created_at_epic ?? null,
          publishedAtEpic: resolvedMeta?.published_at_epic ?? null,
          updatedAtEpic: resolvedMeta?.updated_at_epic ?? null,
          linkType: resolvedMeta?.link_type ?? null,
          children,
          childrenCount: Array.isArray(children) ? children.length : 0,
        };
      }).filter(Boolean) as any[];

      const typeSet = new Set(items.map((it) => it.resolvedType).filter((t) => t !== "neutral"));
      let inferredRowKind: "island" | "collection" | "mixed" = "island";
      if (panelKey === "game_collections") inferredRowKind = "collection";
      else if (typeSet.size > 1) inferredRowKind = "mixed";
      else if (typeSet.has("collection")) inferredRowKind = "collection";

      return {
        panelName,
        panelKey,
        panelDisplayName: panelCfg?.label || DEFAULT_PANEL_LABELS[panelKey] || panelDisplay,
        panelType: first.panel_type ?? null,
        featureTags: first.feature_tags ?? null,
        rowKind: panelCfg?.row_kind || inferredRowKind,
        displayOrder: panelCfg?.display_order ?? DEFAULT_PANEL_ORDER[panelKey] ?? 1000 + panelIdx,
        isPremium: panelCfg?.is_premium ?? false,
        description: panelCfg?.description || DEFAULT_PANEL_DESCRIPTIONS[panelKey] || null,
        timelineKey: `${region}:${surfaceName}:${panelName}`,
        items,
      };
    });

    const visibleRails = [...railsRaw]
      .filter((rail) => {
        if (isPersonalPanel(rail.panelName, rail.panelDisplayName)) return false;
        if (rail.panelKey === "for_you" || rail.panelKey === "recently_played" || rail.panelKey === "player_favorites" || rail.panelKey === "favorites") return false;
        return true;
      })
      .sort((a, b) => {
      if (a.displayOrder !== b.displayOrder) return a.displayOrder - b.displayOrder;
      return String(a.panelDisplayName || a.panelName).localeCompare(String(b.panelDisplayName || b.panelName));
      });

    const rails = mergeRailsByPanelKey(visibleRails as OutputRail[], maxItemsPerPanel)
      .filter((rail) => Array.isArray(rail.items) && rail.items.length > 0)
      .slice(0, maxPanels);

    return json({
      success: true,
      meta: {
        generatedAt: new Date().toISOString(),
        region,
        surfaceName,
        targetId,
        targetLastOkTickAt: target.last_ok_tick_at ?? null,
        rails: rails.length,
      },
      rails,
    });
  } catch (e) {
    return json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
