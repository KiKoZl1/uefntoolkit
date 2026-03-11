import { useCallback, useEffect, useMemo, useState, type WheelEvent } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Eye, TrendingUp, AlertTriangle, Loader2, Clock3, Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDiscoverLiveQuery } from "@/hooks/queries/publicQueries";
import { PageState } from "@/components/ui/page-state";

type PremiumRow = {
  as_of: string;
  region: string;
  surface_name: string;
  panel_name: string;
  panel_display_name: string | null;
  rank: number;
  link_code: string;
  link_code_type: string;
  ccu: number | null;
  title: string | null;
  creator_code: string | null;
};

type EmergingRow = {
  as_of: string;
  region: string;
  surface_name: string;
  link_code: string;
  link_code_type: string;
  first_seen_at: string;
  minutes_6h: number;
  minutes_24h: number;
  panels_24h: number;
  premium_panels_24h: number;
  reentries_24h: number;
  score: number;
  title: string | null;
  creator_code: string | null;
};

type PollutionRow = {
  as_of: string;
  creator_code: string;
  duplicate_clusters_7d: number;
  duplicate_islands_7d: number;
  duplicates_over_min: number;
  spam_score: number;
};

type RailChild = {
  linkCode: string;
  title: string;
  imageUrl: string | null;
  creatorCode: string | null;
  ccu: number | null;
  edgeType: string | null;
  sortOrder?: number | null;
};

type RailItem = {
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
  children?: RailChild[];
  childrenCount?: number;
};

type Rail = {
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
  items: RailItem[];
};

type DiscoveryHighlight = {
  key: "top_ccu" | "latest_launch" | "latest_update";
  label: string;
  item: RailItem | null;
};

type TimelineSeriesPoint = {
  ts: string;
  ccu: number;
  minutes_exposed: number;
  active_items: number;
};

type TimelineTopItem = {
  link_code: string;
  title: string;
  image_url: string | null;
  creator_code: string | null;
  minutes_exposed: number;
};

type PanelIntel = {
  as_of: string;
  window_days: number;
  sample_stints: number;
  sample_closed_stints: number;
  active_maps_now: number;
  panel_avg_ccu: number | null;
  avg_exposure_minutes_per_stint: number | null;
  avg_exposure_minutes_per_map: number | null;
  entries_24h: number;
  exits_24h: number;
  replacements_24h: number;
  ccu_bands: { ruim_lt: number | null; bom_gte: number | null; excelente_gte: number | null };
  exposure_bands_minutes: { ruim_lt: number | null; bom_gte: number | null; excelente_gte: number | null };
  removal_risk_ccu_floor: number | null;
  typical_exit_minutes: number | null;
  keep_alive_targets: { ccu_min: number | null; minutes_min: number | null };
  transitions_out_total: number;
  transitions_out_total_6h: number;
  transitions_out_total_24h: number;
  top_next_panels: Array<{ panel_name: string; panel_display_name?: string; count: number; share_pct: number | null; median_gap_minutes: number | null }>;
  transitions_in_total: number;
  transitions_in_total_6h: number;
  transitions_in_total_24h: number;
  top_prev_panels: Array<{ panel_name: string; panel_display_name?: string; count: number; share_pct: number | null; median_gap_minutes: number | null }>;
  neighbor_net_flow_top: Array<{
    panel_name: string;
    panel_display_name?: string;
    count_out: number;
    count_in: number;
    net_flow: number;
    out_share_pct: number | null;
    in_share_pct: number | null;
    median_gap_minutes_out: number | null;
    median_gap_minutes_in: number | null;
  }>;
  directionality_totals: {
    out_24h: number;
    in_24h: number;
    net_24h: number;
  };
  entry_prev_ccu_p50: number | null;
  entry_prev_ccu_p80: number | null;
  entry_prev_gap_minutes_p50: number | null;
  attempts_avg_per_island: number | null;
  attempts_p50_per_island: number | null;
  islands_single_attempt_pct: number | null;
  islands_multi_attempt_pct: number | null;
  reentry_48h_pct: number | null;
  abandon_48h_pct: number | null;
  attempts_before_abandon_avg: number | null;
  attempts_before_abandon_p50: number | null;
};

type PanelTimelinePayload = {
  panelName: string;
  panelDisplayName?: string;
  from: string;
  to: string;
  series: TimelineSeriesPoint[];
  sample_top_items: TimelineTopItem[];
  panel_intel: PanelIntel | null;
  dppi?: {
    model_version_used: string | null;
    model_name_used: string | null;
    prediction_generated_at: string | null;
    panel_opening_signal: {
      score_avg: number;
      slots_likely_opening: number;
      pressure_distribution: { low: number; medium: number; high: number };
    };
    panel_pressure_forecast: "low" | "medium" | "high";
    panel_opportunities: Array<{
      island_code: string;
      rank: number;
      score: { h2: number; h5: number; h12: number };
      opening_signal: number;
      pressure_forecast: string;
      confidence_bucket: string;
      evidence: Record<string, unknown>;
    }>;
  } | null;
};

const DISCOVERY_SURFACE = "CreativeDiscoverySurface_Frontend";
const ISLAND_CODE_RE = /^\d{4}-\d{4}-\d{4}$/;

function isIslandCode(code: string): boolean {
  return ISLAND_CODE_RE.test(String(code || ""));
}

function fmtNum(n: number | null | undefined): string {
  if (n == null) return "-";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return Math.round(n).toLocaleString("en-US");
}

function fmtMinutes(total: number | null | undefined): string {
  const m = Math.max(0, Math.round(Number(total || 0)));
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const rem = m % 60;
    return rem > 0 ? `${h}h ${rem}m` : `${h}h`;
  }
  return `${m}m`;
}

function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return "-";
  return `${Number(v).toFixed(1)}%`;
}

function parseIsoToMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function panelSectionId(panelName: string): string {
  return `panel-${String(panelName || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")}`;
}

function sortByFixedOrder<T extends { panelKey?: string; panelName?: string; displayOrder?: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const oa = Number(a.displayOrder ?? 9999);
    const ob = Number(b.displayOrder ?? 9999);
    if (oa !== ob) return oa - ob;
    return String(a.panelName || a.panelKey || "").localeCompare(String(b.panelName || b.panelKey || ""));
  });
}

export default function DiscoverLive() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const locale = i18n.language === "pt-BR" ? "pt-BR" : "en-US";

  const [region, setRegion] = useState<string>("NAE");
  const discoverQuery = useDiscoverLiveQuery(region);
  const loading = discoverQuery.isLoading;
  const refreshing = discoverQuery.isFetching && !discoverQuery.isLoading;
  const railsLoading = loading;
  const railsError = discoverQuery.isError ? (discoverQuery.error as Error)?.message || t("common.error") : null;

  const premium = useMemo(
    () => ((discoverQuery.data?.premium || []) as PremiumRow[]),
    [discoverQuery.data?.premium],
  );
  const emerging = useMemo(
    () => ((discoverQuery.data?.emerging || []) as EmergingRow[]),
    [discoverQuery.data?.emerging],
  );
  const pollution = useMemo(
    () => ((discoverQuery.data?.pollution || []) as PollutionRow[]),
    [discoverQuery.data?.pollution],
  );
  const rails = useMemo(
    () => sortByFixedOrder((discoverQuery.data?.rails || []) as Rail[]),
    [discoverQuery.data?.rails],
  );

  const [initialOverlayVisible, setInitialOverlayVisible] = useState(true);
  const [initialOverlayProgress, setInitialOverlayProgress] = useState(0);

  const [jumpPanel, setJumpPanel] = useState<string>("");

  const [timelineOpen, setTimelineOpen] = useState(false);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [timelineData, setTimelineData] = useState<PanelTimelinePayload | null>(null);
  const [visibleMainRails, setVisibleMainRails] = useState(6);
  const [visibleFixedRails, setVisibleFixedRails] = useState(1);
  const initialBusy = loading;

  useEffect(() => {
    let intervalId: number | undefined;
    let hideTimeoutId: number | undefined;

    if (initialBusy) {
      setInitialOverlayVisible(true);
      setInitialOverlayProgress((prev) => (prev >= 5 ? prev : 5));
      intervalId = window.setInterval(() => {
        setInitialOverlayProgress((prev) => {
          if (prev >= 92) return prev;
          const step = Math.max(1, Math.round((100 - prev) / 18));
          return Math.min(92, prev + step);
        });
      }, 120);
    } else {
      setInitialOverlayProgress(100);
      hideTimeoutId = window.setTimeout(() => {
        setInitialOverlayVisible(false);
        setInitialOverlayProgress(0);
      }, 280);
    }

    return () => {
      if (intervalId != null) window.clearInterval(intervalId);
      if (hideTimeoutId != null) window.clearTimeout(hideTimeoutId);
    };
  }, [initialBusy]);

  const displayRails = useMemo(() => {
    return sortByFixedOrder(rails);
  }, [rails]);

  const fixedExperienceRails = useMemo(
    () => displayRails.filter((r) => r.panelKey === "other_experiences_by_epic"),
    [displayRails],
  );

  const mainRails = useMemo(
    () => displayRails.filter((r) => r.panelKey !== "other_experiences_by_epic" && r.panelKey !== "featured_collections"),
    [displayRails],
  );

  useEffect(() => {
    if (mainRails.length === 0) {
      setVisibleMainRails(0);
      return;
    }

    const initial = Math.min(6, mainRails.length);
    setVisibleMainRails(initial);
    if (mainRails.length <= 6) return;

    let cancelled = false;
    const scheduleStep = () => {
      if (cancelled) return;
      const idle = (window as any).requestIdleCallback as ((cb: () => void, opts?: { timeout: number }) => number) | undefined;
      setVisibleMainRails((prev) => {
        const next = Math.min(mainRails.length, prev + 4);
        if (next < mainRails.length) {
          if (typeof idle === "function") {
            idle(() => {
              if (!cancelled) scheduleStep();
            }, { timeout: 180 });
          } else {
            window.setTimeout(() => {
              if (!cancelled) scheduleStep();
            }, 140);
          }
        }
        return next;
      });
    };

    window.setTimeout(() => {
      if (!cancelled) {
        scheduleStep();
      }
    }, 120);

    return () => {
      cancelled = true;
    };
  }, [mainRails.length]);

  useEffect(() => {
    if (fixedExperienceRails.length === 0) {
      setVisibleFixedRails(0);
      return;
    }

    setVisibleFixedRails(1);
    if (fixedExperienceRails.length <= 1) return;

    let cancelled = false;
    const step = () => {
      if (cancelled) return;
      setVisibleFixedRails((prev) => {
        const next = Math.min(fixedExperienceRails.length, prev + 1);
        if (next < fixedExperienceRails.length) {
          window.setTimeout(() => {
            if (!cancelled) step();
          }, 260);
        }
        return next;
      });
    };

    window.setTimeout(() => {
      if (!cancelled) step();
    }, 220);

    return () => {
      cancelled = true;
    };
  }, [fixedExperienceRails.length]);

  const highlights = useMemo<DiscoveryHighlight[]>(() => {
    const islandRows = mainRails
      .filter((rail) => rail.rowKind !== "collection")
      .flatMap((rail) =>
        rail.items
          .filter((item) => item.resolvedType === "island" && !item.isPlaceholder)
          .map((item) => ({ item, panelLabel: rail.panelDisplayName, panelKey: rail.panelKey })),
      );

    const pickMostRecent = (
      rows: Array<{ item: RailItem; panelLabel: string; panelKey: string }>,
      getTsMs: (item: RailItem) => number | null,
    ) => {
      let best: { row: { item: RailItem; panelLabel: string; panelKey: string }; ts: number } | null = null;
      for (const row of rows) {
        const ts = getTsMs(row.item);
        if (ts == null) continue;
        if (!best || ts > best.ts || (ts === best.ts && Number(row.item.ccu || 0) > Number(best.row.item.ccu || 0))) {
          best = { row, ts };
        }
      }
      return best?.row ?? null;
    };

    const topCcuRow = islandRows
      .filter((row) => Number(row.item.ccu || 0) > 0)
      .sort((a, b) => Number(b.item.ccu || 0) - Number(a.item.ccu || 0))[0] || null;

    let newestLaunchRow = pickMostRecent(
      islandRows,
      (item) => parseIsoToMs(item.publishedAtEpic) ?? parseIsoToMs(item.createdAtEpic),
    );
    if (!newestLaunchRow) {
      newestLaunchRow = islandRows
        .filter((row) => row.panelKey === "new" || row.panelKey === "new_released" || row.panelKey === "new_experiences")
        .sort((a, b) => {
          const uptimeDiff = Number(a.item.uptimeMinutes || 0) - Number(b.item.uptimeMinutes || 0);
          if (uptimeDiff !== 0) return uptimeDiff;
          return Number(b.item.ccu || 0) - Number(a.item.ccu || 0);
        })[0] || null;
    }

    let newestUpdateRow = pickMostRecent(
      islandRows,
      (item) => parseIsoToMs(item.updatedAtEpic),
    );
    if (!newestUpdateRow) {
      newestUpdateRow = islandRows
        .filter((row) => row.panelKey === "updated")
        .sort((a, b) => {
          const uptimeDiff = Number(a.item.uptimeMinutes || 0) - Number(b.item.uptimeMinutes || 0);
          if (uptimeDiff !== 0) return uptimeDiff;
          return Number(b.item.ccu || 0) - Number(a.item.ccu || 0);
        })[0] || null;
    }

    return [
      {
        key: "top_ccu",
        label: t("discover.highlightTopCcu"),
        item: topCcuRow?.item || null,
      },
      {
        key: "latest_launch",
        label: t("discover.highlightLatestLaunch"),
        item: newestLaunchRow?.item || null,
      },
      {
        key: "latest_update",
        label: t("discover.highlightLatestUpdate"),
        item: newestUpdateRow?.item || null,
      },
    ];
  }, [mainRails, t]);

  useEffect(() => {
    if (!mainRails.length) {
      setJumpPanel("");
      return;
    }
    if (!jumpPanel || !mainRails.find((r) => r.panelName === jumpPanel)) {
      setJumpPanel(mainRails[0].panelName);
    }
  }, [mainRails, jumpPanel]);

  const emergingRows = useMemo(() => {
    return emerging
      .filter((r) => r.region === region && r.surface_name === DISCOVERY_SURFACE)
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, 20);
  }, [emerging, region]);

  const pollutionRows = useMemo(() => {
    return pollution
      .slice()
      .sort((a, b) => (b.spam_score || 0) - (a.spam_score || 0))
      .slice(0, 20);
  }, [pollution]);

  const scrollToPanel = useCallback((name: string) => {
    setJumpPanel(name);
    const id = panelSectionId(name);
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const openTimeline = useCallback(
    async (rail: Rail) => {
      setTimelineOpen(true);
      setTimelineLoading(true);
      setTimelineError(null);
      setTimelineData(null);

      const { data, error } = await supabase.functions.invoke("discover-panel-timeline", {
        body: {
          region,
          surfaceName: DISCOVERY_SURFACE,
          panelName: rail.panelName,
          hours: 24,
          windowDays: 14,
        },
      });

      if (error) {
        setTimelineError(error.message || "Failed to load timeline");
        setTimelineLoading(false);
        return;
      }

      const payload = data as {
        panelName?: string;
        panelDisplayName?: string;
        from?: string;
        to?: string;
        series?: TimelineSeriesPoint[];
        sample_top_items?: TimelineTopItem[];
        panel_intel?: PanelIntel | null;
        dppi?: PanelTimelinePayload["dppi"];
      };

      setTimelineData({
        panelName: String(payload?.panelDisplayName || rail.panelDisplayName || payload?.panelName || rail.panelName),
        panelDisplayName: String(payload?.panelDisplayName || rail.panelDisplayName || payload?.panelName || rail.panelName),
        from: String(payload?.from || ""),
        to: String(payload?.to || ""),
        series: Array.isArray(payload?.series) ? payload.series : [],
        sample_top_items: Array.isArray(payload?.sample_top_items) ? payload.sample_top_items : [],
        panel_intel: (payload?.panel_intel && typeof payload.panel_intel === "object") ? payload.panel_intel : null,
        dppi: (payload?.dppi && typeof payload.dppi === "object") ? payload.dppi : null,
      });
      setTimelineLoading(false);
    },
    [region],
  );

  const timelineChartData = useMemo(() => {
    if (!timelineData?.series?.length) return [];
    return timelineData.series.map((p) => ({
      ...p,
      label: new Date(p.ts).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }),
    }));
  }, [timelineData, locale]);

  const handleHorizontalWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    const el = event.currentTarget;
    const hasOverflowX = el.scrollWidth > el.clientWidth + 1;
    if (!hasOverflowX) return;
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (delta === 0) return;
    // Force-block native vertical page scrolling while pointer is over horizontal rail.
    const nativeEvent = event.nativeEvent as unknown as { preventDefault?: () => void; stopImmediatePropagation?: () => void };
    nativeEvent.preventDefault?.();
    nativeEvent.stopImmediatePropagation?.();
    event.preventDefault();
    event.stopPropagation();
    el.scrollLeft += delta;
  }, []);

  const getIslandCode = useCallback((item: { hoverIslandCode?: string | null; linkCode?: string | null } | null | undefined) => {
    const hover = String(item?.hoverIslandCode || "").trim();
    if (isIslandCode(hover)) return hover;
    const link = String(item?.linkCode || "").trim();
    if (isIslandCode(link)) return link;
    return null;
  }, []);

  const openIsland = useCallback((islandCode: string | null) => {
    if (!islandCode) return;
    navigate(`/island?code=${encodeURIComponent(islandCode)}`);
  }, [navigate]);

  if (loading && !discoverQuery.data) {
    return (
      <div className="mx-auto max-w-[1380px] px-6 py-10">
        <PageState variant="section" title={t("common.loading")} description={t("discover.initialLoading")} />
      </div>
    );
  }

  if (discoverQuery.isError && !discoverQuery.data) {
    return (
      <div className="mx-auto max-w-[1380px] px-6 py-10">
        <PageState
          variant="section"
          tone="error"
          title={t("common.error")}
          description={t("discover.railsFallback")}
          action={{ label: t("common.reload"), onClick: () => void discoverQuery.refetch() }}
        />
      </div>
    );
  }

  return (
    <div className="px-6 py-10 max-w-[1380px] mx-auto space-y-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <h1 className="font-display text-3xl font-bold">{t("discover.title")}</h1>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-[160px] space-y-1">
            <p className="text-[11px] font-medium text-muted-foreground">{t("common.region")}</p>
            <Select value={region} onValueChange={setRegion}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["NAE", "EU", "BR", "ASIA"].map((r) => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-[220px] space-y-1">
            <p className="text-[11px] font-medium text-muted-foreground">{t("discover.jumpToPanel")}</p>
            <Select value={jumpPanel} onValueChange={scrollToPanel}>
              <SelectTrigger>
                <SelectValue placeholder={t("discover.jumpToPanel")} />
              </SelectTrigger>
              <SelectContent>
                {mainRails.map((rail) => (
                  <SelectItem key={rail.panelName} value={rail.panelName}>
                    {rail.panelDisplayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {(loading || railsLoading || refreshing) && (
            <Badge variant="outline" className="gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              {railsLoading ? t("discover.updatingRails") : t("discover.updating")}
            </Badge>
          )}
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">{t("discover.highlightsTitle")}</CardTitle>
          <p className="text-xs text-muted-foreground">{t("discover.highlightsSubtitle")}</p>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-3">
            {highlights.map((highlight) => {
              const islandCode = getIslandCode(highlight.item);
              const clickable = Boolean(islandCode);
              return (
              <button
                key={highlight.key}
                type="button"
                onClick={() => openIsland(islandCode)}
                disabled={!clickable}
                className={cn(
                  "rounded-xl border overflow-hidden bg-card text-left w-full",
                  clickable && "cursor-pointer hover:border-primary/50 transition-colors",
                  !clickable && "cursor-default",
                )}
              >
                <div className="relative h-[180px] bg-muted/40">
                  {highlight.item?.imageUrl ? (
                    <img src={highlight.item.imageUrl} alt={highlight.item.title} className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <div className="h-full w-full bg-gradient-to-br from-slate-700 via-slate-800 to-slate-900" />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-black/20" />
                  <div className="absolute left-3 top-3">
                    <Badge className="bg-black/65 text-white border-white/20">{highlight.label}</Badge>
                  </div>
                  <div className="absolute inset-x-3 bottom-3 text-white space-y-1">
                    <p className="text-sm font-semibold leading-tight line-clamp-2">
                      {highlight.item?.title || t("discover.highlightNoSignal")}
                    </p>
                    <div className="flex items-center justify-end text-[11px] text-white/80">
                      <span>CCU {fmtNum(highlight.item?.ccu)}</span>
                    </div>
                  </div>
                </div>
                <div className="px-3 py-2 text-[11px] text-muted-foreground flex items-center">
                  <span>{highlight.item?.publicSubtitle || "-"}</span>
                </div>
              </button>
            )})}
          </div>
        </CardContent>
      </Card>

      <div className="space-y-6">
        {railsError && (
          <PageState
            variant="compact"
            tone="error"
            title={t("common.error")}
            description={t("discover.railsFallback")}
            action={{ label: t("common.reload"), onClick: () => void discoverQuery.refetch() }}
          />
        )}

        {mainRails.length === 0 ? (
          <PageState variant="section" title={t("discover.noDataFilter")} description={t("discover.highlightsSubtitle")} />
        ) : (
          mainRails.slice(0, visibleMainRails).map((rail) => {
            const isHomebar = rail.panelKey === "homebar";
            const isGameCollections = rail.panelKey === "game_collections";
            const allowTimeline = rail.rowKind !== "collection" && rail.panelKey !== "game_collections" && rail.panelKey !== "other_experiences_by_epic";
            const showUptime = allowTimeline;
            const railItems = isGameCollections
              ? [...rail.items].sort((a, b) => {
                  const ccuA = Number(a.ccu ?? -1);
                  const ccuB = Number(b.ccu ?? -1);
                  if (ccuB !== ccuA) return ccuB - ccuA;
                  return String(a.title || "").localeCompare(String(b.title || ""));
                })
              : rail.items;

            return (
              <Card key={rail.panelName} id={panelSectionId(rail.panelName)} className="scroll-mt-24">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <CardTitle className="text-base font-medium flex items-center gap-2">
                        <Eye className="h-4 w-4" />
                        {rail.panelDisplayName}
                      </CardTitle>
                      {rail.description && <p className="text-xs text-muted-foreground">{rail.description}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="font-mono">
                        {fmtNum(rail.items.length)} {t("discover.items")}
                      </Badge>
                      {allowTimeline ? (
                        <Button size="sm" variant="outline" onClick={() => openTimeline(rail)}>
                          {t("discover.seeTimeline")}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {isHomebar ? (
                    <div className="grid gap-3 grid-cols-2 md:grid-cols-4 xl:grid-cols-6">
                      {rail.items.slice(0, 12).map((item) => {
                        const islandCode = getIslandCode(item);
                        const clickable = Boolean(islandCode);
                        return (
                        <button
                          key={`${rail.panelName}:${item.rank}:${item.linkCode}`}
                          type="button"
                          onClick={() => openIsland(islandCode)}
                          disabled={!clickable}
                          className={cn(
                            "group rounded-lg border bg-card overflow-hidden text-left",
                            clickable && "cursor-pointer hover:border-primary/50 transition-colors",
                            !clickable && "cursor-default",
                          )}
                        >
                          <div className="relative h-[130px] w-full bg-muted/40">
                            {item.imageUrl ? (
                              <img src={item.imageUrl} alt={item.title} className="h-full w-full object-cover" loading="lazy" />
                            ) : (
                              item.resolvedType === "collection" ? (
                                <div className="h-full w-full bg-gradient-to-br from-slate-700 via-slate-800 to-slate-900 flex items-end p-3">
                                  <p className="text-xs font-semibold text-white line-clamp-2">{item.title}</p>
                                </div>
                              ) : (
                                <div className="h-full w-full flex items-center justify-center text-xs text-muted-foreground">
                                  {item.isPlaceholder ? t("discover.resolving") : t("discover.noThumb")}
                                </div>
                              )
                            )}
                            <Badge className="absolute left-2 top-2 bg-black/70 text-white border-white/20">#{item.rank}</Badge>
                            <Badge className="absolute right-2 top-2 bg-black/70 text-white border-white/20">CCU {fmtNum(item.ccu)}</Badge>
                          </div>
                          <div className="p-3 space-y-1">
                            <p className="text-sm font-semibold leading-tight line-clamp-2">{item.title}</p>
                            {item.publicSubtitle ? (
                              <p className="text-xs text-muted-foreground truncate">{item.publicSubtitle}</p>
                            ) : (
                              <p className="text-xs text-muted-foreground">&nbsp;</p>
                            )}
                            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                              {showUptime ? (
                                <span className="flex items-center gap-1"><Clock3 className="h-3 w-3" /> {fmtMinutes(item.uptimeMinutes)}</span>
                              ) : <span />}
                              {item.hoverIslandCode && <span className="opacity-0 group-hover:opacity-100 transition-opacity">{item.hoverIslandCode}</span>}
                            </div>
                          </div>
                        </button>
                      )})}
                    </div>
                  ) : (
                    <div className="flex gap-3 overflow-x-auto overscroll-contain pb-2" onWheelCapture={handleHorizontalWheel}>
                      {railItems.slice(0, 30).map((item) => {
                        const islandCode = getIslandCode(item);
                        const clickable = Boolean(islandCode);
                        return (
                        <button
                          key={`${rail.panelName}:${item.rank}:${item.linkCode}`}
                          type="button"
                          onClick={() => openIsland(islandCode)}
                          disabled={!clickable}
                          className={cn(
                            "group w-[236px] min-w-[236px] rounded-lg border bg-card overflow-hidden text-left",
                            item.resolvedType === "collection" && "w-[280px] min-w-[280px]",
                            clickable && "cursor-pointer hover:border-primary/50 transition-colors",
                            !clickable && "cursor-default",
                          )}
                        >
                          <div className="relative h-[132px] w-full bg-muted/40">
                            {item.imageUrl ? (
                              <img src={item.imageUrl} alt={item.title} className="h-full w-full object-cover" loading="lazy" />
                            ) : (
                              item.resolvedType === "collection" ? (
                                <div className="h-full w-full bg-gradient-to-br from-slate-700 via-slate-800 to-slate-900 flex items-end p-3">
                                  <p className="text-xs font-semibold text-white line-clamp-2">{item.title}</p>
                                </div>
                              ) : (
                                <div className="h-full w-full flex items-center justify-center text-xs text-muted-foreground">
                                  {item.isPlaceholder ? t("discover.resolving") : t("discover.noThumb")}
                                </div>
                              )
                            )}
                            {!isGameCollections ? (
                              <Badge className="absolute left-2 top-2 bg-black/70 text-white border-white/20">#{item.rank}</Badge>
                            ) : null}
                            <Badge className="absolute right-2 top-2 bg-black/70 text-white border-white/20">CCU {fmtNum(item.ccu)}</Badge>
                          </div>
                          <div className="p-3 space-y-1">
                            <p className="text-sm font-semibold leading-tight line-clamp-2">{item.title}</p>
                            {item.publicSubtitle ? (
                              <p className="text-xs text-muted-foreground truncate">{item.publicSubtitle}</p>
                            ) : (
                              <p className="text-xs text-muted-foreground">&nbsp;</p>
                            )}
                            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                              {showUptime ? (
                                <span className="flex items-center gap-1"><Clock3 className="h-3 w-3" /> {fmtMinutes(item.uptimeMinutes)}</span>
                              ) : <span />}
                              {item.hoverIslandCode && <span className="opacity-0 group-hover:opacity-100 transition-opacity">{item.hoverIslandCode}</span>}
                            </div>
                            {item.resolvedType === "collection" && Number(item.childrenCount || 0) > 0 && (
                              <p className="text-[11px] text-muted-foreground">{fmtNum(item.childrenCount)} linked islands</p>
                            )}
                            {item.isPlaceholder && (
                              <p className="text-[11px] text-muted-foreground">{t("discover.resolvingReferences")}</p>
                            )}
                          </div>
                        </button>
                      )})}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })
        )}

        {visibleMainRails < mainRails.length ? (
          <div className="flex items-center justify-center py-1">
            <Badge variant="outline" className="gap-2">
              <Loader2 className="h-3 w-3 animate-spin" />
              Carregando mais paineis...
            </Badge>
          </div>
        ) : null}

        {fixedExperienceRails.slice(0, visibleFixedRails).map((rail) => (
          <Card key={`fixed-${rail.panelName}`} className="scroll-mt-24">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <CardTitle className="text-base font-medium flex items-center gap-2">
                    <Eye className="h-4 w-4" />
                    {rail.panelDisplayName}
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">Core Epic experiences (fixed set).</p>
                </div>
                <Badge variant="outline" className="font-mono">
                  {fmtNum(rail.items.length)} {t("discover.items")}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex gap-3 overflow-x-auto overscroll-contain pb-2" onWheelCapture={handleHorizontalWheel}>
                {rail.items.slice(0, 30).map((item) => {
                  const islandCode = getIslandCode(item);
                  const clickable = Boolean(islandCode);
                  return (
                  <button
                    key={`${rail.panelName}:${item.rank}:${item.linkCode}`}
                    type="button"
                    onClick={() => openIsland(islandCode)}
                    disabled={!clickable}
                    className={cn(
                      "group w-[236px] min-w-[236px] rounded-lg border bg-card overflow-hidden text-left",
                      clickable && "cursor-pointer hover:border-primary/50 transition-colors",
                      !clickable && "cursor-default",
                    )}
                  >
                    <div className="relative h-[132px] w-full bg-muted/40">
                      {item.imageUrl ? (
                        <img src={item.imageUrl} alt={item.title} className="h-full w-full object-cover" loading="lazy" />
                      ) : (
                        <div className="h-full w-full flex items-center justify-center text-xs text-muted-foreground">
                          {t("discover.noThumb")}
                        </div>
                      )}
                      <Badge className="absolute left-2 top-2 bg-black/70 text-white border-white/20">#{item.rank}</Badge>
                      <Badge className="absolute right-2 top-2 bg-black/70 text-white border-white/20">CCU {fmtNum(item.ccu)}</Badge>
                    </div>
                    <div className="p-3 space-y-1">
                      <p className="text-sm font-semibold leading-tight line-clamp-2">{item.title}</p>
                      <p className="text-xs text-muted-foreground">&nbsp;</p>
                    </div>
                  </button>
                )})}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid xl:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TrendingUp className="h-4 w-4" /> {t("discover.emerging")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {emergingRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("discover.noDataFilter")}</p>
            ) : (
              emergingRows.map((r) => {
                const islandCode = isIslandCode(String(r.link_code || "")) ? String(r.link_code) : null;
                const clickable = Boolean(islandCode);
                return (
                <button
                  key={r.link_code}
                  type="button"
                  onClick={() => openIsland(islandCode)}
                  disabled={!clickable}
                  className={cn(
                    "rounded-md border p-3 w-full text-left",
                    clickable && "cursor-pointer hover:border-primary/50 transition-colors",
                    !clickable && "cursor-default",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{r.title || t("discover.untitledIsland")}</p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {r.creator_code ? `@${r.creator_code}` : t("common.unknown")} - {t("discover.firstSeen")} {new Date(r.first_seen_at).toLocaleString(locale)}
                      </p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        6h {fmtNum(r.minutes_6h)}m - 24h {fmtNum(r.minutes_24h)}m - {t("common.panels")} {fmtNum(r.panels_24h)}
                      </p>
                    </div>
                    <Badge variant="secondary" className="font-mono">score {fmtNum(Math.round(r.score))}</Badge>
                  </div>
                </button>
              )})
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" /> {t("discover.pollution")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {pollutionRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("common.noData")}</p>
            ) : (
              pollutionRows.map((r) => (
                <div key={r.creator_code} className="rounded-md border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">@{r.creator_code}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {t("common.clusters")}: {fmtNum(r.duplicate_clusters_7d)} - {t("common.islands")}: {fmtNum(r.duplicate_islands_7d)} - {t("common.overMin")}: {fmtNum(r.duplicates_over_min)}
                      </p>
                    </div>
                    <Badge variant="secondary" className="font-mono">{t("common.score")} {fmtNum(Math.round(r.spam_score))}</Badge>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={timelineOpen} onOpenChange={setTimelineOpen}>
        <DialogContent className="w-[96vw] max-w-[1200px] h-[92vh] p-0 gap-0 overflow-hidden">
          <DialogHeader className="px-6 py-4 border-b bg-background shrink-0">
            <DialogTitle>{t("discover.panelTimeline")} - {timelineData?.panelName || "-"}</DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-6 py-5">
            {timelineLoading ? (
              <div className="py-12 flex items-center justify-center text-sm text-muted-foreground gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> {t("discover.loadingTimeline")}
              </div>
            ) : timelineError ? (
              <div className="py-8 text-sm text-destructive">{timelineError}</div>
            ) : !timelineData ? (
              <div className="py-8 text-sm text-muted-foreground">{t("discover.noTimelineData")}</div>
            ) : (
              <div className="space-y-5">
              <div className="text-xs text-muted-foreground">
                {timelineData.from ? new Date(timelineData.from).toLocaleString(locale) : "-"} - {" "}
                {timelineData.to ? new Date(timelineData.to).toLocaleString(locale) : "-"}
              </div>

              {timelineData.panel_intel ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold">{t("discover.panelIntelTitle")}</h3>
                  </div>

                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <Card>
                      <CardContent className="pt-4">
                        <p className="text-[11px] text-muted-foreground">{t("discover.panelAvgCcu")}</p>
                        <p className="text-lg font-semibold">{fmtNum(timelineData.panel_intel.panel_avg_ccu)}</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-4">
                        <p className="text-[11px] text-muted-foreground">{t("discover.avgExposurePerEntry")}</p>
                        <p className="text-lg font-semibold">{fmtMinutes(timelineData.panel_intel.avg_exposure_minutes_per_stint)}</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-4">
                        <p className="text-[11px] text-muted-foreground">{t("discover.entriesExits24h")}</p>
                        <p className="text-sm font-semibold">
                          {timelineData.panel_intel.entries_24h} {t("discover.entries")} / {timelineData.panel_intel.exits_24h} {t("discover.exits")}
                        </p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-4">
                        <p className="text-[11px] text-muted-foreground">{t("discover.replacements24h")}</p>
                        <p className="text-lg font-semibold">{fmtNum(timelineData.panel_intel.replacements_24h)}</p>
                      </CardContent>
                    </Card>
                  </div>

                  <div className="grid lg:grid-cols-2 gap-3">
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium">{t("discover.ccuBands")}</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-1 text-xs">
                        <p>{t("discover.bandPoor", { value: fmtNum(timelineData.panel_intel.ccu_bands?.ruim_lt) })}</p>
                        <p>{t("discover.bandGood", { value: fmtNum(timelineData.panel_intel.ccu_bands?.bom_gte) })}</p>
                        <p>{t("discover.bandExcellent", { value: fmtNum(timelineData.panel_intel.ccu_bands?.excelente_gte) })}</p>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium">{t("discover.exposureBands")}</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-1 text-xs">
                        <p>{t("discover.bandPoor", { value: fmtMinutes(timelineData.panel_intel.exposure_bands_minutes?.ruim_lt) })}</p>
                        <p>{t("discover.bandGood", { value: fmtMinutes(timelineData.panel_intel.exposure_bands_minutes?.bom_gte) })}</p>
                        <p>{t("discover.bandExcellent", { value: fmtMinutes(timelineData.panel_intel.exposure_bands_minutes?.excelente_gte) })}</p>
                      </CardContent>
                    </Card>
                  </div>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium">{t("discover.keepAliveSignal")}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {timelineData.panel_intel.keep_alive_targets?.ccu_min || timelineData.panel_intel.keep_alive_targets?.minutes_min ? (
                        <div className="grid sm:grid-cols-2 gap-3">
                          <div className="rounded-md border p-3">
                            <p className="text-[11px] text-muted-foreground">{t("discover.keepAliveCcuMin")}</p>
                            <p className="text-lg font-semibold">{fmtNum(timelineData.panel_intel.keep_alive_targets?.ccu_min)}</p>
                          </div>
                          <div className="rounded-md border p-3">
                            <p className="text-[11px] text-muted-foreground">{t("discover.keepAliveMinutesMin")}</p>
                            <p className="text-lg font-semibold">{fmtMinutes(timelineData.panel_intel.keep_alive_targets?.minutes_min)}</p>
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">{t("discover.keepAliveNoSignal")}</p>
                      )}
                    </CardContent>
                  </Card>

                  <div className="grid lg:grid-cols-2 gap-3">
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium">{t("discover.topNextPanels")}</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        {timelineData.panel_intel.top_next_panels?.length ? (
                          timelineData.panel_intel.top_next_panels.map((row, idx) => (
                            <div key={`next-${row.panel_name}-${idx}`} className="rounded-md border px-3 py-2 text-xs grid grid-cols-12 gap-2 items-center">
                              <p className="col-span-5 font-medium truncate">{row.panel_display_name || row.panel_name}</p>
                              <p className="col-span-2 text-right">{fmtNum(row.count)}</p>
                              <p className="col-span-2 text-right">{fmtPct(row.share_pct)}</p>
                              <p className="col-span-3 text-right">{fmtMinutes(row.median_gap_minutes)}</p>
                            </div>
                          ))
                        ) : (
                          <p className="text-sm text-muted-foreground">{t("discover.noDataFilter")}</p>
                        )}
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium">{t("discover.topSourcePanels")}</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        {timelineData.panel_intel.top_prev_panels?.length ? (
                          timelineData.panel_intel.top_prev_panels.map((row, idx) => (
                            <div key={`prev-${row.panel_name}-${idx}`} className="rounded-md border px-3 py-2 text-xs grid grid-cols-12 gap-2 items-center">
                              <p className="col-span-5 font-medium truncate">{row.panel_display_name || row.panel_name}</p>
                              <p className="col-span-2 text-right">{fmtNum(row.count)}</p>
                              <p className="col-span-2 text-right">{fmtPct(row.share_pct)}</p>
                              <p className="col-span-3 text-right">{fmtMinutes(row.median_gap_minutes)}</p>
                            </div>
                          ))
                        ) : (
                          <p className="text-sm text-muted-foreground">{t("discover.noDataFilter")}</p>
                        )}
                      </CardContent>
                    </Card>
                  </div>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium">{t("discover.neighborNetFlow")}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {timelineData.panel_intel.neighbor_net_flow_top?.length ? (
                        timelineData.panel_intel.neighbor_net_flow_top.map((row, idx) => (
                          <div key={`flow-${row.panel_name}-${idx}`} className="rounded-md border px-3 py-2 text-xs grid grid-cols-12 gap-2 items-center">
                            <p className="col-span-4 font-medium truncate">{row.panel_display_name || row.panel_name}</p>
                            <p className="col-span-2 text-right">
                              {t("discover.flowOutShort")}: {fmtNum(row.count_out)}
                            </p>
                            <p className="col-span-2 text-right">
                              {t("discover.flowInShort")}: {fmtNum(row.count_in)}
                            </p>
                            <p className="col-span-2 text-right">{t("discover.flowNetShort")}: {fmtNum(row.net_flow)}</p>
                            <p className="col-span-2 text-right">
                              {fmtPct(row.out_share_pct)} / {fmtPct(row.in_share_pct)}
                            </p>
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-muted-foreground">{t("discover.noDataFilter")}</p>
                      )}
                    </CardContent>
                  </Card>

                  <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <Card>
                      <CardContent className="pt-4">
                        <p className="text-[11px] text-muted-foreground">{t("discover.attemptsAvgPerIsland")}</p>
                        <p className="text-lg font-semibold">{timelineData.panel_intel.attempts_avg_per_island?.toFixed(2) ?? "-"}</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-4">
                        <p className="text-[11px] text-muted-foreground">{t("discover.attemptsP50PerIsland")}</p>
                        <p className="text-lg font-semibold">{timelineData.panel_intel.attempts_p50_per_island?.toFixed(2) ?? "-"}</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-4">
                        <p className="text-[11px] text-muted-foreground">{t("discover.reentry48hPct")}</p>
                        <p className="text-lg font-semibold">{fmtPct(timelineData.panel_intel.reentry_48h_pct)}</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-4">
                        <p className="text-[11px] text-muted-foreground">{t("discover.abandon48hPct")}</p>
                        <p className="text-lg font-semibold">{fmtPct(timelineData.panel_intel.abandon_48h_pct)}</p>
                      </CardContent>
                    </Card>
                  </div>
                </div>
              ) : (
                <Card>
                  <CardContent className="pt-4">
                    <p className="text-sm text-muted-foreground">{t("discover.panelIntelInsufficient")}</p>
                  </CardContent>
                </Card>
              )}

              {timelineData.dppi ? (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <TrendingUp className="h-4 w-4" /> {t("discover.dppiTitle")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                      <div className="rounded-md border p-3">
                        <p className="text-[11px] text-muted-foreground">{t("discover.dppiOpeningScore")}</p>
                        <p className="text-lg font-semibold">{fmtPct(timelineData.dppi.panel_opening_signal?.score_avg != null ? timelineData.dppi.panel_opening_signal.score_avg * 100 : null)}</p>
                      </div>
                      <div className="rounded-md border p-3">
                        <p className="text-[11px] text-muted-foreground">{t("discover.dppiSlotsLikely")}</p>
                        <p className="text-lg font-semibold">{fmtNum(timelineData.dppi.panel_opening_signal?.slots_likely_opening)}</p>
                      </div>
                      <div className="rounded-md border p-3">
                        <p className="text-[11px] text-muted-foreground">{t("discover.dppiPressureForecast")}</p>
                        <p className="text-lg font-semibold capitalize">{timelineData.dppi.panel_pressure_forecast || "-"}</p>
                      </div>
                      <div className="rounded-md border p-3">
                        <p className="text-[11px] text-muted-foreground">{t("discover.dppiModelVersion")}</p>
                        <p className="text-sm font-semibold truncate">{timelineData.dppi.model_version_used || "-"}</p>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">{t("discover.dppiTopOpps")}</p>
                      {timelineData.dppi.panel_opportunities?.length ? (
                        timelineData.dppi.panel_opportunities.slice(0, 5).map((row, idx) => (
                          <div key={`${row.island_code}:${idx}`} className="rounded-md border px-3 py-2 text-xs grid grid-cols-12 gap-2 items-center">
                            <p className="col-span-4 font-medium truncate">{row.island_code}</p>
                            <p className="col-span-2 text-right">2h {fmtPct(row.score.h2 * 100)}</p>
                            <p className="col-span-2 text-right">5h {fmtPct(row.score.h5 * 100)}</p>
                            <p className="col-span-2 text-right">{t("common.status")} {row.confidence_bucket}</p>
                            <p className="col-span-2 text-right">#{fmtNum(row.rank)}</p>
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-muted-foreground">{t("discover.noDataFilter")}</p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ) : null}

              <div className="grid lg:grid-cols-2 gap-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2"><Activity className="h-4 w-4" /> {t("discover.ccu24h")}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-[220px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={timelineChartData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                          <YAxis tick={{ fontSize: 11 }} />
                          <Tooltip />
                          <Area type="monotone" dataKey="ccu" stroke="#14b8a6" fill="#14b8a633" strokeWidth={2} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">{t("discover.exposureMinutes24h")}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-[220px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={timelineChartData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                          <YAxis tick={{ fontSize: 11 }} />
                          <Tooltip />
                          <Line type="monotone" dataKey="minutes_exposed" stroke="#8b5cf6" strokeWidth={2} dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">{t("discover.topItemsWindow")}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 max-h-[280px] overflow-auto">
                  {timelineData.sample_top_items.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t("discover.noSampledItems")}</p>
                  ) : (
                    timelineData.sample_top_items.map((item, idx) => {
                      const islandCode = isIslandCode(String(item.link_code || "")) ? String(item.link_code) : null;
                      const clickable = Boolean(islandCode);
                      return (
                      <button
                        key={`${item.link_code}:${idx}`}
                        type="button"
                        onClick={() => openIsland(islandCode)}
                        disabled={!clickable}
                        className={cn(
                          "rounded-md border p-2 flex items-center gap-3 w-full text-left",
                          clickable && "cursor-pointer hover:border-primary/50 transition-colors",
                          !clickable && "cursor-default",
                        )}
                      >
                        <div className="h-10 w-16 rounded overflow-hidden bg-muted/40 shrink-0">
                          {item.image_url ? (
                            <img src={item.image_url} alt={item.title} className="h-full w-full object-cover" loading="lazy" />
                          ) : null}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{item.title}</p>
                          <p className="text-[11px] text-muted-foreground truncate">
                            {item.creator_code ? `@${item.creator_code}` : t("discover.collection")} - {fmtNum(item.minutes_exposed)} min
                          </p>
                        </div>
                      </button>
                    )})
                  )}
                </CardContent>
              </Card>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {initialOverlayVisible && (
        <div className="fixed inset-0 z-[100] bg-background/70 backdrop-blur-sm flex items-center justify-center">
          <Card className="w-[240px]">
            <CardContent className="pt-6 pb-6 flex flex-col items-center gap-3">
              <div
                className="relative h-24 w-24 rounded-full"
                style={{
                  background: `conic-gradient(hsl(var(--primary)) ${Math.round(
                    initialOverlayProgress * 3.6,
                  )}deg, hsl(var(--muted)) 0deg)`,
                }}
              >
                <div className="absolute inset-[7px] rounded-full bg-background flex items-center justify-center">
                  <span className="text-xl font-semibold tabular-nums">
                    {Math.round(initialOverlayProgress)}%
                  </span>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">{t("discover.initialLoading")}</p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
