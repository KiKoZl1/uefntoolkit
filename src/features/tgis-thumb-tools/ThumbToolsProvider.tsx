import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type ThumbAsset = {
  id: string;
  user_id: string;
  source_generation_id: string | null;
  parent_asset_id: string | null;
  origin_tool: "generate" | "edit_studio" | "camera_control" | "layer_decomposition";
  image_url: string;
  width: number;
  height: number;
  metadata_json: Record<string, unknown>;
  created_at: string;
};

type ThumbToolsContextValue = {
  loadingHistory: boolean;
  currentAsset: ThumbAsset | null;
  history: ThumbAsset[];
  setCurrentAsset: (asset: ThumbAsset | null) => void;
  refreshHistory: () => Promise<void>;
  registerAsset: (asset: ThumbAsset) => void;
  deleteAsset: (assetId: string) => Promise<void>;
};

const ThumbToolsContext = createContext<ThumbToolsContextValue | undefined>(undefined);

const SESSION_KEY = "tgis_thumb_tools_current_asset";

export function ThumbToolsProvider({ children }: { children: React.ReactNode }) {
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [history, setHistory] = useState<ThumbAsset[]>([]);
  const [currentAsset, setCurrentAssetState] = useState<ThumbAsset | null>(null);
  const currentAssetRef = useRef<ThumbAsset | null>(null);
  const historyRef = useRef<ThumbAsset[]>([]);
  const refreshInFlightRef = useRef(false);
  const lastRefreshAtRef = useRef(0);

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  const dedupeByImageUrl = useCallback((items: ThumbAsset[]) => {
    const out: ThumbAsset[] = [];
    const seen = new Set<string>();
    for (const item of items) {
      const key = String(item.image_url || "").trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
    return out;
  }, []);

  const setCurrentAsset = useCallback((asset: ThumbAsset | null) => {
    setCurrentAssetState(asset);
    currentAssetRef.current = asset;
    if (!asset) {
      sessionStorage.removeItem(SESSION_KEY);
      return;
    }
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      id: asset.id,
      image_url: asset.image_url,
      width: asset.width,
      height: asset.height,
      origin_tool: asset.origin_tool,
      created_at: asset.created_at,
    }));
  }, []);

  const refreshHistory = useCallback(async () => {
    const now = Date.now();
    if (refreshInFlightRef.current) return;
    if (now - lastRefreshAtRef.current < 1200) return;

    refreshInFlightRef.current = true;
    lastRefreshAtRef.current = now;
    setLoadingHistory(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user?.id;
      if (!userId) {
        setHistory([]);
        setCurrentAsset(null);
        return;
      }

      const { data: rows } = await (supabase as any)
        .from("tgis_thumb_assets")
        .select("id,user_id,source_generation_id,parent_asset_id,origin_tool,image_url,width,height,metadata_json,created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(120);

      const parsedRaw = (Array.isArray(rows) ? rows : []) as ThumbAsset[];
      const parsed = dedupeByImageUrl(parsedRaw);
      setHistory(parsed);

      const cached = sessionStorage.getItem(SESSION_KEY);
      if (!cached) {
        if (!currentAssetRef.current && parsed[0]) {
          setCurrentAsset(parsed[0]);
        }
      } else {
        try {
          const cachedObj = JSON.parse(cached);
          const found = parsed.find((x) => x.id === cachedObj?.id);
          if (found) {
            setCurrentAsset(found);
          } else if (parsed[0]) {
            setCurrentAsset(parsed[0]);
          } else {
            setCurrentAsset(null);
          }
        } catch {
          // ignore invalid cache
        }
      }
    } finally {
      setLoadingHistory(false);
      refreshInFlightRef.current = false;
    }
  }, [dedupeByImageUrl, setCurrentAsset]);

  useEffect(() => {
    void refreshHistory();
  }, []);

  const registerAsset = useCallback((asset: ThumbAsset) => {
    setHistory((prev) => {
      const nextRaw = [asset, ...prev.filter((x) => x.id !== asset.id)];
      const next = dedupeByImageUrl(nextRaw);
      return next.slice(0, 120);
    });
    setCurrentAsset(asset);
  }, [setCurrentAsset, dedupeByImageUrl]);

  const deleteAsset = useCallback(async (assetId: string) => {
    const id = String(assetId || "").trim();
    if (!id) throw new Error("asset_id_required");
    const prevHistory = [...historyRef.current];
    const prevCurrent = currentAssetRef.current;
    const target = prevHistory.find((item) => item.id === id) || null;
    const imageUrl = String(target?.image_url || "").trim();

    const nextHistory = imageUrl
      ? prevHistory.filter((item) => String(item.image_url || "").trim() !== imageUrl)
      : prevHistory.filter((item) => item.id !== id);

    // Optimistic UI: remove immediately from recent assets.
    setHistory(nextHistory);
    const active = prevCurrent;
    if (active && (active.id === id || (imageUrl && String(active.image_url || "").trim() === imageUrl))) {
      setCurrentAsset(nextHistory[0] ?? null);
    }

    try {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw new Error(sessionError.message);
    const token = sessionData.session?.access_token;
    if (!token) throw new Error("missing_user_session");

    const { data, error } = await supabase.functions.invoke("tgis-delete-asset", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: { assetId: id },
    });
    if (error || data?.success === false) {
      throw new Error(String(error?.message || data?.error || "delete_asset_failed"));
    }
    } catch (e) {
      // Rollback optimistic update on failure.
      setHistory(prevHistory);
      setCurrentAsset(prevCurrent ?? null);
      throw e;
    }
  }, [setCurrentAsset]);

  const value = useMemo<ThumbToolsContextValue>(() => ({
    loadingHistory,
    currentAsset,
    history,
    setCurrentAsset,
    refreshHistory,
    registerAsset,
    deleteAsset,
  }), [loadingHistory, currentAsset, history, setCurrentAsset, refreshHistory, registerAsset, deleteAsset]);

  return (
    <ThumbToolsContext.Provider value={value}>
      {children}
    </ThumbToolsContext.Provider>
  );
}

export function useThumbTools() {
  const ctx = useContext(ThumbToolsContext);
  if (!ctx) throw new Error("useThumbTools must be used within ThumbToolsProvider");
  return ctx;
}
