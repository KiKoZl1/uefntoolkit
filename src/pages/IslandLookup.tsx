import { useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Search, Loader2, Users, Play, Clock, Star, ThumbsUp, TrendingUp, BarChart3 } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";

interface IslandData {
  metadata: {
    code: string;
    title: string;
    creatorCode: string;
    category: string | null;
    tags: string[];
    createdIn: string | null;
  };
  dailyMetrics: any;
  hourlyMetrics: any;
}

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
  return Math.max(...metrics[key].map((m: any) => m.value ?? 0));
}

const chartColors = {
  primary: "hsl(252, 85%, 60%)",
  accent: "hsl(168, 70%, 45%)",
  warning: "hsl(38, 92%, 50%)",
};

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

export default function IslandLookup() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "pt-BR" ? "pt-BR" : "en-US";

  const [code, setCode] = useState("");
  const [data, setData] = useState<IslandData | null>(null);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    setLoading(true);
    setData(null);
    try {
      const res = await supabase.functions.invoke("discover-island-lookup", {
        body: { islandCode: code.trim() },
      });
      if (res.error) throw res.error;
      if (res.data?.error) throw new Error(res.data.error);
      setData(res.data);
    } catch (e: any) {
      toast({ title: t("common.error"), description: e.message || t("islandLookup.islandNotFound"), variant: "destructive" });
    }
    setLoading(false);
  };

  const daily = data?.dailyMetrics;
  const retention = daily ? extractRetention(daily, locale) : [];

  const fmtVal = (v: number) => {
    if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + "M";
    if (v >= 1_000) return (v / 1_000).toFixed(1) + "K";
    return v.toLocaleString(locale);
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="font-display text-2xl font-bold flex items-center gap-2">
          <Search className="h-6 w-6 text-primary" />
          {t("islandLookup.title")}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">{t("islandLookup.subtitle")}</p>
      </div>

      <form onSubmit={handleSearch} className="flex gap-3 mb-8 max-w-lg">
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder={t("islandLookup.placeholder")}
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
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-start justify-between flex-wrap gap-4">
                <div>
                  <h2 className="font-display text-xl font-bold">{data.metadata.title}</h2>
                  <p className="text-sm text-muted-foreground">
                    {t("islandLookup.code")}: {data.metadata.code} · {t("islandLookup.creator")}: {data.metadata.creatorCode || "—"}
                  </p>
                  <div className="flex gap-2 mt-2 flex-wrap">
                    {data.metadata.category && <Badge variant="secondary">{data.metadata.category}</Badge>}
                    {data.metadata.createdIn && <Badge variant="outline">{data.metadata.createdIn}</Badge>}
                    {data.metadata.tags?.map((tag) => (
                      <Badge key={tag} variant="outline" className="text-xs">{tag}</Badge>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {daily && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {[
                { icon: Users, label: t("kpis.uniquePlayers"), value: sumMetric(daily, "uniquePlayers") },
                { icon: Play, label: t("kpis.totalPlays"), value: sumMetric(daily, "plays") },
                { icon: Clock, label: t("kpis.minutesPlayed"), value: sumMetric(daily, "minutesPlayed") },
                { icon: BarChart3, label: t("kpis.peakCCU"), value: maxMetric(daily, "peakCCU") },
                { icon: Star, label: t("kpis.favorites"), value: sumMetric(daily, "favorites") },
                { icon: ThumbsUp, label: t("kpis.recommendations"), value: sumMetric(daily, "recommendations") },
              ].map((kpi) => (
                <Card key={kpi.label}>
                  <CardContent className="pt-4 pb-3 text-center">
                    <kpi.icon className="h-4 w-4 mx-auto text-primary mb-1" />
                    <p className="text-xs text-muted-foreground">{kpi.label}</p>
                    <p className="font-display font-bold text-lg">{fmtVal(kpi.value)}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {daily && (
            <div className="grid md:grid-cols-2 gap-4">
              <MetricChart title={t("islandLookup.chartUnique")} data={extractTimeseries(daily, "uniquePlayers", locale)} dataKey="value" color={chartColors.primary} />
              <MetricChart title={t("islandLookup.chartPlays")} data={extractTimeseries(daily, "plays", locale)} dataKey="value" color={chartColors.accent} />
              <MetricChart title={t("islandLookup.chartCCU")} data={extractTimeseries(daily, "peakCCU", locale)} dataKey="value" color={chartColors.warning} />
              <MetricChart title={t("islandLookup.chartAvgMin")} data={extractTimeseries(daily, "averageMinutesPerPlayer", locale)} dataKey="value" color={chartColors.primary} />
            </div>
          )}

          {retention.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-primary" /> {t("islandLookup.retentionChart")}
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
