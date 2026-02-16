import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Search,
  Loader2,
  Users,
  Play,
  Clock,
  Star,
  ThumbsUp,
  TrendingUp,
  BarChart3,
  Trophy,
  Radar,
  Shield,
} from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type MetricEntry = {
  timestamp: string;
  value: number | null;
};

type RetentionEntry = {
  timestamp: string;
  d1?: number | null;
  d7?: number | null;
};

type IslandData = {
  metadata: {
    code: string;
    title: string;
    creatorCode: string;
    category: string | null;
    tags: string[];
    createdIn: string | null;
  };
  dailyMetrics: {
    uniquePlayers?: MetricEntry[];
    plays?: MetricEntry[];
    minutesPlayed?: MetricEntry[];
    peakCCU?: MetricEntry[];
    favorites?: MetricEntry[];
    recommendations?: MetricEntry[];
    averageMinutesPerPlayer?: MetricEntry[];
    retention?: RetentionEntry[];
  } | null;
  hourlyMetrics: any;
  internalCard?: {
    title?: string | null;
    imageUrl?: string | null;
    creatorCode?: string | null;
    category?: string | null;
    maxPlayers?: number | null;
    minPlayers?: number | null;
    moderationStatus?: string | null;
    linkState?: string | null;
    exposure?: {
      minutesExposed?: number | null;
      bestRank?: number | null;
      panelsDistinct?: number | null;
    } | null;
  } | null;
  discoverySignals?: {
    panelsTop: Array<{
      panelName: string;
      surfaceName: string;
      minutesExposed: number;
      bestRank: number | null;
      avgRank: number | null;
      ccuMaxSeen: number | null;
      daysActive: number;
    }>;
    dailyMinutes: Array<{
      date: string;
      minutesExposed: number;
    }>;
  };
  metadataEvents?: Array<{
    ts: string | null;
    eventType: string | null;
    oldValue: any;
    newValue: any;
  }>;
  weeklyPerformance?: Array<{
    reportId: string;
    year: number | null;
    weekNumber: number | null;
    weekStart: string | null;
    weekEnd: string | null;
    weekPlays: number;
    weekUnique: number;
    weekPeakCcu: number;
    weekMinutes: number;
  }>;
  categoryLeaders?: Array<{
    islandCode: string;
    title: string;
    creatorCode: string | null;
    weekUnique: number;
    weekPlays: number;
    weekPeakCcu: number;
  }>;
  latestDoneReport?: {
    id: string;
    year: number;
    weekNumber: number;
    weekStart: string;
    weekEnd: string;
    status: string;
  } | null;
};

function extractTimeseries(
  metrics: IslandData["dailyMetrics"],
  key: keyof NonNullable<IslandData["dailyMetrics"]>,
  locale: string,
): { date: string; value: number }[] {
  const arr = (metrics?.[key] || []) as MetricEntry[];
  return arr
    .filter((m) => m.value != null)
    .map((m) => ({
      date: new Date(m.timestamp).toLocaleDateString(locale, { day: "2-digit", month: "2-digit" }),
      value: Number(m.value || 0),
    }));
}

function extractRetention(metrics: IslandData["dailyMetrics"], locale: string) {
  const arr = (metrics?.retention || []) as RetentionEntry[];
  return arr
    .filter((r) => r.d1 != null || r.d7 != null)
    .map((r) => ({
      date: new Date(r.timestamp).toLocaleDateString(locale, { day: "2-digit", month: "2-digit" }),
      d1: Number(r.d1 || 0),
      d7: Number(r.d7 || 0),
    }));
}

function sumMetric(metrics: IslandData["dailyMetrics"], key: keyof NonNullable<IslandData["dailyMetrics"]>): number {
  const arr = (metrics?.[key] || []) as MetricEntry[];
  return arr.reduce((acc, m) => acc + Number(m.value || 0), 0);
}

function maxMetric(metrics: IslandData["dailyMetrics"], key: keyof NonNullable<IslandData["dailyMetrics"]>): number {
  const arr = (metrics?.[key] || []) as MetricEntry[];
  if (!arr.length) return 0;
  return Math.max(...arr.map((m) => Number(m.value || 0)));
}

function formatCompact(v: number, locale: string): string {
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + "M";
  if (v >= 1_000) return (v / 1_000).toFixed(1) + "K";
  return v.toLocaleString(locale);
}

function metricValue(data: IslandData | null, metric: "unique" | "plays" | "minutes" | "ccu" | "exposure"): number {
  if (!data) return 0;
  if (metric === "unique") return sumMetric(data.dailyMetrics, "uniquePlayers");
  if (metric === "plays") return sumMetric(data.dailyMetrics, "plays");
  if (metric === "minutes") return sumMetric(data.dailyMetrics, "minutesPlayed");
  if (metric === "ccu") return maxMetric(data.dailyMetrics, "peakCCU");
  return Number(data.internalCard?.exposure?.minutesExposed || 0);
}

const chartColors = {
  primary: "hsl(252, 85%, 60%)",
  accent: "hsl(168, 70%, 45%)",
  warning: "hsl(38, 92%, 50%)",
};

function MetricChart({
  title,
  data,
  dataKey,
  color,
}: {
  title: string;
  data: any[];
  dataKey: string;
  color: string;
}) {
  if (data.length === 0) return null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 14%, 89%)" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

function IslandHero({ title, data, locale }: { title: string; data: IslandData; locale: string }) {
  const effectiveTitle = data.internalCard?.title || data.metadata.title || data.metadata.code;
  const creator = data.internalCard?.creatorCode || data.metadata.creatorCode || "-";
  const image = data.internalCard?.imageUrl;
  const state = data.internalCard?.linkState;
  const moderation = data.internalCard?.moderationStatus;

  return (
    <Card className="overflow-hidden">
      {image && (
        <div
          className="h-28 w-full bg-cover bg-center"
          style={{ backgroundImage: `linear-gradient(to top, rgba(0,0,0,.35), rgba(0,0,0,.1)), url(${image})` }}
        />
      )}
      <CardContent className="pt-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{title}</p>
        <h3 className="font-display text-lg font-bold leading-tight mt-1">{effectiveTitle}</h3>
        <p className="text-xs text-muted-foreground mt-1">
          {data.metadata.code} · @{creator}
        </p>
        <div className="flex flex-wrap gap-1.5 mt-3">
          {data.metadata.category && <Badge variant="secondary">{data.metadata.category}</Badge>}
          {state && <Badge variant="outline">{state}</Badge>}
          {moderation && <Badge variant="outline">{moderation}</Badge>}
          {data.metadata.createdIn && (
            <Badge variant="outline">
              {new Date(data.metadata.createdIn).toLocaleDateString(locale)}
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function IslandLookup() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "pt-BR" ? "pt-BR" : "en-US";
  const { toast } = useToast();

  const [code, setCode] = useState("");
  const [compareCode, setCompareCode] = useState("");
  const [data, setData] = useState<IslandData | null>(null);
  const [compareData, setCompareData] = useState<IslandData | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchIsland = async (islandCode: string): Promise<IslandData> => {
    const res = await supabase.functions.invoke("discover-island-lookup", {
      body: { islandCode: islandCode.trim() },
    });
    if (res.error) throw res.error;
    if (res.data?.error) throw new Error(res.data.error);
    return res.data as IslandData;
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    setLoading(true);
    setData(null);
    setCompareData(null);

    try {
      const hasCompare = compareCode.trim().length > 0 && compareCode.trim() !== code.trim();
      const requests = [fetchIsland(code.trim())];
      if (hasCompare) requests.push(fetchIsland(compareCode.trim()));

      const results = await Promise.all(requests);
      setData(results[0]);
      if (hasCompare && results[1]) setCompareData(results[1]);
    } catch (e: any) {
      toast({
        title: t("common.error"),
        description: e?.message || "Nao foi possivel carregar ilha.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const retention = useMemo(() => extractRetention(data?.dailyMetrics || null, locale), [data, locale]);
  const weeklySeries = useMemo(() => {
    return (data?.weeklyPerformance || []).map((w) => ({
      label: w.weekNumber ? `W${w.weekNumber}` : (w.weekEnd || "").slice(5, 10),
      plays: w.weekPlays,
      unique: w.weekUnique,
      ccu: w.weekPeakCcu,
    }));
  }, [data]);
  const exposureSeries = useMemo(() => {
    return (data?.discoverySignals?.dailyMinutes || []).map((d) => ({
      date: new Date(d.date + "T00:00:00Z").toLocaleDateString(locale, { day: "2-digit", month: "2-digit" }),
      value: d.minutesExposed,
    }));
  }, [data, locale]);

  const comparisonRows = useMemo(() => {
    if (!data || !compareData) return [];
    const rows = [
      { key: "unique", label: "Unique players (7d)" },
      { key: "plays", label: "Plays (7d)" },
      { key: "minutes", label: "Minutes played (7d)" },
      { key: "ccu", label: "Peak CCU (7d)" },
      { key: "exposure", label: "Exposure minutes (7d)" },
    ] as const;

    return rows.map((r) => {
      const a = metricValue(data, r.key);
      const b = metricValue(compareData, r.key);
      const delta = a - b;
      const pct = b > 0 ? (delta / b) * 100 : null;
      return { ...r, a, b, delta, pct };
    });
  }, [data, compareData]);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="font-display text-2xl font-bold flex items-center gap-2">
          <Search className="h-6 w-6 text-primary" />
          Island Lookup Pro
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Lookup completo com metricas Epic + sinais internos de Discover.
        </p>
      </div>

      <form onSubmit={handleSearch} className="grid md:grid-cols-[1fr_1fr_auto] gap-3 mb-8">
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Ilha principal (ex: 4826-5238-3419)"
          className="flex-1"
        />
        <Input
          value={compareCode}
          onChange={(e) => setCompareCode(e.target.value)}
          placeholder="Comparar com (opcional)"
          className="flex-1"
        />
        <Button type="submit" disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        </Button>
      </form>

      {loading && (
        <div className="flex justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      )}

      {data && (
        <div className="space-y-6 animate-fade-in">
          <div className={`grid gap-4 ${compareData ? "md:grid-cols-2" : "md:grid-cols-1"}`}>
            <IslandHero title="Ilha principal" data={data} locale={locale} />
            {compareData && <IslandHero title="Comparacao" data={compareData} locale={locale} />}
          </div>

          {comparisonRows.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Comparativo rapido</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {comparisonRows.map((r) => (
                  <div key={r.key} className="grid grid-cols-[1.6fr_1fr_1fr_1fr] items-center gap-2 text-sm">
                    <p className="text-muted-foreground">{r.label}</p>
                    <p className="font-medium">{formatCompact(r.a, locale)}</p>
                    <p className="font-medium">{formatCompact(r.b, locale)}</p>
                    <p className={r.delta >= 0 ? "text-green-600 font-medium" : "text-red-600 font-medium"}>
                      {r.delta >= 0 ? "+" : ""}
                      {formatCompact(Math.abs(r.delta), locale)}
                      {r.pct != null ? ` (${r.delta >= 0 ? "+" : ""}${r.pct.toFixed(1)}%)` : ""}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
            {[
              { icon: Users, label: "Unique", value: sumMetric(data.dailyMetrics, "uniquePlayers") },
              { icon: Play, label: "Plays", value: sumMetric(data.dailyMetrics, "plays") },
              { icon: Clock, label: "Minutes", value: sumMetric(data.dailyMetrics, "minutesPlayed") },
              { icon: BarChart3, label: "Peak CCU", value: maxMetric(data.dailyMetrics, "peakCCU") },
              { icon: Star, label: "Favorites", value: sumMetric(data.dailyMetrics, "favorites") },
              { icon: ThumbsUp, label: "Recommendations", value: sumMetric(data.dailyMetrics, "recommendations") },
              { icon: Radar, label: "Exposure (7d)", value: Number(data.internalCard?.exposure?.minutesExposed || 0) },
            ].map((kpi) => (
              <Card key={kpi.label}>
                <CardContent className="pt-4 pb-3 text-center">
                  <kpi.icon className="h-4 w-4 mx-auto text-primary mb-1" />
                  <p className="text-xs text-muted-foreground">{kpi.label}</p>
                  <p className="font-display font-bold text-lg">{formatCompact(kpi.value, locale)}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <MetricChart
              title="Unique players (7d)"
              data={extractTimeseries(data.dailyMetrics, "uniquePlayers", locale)}
              dataKey="value"
              color={chartColors.primary}
            />
            <MetricChart
              title="Plays (7d)"
              data={extractTimeseries(data.dailyMetrics, "plays", locale)}
              dataKey="value"
              color={chartColors.accent}
            />
            <MetricChart
              title="Peak CCU (7d)"
              data={extractTimeseries(data.dailyMetrics, "peakCCU", locale)}
              dataKey="value"
              color={chartColors.warning}
            />
            <MetricChart
              title="Avg minutes/player (7d)"
              data={extractTimeseries(data.dailyMetrics, "averageMinutesPerPlayer", locale)}
              dataKey="value"
              color={chartColors.primary}
            />
          </div>

          {retention.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-primary" /> Retention
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={retention}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 14%, 89%)" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Line type="monotone" dataKey="d1" stroke={chartColors.primary} strokeWidth={2} name="D1" />
                    <Line type="monotone" dataKey="d7" stroke={chartColors.accent} strokeWidth={2} name="D7" />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          <div className="grid lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Radar className="h-4 w-4 text-primary" /> Discover footprint (14d)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {(data.discoverySignals?.panelsTop || []).slice(0, 10).map((p) => (
                  <div key={`${p.surfaceName}:${p.panelName}`} className="rounded border p-2 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium truncate">{p.panelName}</p>
                      <Badge variant="secondary">{p.surfaceName.includes("Frontend") ? "Frontend" : "Browse"}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {formatCompact(p.minutesExposed, locale)} min · best rank {p.bestRank ?? "-"} · {p.daysActive}d
                    </p>
                  </div>
                ))}
                {(data.discoverySignals?.panelsTop || []).length === 0 && (
                  <p className="text-sm text-muted-foreground">Sem sinais de exposure no periodo.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Shield className="h-4 w-4 text-primary" /> Metadata events
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {(data.metadataEvents || []).slice(0, 8).map((ev, idx) => (
                  <div key={`${ev.ts || idx}:${ev.eventType || "event"}`} className="rounded border p-2 text-sm">
                    <p className="font-medium">{ev.eventType || "event"}</p>
                    <p className="text-xs text-muted-foreground">
                      {ev.ts ? new Date(ev.ts).toLocaleString(locale) : "-"}
                    </p>
                  </div>
                ))}
                {(data.metadataEvents || []).length === 0 && (
                  <p className="text-sm text-muted-foreground">Nenhum evento recente para esta ilha.</p>
                )}
              </CardContent>
            </Card>
          </div>

          {exposureSeries.length > 0 && (
            <MetricChart
              title="Exposure minutes por dia (14d)"
              data={exposureSeries}
              dataKey="value"
              color={chartColors.warning}
            />
          )}

          {weeklySeries.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Trophy className="h-4 w-4 text-primary" /> Weekly performance (historico de reports)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={weeklySeries}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 14%, 89%)" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Line type="monotone" dataKey="unique" stroke={chartColors.primary} strokeWidth={2} name="Unique" />
                    <Line type="monotone" dataKey="plays" stroke={chartColors.accent} strokeWidth={2} name="Plays" />
                    <Line type="monotone" dataKey="ccu" stroke={chartColors.warning} strokeWidth={2} name="Peak CCU" />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {(data.categoryLeaders || []).length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Top ilhas da mesma categoria (ultimo report)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {(data.categoryLeaders || []).map((leader) => (
                  <div key={leader.islandCode} className="rounded border p-2 text-sm flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{leader.title}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {leader.islandCode} · @{leader.creatorCode || "-"}
                      </p>
                    </div>
                    <div className="text-right text-xs">
                      <p>Uniques: {formatCompact(leader.weekUnique, locale)}</p>
                      <p>Plays: {formatCompact(leader.weekPlays, locale)}</p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {!loading && !data && (
        <div className="text-center py-20 text-muted-foreground">
          <Search className="h-16 w-16 mx-auto mb-4 opacity-20" />
          <p>Busque uma ilha para ver metricas, exposure e comparacao.</p>
        </div>
      )}
    </div>
  );
}
