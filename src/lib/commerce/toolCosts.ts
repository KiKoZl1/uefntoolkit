export type CommerceToolCode =
  | "surprise_gen"
  | "edit_studio"
  | "camera_control"
  | "layer_decomposition"
  | "psd_to_umg"
  | "umg_to_verse";

export type ToolCostCatalog = Record<CommerceToolCode, number>;

export const DEFAULT_TOOL_COSTS: ToolCostCatalog = {
  surprise_gen: 15,
  edit_studio: 4,
  camera_control: 3,
  layer_decomposition: 8,
  psd_to_umg: 2,
  umg_to_verse: 2,
};

const TOOL_COST_CONFIG_KEYS: Record<CommerceToolCode, string> = {
  surprise_gen: "tool_cost_surprise_gen",
  edit_studio: "tool_cost_edit_studio",
  camera_control: "tool_cost_camera_control",
  layer_decomposition: "tool_cost_layer_decomposition",
  psd_to_umg: "tool_cost_psd_to_umg",
  umg_to_verse: "tool_cost_umg_to_verse",
};

const CATALOG_CACHE_KEY = "commerce_tool_costs_v1";
const CATALOG_TTL_MS = 5 * 60 * 1000;

let cachedCatalog: ToolCostCatalog | null = null;
let cachedAt = 0;
let inFlightCatalog: Promise<ToolCostCatalog> | null = null;

function toSafeCost(value: unknown, fallback: number): number {
  const next = Number(value);
  if (!Number.isFinite(next) || next <= 0) return fallback;
  return Math.max(1, Math.floor(next));
}

function decodeCatalog(raw: unknown): ToolCostCatalog {
  const next: ToolCostCatalog = { ...DEFAULT_TOOL_COSTS };
  const payload = raw as { tool_costs?: Record<string, unknown> } | null;
  const map = payload?.tool_costs || {};

  (Object.keys(TOOL_COST_CONFIG_KEYS) as CommerceToolCode[]).forEach((toolCode) => {
    next[toolCode] = toSafeCost(map[toolCode], DEFAULT_TOOL_COSTS[toolCode]);
  });

  return next;
}

function readCachedCatalogFromStorage(): ToolCostCatalog | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(CATALOG_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at?: number; tool_costs?: Record<string, unknown> };
    const at = Number(parsed?.at || 0);
    if (!Number.isFinite(at) || at <= 0) return null;
    if (Date.now() - at > CATALOG_TTL_MS) return null;
    return decodeCatalog({ tool_costs: parsed.tool_costs || {} });
  } catch {
    return null;
  }
}

function writeCachedCatalogToStorage(catalog: ToolCostCatalog) {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      CATALOG_CACHE_KEY,
      JSON.stringify({
        at: Date.now(),
        tool_costs: catalog,
      }),
    );
  } catch {
    // best effort only
  }
}

async function fetchCatalogFromApi(): Promise<ToolCostCatalog> {
  const supabaseUrl = String(import.meta.env.VITE_SUPABASE_URL || "").trim();
  const anonKey = String(
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || "",
  ).trim();
  if (!supabaseUrl || !anonKey) return { ...DEFAULT_TOOL_COSTS };

  const url = `${supabaseUrl}/functions/v1/commerce/catalog/tool-costs`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      apikey: anonKey,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) return { ...DEFAULT_TOOL_COSTS };

  const text = await response.text();
  let payload: unknown = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {};
  }

  return decodeCatalog(payload);
}

export async function getToolCostCatalog(options?: { forceRefresh?: boolean }): Promise<ToolCostCatalog> {
  const forceRefresh = Boolean(options?.forceRefresh);
  const stillFresh = cachedCatalog && Date.now() - cachedAt < CATALOG_TTL_MS;
  if (!forceRefresh && stillFresh) return cachedCatalog;

  if (!forceRefresh && !cachedCatalog) {
    const localCached = readCachedCatalogFromStorage();
    if (localCached) {
      cachedCatalog = localCached;
      cachedAt = Date.now();
      return localCached;
    }
  }

  if (inFlightCatalog) return await inFlightCatalog;

  inFlightCatalog = (async () => {
    try {
      const catalog = await fetchCatalogFromApi();
      cachedCatalog = catalog;
      cachedAt = Date.now();
      writeCachedCatalogToStorage(catalog);
      return catalog;
    } catch {
      if (cachedCatalog) return cachedCatalog;
      return { ...DEFAULT_TOOL_COSTS };
    } finally {
      inFlightCatalog = null;
    }
  })();

  return await inFlightCatalog;
}

export function getToolCost(toolCode: CommerceToolCode, catalog?: Partial<Record<CommerceToolCode, number>>): number {
  const fromCatalog = catalog?.[toolCode];
  return toSafeCost(fromCatalog, DEFAULT_TOOL_COSTS[toolCode]);
}

export function getToolCodeForNavItem(itemId: string): CommerceToolCode | null {
  if (itemId === "toolsGenerate") return "surprise_gen";
  if (itemId === "toolsEditStudio") return "edit_studio";
  if (itemId === "toolsCameraControl") return "camera_control";
  if (itemId === "toolsLayerDecomposition") return "layer_decomposition";
  if (itemId === "widgetKitPsdUmg") return "psd_to_umg";
  if (itemId === "widgetKitUmgVerse") return "umg_to_verse";
  return null;
}

