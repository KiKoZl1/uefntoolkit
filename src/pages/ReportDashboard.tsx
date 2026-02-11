import { useEffect, useState, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { BarChart3, ArrowLeft, TrendingUp, TrendingDown, Minus, AlertTriangle } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from "recharts";

interface ReportData {
  id: string;
  status: string;
  parsed_data: Record<string, { columns: string[]; rows: Record<string, any>[] }> | null;
  metrics: {
    kpis: Record<string, number | string | null>;
    timeseries: Record<string, { date: string; value: number }[]>;
    rankings: Record<string, { name: string; value: number }[]>;
  };
  diagnostics: {
    priority: string;
    area: string;
    title: string;
    description: string;
    evidence: string;
    action: string;
  }[];
  ai_summary: string | null;
}

/** Rebuild rankings from pivoted parsed_data when saved rankings have dates as names */
function rebuildRankingsFromParsedData(
  savedRankings: Record<string, { name: string; value: number }[]>,
  parsedData: Record<string, { columns: string[]; rows: Record<string, any>[] }> | null
): Record<string, { name: string; value: number }[]> {
  if (!parsedData) return savedRankings;

  const datePattern = /^\d{4}-\d{2}-\d{2}/;
  const dateHints = ['date', 'data', 'dia', 'day', 'semana', 'week'];
  
  const unpivot = (datasetKey: string, rankingKey: string) => {
    const ranking = savedRankings[rankingKey];
    if (!ranking || ranking.length === 0) return;
    
    // Check if ranking names look like dates
    const hasDateNames = ranking.some(r => datePattern.test(r.name));
    if (!hasDateNames) return;
    
    const ds = parsedData[datasetKey];
    if (!ds) return;
    
    const valueCols = ds.columns.filter(c => {
      const cn = c.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      return !dateHints.some(h => cn === h);
    });
    
    if (valueCols.length <= 1) return;
    
    const totals = valueCols.map(col => ({
      name: col.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
      value: ds.rows.reduce((sum, r) => sum + (typeof r[col] === 'number' ? r[col] : 0), 0),
    }));
    
    savedRankings[rankingKey] = totals.sort((a, b) => b.value - a.value).slice(0, 10);
  };

  unpivot('acq_impressions_source', 'impressions_by_source');
  unpivot('acq_clicks_country', 'clicks_by_country');
  unpivot('acq_clicks_platform', 'clicks_by_platform');
  
  return savedRankings;
}

function KpiCard({ label, value, unit }: { label: string; value: any; unit?: string }) {
  const display = value === null || value === undefined ? '—' : typeof value === 'number' ? value.toLocaleString('pt-BR') : String(value);
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground uppercase tracking-wider">{label}</p>
        <p className="font-display text-2xl font-bold mt-1">
          {display}{unit && <span className="text-sm font-normal text-muted-foreground ml-1">{unit}</span>}
        </p>
      </CardContent>
    </Card>
  );
}

function TimeseriesChart({ data, label, color = "hsl(var(--primary))" }: { data: { date: string; value: number }[]; label: string; color?: string }) {
  if (!data || data.length === 0) return <p className="text-sm text-muted-foreground">Sem dados disponíveis.</p>;
  return (
    <ResponsiveContainer width="100%" height={250}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
        <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
        <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }} />
        <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={false} name={label} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function RankingTable({ data, nameLabel, valueLabel }: { data: { name: string; value: number }[]; nameLabel: string; valueLabel: string }) {
  if (!data || data.length === 0) return <p className="text-sm text-muted-foreground">Sem dados disponíveis.</p>;
  return (
    <div className="rounded-lg border overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="text-left p-2 font-medium">{nameLabel}</th>
            <th className="text-right p-2 font-medium">{valueLabel}</th>
          </tr>
        </thead>
        <tbody>
          {data.map((r, i) => (
            <tr key={i} className="border-b last:border-0">
              <td className="p-2">{r.name}</td>
              <td className="p-2 text-right font-mono">{r.value.toLocaleString('pt-BR')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const variant = priority === 'P0' ? 'destructive' : priority === 'P1' ? 'default' : 'secondary';
  return <Badge variant={variant}>{priority}</Badge>;
}

export default function ReportDashboard() {
  const { id, reportId } = useParams<{ id: string; reportId: string }>();
  const [report, setReport] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!reportId) return;
    supabase
      .from("reports")
      .select("id, status, metrics, diagnostics, ai_summary, parsed_data")
      .eq("id", reportId)
      .single()
      .then(({ data }) => {
        if (data) setReport(data as any);
        setLoading(false);
      });
  }, [reportId]);

  const { kpis, timeseries, rankings } = useMemo(() => {
    if (!report?.metrics) return { kpis: {}, timeseries: {}, rankings: {} };
    const { kpis, timeseries, rankings: savedRankings } = report.metrics;
    const rankings = rebuildRankingsFromParsedData({ ...savedRankings }, report.parsed_data);
    return { kpis: kpis || {}, timeseries: timeseries || {}, rankings };
  }, [report]);

  const diagnostics = useMemo(() => (report?.diagnostics as any[]) || [], [report]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!report) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-muted-foreground">Relatório não encontrado.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <nav className="flex items-center justify-between px-6 py-4 border-b max-w-7xl mx-auto">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
            <BarChart3 className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="font-display text-lg font-bold">Island Analytics</span>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6 py-8">
        <Link to={`/app/projects/${id}`} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6">
          <ArrowLeft className="h-4 w-4" /> Voltar ao projeto
        </Link>

        <h1 className="font-display text-2xl font-bold mb-6">Dashboard do Relatório</h1>

        <Tabs defaultValue="summary" className="space-y-6">
          <TabsList className="flex flex-wrap gap-1">
            <TabsTrigger value="summary">Resumo</TabsTrigger>
            <TabsTrigger value="acquisition">Aquisição</TabsTrigger>
            <TabsTrigger value="engagement">Engajamento</TabsTrigger>
            <TabsTrigger value="retention">Retenção</TabsTrigger>
            <TabsTrigger value="surveys">Surveys</TabsTrigger>
            <TabsTrigger value="actions">Plano de Ação</TabsTrigger>
          </TabsList>

          {/* Executive Summary */}
          <TabsContent value="summary" className="space-y-6">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              <KpiCard label="Impressões" value={kpis.total_impressions} />
              <KpiCard label="Cliques" value={kpis.total_clicks} />
              <KpiCard label="CTR" value={kpis.ctr} unit="%" />
              <KpiCard label="Pessoas Ativas" value={kpis.total_active_people} />
              <KpiCard label="Tempo Médio/Jogador" value={kpis.avg_playtime_per_player} unit="min" />
              <KpiCard label="Retenção D1" value={typeof kpis.retention_d1 === 'number' ? (kpis.retention_d1 > 1 ? kpis.retention_d1 : (kpis.retention_d1 * 100)) : null} unit="%" />
              <KpiCard label="Retenção D7" value={typeof kpis.retention_d7 === 'number' ? (kpis.retention_d7 > 1 ? kpis.retention_d7 : (kpis.retention_d7 * 100)) : null} unit="%" />
              <KpiCard label="Fila P95" value={kpis.queue_p95} unit="s" />
            </div>

            {diagnostics.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="font-display text-lg flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-amber-500" /> Diagnósticos Principais
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {diagnostics.slice(0, 5).map((d, i) => (
                    <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                      <PriorityBadge priority={d.priority} />
                      <div className="flex-1">
                        <p className="font-medium text-sm">{d.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{d.evidence}</p>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Acquisition */}
          <TabsContent value="acquisition" className="space-y-6">
            <div className="grid lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader><CardTitle className="text-sm">Impressões ao longo do tempo</CardTitle></CardHeader>
                <CardContent>
                  <TimeseriesChart data={timeseries.impressions} label="Impressões" />
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-sm">Cliques ao longo do tempo</CardTitle></CardHeader>
                <CardContent>
                  <TimeseriesChart data={timeseries.clicks} label="Cliques" />
                </CardContent>
              </Card>
            </div>

            <div className="grid lg:grid-cols-3 gap-6">
              {rankings.impressions_by_source && (
                <Card>
                  <CardHeader><CardTitle className="text-sm">Top Fontes</CardTitle></CardHeader>
                  <CardContent>
                    <RankingTable data={rankings.impressions_by_source} nameLabel="Fonte" valueLabel="Impressões" />
                  </CardContent>
                </Card>
              )}
              {rankings.clicks_by_country && (
                <Card>
                  <CardHeader><CardTitle className="text-sm">Top Países</CardTitle></CardHeader>
                  <CardContent>
                    <RankingTable data={rankings.clicks_by_country} nameLabel="País" valueLabel="Cliques" />
                  </CardContent>
                </Card>
              )}
              {rankings.clicks_by_platform && (
                <Card>
                  <CardHeader><CardTitle className="text-sm">Por Plataforma</CardTitle></CardHeader>
                  <CardContent>
                    <RankingTable data={rankings.clicks_by_platform} nameLabel="Plataforma" valueLabel="Cliques" />
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          {/* Engagement */}
          <TabsContent value="engagement" className="space-y-6">
            <div className="grid lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader><CardTitle className="text-sm">Tempo de Jogo</CardTitle></CardHeader>
                <CardContent>
                  <TimeseriesChart data={timeseries.playtime} label="Playtime" />
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-sm">Pessoas Ativas</CardTitle></CardHeader>
                <CardContent>
                  <TimeseriesChart data={timeseries.active_people} label="Ativos" />
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Retention */}
          <TabsContent value="retention" className="space-y-6">
            <div className="grid lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader><CardTitle className="text-sm">Retenção D1</CardTitle></CardHeader>
                <CardContent>
                  <TimeseriesChart data={timeseries.retention_d1} label="D1" />
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-sm">Retenção D7</CardTitle></CardHeader>
                <CardContent>
                  <TimeseriesChart data={timeseries.retention_d7} label="D7" />
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Surveys */}
          <TabsContent value="surveys" className="space-y-6">
            <Card>
              <CardHeader><CardTitle className="text-sm">Avaliação ao longo do tempo</CardTitle></CardHeader>
              <CardContent>
                <TimeseriesChart data={timeseries.rating} label="Nota" />
              </CardContent>
            </Card>
          </TabsContent>

          {/* Action Plan */}
          <TabsContent value="actions" className="space-y-4">
            {diagnostics.length === 0 ? (
              <Card className="text-center py-12">
                <CardContent>
                  <p className="text-muted-foreground">Sem diagnósticos identificados. Seus dados parecem saudáveis!</p>
                </CardContent>
              </Card>
            ) : (
              diagnostics.map((d, i) => (
                <Card key={i}>
                  <CardContent className="p-5">
                    <div className="flex items-start gap-3">
                      <PriorityBadge priority={d.priority} />
                      <div className="flex-1 space-y-1">
                        <p className="font-display font-semibold">{d.title}</p>
                        <p className="text-sm text-muted-foreground">{d.description}</p>
                        <p className="text-xs font-mono bg-muted/50 rounded px-2 py-1 inline-block">{d.evidence}</p>
                        <p className="text-sm mt-2">
                          <span className="font-medium">Ação:</span> {d.action}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
