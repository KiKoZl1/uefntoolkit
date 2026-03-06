import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import {
  CalendarDays,
  Clock3,
  Copy,
  ExternalLink,
  Hash,
  Loader2,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Line,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip as UiTooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useIslandPageQuery } from "@/hooks/queries/publicQueries";
import { PageState } from "@/components/ui/page-state";
import type { IslandChartRange, IslandPageResponse, IslandSeriesBundle, IslandSeriesPoint } from "@/types/discover-island-page";

const ISLAND_CODE_RE = /^\d{4}-\d{4}-\d{4}$/;
const CHART_RANGES: IslandChartRange[] = ["1D", "1W", "1M", "ALL"];
const CHART_CURRENT = "hsl(214,90%,58%)";
const CHART_PREVIOUS = "hsl(252,85%,60%)";
const CHART_GRID = "hsl(var(--border))";
const EMPTY_SERIES_BUNDLE: IslandSeriesBundle = {
  playerCount24h: [],
  uniquePlayers: [],
  favorites: [],
  recommends: [],
  avgPlaytime: [],
  totalPlaytime: [],
  sessions: [],
};
const PANEL_COLOR_PALETTE = [
  { fill: "hsl(252,85%,60%)", border: "hsl(252,85%,60%)" },
  { fill: "hsl(214,90%,58%)", border: "hsl(214,90%,58%)" },
  { fill: "hsl(168,70%,45%)", border: "hsl(168,70%,45%)" },
  { fill: "hsl(280,60%,55%)", border: "hsl(280,60%,55%)" },
  { fill: "hsl(38,92%,50%)", border: "hsl(38,92%,50%)" },
  { fill: "hsl(335,85%,60%)", border: "hsl(335,85%,60%)" },
];

function asNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fmtCompact(v: number, locale: string): string {
  if (!Number.isFinite(v)) return "-";
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return Math.round(v).toLocaleString(locale);
}

function fmtPercent(v: number, locale: string): string {
  if (!Number.isFinite(v)) return "-";
  const normalized = Math.abs(v) <= 1 ? v * 100 : v;
  return `${normalized.toLocaleString(locale, { maximumFractionDigits: 1 })}%`;
}

function formatTs(ts: string, range: IslandChartRange, locale: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  if (range === "1D") return d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString(locale, { day: "2-digit", month: "2-digit" });
}

function mapSeries(series: IslandSeriesPoint[], range: IslandChartRange, locale: string) {
  return (series || []).map((p) => ({
    ts: p.ts,
    label: formatTs(p.ts, range, locale),
    current: asNum(p.current),
    previous: p.previous == null ? undefined : asNum(p.previous),
  }));
}

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function panelColor(panelName: string) {
  const index = hashString(panelName) % PANEL_COLOR_PALETTE.length;
  return PANEL_COLOR_PALETTE[index];
}

function formatClock(ts: string, locale: string) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}

function getUpdatedInstant(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const candidate = row.updated ?? row.updated_at;
  if (typeof candidate !== "string") return null;
  const ms = Date.parse(candidate);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function getThumbUrl(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const candidate = row.image_url ?? row.imageUrl ?? row.thumb_url ?? row.thumbUrl ?? row.thumbnail_url ?? row.thumbnailUrl;
  return typeof candidate === "string" && /^https?:\/\//i.test(candidate) ? candidate : null;
}

function tooltipRenderer(label: string, locale: string) {
  return ({ active, payload }: any) => {
    if (!active || !Array.isArray(payload) || payload.length === 0) return null;
    return (
      <div className="rounded-lg border border-border/60 bg-background/95 px-3 py-2 text-xs shadow-xl">
        <div className="mb-1 font-medium text-white">{label}</div>
        {payload.map((p: any, idx: number) => (
          <div key={`${p.dataKey || idx}`} className="flex items-center justify-between gap-4 text-zinc-200">
            <span>{p.name || p.dataKey}</span>
            <span className="font-mono">{Math.round(asNum(p.value)).toLocaleString(locale)}</span>
          </div>
        ))}
      </div>
    );
  };
}

function SurfaceCard({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <Card className={cn("border-border/60 bg-card/75 shadow-sm backdrop-blur-sm", className)}>
      {children}
    </Card>
  );
}

function RangeSelector({
  value,
  onChange,
  className,
}: {
  value: IslandChartRange;
  onChange: (value: IslandChartRange) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      {CHART_RANGES.map((item) => (
        <button
          key={item}
          type="button"
          onClick={() => onChange(item)}
          className={cn(
            "rounded-full border px-3 py-1 text-xs transition",
            value === item ? "border-primary/70 bg-primary/20 text-primary" : "border-border/60 bg-background/35 text-zinc-300",
          )}
        >
          {item}
        </button>
      ))}
    </div>
  );
}

export default function IslandPage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "pt-BR" ? "pt-BR" : "en-US";
  const [searchParams] = useSearchParams();
  const { toast } = useToast();

  const code = String(searchParams.get("code") || "").trim();
  const [playerCountRange, setPlayerCountRange] = useState<IslandChartRange>("1D");
  const [dauMauRange, setDauMauRange] = useState<IslandChartRange>("1D");
  const [uniqueRange, setUniqueRange] = useState<IslandChartRange>("1D");
  const [favoritesRange, setFavoritesRange] = useState<IslandChartRange>("1D");
  const [recommendsRange, setRecommendsRange] = useState<IslandChartRange>("1D");
  const [avgPlaytimeRange, setAvgPlaytimeRange] = useState<IslandChartRange>("1D");
  const [totalPlaytimeRange, setTotalPlaytimeRange] = useState<IslandChartRange>("1D");
  const [sessionsRange, setSessionsRange] = useState<IslandChartRange>("1D");
  const [data, setData] = useState<IslandPageResponse | null>(null);
  const [overlayVisible, setOverlayVisible] = useState(false);
  const [overlayProgress, setOverlayProgress] = useState(0);
  const [imagePreview, setImagePreview] = useState<{ src: string; label: string } | null>(null);

  const isValidCode = ISLAND_CODE_RE.test(code);
  const islandQuery = useIslandPageQuery(code, isValidCode);
  const loading = islandQuery.isLoading;
  const error = islandQuery.error instanceof Error ? islandQuery.error.message : null;

  useEffect(() => {
    setData((islandQuery.data as IslandPageResponse | undefined) ?? null);
  }, [islandQuery.data]);

  useEffect(() => {
    if (!error) return;
    toast({ title: t("common.error"), description: error || t("islandPage.loadFailed"), variant: "destructive" });
  }, [error, t, toast]);

  useEffect(() => {
    let intervalId: number | undefined;
    let hideTimeoutId: number | undefined;
    if (loading) {
      setOverlayVisible(true);
      setOverlayProgress((prev) => (prev >= 5 ? prev : 5));
      intervalId = window.setInterval(() => setOverlayProgress((prev) => Math.min(92, prev + 4)), 120);
    } else {
      setOverlayProgress(100);
      hideTimeoutId = window.setTimeout(() => {
        setOverlayVisible(false);
        setOverlayProgress(0);
      }, 260);
    }
    return () => {
      if (intervalId != null) window.clearInterval(intervalId);
      if (hideTimeoutId != null) window.clearTimeout(hideTimeoutId);
    };
  }, [loading]);

  const sharePage = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast({ title: t("islandPage.linkCopied") });
    } catch {
      toast({ title: t("common.error"), description: t("islandPage.linkCopyFailed"), variant: "destructive" });
    }
  };

  const openInFortnite = () => {
    if (!data?.meta.islandCode) return;
    const creator = data.meta.creatorCode ? `@${data.meta.creatorCode}/` : "";
    window.open(`https://www.fortnite.com/${creator}${data.meta.islandCode}`, "_blank", "noopener,noreferrer");
  };

  const bundleForRange = useCallback(
    (range: IslandChartRange): IslandSeriesBundle => data?.seriesByRange?.[range] || data?.series || EMPTY_SERIES_BUNDLE,
    [data],
  );

  const playerRows = useMemo(
    () => mapSeries(bundleForRange(playerCountRange).playerCount24h || [], playerCountRange, locale),
    [bundleForRange, playerCountRange, locale],
  );
  const dauRows = useMemo(() => {
    const rows = mapSeries(bundleForRange(dauMauRange).uniquePlayers || [], dauMauRange, locale);
    return dauMauRange === "1D" ? rows.slice(-8) : rows;
  }, [bundleForRange, dauMauRange, locale]);
  const uniqueRows = useMemo(
    () => mapSeries(bundleForRange(uniqueRange).uniquePlayers || [], uniqueRange, locale),
    [bundleForRange, uniqueRange, locale],
  );
  const favoritesRows = useMemo(
    () => mapSeries(bundleForRange(favoritesRange).favorites || [], favoritesRange, locale),
    [bundleForRange, favoritesRange, locale],
  );
  const recommendsRows = useMemo(
    () => mapSeries(bundleForRange(recommendsRange).recommends || [], recommendsRange, locale),
    [bundleForRange, recommendsRange, locale],
  );
  const avgPlaytimeRows = useMemo(
    () => mapSeries(bundleForRange(avgPlaytimeRange).avgPlaytime || [], avgPlaytimeRange, locale),
    [bundleForRange, avgPlaytimeRange, locale],
  );
  const totalPlaytimeRows = useMemo(
    () => mapSeries(bundleForRange(totalPlaytimeRange).totalPlaytime || [], totalPlaytimeRange, locale),
    [bundleForRange, totalPlaytimeRange, locale],
  );
  const sessionsRows = useMemo(
    () => mapSeries(bundleForRange(sessionsRange).sessions || [], sessionsRange, locale),
    [bundleForRange, sessionsRange, locale],
  );

  const engagementMixRows = useMemo(() => {
    const uniquePlayers = Math.max(0, asNum(data?.overview24h.uniquePlayers));
    const plays = Math.max(0, asNum(data?.overview24h.plays));
    const sessions24h = Math.max(
      0,
      (bundleForRange("1D").sessions || []).reduce((sum, point) => sum + asNum(point.current), 0),
    );
    const sum = uniquePlayers + plays + sessions24h;
    if (sum <= 0) return [] as Array<{ name: string; value: number; color: string }>;
    return [
      { name: t("islandPage.uniquePlayers"), value: (uniquePlayers / sum) * 100, color: CHART_CURRENT },
      { name: t("islandPage.plays"), value: (plays / sum) * 100, color: CHART_PREVIOUS },
      { name: t("islandPage.sessions"), value: (sessions24h / sum) * 100, color: "hsl(220,14%,64%)" },
    ];
  }, [data?.overview24h.uniquePlayers, data?.overview24h.plays, bundleForRange, t]);

  const updates = useMemo(
    () => (data?.updates.events || []).filter((ev) => ev.eventType === "epic_updated" || ev.eventType === "thumb_changed").slice(0, 8),
    [data?.updates.events],
  );

  const panelBase = useMemo(() => {
    const asOf = data?.asOf ? Date.parse(data.asOf) : Date.now();
    const start = asOf - 24 * 60 * 60 * 1000;
    return { start, duration: Math.max(1, asOf - start) };
  }, [data?.asOf]);

  const weeklyRows = useMemo(() => {
    const candidates = [bundleForRange("ALL"), bundleForRange("1M"), bundleForRange("1W")];
    const source = candidates.find((bundle) => (bundle.playerCount24h || []).length > 0) || EMPTY_SERIES_BUNDLE;
    const players = source.playerCount24h || [];
    const uniqueByDay = new Map<string, number>();
    for (const point of source.uniquePlayers || []) {
      const tsMs = Date.parse(point.ts);
      if (!Number.isFinite(tsMs)) continue;
      uniqueByDay.set(new Date(tsMs).toISOString().slice(0, 10), asNum(point.current));
    }

    const rowsAsc = players
      .map((point) => {
        const tsMs = Date.parse(point.ts);
        if (!Number.isFinite(tsMs)) return null;
        const dayKey = new Date(tsMs).toISOString().slice(0, 10);
        const uniqueValue = uniqueByDay.get(dayKey);
        const fallbackAvg = asNum(point.current);
        const avg = uniqueValue && uniqueValue > 0 ? uniqueValue / 7 : fallbackAvg;
        return {
          tsMs,
          week: new Date(tsMs).toLocaleDateString(locale, { day: "2-digit", month: "2-digit", year: "2-digit" }),
          avg,
          peak: asNum(point.current),
          growth: 0,
        };
      })
      .filter((row): row is { tsMs: number; week: string; avg: number; peak: number; growth: number } => row != null)
      .sort((a, b) => a.tsMs - b.tsMs);

    if (!rowsAsc.length) return [] as Array<{ week: string; avg: number; peak: number; growth: number }>;

    const enriched = rowsAsc.map((row, idx) => {
      const prev = rowsAsc[idx - 1]?.avg;
      const growth = prev && prev > 0 ? ((row.avg - prev) / prev) * 100 : 0;
      return {
        week: row.week,
        avg: row.avg,
        peak: row.peak,
        growth,
      };
    });

    return enriched.slice(-4).reverse();
  }, [bundleForRange, locale]);

  if (!isValidCode) {
    return (
      <div className="mx-auto max-w-[1400px] px-4 py-8 md:px-6">
        <PageState variant="section" tone="error" title={t("common.error")} description={t("islandPage.invalidCode")} />
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="mx-auto max-w-[1400px] px-4 py-8 md:px-6">
        <PageState variant="section" title={t("common.loading")} description={t("islandPage.loading")} />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="mx-auto max-w-[1400px] px-4 py-8 md:px-6">
        <PageState
          variant="section"
          tone="error"
          title={t("common.error")}
          description={error}
          action={{ label: t("common.reload"), onClick: () => void islandQuery.refetch() }}
        />
      </div>
    );
  }

  return (
    <div className="relative mx-auto max-w-[1400px] space-y-6 px-4 py-6 md:px-6 md:py-8">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_14%_0%,rgba(148,163,184,0.08),transparent_38%),radial-gradient(circle_at_82%_2%,rgba(51,65,85,0.08),transparent_34%)]" />

      {error ? <div className="text-sm text-red-300">{error}</div> : null}

      {data ? (
        <>
          <section className="relative overflow-hidden rounded-2xl border border-border/60 bg-card/80">
            <div className="absolute inset-0">
              {data.meta.imageUrl ? <img src={data.meta.imageUrl} alt={data.meta.title} className="h-full w-full object-cover" /> : null}
              <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/20 to-background/95" />
              <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent via-background/80 to-background" />
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,rgba(59,130,246,0.12),transparent_44%)]" />
            </div>

            <div className="relative z-10 flex min-h-[360px] flex-col justify-end p-4 md:min-h-[390px] md:p-6">
              <div className="space-y-3 pb-4">
                <div className="flex flex-wrap gap-2">
                  {(data.meta.tags || []).slice(0, 4).map((tag) => (
                    <Badge key={tag} className="border border-border/70 bg-background/55 text-zinc-100">
                      {tag}
                    </Badge>
                  ))}
                </div>
                <h1 className="font-display text-4xl font-bold leading-tight md:text-6xl">{data.meta.title}</h1>
                <div className="flex items-end justify-between gap-3">
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-100/95">
                    <span className="inline-flex items-center gap-1">
                      <Hash className="h-3.5 w-3.5" /> {t("islandPage.islandCodeLabel")}: {data.meta.islandCode}
                    </span>
                    {data.meta.creatorCode ? <span>@{data.meta.creatorCode}</span> : null}
                    {data.meta.publishedAtEpic ? (
                      <span className="inline-flex items-center gap-1">
                        <CalendarDays className="h-3.5 w-3.5" /> {t("islandPage.publishedLabel")} {new Date(data.meta.publishedAtEpic).toLocaleDateString(locale)}
                      </span>
                    ) : null}
                    {data.meta.updatedAtEpic ? (
                      <span className="inline-flex items-center gap-1">
                        <Clock3 className="h-3.5 w-3.5" /> {t("islandPage.updatedLabel")} {new Date(data.meta.updatedAtEpic).toLocaleDateString(locale)}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button onClick={openInFortnite} className="h-12 bg-primary px-6 text-base font-semibold text-primary-foreground hover:bg-primary/90">
                      <ExternalLink className="mr-2 h-4 w-4" />
                      {t("islandPage.openInFortnite")}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={sharePage}
                      aria-label={t("islandPage.copyLink")}
                      className="h-12 w-12 border-border/60 bg-background/35 p-0"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="relative z-10 -mt-7 overflow-hidden rounded-2xl border border-border/60 bg-card/90">
            <div className="grid grid-cols-2 md:grid-cols-4">
              {[
                { label: t("islandPage.playersNow"), value: fmtCompact(asNum(data.kpisNow.playersNow), locale) },
                { label: t("islandPage.peak24h"), value: fmtCompact(asNum(data.kpisNow.peak24h), locale) },
                { label: t("islandPage.peakAllTime"), value: fmtCompact(asNum(data.kpisNow.peakAllTime), locale) },
                { label: t("islandPage.globalRank"), value: data.kpisNow.rankNow != null ? `#${data.kpisNow.rankNow}` : "-" },
              ].map((item, idx) => (
                <div
                  key={item.label}
                  className={cn(
                    "p-3 text-center md:p-4",
                    idx !== 3 ? "md:border-r md:border-border/60" : "",
                    idx % 2 === 0 ? "border-r border-border/60 md:border-r" : "",
                    idx < 2 ? "border-b border-border/60 md:border-b-0" : "",
                  )}
                >
                  <p className="text-[11px] uppercase tracking-[0.12em] text-zinc-300/80">{item.label}</p>
                  <p className="mt-1 text-2xl font-semibold text-white md:text-[1.95rem]">{item.value}</p>
                </div>
              ))}
            </div>
          </section>

          <SurfaceCard>
            <CardHeader className="pb-1">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-2xl">{t("islandPage.playerCountTitle")}</CardTitle>
                  <p className="mt-1 text-sm text-zinc-400">{t("islandPage.playerCountDesc")}</p>
                </div>
                <RangeSelector value={playerCountRange} onChange={setPlayerCountRange} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="h-[340px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={playerRows}>
                    <defs>
                      <linearGradient id="pbg" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={CHART_CURRENT} stopOpacity={0.38} />
                        <stop offset="100%" stopColor={CHART_CURRENT} stopOpacity={0.04} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} width={44} />
                    <Tooltip content={tooltipRenderer(t("islandPage.playerCountTitle"), locale)} />
                    <Area type="monotone" dataKey="current" stroke="none" fill="url(#pbg)" />
                    <Line type="monotone" dataKey="current" stroke={CHART_CURRENT} strokeWidth={2.4} dot={false} />
                    <Line type="monotone" dataKey="previous" stroke={CHART_PREVIOUS} strokeWidth={1.3} dot={false} strokeDasharray="4 4" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </SurfaceCard>

          <div className="grid gap-4 lg:grid-cols-2">
            <SurfaceCard>
              <CardHeader className="pb-2">
                <CardTitle className="text-3xl">{t("islandPage.overviewAllTime")}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-border/60 bg-background/35 p-3.5">
                  <p className="text-xs text-zinc-400">{t("islandPage.minutesPlayed")}</p>
                  <p className="text-3xl font-semibold">{fmtCompact(asNum(data.overviewAllTime.minutesPlayed), locale)}</p>
                </div>
                <div className="rounded-2xl border border-border/60 bg-background/35 p-3.5">
                  <p className="text-xs text-zinc-400">{t("islandPage.favorites")}</p>
                  <p className="text-3xl font-semibold">{fmtCompact(asNum(data.overviewAllTime.favorites), locale)}</p>
                </div>
                <div className="rounded-2xl border border-border/60 bg-background/35 p-3.5">
                  <p className="text-xs text-zinc-400">{t("islandPage.recommendations")}</p>
                  <p className="text-3xl font-semibold">{fmtCompact(asNum(data.overviewAllTime.recommends), locale)}</p>
                </div>
              </CardContent>
            </SurfaceCard>

            <SurfaceCard>
              <CardHeader className="pb-2">
                <CardTitle className="text-3xl">{t("islandPage.performanceInsights")}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-border/60 bg-background/35 p-3.5">
                  <p className="text-xs text-zinc-400">{t("islandPage.avgSessionTime")}</p>
                  <p className="text-2xl font-semibold">{asNum(data.overview24h.avgSessionMinutes).toFixed(1)}m</p>
                </div>
                <div className="rounded-2xl border border-border/60 bg-background/35 p-3.5">
                  <p className="text-xs text-zinc-400">{t("islandPage.retentionD1D7")}</p>
                  <p className="text-2xl font-semibold">
                    {fmtPercent(asNum(data.overview24h.retentionD1), locale)} / {fmtPercent(asNum(data.overview24h.retentionD7), locale)}
                  </p>
                </div>
                <div className="rounded-2xl border border-border/60 bg-background/35 p-3.5">
                  <p className="text-xs text-zinc-400">{t("islandPage.avgMinPerPlayer")}</p>
                  <p className="text-2xl font-semibold">{asNum(data.overview24h.avgMinutesPerPlayer).toFixed(1)}m</p>
                </div>
                <div className="rounded-2xl border border-border/60 bg-background/35 p-3.5">
                  <p className="text-xs text-zinc-400">{t("islandPage.uniquePlayers24h")}</p>
                  <p className="text-2xl font-semibold">{fmtCompact(asNum(data.overview24h.uniquePlayers), locale)}</p>
                </div>
              </CardContent>
            </SurfaceCard>
          </div>

          <section className="space-y-4">
            <h3 className="text-3xl font-display font-semibold">{t("islandPage.engagementBreakdown")}</h3>
            <div className="grid gap-4 lg:grid-cols-[1.5fr_0.5fr]">
              <SurfaceCard>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between gap-3">
                    <CardTitle className="text-2xl">{t("islandPage.dauVsMau")}</CardTitle>
                    <RangeSelector value={dauMauRange} onChange={setDauMauRange} />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={dauRows}>
                        <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} width={44} />
                        <Tooltip content={tooltipRenderer(t("islandPage.dauVsMau"), locale)} />
                        <Bar dataKey="current" name={t("islandPage.dau")} fill={CHART_CURRENT} radius={[4, 4, 0, 0]} />
                        <Bar dataKey="previous" name={t("islandPage.mauScaled")} fill={CHART_PREVIOUS} radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </SurfaceCard>

              <SurfaceCard>
              <CardHeader className="pb-2">
                  <CardTitle className="text-2xl">{t("islandPage.engagementMix24h")}</CardTitle>
                </CardHeader>
                <CardContent>
                  {engagementMixRows.length === 0 ? (
                    <p className="text-sm text-zinc-400">{t("common.noData")}</p>
                  ) : (
                    <>
                      <div className="h-[250px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={engagementMixRows}
                              dataKey="value"
                              nameKey="name"
                              innerRadius={60}
                              outerRadius={92}
                              label={({ percent }) => `${((percent || 0) * 100).toFixed(0)}%`}
                              labelLine={false}
                            >
                              {engagementMixRows.map((row) => (
                                <Cell key={row.name} fill={row.color} />
                              ))}
                            </Pie>
                            <Tooltip content={tooltipRenderer(t("islandPage.engagementMix24h"), locale)} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="mt-2 space-y-1.5 text-sm">
                        {engagementMixRows.map((row) => (
                          <div key={row.name} className="flex items-center justify-between text-zinc-300">
                            <span className="inline-flex items-center gap-2">
                              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: row.color }} />
                              {row.name}
                            </span>
                            <span>{row.value.toFixed(0)}%</span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </CardContent>
              </SurfaceCard>
            </div>
          </section>

          <SurfaceCard>
            <CardHeader className="pb-2">
                <CardTitle className="text-3xl">{t("islandPage.historicalPerformance")}</CardTitle>
            </CardHeader>
            <CardContent>
              {weeklyRows.length === 0 ? (
                <p className="text-sm text-zinc-400">{t("common.noData")}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border/60 text-left text-zinc-400">
                        <th className="px-3 py-2 font-medium">{t("islandPage.week")}</th>
                        <th className="px-3 py-2 font-medium">{t("islandPage.avgDailyPlayers")}</th>
                        <th className="px-3 py-2 font-medium">{t("islandPage.weeklyGrowth")}</th>
                        <th className="px-3 py-2 font-medium">{t("islandPage.peakConcurrent")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {weeklyRows.map((row) => (
                        <tr key={row.week} className="border-b border-border/30 text-zinc-200">
                          <td className="px-3 py-2">{row.week}</td>
                          <td className="px-3 py-2">{fmtCompact(row.avg, locale)}</td>
                          <td className="px-3 py-2">
                            <span className={cn("rounded-full px-2 py-0.5 text-xs", row.growth >= 0 ? "bg-primary/20 text-primary" : "bg-red-500/20 text-red-300")}>
                              {row.growth >= 0 ? "+" : ""}
                              {row.growth.toFixed(0)}%
                            </span>
                          </td>
                          <td className="px-3 py-2">{fmtCompact(row.peak, locale)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </SurfaceCard>

          <section className="space-y-4">
            <h3 className="text-3xl font-display font-semibold">{t("islandPage.metricTrends")}</h3>
            <div className="grid gap-4 lg:grid-cols-2">
              {[
                {
                  key: "unique",
                  title: t("islandPage.uniquePlayers"),
                  rows: uniqueRows,
                  range: uniqueRange,
                  onRangeChange: setUniqueRange,
                },
                {
                  key: "favorites",
                  title: t("islandPage.favorites"),
                  rows: favoritesRows,
                  range: favoritesRange,
                  onRangeChange: setFavoritesRange,
                },
                {
                  key: "recommends",
                  title: t("islandPage.recommendations"),
                  rows: recommendsRows,
                  range: recommendsRange,
                  onRangeChange: setRecommendsRange,
                },
                {
                  key: "avgPlaytime",
                  title: t("islandPage.averagePlaytime"),
                  rows: avgPlaytimeRows,
                  range: avgPlaytimeRange,
                  onRangeChange: setAvgPlaytimeRange,
                },
                {
                  key: "totalPlaytime",
                  title: t("islandPage.totalPlaytime"),
                  rows: totalPlaytimeRows,
                  range: totalPlaytimeRange,
                  onRangeChange: setTotalPlaytimeRange,
                },
                {
                  key: "sessions",
                  title: t("islandPage.sessions"),
                  rows: sessionsRows,
                  range: sessionsRange,
                  onRangeChange: setSessionsRange,
                },
              ].map((metric, metricIdx) => (
                <SurfaceCard key={metric.key}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between gap-3">
                      <CardTitle className="text-xl">{metric.title}</CardTitle>
                      <RangeSelector value={metric.range} onChange={metric.onRangeChange} />
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="h-[210px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={metric.rows}>
                          <defs>
                            <linearGradient id={`fill-${metricIdx}`} x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor={CHART_CURRENT} stopOpacity={0.30} />
                              <stop offset="100%" stopColor={CHART_CURRENT} stopOpacity={0.02} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                          <YAxis tick={{ fontSize: 11 }} width={44} />
                          <Tooltip content={tooltipRenderer(metric.title, locale)} />
                          <Area type="monotone" dataKey="current" fill={`url(#fill-${metricIdx})`} stroke="none" />
                          <Line type="monotone" dataKey="current" stroke={CHART_CURRENT} strokeWidth={2.1} dot={false} />
                          <Line type="monotone" dataKey="previous" stroke={CHART_PREVIOUS} strokeWidth={1.2} dot={false} strokeDasharray="4 4" />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </SurfaceCard>
              ))}
            </div>
          </section>

          <SurfaceCard>
            <CardHeader className="pb-2">
              <CardTitle className="text-2xl">{t("islandPage.panelTimelineTitle")}</CardTitle>
            </CardHeader>
            <CardContent>
              {data.panelTimeline24h.rows.length === 0 ? (
                <p className="text-sm text-zinc-400">{t("islandPage.noTimelineData")}</p>
              ) : (
                <TooltipProvider delayDuration={120}>
                  <div className="space-y-3">
                    {data.panelTimeline24h.rows.map((row) => {
                      const color = panelColor(row.panelName);
                      return (
                        <div key={row.panelName} className="space-y-1.5">
                          <p className="text-xs font-medium text-zinc-200">{row.panelDisplayName}</p>
                          <div className="relative h-10 overflow-hidden rounded-lg border border-border/60 bg-background/40">
                            {row.segments.map((seg, idx) => {
                              const startMs = Date.parse(seg.start);
                              const endMs = Date.parse(seg.end);
                              const left = ((startMs - panelBase.start) / panelBase.duration) * 100;
                              const width = ((endMs - startMs) / panelBase.duration) * 100;
                              return (
                                <UiTooltip key={`${row.panelName}-${idx}`}>
                                  <TooltipTrigger asChild>
                                    <button
                                      type="button"
                                      className="absolute bottom-1 top-1 flex items-center rounded border px-1.5 text-[10px] text-white"
                                      style={{
                                        left: `${Math.max(0, left)}%`,
                                        width: `${Math.max(1.2, width)}%`,
                                        backgroundColor: color.fill,
                                        borderColor: color.border,
                                      }}
                                    >
                                      #{seg.rank ?? "-"}
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent className="border-border/60 bg-background text-xs">
                                    <div className="space-y-1">
                                      <p className="font-medium text-foreground">{row.panelDisplayName}</p>
                                      <p className="text-zinc-300">{t("islandPage.rank")}: #{seg.rank ?? "-"}</p>
                                      <p className="text-zinc-300">{t("islandPage.entered")}: {formatClock(seg.start, locale)}</p>
                                      <p className="text-zinc-300">{t("islandPage.left")}: {formatClock(seg.end, locale)}</p>
                                      <p className="text-zinc-300">{t("islandPage.duration")}: {Math.max(0, Math.round(asNum(seg.minutes)))} {t("islandPage.minutesShort")}</p>
                                    </div>
                                  </TooltipContent>
                                </UiTooltip>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </TooltipProvider>
              )}
            </CardContent>
          </SurfaceCard>

          <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
            <section className="space-y-3">
              <h3 className="text-4xl font-semibold">{t("islandPage.historyOfUpdates")}</h3>
              {updates.length === 0 ? (
                <p className="text-sm text-zinc-400">{t("common.noData")}</p>
              ) : (
                <div className="relative pl-9">
                  <span className="absolute bottom-3 left-2 top-2 w-px bg-white/15" />
                  <div className="max-h-[520px] space-y-3 overflow-y-auto pr-1">
                    {updates.map((ev, idx) => {
                      const oldUpdated = getUpdatedInstant(ev.oldValue);
                      const newUpdated = getUpdatedInstant(ev.newValue);
                      const oldThumb = getThumbUrl(ev.oldValue);
                      const newThumb = getThumbUrl(ev.newValue);
                      return (
                        <div key={`${ev.ts}-${idx}`} className="relative">
                          <span className={cn("absolute -left-[29px] top-5 h-3 w-3 rounded-full", idx === 0 ? "bg-primary" : "bg-zinc-700")} />
                          <div className={cn("rounded-2xl border bg-card/45 p-4", idx === 0 ? "border-primary/45" : "border-border/60")}>
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <p className="text-lg font-semibold text-zinc-100">
                                {ev.eventType === "epic_updated"
                                  ? t("islandPage.eventIslandUpdate")
                                  : ev.eventType === "thumb_changed"
                                    ? t("islandPage.eventThumbChange")
                                    : t("islandPage.eventUpdate")}
                              </p>
                              <span className="text-xs font-semibold text-zinc-400 uppercase">{new Date(ev.ts).toLocaleDateString(locale)}</span>
                            </div>

                            {ev.eventType === "epic_updated" ? (
                              <p className="text-sm text-zinc-300">
                                {oldUpdated && newUpdated
                                  ? t("islandPage.updatedAtRange", {
                                      from: new Date(oldUpdated).toLocaleString(locale),
                                      to: new Date(newUpdated).toLocaleString(locale),
                                    })
                                  : t("islandPage.updateDetected")}
                              </p>
                            ) : null}

                            {ev.eventType === "thumb_changed" ? (
                              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                                <button
                                  type="button"
                                  className="rounded-xl border border-border/60 bg-background/45 p-2 text-left"
                                  onClick={() => oldThumb && setImagePreview({ src: oldThumb, label: t("islandPage.oldThumbnail") })}
                                >
                                  <p className="mb-1 text-[11px] text-zinc-400">{t("islandPage.before")}</p>
                                  <div className="h-24 overflow-hidden rounded-md bg-background/55">
                                    {oldThumb ? <img src={oldThumb} alt={t("islandPage.oldThumbnail")} className="h-full w-full object-cover" /> : null}
                                  </div>
                                </button>

                                <button
                                  type="button"
                                  className="rounded-xl border border-border/60 bg-background/45 p-2 text-left"
                                  onClick={() => newThumb && setImagePreview({ src: newThumb, label: t("islandPage.newThumbnail") })}
                                >
                                  <p className="mb-1 text-[11px] text-zinc-400">{t("islandPage.after")}</p>
                                  <div className="h-24 overflow-hidden rounded-md bg-background/55">
                                    {newThumb ? <img src={newThumb} alt={t("islandPage.newThumbnail")} className="h-full w-full object-cover" /> : null}
                                  </div>
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>

            <section className="space-y-3">
              <h3 className="text-4xl font-semibold">{t("islandPage.promotionRadarTitle")}</h3>
              <p className="text-sm text-muted-foreground">{t("islandPage.promotionRadarSubtitle")}</p>

              {data.dppi_radar ? (
                <div className="rounded-3xl border border-border/60 bg-card/70 p-5">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl border border-border/60 bg-background/40 p-4">
                      <p className="text-xs text-zinc-400">{t("islandPage.modelVersionUsed")}</p>
                      <p className="mt-1 text-base font-semibold">{data.dppi_radar.model_version_used || "-"}</p>
                    </div>
                    <div className="rounded-2xl border border-border/60 bg-background/40 p-4">
                      <p className="text-xs text-zinc-400">{t("islandPage.predictionGeneratedAt")}</p>
                      <p className="mt-1 text-base font-semibold">{data.dppi_radar.prediction_generated_at ? new Date(data.dppi_radar.prediction_generated_at).toLocaleString(locale) : "-"}</p>
                    </div>
                  </div>

                  {data.dppi_radar.headline ? (
                    <div className="mt-3 rounded-2xl border border-primary/40 bg-primary/10 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-primary">{t("islandPage.headlinePanel")}</p>
                      <p className="mt-1 text-xl font-semibold">{data.dppi_radar.headline.panel_name}</p>
                      <div className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                        <p>{t("islandPage.entryChance2h")}: <span className="font-semibold">{fmtPercent(data.dppi_radar.headline.score_h2, locale)}</span></p>
                        <p>{t("islandPage.openingSignal")}: <span className="font-semibold">{fmtPercent(data.dppi_radar.headline.opening_signal, locale)}</span></p>
                        <p>{t("islandPage.pressureForecast")}: <span className="font-semibold capitalize">{data.dppi_radar.headline.pressure_forecast}</span></p>
                        <p>{t("islandPage.confidenceBucket")}: <span className="font-semibold capitalize">{data.dppi_radar.headline.confidence_bucket}</span></p>
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-3 grid gap-3 xl:grid-cols-2">
                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-zinc-400">{t("islandPage.topPanelOpportunities")}</p>
                      {(data.dppi_radar.top_panel_opportunities || []).slice(0, 5).map((row, idx) => (
                        <div key={`${row.panel_name}:${idx}`} className="rounded-xl border border-border/60 bg-background/35 p-3 text-sm">
                          <p className="font-semibold">{row.panel_name}</p>
                          <div className="mt-1 grid grid-cols-2 gap-1 text-xs text-zinc-300">
                            <p>{t("islandPage.entryChance2h")}: {fmtPercent(row.score.h2, locale)}</p>
                            <p>{t("islandPage.entryChance5h")}: {fmtPercent(row.score.h5, locale)}</p>
                            <p>{t("islandPage.entryChance12h")}: {fmtPercent(row.score.h12, locale)}</p>
                            <p>{t("islandPage.openingSignal")}: {fmtPercent(row.opening_signal, locale)}</p>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-zinc-400">{t("islandPage.survivalSignals")}</p>
                      {(data.dppi_radar.survival_signals || []).slice(0, 6).map((row, idx) => (
                        <div key={`${row.panel_name}:${row.horizon}:${idx}`} className="rounded-xl border border-border/60 bg-background/35 p-3 text-sm">
                          <div className="flex items-center justify-between gap-2">
                            <p className="font-semibold">{row.panel_name}</p>
                            <p className="text-xs uppercase text-zinc-400">{row.horizon}</p>
                          </div>
                          <p className="mt-1 text-xs text-zinc-300">
                            {t("islandPage.confidenceBucket")}: <span className="capitalize">{row.confidence_bucket}</span> • {fmtPercent(row.score, locale)}
                          </p>
                        </div>
                      ))}

                      <div className="rounded-xl border border-border/60 bg-background/35 p-3 text-sm">
                        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-zinc-400">{t("islandPage.attemptHistory")}</p>
                        <div className="grid grid-cols-3 gap-2 text-xs text-zinc-300">
                          <p>{t("islandPage.attempts14d")}: <span className="font-semibold text-zinc-100">{fmtCompact(asNum(data.dppi_radar.attempts.total_14d), locale)}</span></p>
                          <p>{t("islandPage.entries48h")}: <span className="font-semibold text-zinc-100">{fmtCompact(asNum(data.dppi_radar.attempts.entries_48h), locale)}</span></p>
                          <p>{t("islandPage.exits48h")}: <span className="font-semibold text-zinc-100">{fmtCompact(asNum(data.dppi_radar.attempts.exits_48h), locale)}</span></p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-3xl border border-border/60 bg-card/70 p-5 text-sm text-muted-foreground">
                  {t("islandPage.noDppiData")}
                </div>
              )}
            </section>
          </div>
        </>
      ) : null}

      {overlayVisible && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/75 backdrop-blur-sm">
          <Card className="w-[240px] border-border/60 bg-card">
            <CardContent className="flex flex-col items-center gap-3 pb-6 pt-6">
              <div
                className="relative h-24 w-24 rounded-full"
                style={{
                  background: `conic-gradient(hsl(var(--primary)) ${Math.round(overlayProgress * 3.6)}deg, hsl(var(--muted)) 0deg)`,
                }}
              >
                <div className="absolute inset-[7px] flex items-center justify-center rounded-full bg-background">
                  <span className="tabular-nums text-xl font-semibold">{Math.round(overlayProgress)}%</span>
                </div>
              </div>
              <p className="flex items-center gap-2 text-sm text-zinc-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("islandPage.loading")}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {imagePreview ? (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm" onClick={() => setImagePreview(null)}>
          <div className="w-full max-w-[900px] rounded-xl border border-border/60 bg-card p-3" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm text-zinc-300">{imagePreview.label}</p>
              <Button variant="outline" size="sm" onClick={() => setImagePreview(null)} className="border-border/70 bg-background/40">
                {t("common.close")}
              </Button>
            </div>
            <div className="max-h-[78vh] overflow-hidden rounded-lg border border-border/60">
              <img src={imagePreview.src} alt={imagePreview.label} className="w-full bg-background/55 object-contain" />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

