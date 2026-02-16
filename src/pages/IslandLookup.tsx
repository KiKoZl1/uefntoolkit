import { useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  Search, Loader2, Users, Play, Clock, Star, ThumbsUp, TrendingUp, BarChart3,
  Layers, Eye, GitCompare, Trophy, Calendar, Activity,
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  BarChart, Bar,
} from "recharts";

// ── Types ──

interface IslandMetadata {
  code: string;
  title: string;
  creatorCode: string;
  category: string | null;
  tags: string[];
  createdIn: string | null;
}

interface PanelExposure {
  panelName: string;
  surfaceName: string;
  minutesExposed: number;
  bestRank: number | null;
  avgRank: number | null;
  ccuMaxSeen: number | null;
  daysActive: number;
}

interface WeeklyPerfEntry {
  reportId: string;
  year: number | null;
  weekNumber: number | null;
  weekStart: string | null;
  weekEnd: string | null;
  weekPlays: number;
  weekUnique: number;
  weekPeakCcu: number;
  weekMinutes: number;
}

interface CategoryLeader {
  islandCode: string;
  title: string;
  creatorCode: string;
  weekUnique: number;
  weekPlays: number;
  weekPeakCcu: number;
}

interface MetadataEvent {
  ts: string | null;
  eventType: string | null;
  oldValue: any;
  newValue: any;
}

interface IslandData {
  metadata: IslandMetadata;
  dailyMetrics: any;
  hourlyMetrics: any;
  internalCard: any;
  discoverySignals: {
    panelsTop: PanelExposure[];
    dailyMinutes: { date: string; minutesExposed: number }[];
  };
  metadataEvents: MetadataEvent[];
  weeklyPerformance: WeeklyPerfEntry[];
  categoryLeaders: CategoryLeader[];
  latestDoneReport: any;
}

// ── Helpers ──

function extractTimeseries(metrics: any, key: string, locale: string): { date: string; value: number }[] {
  if (!metrics || !metrics[key]) return [];
  return metrics[key]
    .filter((m: any) => m.value != null)
    .map((m: any) => ({
      date: new Date(m.timestamp).toLocaleDateString(locale, { day: "2-digit", month: "2-digit" }),
      value: m.value,
    }));
}

function extractRetention(metrics: any, locale: string): { date: string; d1: number; d7: number }[] {
  if (!metrics?.retention) return [];
  return metrics.retention
    .filter((r: any) => r.d1 != null || r.d7 != null)
    .map((r: any) => ({
      date: new Date(r.timestamp).toLocaleDateString(locale, { day: "2-digit", month: "2-digit" }),
      d1: r.d1 ?? 0,
      d7: r.d7 ?? 0,
    }));
}

function sumMetric(metrics: any, key: string): number {
  if (!metrics?.[key]) return 0;
  return metrics[key].reduce((acc: number, m: any) => acc + (m.value ?? 0), 0);
}

function maxMetric(metrics: any, key: string): number {
  if (!metrics?.[key]) return 0;
  return Math.max(0, ...metrics[key].map((m: any) => m.value ?? 0));
}

const fmtVal = (v: number, locale: string) => {
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + "M";
  if (v >= 1_000) return (v / 1_000).toFixed(1) + "K";
  return v.toLocaleString(locale);
};

const chartColors = {
  primary: "hsl(252, 85%, 60%)",
  accent: "hsl(168, 70%, 45%)",
  warning: "hsl(38, 92%, 50%)",
  secondary: "hsl(280, 60%, 55%)",
};

// ── Chart Components ──

function MetricChart({ title, data, dataKey, color }: { title: string; data: any[]; dataKey: string; color: string }) {
  if (data.length === 0) return null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
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

// ── KPI Card ──

function KpiCard({ icon: Icon, label, value, sub }: { icon: React.ElementType; label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="pt-4 pb-3 text-center">
        <Icon className="h-4 w-4 mx-auto text-primary mb-1" />
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="font-display font-bold text-lg">{value}</p>
        {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

// ── Compare Delta ──

function CompareDelta({ label, a, b, locale }: { label: string; a: number; b: number; locale: string }) {
  const delta = a - b;
  const pct = b > 0 ? ((delta / b) * 100).toFixed(1) : "—";
  const color = delta > 0 ? "text-green-500" : delta < 0 ? "text-destructive" : "text-muted-foreground";
  return (
    <div className="flex items-center justify-between text-sm py-1 border-b last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex items-center gap-3">
        <span className="font-mono">{fmtVal(a, locale)}</span>
        <span className="text-muted-foreground">vs</span>
        <span className="font-mono">{fmtVal(b, locale)}</span>
        <span className={`font-mono text-xs ${color}`}>
          {delta > 0 ? "+" : ""}{fmtVal(delta, locale)} ({pct}%)
        </span>
      </div>
    </div>
  );
}

// ── Main Component ──

export default function IslandLookup() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "pt-BR" ? "pt-BR" : "en-US";

  const [code, setCode] = useState("");
  const [compareCode, setCompareCode] = useState("");
  const [data, setData] = useState<IslandData | null>(null);
  const [compareData, setCompareData] = useState<IslandData | null>(null);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const fetchIsland = async (islandCode: string): Promise<IslandData | null> => {
    const res = await supabase.functions.invoke("discover-island-lookup", {
      body: { islandCode },
    });
    if (res.error) throw res.error;
    if (res.data?.error) throw new Error(res.data.error);
    return res.data;
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    setLoading(true);
    setData(null);
    setCompareData(null);
    try {
      const [main, compare] = await Promise.all([
        fetchIsland(code.trim()),
        compareCode.trim() ? fetchIsland(compareCode.trim()) : Promise.resolve(null),
      ]);
      setData(main);
      setCompareData(compare);
    } catch (e: any) {
      toast({ title: t("common.error"), description: e.message || t("islandLookup.islandNotFound"), variant: "destructive" });
    }
    setLoading(false);
  };

  const daily = data?.dailyMetrics;
  const retention = daily ? extractRetention(daily, locale) : [];
  const panels = data?.discoverySignals?.panelsTop || [];
  const weeklyPerf = data?.weeklyPerformance || [];
  const leaders = data?.categoryLeaders || [];
  const events = data?.metadataEvents || [];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="font-display text-2xl font-bold flex items-center gap-2">
          <Search className="h-6 w-6 text-primary" />
          Island Lookup Pro
        </h1>
        <p className="text-sm text-muted-foreground mt-1">{t("islandLookup.subtitle")}</p>
      </div>

      <form onSubmit={handleSearch} className="flex flex-wrap gap-3 mb-8">
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder={t("islandLookup.placeholder")}
          className="flex-1 min-w-[200px]"
        />
        <Input
          value={compareCode}
          onChange={(e) => setCompareCode(e.target.value)}
          placeholder="Código para comparar (opcional)"
          className="flex-1 min-w-[200px]"
        />
        <Button type="submit" disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4 mr-1" />}
          Buscar
        </Button>
      </form>

      {loading && (
        <div className="flex justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      )}

      {data && (
        <div className="space-y-6 animate-fade-in">
          {/* Identity Card */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-start justify-between flex-wrap gap-4">
                <div>
                  <h2 className="font-display text-xl font-bold">{data.metadata.title}</h2>
                  <p className="text-sm text-muted-foreground">
                    {data.metadata.code} · @{data.metadata.creatorCode || "—"}
                  </p>
                  <div className="flex gap-2 mt-2 flex-wrap">
                    {data.metadata.category && <Badge variant="secondary">{data.metadata.category}</Badge>}
                    {data.metadata.createdIn && <Badge variant="outline">{data.metadata.createdIn}</Badge>}
                    {data.internalCard?.link_state && (
                      <Badge variant={data.internalCard.link_state === "Active" ? "default" : "destructive"}>
                        {data.internalCard.link_state}
                      </Badge>
                    )}
                    {data.metadata.tags?.map((tag) => (
                      <Badge key={tag} variant="outline" className="text-xs">{tag}</Badge>
                    ))}
                  </div>
                </div>
                {compareData && (
                  <div className="text-right">
                    <h3 className="font-display text-lg font-bold flex items-center gap-2 justify-end">
                      <GitCompare className="h-4 w-4 text-accent" />
                      {compareData.metadata.title}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {compareData.metadata.code} · @{compareData.metadata.creatorCode || "—"}
                    </p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Tabs defaultValue="overview" className="w-full">
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="discovery">Discovery</TabsTrigger>
              <TabsTrigger value="history">Histórico</TabsTrigger>
              <TabsTrigger value="competitors">Competidores</TabsTrigger>
              <TabsTrigger value="events">Eventos</TabsTrigger>
            </TabsList>

            {/* Overview Tab */}
            <TabsContent value="overview" className="space-y-6">
              {daily && (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  <KpiCard icon={Users} label={t("kpis.uniquePlayers")} value={fmtVal(sumMetric(daily, "uniquePlayers"), locale)} />
                  <KpiCard icon={Play} label={t("kpis.totalPlays")} value={fmtVal(sumMetric(daily, "plays"), locale)} />
                  <KpiCard icon={Clock} label={t("kpis.minutesPlayed")} value={fmtVal(sumMetric(daily, "minutesPlayed"), locale)} />
                  <KpiCard icon={BarChart3} label={t("kpis.peakCCU")} value={fmtVal(maxMetric(daily, "peakCCU"), locale)} />
                  <KpiCard icon={Star} label={t("kpis.favorites")} value={fmtVal(sumMetric(daily, "favorites"), locale)} />
                  <KpiCard icon={ThumbsUp} label={t("kpis.recommendations")} value={fmtVal(sumMetric(daily, "recommendations"), locale)} />
                </div>
              )}

              {/* Compare deltas */}
              {compareData?.dailyMetrics && daily && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <GitCompare className="h-4 w-4" /> Comparativo 7d
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <CompareDelta label="Jogadores Únicos" a={sumMetric(daily, "uniquePlayers")} b={sumMetric(compareData.dailyMetrics, "uniquePlayers")} locale={locale} />
                    <CompareDelta label="Plays" a={sumMetric(daily, "plays")} b={sumMetric(compareData.dailyMetrics, "plays")} locale={locale} />
                    <CompareDelta label="Minutos" a={sumMetric(daily, "minutesPlayed")} b={sumMetric(compareData.dailyMetrics, "minutesPlayed")} locale={locale} />
                    <CompareDelta label="Peak CCU" a={maxMetric(daily, "peakCCU")} b={maxMetric(compareData.dailyMetrics, "peakCCU")} locale={locale} />
                    <CompareDelta label="Favoritos" a={sumMetric(daily, "favorites")} b={sumMetric(compareData.dailyMetrics, "favorites")} locale={locale} />
                  </CardContent>
                </Card>
              )}

              {daily && (
                <div className="grid md:grid-cols-2 gap-4">
                  <MetricChart title={t("islandLookup.chartUnique")} data={extractTimeseries(daily, "uniquePlayers", locale)} dataKey="value" color={chartColors.primary} />
                  <MetricChart title={t("islandLookup.chartPlays")} data={extractTimeseries(daily, "plays", locale)} dataKey="value" color={chartColors.accent} />
                  <MetricChart title={t("islandLookup.chartCCU")} data={extractTimeseries(daily, "peakCCU", locale)} dataKey="value" color={chartColors.warning} />
                  <MetricChart title={t("islandLookup.chartAvgMin")} data={extractTimeseries(daily, "averageMinutesPerPlayer", locale)} dataKey="value" color={chartColors.secondary} />
                </div>
              )}

              {retention.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-primary" /> {t("islandLookup.retentionChart")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={250}>
                      <LineChart data={retention}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
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
            </TabsContent>

            {/* Discovery Tab */}
            <TabsContent value="discovery" className="space-y-6">
              {/* Exposure daily chart */}
              {data.discoverySignals.dailyMinutes.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Eye className="h-4 w-4" /> Exposição Diária (min)
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={data.discoverySignals.dailyMinutes}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} />
                        <Tooltip />
                        <Bar dataKey="minutesExposed" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="Minutos" />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              )}

              {/* Panels Top */}
              {panels.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Layers className="h-4 w-4" /> Panels com Presença ({panels.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b text-muted-foreground">
                            <th className="text-left p-2 font-medium">Panel</th>
                            <th className="text-left p-2 font-medium">Surface</th>
                            <th className="text-right p-2 font-medium">Min. Expostos</th>
                            <th className="text-right p-2 font-medium">Best Rank</th>
                            <th className="text-right p-2 font-medium">Avg Rank</th>
                            <th className="text-right p-2 font-medium">Dias</th>
                          </tr>
                        </thead>
                        <tbody>
                          {panels.map((p, i) => (
                            <tr key={i} className="border-b last:border-0">
                              <td className="p-2 font-mono">{p.panelName}</td>
                              <td className="p-2 text-muted-foreground">{p.surfaceName}</td>
                              <td className="p-2 text-right font-mono">{fmtVal(p.minutesExposed, locale)}</td>
                              <td className="p-2 text-right font-mono">{p.bestRank ?? "—"}</td>
                              <td className="p-2 text-right font-mono">{p.avgRank ?? "—"}</td>
                              <td className="p-2 text-right">{p.daysActive}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              )}

              {panels.length === 0 && (
                <Card className="text-center py-10">
                  <CardContent>
                    <Eye className="h-10 w-10 mx-auto text-muted-foreground/30 mb-3" />
                    <p className="text-sm text-muted-foreground">Sem dados de exposure nos últimos 14 dias.</p>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* History Tab */}
            <TabsContent value="history" className="space-y-6">
              {weeklyPerf.length > 0 ? (
                <>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Calendar className="h-4 w-4" /> Performance Semanal
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ResponsiveContainer width="100%" height={250}>
                        <BarChart data={weeklyPerf}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                          <XAxis dataKey="weekNumber" tick={{ fontSize: 10 }} tickFormatter={(v) => `W${v}`} />
                          <YAxis tick={{ fontSize: 10 }} />
                          <Tooltip labelFormatter={(v) => `Semana ${v}`} />
                          <Bar dataKey="weekUnique" fill={chartColors.primary} name="Jogadores Únicos" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>

                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b text-muted-foreground">
                          <th className="text-left p-2 font-medium">Semana</th>
                          <th className="text-right p-2 font-medium">Unique</th>
                          <th className="text-right p-2 font-medium">Plays</th>
                          <th className="text-right p-2 font-medium">Peak CCU</th>
                          <th className="text-right p-2 font-medium">Minutos</th>
                        </tr>
                      </thead>
                      <tbody>
                        {weeklyPerf.map((w, i) => (
                          <tr key={i} className="border-b last:border-0">
                            <td className="p-2">W{w.weekNumber} ({w.weekStart?.slice(5) || "—"})</td>
                            <td className="p-2 text-right font-mono">{fmtVal(w.weekUnique, locale)}</td>
                            <td className="p-2 text-right font-mono">{fmtVal(w.weekPlays, locale)}</td>
                            <td className="p-2 text-right font-mono">{fmtVal(w.weekPeakCcu, locale)}</td>
                            <td className="p-2 text-right font-mono">{fmtVal(w.weekMinutes, locale)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <Card className="text-center py-10">
                  <CardContent>
                    <Calendar className="h-10 w-10 mx-auto text-muted-foreground/30 mb-3" />
                    <p className="text-sm text-muted-foreground">Sem dados históricos de reports semanais para esta ilha.</p>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* Competitors Tab */}
            <TabsContent value="competitors" className="space-y-6">
              {leaders.length > 0 ? (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Trophy className="h-4 w-4" /> Top {data.metadata.category || "Categoria"} — Último Report
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b text-muted-foreground">
                            <th className="text-left p-2 font-medium">#</th>
                            <th className="text-left p-2 font-medium">Ilha</th>
                            <th className="text-left p-2 font-medium">Criador</th>
                            <th className="text-right p-2 font-medium">Unique</th>
                            <th className="text-right p-2 font-medium">Plays</th>
                            <th className="text-right p-2 font-medium">Peak CCU</th>
                          </tr>
                        </thead>
                        <tbody>
                          {leaders.map((l, i) => (
                            <tr
                              key={l.islandCode}
                              className={`border-b last:border-0 ${l.islandCode === data.metadata.code ? "bg-primary/5 font-medium" : ""}`}
                            >
                              <td className="p-2">{i + 1}</td>
                              <td className="p-2">{l.title}</td>
                              <td className="p-2 text-muted-foreground">@{l.creatorCode || "—"}</td>
                              <td className="p-2 text-right font-mono">{fmtVal(l.weekUnique, locale)}</td>
                              <td className="p-2 text-right font-mono">{fmtVal(l.weekPlays, locale)}</td>
                              <td className="p-2 text-right font-mono">{fmtVal(l.weekPeakCcu, locale)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <Card className="text-center py-10">
                  <CardContent>
                    <Trophy className="h-10 w-10 mx-auto text-muted-foreground/30 mb-3" />
                    <p className="text-sm text-muted-foreground">Sem dados de competidores na mesma categoria.</p>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* Events Tab */}
            <TabsContent value="events" className="space-y-6">
              {events.length > 0 ? (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Activity className="h-4 w-4" /> Mudanças de Metadata ({events.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2 max-h-[400px] overflow-y-auto">
                      {events.map((ev, i) => (
                        <div key={i} className="rounded-lg border p-3 text-xs space-y-1">
                          <div className="flex items-center justify-between">
                            <Badge variant="outline" className="text-[10px]">{ev.eventType || "unknown"}</Badge>
                            <span className="text-muted-foreground">
                              {ev.ts ? new Date(ev.ts).toLocaleString(locale) : "—"}
                            </span>
                          </div>
                          {ev.oldValue && (
                            <p className="text-muted-foreground">De: {typeof ev.oldValue === "string" ? ev.oldValue : JSON.stringify(ev.oldValue)}</p>
                          )}
                          {ev.newValue && (
                            <p>Para: {typeof ev.newValue === "string" ? ev.newValue : JSON.stringify(ev.newValue)}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <Card className="text-center py-10">
                  <CardContent>
                    <Activity className="h-10 w-10 mx-auto text-muted-foreground/30 mb-3" />
                    <p className="text-sm text-muted-foreground">Sem eventos de mudança de metadata registrados.</p>
                  </CardContent>
                </Card>
              )}
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
    </div>
  );
}
