import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Search,
  Loader2,
  Users,
  Play,
  Clock,
  Star,
  ThumbsUp,
  BarChart3,
  Eye,
  Trophy,
  Activity,
  Sparkles,
  Calendar,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  BarChart,
  Bar,
  Legend,
} from "recharts";

type ScaleMode = "absolute" | "normalized";
const DISCOVERY_SURFACE = "CreativeDiscoverySurface_Frontend";

function asNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fmtVal(v: number, locale: string): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return Math.round(v).toLocaleString(locale);
}

function sumMetric(metrics: any, key: string): number {
  if (!metrics?.[key]) return 0;
  return (metrics[key] as any[]).reduce((acc, m) => acc + asNum(m?.value), 0);
}

function maxMetric(metrics: any, key: string): number {
  if (!metrics?.[key]) return 0;
  return Math.max(0, ...(metrics[key] as any[]).map((m) => asNum(m?.value)));
}

function dailySeries(
  metrics: any,
  key: string,
  locale: string,
): Array<{ dateKey: string; label: string; value: number }> {
  if (!metrics?.[key]) return [];
  return (metrics[key] as any[])
    .filter((m) => m?.timestamp != null && m?.value != null)
    .map((m) => {
      const d = new Date(String(m.timestamp));
      const dateKey = Number.isNaN(d.getTime())
        ? String(m.timestamp).slice(0, 10)
        : d.toISOString().slice(0, 10);
      return {
        dateKey,
        label: Number.isNaN(d.getTime())
          ? dateKey
          : d.toLocaleDateString(locale, { day: "2-digit", month: "2-digit" }),
        value: asNum(m.value),
      };
    })
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

function retentionSeries(
  metrics: any,
  locale: string,
): Array<{ dateKey: string; label: string; d1: number; d7: number }> {
  if (!metrics?.retention) return [];
  return (metrics.retention as any[])
    .filter((r) => r?.timestamp)
    .map((r) => {
      const d = new Date(String(r.timestamp));
      const dateKey = Number.isNaN(d.getTime())
        ? String(r.timestamp).slice(0, 10)
        : d.toISOString().slice(0, 10);
      return {
        dateKey,
        label: Number.isNaN(d.getTime())
          ? dateKey
          : d.toLocaleDateString(locale, { day: "2-digit", month: "2-digit" }),
        d1: asNum(r.d1),
        d7: asNum(r.d7),
      };
    })
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

function mergeSeries(
  a: Array<{ dateKey: string; label: string; value: number }>,
  b: Array<{ dateKey: string; label: string; value: number }>,
  scale: ScaleMode,
): Array<{ label: string; a: number; b: number }> {
  const map = new Map<string, { label: string; a: number; b: number }>();
  for (const x of a) map.set(x.dateKey, { label: x.label, a: x.value, b: 0 });
  for (const y of b) {
    const ex = map.get(y.dateKey);
    if (ex) ex.b = y.value;
    else map.set(y.dateKey, { label: y.label, a: 0, b: y.value });
  }

  let rows = Array.from(map.entries())
    .sort((x, y) => x[0].localeCompare(y[0]))
    .map(([, v]) => v);

  if (scale === "normalized") {
    const maxA = Math.max(0, ...rows.map((r) => r.a));
    const maxB = Math.max(0, ...rows.map((r) => r.b));
    rows = rows.map((r) => ({
      label: r.label,
      a: maxA > 0 ? (r.a / maxA) * 100 : 0,
      b: maxB > 0 ? (r.b / maxB) * 100 : 0,
    }));
  }

  return rows;
}

function hashText(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  return (h >>> 0).toString(16);
}

function extractImageUrl(value: any): string | null {
  if (!value) return null;
  if (typeof value === "string" && /^https?:\/\//i.test(value)) return value;
  if (typeof value !== "object") return null;

  const keys = [
    "image_url",
    "imageUrl",
    "thumb_url",
    "thumbUrl",
    "thumbnail_url",
    "thumbnailUrl",
    "url",
  ];
  for (const k of keys) {
    const v = value?.[k];
    if (typeof v === "string" && /^https?:\/\//i.test(v)) return v;
  }

  for (const v of Object.values(value)) {
    if (typeof v === "string" && /^https?:\/\//i.test(v)) return v;
  }
  return null;
}

function extractUpdatedAt(value: any): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value !== "object") return null;
  return String(value.updated || value.updated_at || "");
}

function extractVersion(value: any): string | null {
  if (!value || typeof value !== "object") return null;
  return String(
    value.version ||
      value.version_number ||
      value.release_version ||
      value.releaseVersion ||
      "",
  );
}

function prettyJson(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function eventTypeLabel(type: string | null | undefined): string {
  const t = String(type || "");
  if (t === "epic_updated") return "Island Update";
  if (t === "thumb_changed") return "Thumb Change";
  if (t === "title_changed") return "Title Change";
  if (t === "version_changed") return "Version Change";
  if (t === "moderation_changed") return "Moderation Change";
  if (t === "link_state_changed") return "State Change";
  if (t === "published_at_changed") return "Published Date Change";
  return t || "Unknown";
}

function getIslandCardImage(data: any): string | null {
  return (
    extractImageUrl(data?.metadata?.imageUrl) ||
    extractImageUrl(data?.internalCard?.imageUrl) ||
    extractImageUrl(data?.internalCard?.thumbUrl) ||
    extractImageUrl(data?.internalCard?.thumbnailUrl) ||
    null
  );
}

function calcTotals(data: any) {
  return {
    unique: sumMetric(data?.dailyMetrics, "uniquePlayers"),
    plays: sumMetric(data?.dailyMetrics, "plays"),
    minutes: sumMetric(data?.dailyMetrics, "minutesPlayed"),
    peak: maxMetric(data?.dailyMetrics, "peakCCU"),
    favorites: sumMetric(data?.dailyMetrics, "favorites"),
    recommends: sumMetric(data?.dailyMetrics, "recommendations"),
  };
}

function buildLookupSummary(payload: any) {
  const daily = payload?.dailyMetrics;
  const events = payload?.eventsV2?.meaningful || payload?.metadataEvents || [];
  const sum = (key: string) => {
    if (!daily?.[key]) return 0;
    return (daily[key] as any[]).reduce((acc, row) => acc + asNum(row?.value), 0);
  };
  const peak = () => {
    if (!daily?.peakCCU) return 0;
    return Math.max(0, ...(daily.peakCCU as any[]).map((row) => asNum(row?.value)));
  };

  return {
    code: payload?.metadata?.code || null,
    title: payload?.metadata?.title || null,
    creator: payload?.metadata?.creatorCode || null,
    category: payload?.metadata?.category || null,
    tags: payload?.metadata?.tags || [],
    unique7d: sum("uniquePlayers"),
    plays7d: sum("plays"),
    minutes7d: sum("minutesPlayed"),
    peakCcu7d: peak(),
    favorites7d: sum("favorites"),
    recommends7d: sum("recommendations"),
    discovery: payload?.discoverySignalsV2?.summary || null,
    weeklyTail: (payload?.weeklyPerformance || []).slice(-6),
    competitorsRank: payload?.competitorsV2?.primaryIslandRank || null,
    latestEventTs: events?.[0]?.ts || null,
  };
}

function metricDelta(a: number, b: number) {
  const delta = a - b;
  const pct = b > 0 ? (delta / b) * 100 : null;
  return { delta, pct };
}

function formatCohortRule(rule: unknown): string {
  const r = String(rule || "").trim();
  if (r === "category_plus_tag_overlap") return "category + tag overlap";
  if (r === "category_only_fallback") return "category only (fallback)";
  if (r === "category_only") return "category only";
  return r || "-";
}

const ISLAND_CODE_RE = /^\d{4}-\d{4}-\d{4}$/;

function toRecentTitle(raw: unknown, fallback: string): string {
  const value = String(raw || "").trim();
  if (!value) return fallback;
  if (ISLAND_CODE_RE.test(value)) return fallback;
  return value;
}

export default function IslandLookup() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "pt-BR" ? "pt-BR" : "en-US";
  const { toast } = useToast();

  const [code, setCode] = useState("");
  const [compareCode, setCompareCode] = useState("");
  const [data, setData] = useState<any | null>(null);
  const [compareData, setCompareData] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadingVisible, setLoadingVisible] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [scaleMode, setScaleMode] = useState<ScaleMode>("absolute");
  const [activeTab, setActiveTab] = useState("overview");

  const [aiData, setAiData] = useState<any | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const aiRequestRunRef = useRef(0);
  const [recentLookups, setRecentLookups] = useState<any[]>([]);
  const [imagePreview, setImagePreview] = useState<{
    open: boolean;
    url: string | null;
    title: string;
  }>({
    open: false,
    url: null,
    title: "Thumbnail",
  });

  const loadRecentLookups = async () => {
    setInitialLoading(true);
    try {
      const res = await supabase.functions.invoke("discover-island-lookup", {
        body: { mode: "recent" },
      });
      if (res.error) return;
      setRecentLookups(Array.isArray(res.data?.recentLookups) ? res.data.recentLookups : []);
    } catch {
      // best-effort only
    } finally {
      setInitialLoading(false);
    }
  };

  useEffect(() => {
    void loadRecentLookups();
  }, []);

  const busy = loading || initialLoading;

  useEffect(() => {
    let intervalId: number | undefined;
    let hideTimeoutId: number | undefined;

    if (busy) {
      setLoadingVisible(true);
      setLoadingProgress((prev) => (prev >= 5 ? prev : 5));
      intervalId = window.setInterval(() => {
        setLoadingProgress((prev) => {
          if (prev >= 92) return prev;
          const step = Math.max(1, Math.round((100 - prev) / 18));
          return Math.min(92, prev + step);
        });
      }, 120);
    } else {
      setLoadingProgress(100);
      hideTimeoutId = window.setTimeout(() => {
        setLoadingVisible(false);
        setLoadingProgress(0);
      }, 280);
    }

    return () => {
      if (intervalId != null) window.clearInterval(intervalId);
      if (hideTimeoutId != null) window.clearTimeout(hideTimeoutId);
    };
  }, [busy]);

  const fetchIsland = async (
    islandCode: string,
    compareIslandCode?: string,
  ) => {
    const res = await supabase.functions.invoke("discover-island-lookup", {
      body: { islandCode, compareCode: compareIslandCode || null },
    });
    if (res.error) throw res.error;
    if (res.data?.error) throw new Error(String(res.data.error));
    return res.data;
  };

  const fetchLookupAi = async (main: any, compare: any | null) => {
    const runId = ++aiRequestRunRef.current;
    setAiLoading(true);
    setAiData(null);
    setAiError(null);
    try {
      const primarySummary = buildLookupSummary(main);
      const compareSummary = compare ? buildLookupSummary(compare) : null;
      const payloadFingerprint = hashText(
        JSON.stringify({
          version: "lookup_ai_v2",
          primary: main?.metadata?.code,
          compare: compare?.metadata?.code || null,
          pUnique: sumMetric(main?.dailyMetrics, "uniquePlayers"),
          pPlays: sumMetric(main?.dailyMetrics, "plays"),
          cUnique: sumMetric(compare?.dailyMetrics, "uniquePlayers"),
          cPlays: sumMetric(compare?.dailyMetrics, "plays"),
        }),
      );

      const res = await supabase.functions.invoke("discover-island-lookup-ai", {
        body: {
          primaryCode: main?.metadata?.code,
          compareCode: compare?.metadata?.code || null,
          locale: i18n.language,
          windowDays: 7,
          includeRecent: false,
          primarySummary,
          compareSummary,
          payloadFingerprint,
        },
      });
      if (res.error) throw res.error;
      if (res.data?.error) throw new Error(String(res.data.error));
      if (runId !== aiRequestRunRef.current) return;

      setAiData(res.data);

      const shouldPollEnrichment =
        String(res.data?.phase || "").trim() !== "enriched" &&
        Boolean(res.data?.enriching);

      setAiLoading(false);

      if (shouldPollEnrichment) {
        const pollAttempts = 8;
        for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 2000));
          if (runId !== aiRequestRunRef.current) return;

          const poll = await supabase.functions.invoke("discover-island-lookup-ai", {
            body: {
              primaryCode: main?.metadata?.code,
              compareCode: compare?.metadata?.code || null,
              locale: i18n.language,
              windowDays: 7,
              includeRecent: false,
              primarySummary,
              compareSummary,
              payloadFingerprint,
            },
          });

          if (poll.error || poll.data?.error) continue;
          if (runId !== aiRequestRunRef.current) return;

          setAiData(poll.data);

          const enriched = String(poll.data?.phase || "").trim() === "enriched";
          const stillEnriching = Boolean(poll.data?.enriching);
          if (enriched || !stillEnriching) break;
        }
      }
    } catch (e: any) {
      if (runId !== aiRequestRunRef.current) return;
      const message =
        e?.context?.message ||
        e?.context?.error ||
        e?.message ||
        "AI lookup insights unavailable";
      setAiError(message);
    } finally {
      if (runId === aiRequestRunRef.current) {
        setAiLoading(false);
      }
    }
  };

  const runLookup = async (mainCode: string, cmp: string) => {
    if (!mainCode) return;

    setLoading(true);
    setData(null);
    setCompareData(null);
    aiRequestRunRef.current += 1;
    setAiData(null);
    setAiError(null);

    try {
      const main = await fetchIsland(mainCode, cmp || undefined);
      let second = null;
      if (Array.isArray(main?.recentLookups)) {
        setRecentLookups(main.recentLookups);
      }

      if (cmp) {
        try {
          second = await fetchIsland(cmp, mainCode);
        } catch (err: any) {
          toast({
            title: t("common.error"),
            description: err?.message || "Compare island not found",
            variant: "destructive",
          });
        }
      }

      setData(main);
      setCompareData(second);
      void fetchLookupAi(main, second);
    } catch (err: any) {
      toast({
        title: t("common.error"),
        description: err?.message || t("islandLookup.islandNotFound"),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async (e: FormEvent) => {
    e.preventDefault();
    await runLookup(code.trim(), compareCode.trim());
  };

  const handleRecentLookupClick = async (item: any) => {
    const mainCode = String(item?.primaryCode || "").trim();
    const cmp = String(item?.compareCode || "").trim();
    if (!mainCode) return;
    setCode(mainCode);
    setCompareCode(cmp);
    await runLookup(mainCode, cmp);
  };

  useEffect(() => {
    return () => {
      aiRequestRunRef.current += 1;
    };
  }, []);

  const openImagePreview = (url: string | null, title = "Thumbnail") => {
    if (!url) return;
    setImagePreview({
      open: true,
      url,
      title,
    });
  };

  const compareMode = Boolean(compareData);
  const mainLabel = data?.metadata?.title || data?.metadata?.code || "Island A";
  const compareLabel =
    compareData?.metadata?.title || compareData?.metadata?.code || "Island B";
  const mainImage = getIslandCardImage(data);
  const compareImage = getIslandCardImage(compareData);

  const mainTotals = useMemo(() => calcTotals(data), [data]);
  const compareTotals = useMemo(() => calcTotals(compareData), [compareData]);

  const uniqueOverlay = useMemo(
    () =>
      mergeSeries(
        dailySeries(data?.dailyMetrics, "uniquePlayers", locale),
        dailySeries(compareData?.dailyMetrics, "uniquePlayers", locale),
        scaleMode,
      ),
    [data, compareData, locale, scaleMode],
  );

  const playsOverlay = useMemo(
    () =>
      mergeSeries(
        dailySeries(data?.dailyMetrics, "plays", locale),
        dailySeries(compareData?.dailyMetrics, "plays", locale),
        scaleMode,
      ),
    [data, compareData, locale, scaleMode],
  );

  const ccuOverlay = useMemo(
    () =>
      mergeSeries(
        dailySeries(data?.dailyMetrics, "peakCCU", locale),
        dailySeries(compareData?.dailyMetrics, "peakCCU", locale),
        scaleMode,
      ),
    [data, compareData, locale, scaleMode],
  );

  const avgMinOverlay = useMemo(
    () =>
      mergeSeries(
        dailySeries(data?.dailyMetrics, "averageMinutesPerPlayer", locale),
        dailySeries(
          compareData?.dailyMetrics,
          "averageMinutesPerPlayer",
          locale,
        ),
        scaleMode,
      ),
    [data, compareData, locale, scaleMode],
  );

  const retentionOverlay = useMemo(() => {
    const a = retentionSeries(data?.dailyMetrics, locale);
    const b = retentionSeries(compareData?.dailyMetrics, locale);
    const map = new Map<
      string,
      { label: string; d1a: number; d7a: number; d1b: number; d7b: number }
    >();
    for (const x of a)
      map.set(x.dateKey, {
        label: x.label,
        d1a: x.d1,
        d7a: x.d7,
        d1b: 0,
        d7b: 0,
      });
    for (const y of b) {
      const ex = map.get(y.dateKey);
      if (ex) {
        ex.d1b = y.d1;
        ex.d7b = y.d7;
      } else {
        map.set(y.dateKey, {
          label: y.label,
          d1a: 0,
          d7a: 0,
          d1b: y.d1,
          d7b: y.d7,
        });
      }
    }
    return Array.from(map.entries())
      .sort((x, y) => x[0].localeCompare(y[0]))
      .map(([, v]) => v);
  }, [data, compareData, locale]);

  const discoveryPanelsMain = useMemo(() => {
    if (!data) return [] as any[];
    if (data.discoverySignalsV2?.panelsTop?.length)
      return data.discoverySignalsV2.panelsTop;
    const legacy = data.discoverySignals?.panelsTop || [];
    return legacy
      .filter((p: any) => p.surfaceName === DISCOVERY_SURFACE)
      .map((p: any) => ({
        panelNameRaw: p.panelName,
        panelDisplayName: String(p.panelName || "").replace(/_/g, " "),
        minutesExposed: asNum(p.minutesExposed),
        bestRank: p.bestRank,
        avgRank: p.avgRank,
        daysActive: asNum(p.daysActive),
      }));
  }, [data]);

  const discoveryPanelsCompare = useMemo(() => {
    if (!compareData) return [] as any[];
    if (compareData.discoverySignalsV2?.panelsTop?.length)
      return compareData.discoverySignalsV2.panelsTop;
    const legacy = compareData.discoverySignals?.panelsTop || [];
    return legacy
      .filter((p: any) => p.surfaceName === DISCOVERY_SURFACE)
      .map((p: any) => ({
        panelNameRaw: p.panelName,
        panelDisplayName: String(p.panelName || "").replace(/_/g, " "),
        minutesExposed: asNum(p.minutesExposed),
        bestRank: p.bestRank,
        avgRank: p.avgRank,
        daysActive: asNum(p.daysActive),
      }));
  }, [compareData]);

  const discoveryPanelsMerged = useMemo(() => {
    const map = new Map<string, { name: string; main?: any; compare?: any }>();
    for (const p of discoveryPanelsMain)
      map.set(p.panelNameRaw, { name: p.panelDisplayName, main: p });
    for (const p of discoveryPanelsCompare) {
      const ex = map.get(p.panelNameRaw);
      if (ex) ex.compare = p;
      else map.set(p.panelNameRaw, { name: p.panelDisplayName, compare: p });
    }
    return Array.from(map.entries())
      .map(([raw, v]) => ({ raw, ...v }))
      .sort(
        (a, b) =>
          (b.main?.minutesExposed || 0) +
          (b.compare?.minutesExposed || 0) -
          ((a.main?.minutesExposed || 0) + (a.compare?.minutesExposed || 0)),
      );
  }, [discoveryPanelsMain, discoveryPanelsCompare]);

  const discoveryDailyOverlay = useMemo(() => {
    const toSeries = (obj: any) => {
      const rows =
        obj?.discoverySignalsV2?.dailyMinutes ||
        obj?.discoverySignals?.dailyMinutes ||
        [];
      return (rows as any[]).map((r) => ({
        dateKey: String(r.date),
        label: String(r.date).slice(5),
        value: asNum(r.minutesExposed),
      }));
    };
    return mergeSeries(toSeries(data), toSeries(compareData), scaleMode);
  }, [data, compareData, scaleMode]);

  const weeklyOverlay = useMemo(() => {
    const mk = (r: any) => `${r.year ?? "na"}-W${r.weekNumber ?? "na"}`;
    const map = new Map<string, { label: string; a: number; b: number }>();
    for (const r of data?.weeklyPerformance || []) {
      map.set(mk(r), {
        label: `W${r.weekNumber ?? "?"}/${r.year ?? "?"}`,
        a: asNum(r.weekUnique),
        b: 0,
      });
    }
    for (const r of compareData?.weeklyPerformance || []) {
      const ex = map.get(mk(r));
      if (ex) ex.b = asNum(r.weekUnique);
      else
        map.set(mk(r), {
          label: `W${r.weekNumber ?? "?"}/${r.year ?? "?"}`,
          a: 0,
          b: asNum(r.weekUnique),
        });
    }
    return Array.from(map.entries())
      .sort((x, y) => x[0].localeCompare(y[0]))
      .map(([, v]) => v);
  }, [data, compareData]);

  const mainEvents = useMemo(
    () => data?.eventsV2?.meaningful || data?.metadataEvents || [],
    [data],
  );
  const compareEvents = useMemo(
    () =>
      compareData?.eventsV2?.meaningful || compareData?.metadataEvents || [],
    [compareData],
  );

  const aiSectionText = useMemo(() => {
    if (!aiData?.sections) return null;
    if (activeTab === "overview") return aiData.sections.overview;
    if (activeTab === "discovery") return aiData.sections.discovery;
    if (activeTab === "history") return aiData.sections.history;
    if (activeTab === "competitors") return aiData.sections.competitors;
    if (activeTab === "events") return aiData.sections.events;
    return null;
  }, [aiData, activeTab]);

  const formatTooltipValue = (
    value: number,
    valueMode: "number" | "percent",
  ) => {
    if (valueMode === "percent") return `${asNum(value).toFixed(2)}%`;
    return fmtVal(asNum(value), locale);
  };

  const renderMetricTooltip =
    (metricLabel: string, valueMode: "number" | "percent" = "number") =>
    ({ active, payload, label }: any) => {
      if (!active || !Array.isArray(payload) || payload.length === 0) return null;

      const rows = payload.filter(
        (p: any) => p && p.value != null && Number.isFinite(Number(p.value)),
      );
      if (rows.length === 0) return null;

      return (
        <div className="rounded-md border border-border/60 bg-black/90 px-3 py-2 text-xs shadow-xl min-w-[220px]">
          <div className="font-medium text-white">{metricLabel}</div>
          {label != null && (
            <div className="text-[11px] text-zinc-300 mb-1.5">{String(label)}</div>
          )}
          <div className="space-y-1">
            {rows.map((entry: any, idx: number) => {
              const color = String(entry.color || "#94a3b8");
              const seriesName = String(entry.name || entry.dataKey || `serie_${idx + 1}`);
              return (
                <div key={`${seriesName}-${idx}`} className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                    <span className="truncate text-zinc-100">{seriesName}</span>
                  </div>
                  <span className="font-mono text-zinc-100">
                    {formatTooltipValue(asNum(entry.value), valueMode)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      );
    };

  const kpiRows = [
    { key: "unique", label: t("kpis.uniquePlayers"), icon: Users },
    { key: "plays", label: t("kpis.totalPlays"), icon: Play },
    { key: "minutes", label: t("kpis.minutesPlayed"), icon: Clock },
    { key: "peak", label: t("kpis.peakCCU"), icon: BarChart3 },
    { key: "favorites", label: t("kpis.favorites"), icon: Star },
    { key: "recommends", label: t("kpis.recommendations"), icon: ThumbsUp },
  ] as const;

  const renderEventList = (events: any[], islandCode: string) => (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{islandCode}</CardTitle>
      </CardHeader>
      <CardContent>
        {events.length > 0 ? (
          <div className="space-y-2 max-h-[460px] overflow-y-auto">
            {events.map((ev: any, i: number) => {
              const type = String(ev.eventType || "");
              const oldImg = extractImageUrl(ev.oldValue);
              const newImg = extractImageUrl(ev.newValue);
              const oldUpdateTs = extractUpdatedAt(ev.oldValue);
              const newUpdateTs = extractUpdatedAt(ev.newValue);
              const oldVersion = extractVersion(ev.oldValue);
              const newVersion = extractVersion(ev.newValue);

              return (
                <div
                  key={`${ev.ts || i}-${i}`}
                  className="rounded-lg border p-3 text-xs space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant="outline" className="text-[10px]">
                      {eventTypeLabel(type)}
                    </Badge>
                    <span className="text-muted-foreground">
                      {ev.ts ? new Date(ev.ts).toLocaleString(locale) : "-"}
                    </span>
                  </div>

                  {type === "epic_updated" ? (
                    <div className="space-y-1">
                      <p>
                        <span className="text-muted-foreground">
                          Updated at:
                        </span>{" "}
                        {oldUpdateTs
                          ? new Date(oldUpdateTs).toLocaleString(locale)
                          : "-"}{" "}
                        {" -> "}
                        {newUpdateTs
                          ? new Date(newUpdateTs).toLocaleString(locale)
                          : "-"}
                      </p>
                      {(oldVersion || newVersion) && (
                        <p>
                          <span className="text-muted-foreground">
                            Version:
                          </span>{" "}
                          {oldVersion || "-"} {" -> "} {newVersion || "-"}
                        </p>
                      )}
                    </div>
                  ) : null}

                  {type === "thumb_changed" && (oldImg || newImg) ? (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <p className="text-muted-foreground">Before</p>
                        {oldImg ? (
                          <button
                            type="button"
                            className="w-full"
                            onClick={() => openImagePreview(oldImg, "Old thumbnail")}
                          >
                            <img
                              src={oldImg}
                              alt="Old thumbnail"
                              className="w-full h-24 object-cover rounded border cursor-zoom-in"
                            />
                          </button>
                        ) : (
                          <div className="w-full h-24 rounded border flex items-center justify-center text-muted-foreground">
                            No image
                          </div>
                        )}
                      </div>
                      <div className="space-y-1">
                        <p className="text-muted-foreground">After</p>
                        {newImg ? (
                          <button
                            type="button"
                            className="w-full"
                            onClick={() => openImagePreview(newImg, "New thumbnail")}
                          >
                            <img
                              src={newImg}
                              alt="New thumbnail"
                              className="w-full h-24 object-cover rounded border cursor-zoom-in"
                            />
                          </button>
                        ) : (
                          <div className="w-full h-24 rounded border flex items-center justify-center text-muted-foreground">
                            No image
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <>
                      {type !== "epic_updated" && ev.oldValue != null && (
                        <p className="text-muted-foreground">
                          From: {prettyJson(ev.oldValue)}
                        </p>
                      )}
                      {type !== "epic_updated" && ev.newValue != null && (
                        <p>To: {prettyJson(ev.newValue)}</p>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Sem atualizações relevantes.</p>
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="font-display text-2xl font-bold flex items-center gap-2">
          <Search className="h-6 w-6 text-primary" />
          Island Lookup Pro
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t("islandLookup.subtitle")}
        </p>
      </div>

      <form onSubmit={handleSearch} className="flex flex-wrap gap-3 mb-6">
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder={t("islandLookup.placeholder")}
          className="flex-1 min-w-[220px]"
        />
        <Input
          value={compareCode}
          onChange={(e) => setCompareCode(e.target.value)}
          placeholder={t("islandLookup.comparePlaceholder")}
          className="flex-1 min-w-[220px]"
        />
        <Button type="submit" disabled={loading}>
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Search className="h-4 w-4 mr-1" />
          )}
          Buscar
        </Button>
      </form>

      {!loading && !data && recentLookups.length > 0 && (
        <Card className="mb-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Ultimos 3 lookups</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            {recentLookups.map((item, idx) => {
              const primaryCode = String(item?.primaryCode || "").trim();
              const compareCodeValue = String(item?.compareCode || "").trim();
              const primaryTitle = toRecentTitle(item?.primaryTitle, "Lookup anterior");
              const compareTitle = compareCodeValue
                ? toRecentTitle(item?.compareTitle, "Comparativo")
                : "";
              const primaryImage = String(item?.primaryImageUrl || "").trim();
              return (
                <Button
                  key={`${primaryCode}-${compareCodeValue}-${idx}`}
                  type="button"
                  variant="outline"
                  className="w-full justify-start h-auto py-2 px-3"
                  title={compareCodeValue ? `${primaryTitle} vs ${compareTitle}` : primaryTitle}
                  onClick={() => void handleRecentLookupClick(item)}
                >
                  <div className="flex items-center gap-3 min-w-0 w-full">
                    <div
                      className="w-12 h-8 rounded border overflow-hidden bg-muted/30 flex-shrink-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        openImagePreview(primaryImage || null, primaryTitle);
                      }}
                    >
                      {primaryImage ? (
                        <img
                          src={primaryImage}
                          alt={primaryTitle}
                          className="w-full h-full object-cover cursor-zoom-in"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-[10px] text-muted-foreground">
                          no thumb
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 text-left">
                      <div className="truncate font-medium">{primaryTitle}</div>
                      {compareCodeValue ? (
                        <div className="truncate text-xs text-muted-foreground">
                          vs {compareTitle}
                        </div>
                      ) : (
                        <div className="truncate text-xs text-muted-foreground">
                          lookup simples
                        </div>
                      )}
                    </div>
                  </div>
                </Button>
              );
            })}
          </CardContent>
        </Card>
      )}

      {loading && <div className="py-20" />}

      {!loading && data && (
        <div className="space-y-6 animate-fade-in">
          <div
            className={
              compareMode ? "grid md:grid-cols-2 gap-4" : "grid grid-cols-1"
            }
          >
            <Card>
              <CardContent className="pt-5">
                <div className="flex gap-3">
                  <button
                    type="button"
                    className="w-[112px] h-[72px] rounded border overflow-hidden bg-muted/30 flex-shrink-0"
                    onClick={() => openImagePreview(mainImage, mainLabel)}
                  >
                    {mainImage ? (
                      <img
                        src={mainImage}
                        alt={mainLabel}
                        className="w-full h-full object-cover cursor-zoom-in"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">
                        No thumb
                      </div>
                    )}
                  </button>
                  <div className="min-w-0">
                    <h2 className="font-display text-lg font-bold truncate">
                      {mainLabel}
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      {data.metadata.code} {" | "}@{data.metadata.creatorCode || "-"}
                    </p>
                    <div className="flex gap-2 mt-2 flex-wrap">
                      {data.metadata.category && (
                        <Badge variant="secondary">
                          {data.metadata.category}
                        </Badge>
                      )}
                      {(data.metadata.tags || []).map((tag: string) => (
                        <Badge
                          key={`main-${tag}`}
                          variant="outline"
                          className="text-xs"
                        >
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {compareMode && compareData && (
              <Card>
                <CardContent className="pt-5">
                  <div className="flex gap-3">
                    <button
                      type="button"
                      className="w-[112px] h-[72px] rounded border overflow-hidden bg-muted/30 flex-shrink-0"
                      onClick={() => openImagePreview(compareImage, compareLabel)}
                    >
                      {compareImage ? (
                        <img
                          src={compareImage}
                          alt={compareLabel}
                          className="w-full h-full object-cover cursor-zoom-in"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">
                          No thumb
                        </div>
                      )}
                    </button>
                    <div className="min-w-0">
                      <h3 className="font-display text-lg font-bold truncate">
                        {compareLabel}
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        {compareData.metadata.code} {" | "}@
                        {compareData.metadata.creatorCode || "-"}
                      </p>
                      <div className="flex gap-2 mt-2 flex-wrap">
                        {compareData.metadata.category && (
                          <Badge variant="secondary">
                            {compareData.metadata.category}
                          </Badge>
                        )}
                        {(compareData.metadata.tags || []).map(
                          (tag: string) => (
                            <Badge
                              key={`cmp-${tag}`}
                              variant="outline"
                              className="text-xs"
                            >
                              {tag}
                            </Badge>
                          ),
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                {t("islandLookup.aiInsightsTitle")}
                {aiData?.cacheHit && <Badge variant="outline">cache</Badge>}
                {aiData?.phase === "baseline" && <Badge variant="secondary">baseline</Badge>}
                {aiData?.phase === "enriched" && <Badge variant="outline">enriched</Badge>}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {aiLoading && (
                <div className="text-sm text-muted-foreground flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t("islandLookup.aiLoading")}
                </div>
              )}
              {!aiLoading && aiError && (
                <p className="text-sm text-muted-foreground">{aiError}</p>
              )}
              {!aiLoading && aiData && (
                <>
                  {aiData?.phase === "baseline" && aiData?.enriching && (
                    <div className="text-xs text-muted-foreground flex items-center gap-2">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Enriquecendo insights com IA...
                    </div>
                  )}
                  <p className="text-sm">{aiData.summaryGlobal}</p>
                  {aiSectionText && (
                    <p className="text-sm text-muted-foreground">
                      {aiSectionText}
                    </p>
                  )}
                  {(aiData.actionsTop3 || []).map((x: string, i: number) => (
                    <p key={`${i}-${x}`} className="text-sm">
                      {i + 1}. {x}
                    </p>
                  ))}
                </>
              )}
            </CardContent>
          </Card>

          <Tabs
            value={activeTab}
            onValueChange={setActiveTab}
            className="w-full"
          >
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="discovery">Discovery</TabsTrigger>
              <TabsTrigger value="history">Historico</TabsTrigger>
              <TabsTrigger value="competitors">Competidores</TabsTrigger>
              <TabsTrigger value="events">Atualizações</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-6">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <p className="text-xs text-muted-foreground">
                  {t("islandLookup.scaleLabel")}
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant={scaleMode === "absolute" ? "default" : "outline"}
                    onClick={() => setScaleMode("absolute")}
                  >
                    {t("islandLookup.scaleAbsolute")}
                  </Button>
                  <Button
                    size="sm"
                    variant={scaleMode === "normalized" ? "default" : "outline"}
                    onClick={() => setScaleMode("normalized")}
                  >
                    {t("islandLookup.scaleNormalized")}
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {kpiRows.map((kpi) => {
                  const Icon = kpi.icon;
                  const aVal = asNum((mainTotals as any)[kpi.key]);
                  const bVal = asNum((compareTotals as any)[kpi.key]);
                  const d = metricDelta(aVal, bVal);
                  return (
                    <Card key={kpi.key}>
                      <CardContent className="pt-4 pb-3">
                        <div className="flex items-center gap-2 mb-2">
                          <Icon className="h-4 w-4 text-primary" />
                          <p className="text-xs text-muted-foreground">
                            {kpi.label}
                          </p>
                        </div>
                        <div className="space-y-1 text-sm">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-muted-foreground truncate">
                              {mainLabel}
                            </span>
                            <span className="font-display font-bold">
                              {fmtVal(aVal, locale)}
                            </span>
                          </div>
                          {compareMode && (
                            <>
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-muted-foreground truncate">
                                  {compareLabel}
                                </span>
                                <span className="font-display font-bold">
                                  {fmtVal(bVal, locale)}
                                </span>
                              </div>
                              <div className="flex items-center justify-between gap-2 pt-1 border-t mt-1">
                                <span className="text-muted-foreground">
                                  Delta
                                </span>
                                <span className="font-mono">
                                  {d.delta > 0 ? "+" : ""}
                                  {fmtVal(d.delta, locale)}
                                  {d.pct != null
                                    ? ` (${d.pct > 0 ? "+" : ""}${d.pct.toFixed(1)}%)`
                                    : ""}
                                </span>
                              </div>
                            </>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              {compareMode && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Comparativo 7d</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b text-muted-foreground">
                            <th className="text-left p-2">Métrica</th>
                            <th className="text-right p-2 truncate max-w-[220px]">
                              {mainLabel}
                            </th>
                            <th className="text-right p-2 truncate max-w-[220px]">
                              {compareLabel}
                            </th>
                            <th className="text-right p-2">Delta</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[
                            { name: "Unique Players", a: mainTotals.unique, b: compareTotals.unique },
                            { name: "Total Plays", a: mainTotals.plays, b: compareTotals.plays },
                            { name: "Minutes Played", a: mainTotals.minutes, b: compareTotals.minutes },
                            { name: "Peak CCU", a: mainTotals.peak, b: compareTotals.peak },
                            { name: "Favorites", a: mainTotals.favorites, b: compareTotals.favorites },
                            { name: "Recommendations", a: mainTotals.recommends, b: compareTotals.recommends },
                          ].map((row) => {
                            const d = metricDelta(row.a, row.b);
                            return (
                              <tr key={row.name} className="border-b last:border-0">
                                <td className="p-2">{row.name}</td>
                                <td className="p-2 text-right font-mono">{fmtVal(row.a, locale)}</td>
                                <td className="p-2 text-right font-mono">{fmtVal(row.b, locale)}</td>
                                <td className="p-2 text-right font-mono">
                                  {d.delta > 0 ? "+" : ""}
                                  {fmtVal(d.delta, locale)}
                                  {d.pct != null ? ` (${d.pct > 0 ? "+" : ""}${d.pct.toFixed(1)}%)` : ""}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              )}

              <div className="grid md:grid-cols-2 gap-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">
                      {t("islandLookup.chartUnique")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={210}>
                      <LineChart data={uniqueOverlay}>
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke="hsl(var(--border))"
                        />
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip
                          cursor={{ stroke: "rgba(255,255,255,0.2)", strokeWidth: 1 }}
                          content={renderMetricTooltip("Unique Players")}
                        />
                        <Legend />
                        <Line
                          type="monotone"
                          dataKey="a"
                          stroke="hsl(252,85%,60%)"
                          strokeWidth={2}
                          name={mainLabel}
                        />
                        {compareMode && (
                          <Line
                            type="monotone"
                            dataKey="b"
                            stroke="hsl(168,70%,45%)"
                            strokeWidth={2}
                            name={compareLabel}
                          />
                        )}
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">
                      {t("islandLookup.chartPlays")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={210}>
                      <LineChart data={playsOverlay}>
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke="hsl(var(--border))"
                        />
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip
                          cursor={{ stroke: "rgba(255,255,255,0.2)", strokeWidth: 1 }}
                          content={renderMetricTooltip("Total Plays")}
                        />
                        <Legend />
                        <Line
                          type="monotone"
                          dataKey="a"
                          stroke="hsl(252,85%,60%)"
                          strokeWidth={2}
                          name={mainLabel}
                        />
                        {compareMode && (
                          <Line
                            type="monotone"
                            dataKey="b"
                            stroke="hsl(168,70%,45%)"
                            strokeWidth={2}
                            name={compareLabel}
                          />
                        )}
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">
                      {t("islandLookup.chartCCU")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={210}>
                      <LineChart data={ccuOverlay}>
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke="hsl(var(--border))"
                        />
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip
                          cursor={{ stroke: "rgba(255,255,255,0.2)", strokeWidth: 1 }}
                          content={renderMetricTooltip("Peak CCU")}
                        />
                        <Legend />
                        <Line
                          type="monotone"
                          dataKey="a"
                          stroke="hsl(252,85%,60%)"
                          strokeWidth={2}
                          name={mainLabel}
                        />
                        {compareMode && (
                          <Line
                            type="monotone"
                            dataKey="b"
                            stroke="hsl(168,70%,45%)"
                            strokeWidth={2}
                            name={compareLabel}
                          />
                        )}
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">
                      {t("islandLookup.chartAvgMin")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={210}>
                      <LineChart data={avgMinOverlay}>
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke="hsl(var(--border))"
                        />
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip
                          cursor={{ stroke: "rgba(255,255,255,0.2)", strokeWidth: 1 }}
                          content={renderMetricTooltip("Avg Minutes / Player")}
                        />
                        <Legend />
                        <Line
                          type="monotone"
                          dataKey="a"
                          stroke="hsl(252,85%,60%)"
                          strokeWidth={2}
                          name={mainLabel}
                        />
                        {compareMode && (
                          <Line
                            type="monotone"
                            dataKey="b"
                            stroke="hsl(168,70%,45%)"
                            strokeWidth={2}
                            name={compareLabel}
                          />
                        )}
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </div>

              {retentionOverlay.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">
                      {t("islandLookup.retentionChart")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={240}>
                      <LineChart data={retentionOverlay}>
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke="hsl(var(--border))"
                        />
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip
                          cursor={{ stroke: "rgba(255,255,255,0.2)", strokeWidth: 1 }}
                          content={renderMetricTooltip("Retention", "percent")}
                        />
                        <Legend />
                        <Line
                          type="monotone"
                          dataKey="d1a"
                          stroke="hsl(252,85%,60%)"
                          strokeWidth={2}
                          name={`D1 ${mainLabel}`}
                        />
                        <Line
                          type="monotone"
                          dataKey="d7a"
                          stroke="hsl(280,60%,55%)"
                          strokeWidth={2}
                          name={`D7 ${mainLabel}`}
                        />
                        {compareMode && (
                          <>
                            <Line
                              type="monotone"
                              dataKey="d1b"
                              stroke="hsl(168,70%,45%)"
                              strokeWidth={2}
                              name={`D1 ${compareLabel}`}
                            />
                            <Line
                              type="monotone"
                              dataKey="d7b"
                              stroke="hsl(38,92%,50%)"
                              strokeWidth={2}
                              name={`D7 ${compareLabel}`}
                            />
                          </>
                        )}
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="discovery" className="space-y-6">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Eye className="h-4 w-4" />
                    Discovery only ({DISCOVERY_SURFACE})
                  </CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">
                    Exposure timeline (minutes)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {discoveryDailyOverlay.length > 0 ? (
                    <ResponsiveContainer width="100%" height={210}>
                      <LineChart data={discoveryDailyOverlay}>
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke="hsl(var(--border))"
                        />
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip
                          cursor={{ stroke: "rgba(255,255,255,0.2)", strokeWidth: 1 }}
                          content={renderMetricTooltip("Discovery Minutes Exposed")}
                        />
                        <Legend />
                        <Line
                          type="monotone"
                          dataKey="a"
                          stroke="hsl(252,85%,60%)"
                          strokeWidth={2}
                          name={mainLabel}
                        />
                        {compareMode && (
                          <Line
                            type="monotone"
                            dataKey="b"
                            stroke="hsl(168,70%,45%)"
                            strokeWidth={2}
                            name={compareLabel}
                          />
                        )}
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No discovery exposure data.
                    </p>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">
                    Panel comparison ({discoveryPanelsMerged.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {discoveryPanelsMerged.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b text-muted-foreground">
                            <th className="text-left p-2">Panel</th>
                            <th className="text-right p-2">A Min</th>
                            <th className="text-right p-2">B Min</th>
                            <th className="text-right p-2">Delta</th>
                            <th className="text-right p-2">A Best</th>
                            <th className="text-right p-2">B Best</th>
                            <th className="text-right p-2">A Avg</th>
                            <th className="text-right p-2">B Avg</th>
                            <th className="text-right p-2">A Days</th>
                            <th className="text-right p-2">B Days</th>
                          </tr>
                        </thead>
                        <tbody>
                          {discoveryPanelsMerged.map((r) => {
                            const a = asNum(r.main?.minutesExposed);
                            const b = asNum(r.compare?.minutesExposed);
                            return (
                              <tr
                                key={r.raw}
                                className="border-b last:border-0"
                              >
                                <td className="p-2">
                                  <div className="font-medium">{r.name}</div>
                                  <div className="text-muted-foreground">
                                    {r.raw}
                                  </div>
                                </td>
                                <td className="p-2 text-right font-mono">
                                  {fmtVal(a, locale)}
                                </td>
                                <td className="p-2 text-right font-mono">
                                  {fmtVal(b, locale)}
                                </td>
                                <td className="p-2 text-right font-mono">
                                  {a - b > 0 ? "+" : ""}
                                  {fmtVal(a - b, locale)}
                                </td>
                                <td className="p-2 text-right">
                                  {r.main?.bestRank ?? "-"}
                                </td>
                                <td className="p-2 text-right">
                                  {r.compare?.bestRank ?? "-"}
                                </td>
                                <td className="p-2 text-right">
                                  {r.main?.avgRank ?? "-"}
                                </td>
                                <td className="p-2 text-right">
                                  {r.compare?.avgRank ?? "-"}
                                </td>
                                <td className="p-2 text-right">
                                  {r.main?.daysActive ?? 0}
                                </td>
                                <td className="p-2 text-right">
                                  {r.compare?.daysActive ?? 0}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No panel data.
                    </p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="history" className="space-y-6">
              {weeklyOverlay.length > 0 ? (
                <>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Calendar className="h-4 w-4" />
                        Weekly Unique overlay
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ResponsiveContainer width="100%" height={220}>
                        <BarChart data={weeklyOverlay}>
                          <CartesianGrid
                            strokeDasharray="3 3"
                            stroke="hsl(var(--border))"
                          />
                          <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                          <YAxis tick={{ fontSize: 10 }} />
                          <Tooltip
                            cursor={{ fill: "rgba(255,255,255,0.08)" }}
                            content={renderMetricTooltip("Weekly Unique Players")}
                          />
                          <Legend />
                          <Bar
                            dataKey="a"
                            fill="hsl(252,85%,60%)"
                            name={mainLabel}
                            radius={[4, 4, 0, 0]}
                          />
                          {compareMode && (
                            <Bar
                              dataKey="b"
                              fill="hsl(168,70%,45%)"
                              name={compareLabel}
                              radius={[4, 4, 0, 0]}
                            />
                          )}
                        </BarChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4">
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b text-muted-foreground">
                              <th className="text-left p-2">Week</th>
                              <th className="text-right p-2">{mainLabel}</th>
                              <th className="text-right p-2">{compareLabel}</th>
                              <th className="text-right p-2">Delta</th>
                            </tr>
                          </thead>
                          <tbody>
                            {weeklyOverlay.map((r, i) => (
                              <tr
                                key={`${r.label}-${i}`}
                                className="border-b last:border-0"
                              >
                                <td className="p-2">{r.label}</td>
                                <td className="p-2 text-right font-mono">
                                  {fmtVal(r.a, locale)}
                                </td>
                                <td className="p-2 text-right font-mono">
                                  {fmtVal(r.b, locale)}
                                </td>
                                <td className="p-2 text-right font-mono">
                                  {r.a - r.b > 0 ? "+" : ""}
                                  {fmtVal(r.a - r.b, locale)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>
                </>
              ) : (
                <Card className="text-center py-10">
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      No weekly history.
                    </p>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="competitors" className="space-y-6">
              {data?.competitorsV2 ? (
                <>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Trophy className="h-4 w-4" />
                        Composite ranking (Balanced)
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-xs">
                      <p className="text-muted-foreground">
                        Cohort: {formatCohortRule(data.competitorsV2.cohortMeta.ruleApplied)} {" | "}
                        Size: {data.competitorsV2.cohortMeta.cohortSize}
                      </p>
                      <div className="flex gap-2 flex-wrap">
                        <Badge variant="outline">
                          Rank A: {data.competitorsV2.primaryIslandRank ?? "-"}
                        </Badge>
                        {compareMode && (
                          <Badge variant="outline">
                            Rank B:{" "}
                            {data.competitorsV2.compareIslandRank ??
                              "outside cohort"}
                          </Badge>
                        )}
                      </div>
                      {compareMode &&
                        data.competitorsV2.compareIslandRank == null && (
                          <p className="text-muted-foreground">
                            Rank B is outside the current cohort filter
                            (category + tag overlap fallback rules).
                          </p>
                        )}
                      <div className="rounded-md border p-3 space-y-1">
                        <p className="font-medium">How score is calculated</p>
                        <p className="text-muted-foreground">
                          Score = U*0.25 + P*0.20 + C*0.15 + M*0.15 + R*0.20 + A*0.05
                        </p>
                        <p className="text-muted-foreground">
                          U=Unique percentile, P=Plays percentile, C=Peak CCU
                          percentile, M=Minutes/Player percentile, R=Retention
                          (D1/D7) percentile, A=Advocacy percentile.
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4">
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b text-muted-foreground">
                              <th className="text-left p-2">#</th>
                              <th className="text-left p-2">Island</th>
                              <th className="text-left p-2">Creator</th>
                              <th className="text-right p-2">Score</th>
                              <th className="text-right p-2">Unique</th>
                              <th className="text-right p-2">Plays</th>
                              <th className="text-right p-2">Peak</th>
                              <th className="text-left p-2">How</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(data.competitorsV2.rows || [])
                              .slice(0, 25)
                              .map((row: any) => {
                                const breakdown = `U ${row.score_breakdown?.unique?.contribution ?? 0} | P ${row.score_breakdown?.plays?.contribution ?? 0} | C ${row.score_breakdown?.peakCCU?.contribution ?? 0} | M ${row.score_breakdown?.minutesPerPlayer?.contribution ?? 0} | R ${row.score_breakdown?.retentionComposite?.contribution ?? 0} | A ${row.score_breakdown?.advocacy?.contribution ?? 0}`;
                                const bg =
                                  row.islandCode === data.metadata.code
                                    ? "bg-primary/10"
                                    : compareData?.metadata?.code ===
                                        row.islandCode
                                      ? "bg-accent/10"
                                      : "";
                                return (
                                  <tr
                                    key={row.islandCode}
                                    className={`border-b last:border-0 ${bg}`}
                                  >
                                    <td className="p-2">{row.rank_position}</td>
                                    <td className="p-2">{row.title}</td>
                                    <td className="p-2 text-muted-foreground">
                                      @{row.creatorCode || "-"}
                                    </td>
                                    <td className="p-2 text-right font-mono">
                                      {asNum(row.score_total).toFixed(2)}
                                    </td>
                                    <td className="p-2 text-right font-mono">
                                      {fmtVal(
                                        asNum(row.metrics?.weekUnique),
                                        locale,
                                      )}
                                    </td>
                                    <td className="p-2 text-right font-mono">
                                      {fmtVal(
                                        asNum(row.metrics?.weekPlays),
                                        locale,
                                      )}
                                    </td>
                                    <td className="p-2 text-right font-mono">
                                      {fmtVal(
                                        asNum(row.metrics?.weekPeakCcuMax),
                                        locale,
                                      )}
                                    </td>
                                    <td
                                      className="p-2 text-muted-foreground"
                                      title={breakdown}
                                    >
                                      {breakdown}
                                    </td>
                                  </tr>
                                );
                              })}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>
                </>
              ) : (
                <Card className="text-center py-10">
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      No competitors V2 data.
                    </p>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="events" className="space-y-6">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Activity className="h-4 w-4" />
                    Atualizações relevantes
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground">
                  <p>
                    A filtered: {data?.eventsV2?.technicalFilteredCount ?? 0}
                    {compareMode
                      ? ` | B filtered: ${compareData?.eventsV2?.technicalFilteredCount ?? 0}`
                      : ""}
                  </p>
                </CardContent>
              </Card>
              <div
                className={
                  compareMode ? "grid md:grid-cols-2 gap-4" : "grid grid-cols-1"
                }
              >
                {renderEventList(mainEvents, data.metadata.code)}
                {compareMode &&
                  renderEventList(compareEvents, compareData?.metadata?.code)}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      )}

      {!loading && !data && (
        <div className="text-center py-20 text-muted-foreground">
          <Search className="h-16 w-16 mx-auto mb-4 opacity-20" />
          <p>{t("islandLookup.emptyState")}</p>
        </div>
      )}

      {loadingVisible && (
        <div className="fixed inset-0 z-[100] bg-background/70 backdrop-blur-sm flex items-center justify-center">
          <Card className="w-[240px]">
            <CardContent className="pt-6 pb-6 flex flex-col items-center gap-3">
              <div
                className="relative h-24 w-24 rounded-full"
                style={{
                  background: `conic-gradient(hsl(var(--primary)) ${Math.round(
                    loadingProgress * 3.6,
                  )}deg, hsl(var(--muted)) 0deg)`,
                }}
              >
                <div className="absolute inset-[7px] rounded-full bg-background flex items-center justify-center">
                  <span className="text-xl font-semibold tabular-nums">
                    {Math.round(loadingProgress)}%
                  </span>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                {initialLoading ? "Preparando lookup..." : "Buscando dados..."}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      <Dialog
        open={imagePreview.open}
        onOpenChange={(open) =>
          setImagePreview((prev) => ({
            ...prev,
            open,
            url: open ? prev.url : null,
          }))
        }
      >
        <DialogContent className="max-w-4xl p-3 sm:p-4">
          <DialogHeader>
            <DialogTitle className="text-sm">{imagePreview.title}</DialogTitle>
          </DialogHeader>
          {imagePreview.url ? (
            <div className="rounded border overflow-hidden bg-muted/20">
              <img
                src={imagePreview.url}
                alt={imagePreview.title}
                className="w-full h-auto max-h-[75vh] object-contain"
              />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
