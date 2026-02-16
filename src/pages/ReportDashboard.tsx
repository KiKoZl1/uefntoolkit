import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft,
  BarChart3,
  Download,
  Search,
  Database,
  AlertTriangle,
  LineChart as LineChartIcon,
  Activity,
} from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
} from "recharts";
import ReactMarkdown from "react-markdown";

interface ParsedDataset {
  label?: string;
  category?: string;
  columns?: string[];
  rows?: Record<string, any>[];
  rowCount?: number;
  confidence?: string;
}

interface ReportData {
  id: string;
  status: string;
  parsed_data: Record<string, ParsedDataset> | null;
  metrics: {
    kpis: Record<string, number | string | null>;
    timeseries: Record<string, { date: string; value: number }[]>;
    rankings: Record<string, { name: string; value: number }[]>;
    distributions?: Record<string, { label: string; value: number }[]>;
  } | null;
  diagnostics: any[] | null;
  ai_summary: string | null;
}

function KpiCard({ label, value, unit }: { label: string; value: unknown; unit?: string }) {
  const v = typeof value === "number" ? value.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : value == null ? "--" : String(value);
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground uppercase tracking-wider">{label}</p>
        <p className="font-display text-2xl font-bold mt-1">
          {v}
          {unit ? <span className="text-sm font-normal text-muted-foreground ml-1">{unit}</span> : null}
        </p>
      </CardContent>
    </Card>
  );
}

function TimeChart({ data, label, color = "hsl(var(--primary))" }: { data: { date: string; value: number }[]; label: string; color?: string }) {
  if (!data?.length) return <p className="text-sm text-muted-foreground">Sem dados</p>;
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
        <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
        <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 12 }} />
        <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={false} name={label} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function RankingTable({ data, topN, query, nameLabel, valueLabel }: { data: { name: string; value: number }[]; topN: number; query: string; nameLabel: string; valueLabel: string }) {
  const q = query.trim().toLowerCase();
  const rows = (data || []).filter((r) => (!q ? true : r.name.toLowerCase().includes(q))).slice(0, topN);
  if (!rows.length) return <p className="text-sm text-muted-foreground">Sem dados</p>;

  return (
    <div className="rounded-lg border overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted/50 border-b">
            <th className="text-left p-2 font-medium">{nameLabel}</th>
            <th className="text-right p-2 font-medium">{valueLabel}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => (
            <tr key={idx} className="border-b last:border-0">
              <td className="p-2">{r.name}</td>
              <td className="p-2 text-right font-mono">{r.value.toLocaleString("pt-BR")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ReportDashboard() {
  const { id, reportId } = useParams<{ id: string; reportId: string }>();
  const [report, setReport] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [topN, setTopN] = useState(10);
  const [rankingQuery, setRankingQuery] = useState("");
  const [datasetQuery, setDatasetQuery] = useState("");

  useEffect(() => {
    if (!reportId) return;
    supabase
      .from("reports")
      .select("id,status,parsed_data,metrics,diagnostics,ai_summary")
      .eq("id", reportId)
      .single()
      .then(({ data }) => {
        if (data) setReport(data as any);
        setLoading(false);
      });
  }, [reportId]);

  const kpis = (report?.metrics?.kpis || {}) as Record<string, unknown>;
  const timeseries = (report?.metrics?.timeseries || {}) as Record<string, { date: string; value: number }[]>;
  const rankings = (report?.metrics?.rankings || {}) as Record<string, { name: string; value: number }[]>;
  const distributions = (report?.metrics?.distributions || {}) as Record<string, { label: string; value: number }[]>;
  const diagnostics = (report?.diagnostics || []) as any[];

  const datasetEntries = useMemo(() => {
    const parsed = report?.parsed_data || {};
    return Object.entries(parsed)
      .map(([key, ds]) => ({
        key,
        label: ds?.label || key,
        category: ds?.category || "unknown",
        confidence: ds?.confidence || "--",
        rows: ds?.rowCount || ds?.rows?.length || 0,
        columns: ds?.columns || [],
      }))
      .filter((d) => {
        const q = datasetQuery.trim().toLowerCase();
        return !q || d.key.toLowerCase().includes(q) || d.label.toLowerCase().includes(q);
      })
      .sort((a, b) => b.rows - a.rows);
  }, [report?.parsed_data, datasetQuery]);

  const exportJson = () => {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `report_${report.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

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
        <p className="text-muted-foreground">Relatorio nao encontrado.</p>
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
          <span className="font-display text-lg font-bold">CSV Report Dashboard</span>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <Link to={`/app/projects/${id}`} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-4 w-4" /> Voltar ao projeto
          </Link>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">Status: {report.status}</Badge>
            <Button size="sm" onClick={exportJson}>
              <Download className="h-4 w-4 mr-2" /> Exportar JSON
            </Button>
          </div>
        </div>

        <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
          <KpiCard label="Impressoes" value={kpis.total_impressions} />
          <KpiCard label="Cliques" value={kpis.total_clicks} />
          <KpiCard label="CTR" value={kpis.ctr} unit="%" />
          <KpiCard label="Ativos" value={kpis.total_active_people} />
          <KpiCard label="Ret D1" value={typeof kpis.retention_d1 === "number" ? (kpis.retention_d1 > 1 ? kpis.retention_d1 : kpis.retention_d1 * 100) : null} unit="%" />
          <KpiCard label="Ret D7" value={typeof kpis.retention_d7 === "number" ? (kpis.retention_d7 > 1 ? kpis.retention_d7 : kpis.retention_d7 * 100) : null} unit="%" />
        </div>

        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList className="flex flex-wrap gap-1">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="acquisition">Aquisicao</TabsTrigger>
            <TabsTrigger value="engagement">Engajamento</TabsTrigger>
            <TabsTrigger value="quality">Qualidade dos dados</TabsTrigger>
            <TabsTrigger value="actions">Plano de acao</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <div className="grid lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2"><LineChartIcon className="h-4 w-4" /> Impressoes</CardTitle>
                </CardHeader>
                <CardContent>
                  <TimeChart data={timeseries.impressions || []} label="Impressoes" />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2"><Activity className="h-4 w-4" /> Ativos</CardTitle>
                </CardHeader>
                <CardContent>
                  <TimeChart data={timeseries.active_people || []} label="Ativos" color="#22c55e" />
                </CardContent>
              </Card>
            </div>

            {report.ai_summary ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Resumo IA salvo</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="prose prose-sm dark:prose-invert max-w-none">
                    <ReactMarkdown>{report.ai_summary}</ReactMarkdown>
                  </div>
                </CardContent>
              </Card>
            ) : null}
          </TabsContent>

          <TabsContent value="acquisition" className="space-y-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                {[5, 10, 20, 50].map((n) => (
                  <Button key={n} size="sm" variant={topN === n ? "default" : "outline"} onClick={() => setTopN(n)}>{n}</Button>
                ))}
              </div>
              <div className="relative">
                <Search className="h-4 w-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
                <Input className="pl-9 w-64" placeholder="Filtrar ranking" value={rankingQuery} onChange={(e) => setRankingQuery(e.target.value)} />
              </div>
            </div>

            <div className="grid lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader><CardTitle className="text-sm">Cliques diarios</CardTitle></CardHeader>
                <CardContent><TimeChart data={timeseries.clicks || []} label="Cliques" color="#06b6d4" /></CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-sm">CTR diario</CardTitle></CardHeader>
                <CardContent><TimeChart data={timeseries.ctr || []} label="CTR" color="#f59e0b" /></CardContent>
              </Card>
            </div>

            <div className="grid lg:grid-cols-3 gap-6">
              <Card>
                <CardHeader><CardTitle className="text-sm">Impressoes por fonte</CardTitle></CardHeader>
                <CardContent><RankingTable data={rankings.impressions_by_source || []} topN={topN} query={rankingQuery} nameLabel="Fonte" valueLabel="Impressoes" /></CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-sm">Cliques por pais</CardTitle></CardHeader>
                <CardContent><RankingTable data={rankings.clicks_by_country || []} topN={topN} query={rankingQuery} nameLabel="Pais" valueLabel="Cliques" /></CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-sm">Cliques por plataforma</CardTitle></CardHeader>
                <CardContent><RankingTable data={rankings.clicks_by_platform || []} topN={topN} query={rankingQuery} nameLabel="Plataforma" valueLabel="Cliques" /></CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="engagement" className="space-y-6">
            <div className="grid lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader><CardTitle className="text-sm">Playtime</CardTitle></CardHeader>
                <CardContent><TimeChart data={timeseries.playtime || []} label="Playtime" /></CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-sm">Fila media</CardTitle></CardHeader>
                <CardContent><TimeChart data={timeseries.queue_avg || []} label="Queue" color="#a855f7" /></CardContent>
              </Card>
            </div>

            {distributions.session_duration?.length ? (
              <Card>
                <CardHeader><CardTitle className="text-sm">Distribuicao de sessao</CardTitle></CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={distributions.session_duration}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                      <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                      <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 12 }} />
                      <Bar dataKey="value" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            ) : null}
          </TabsContent>

          <TabsContent value="quality" className="space-y-6">
            <div className="grid sm:grid-cols-3 gap-4">
              <Card>
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground flex items-center gap-1"><Database className="h-3.5 w-3.5" /> Datasets</p>
                  <p className="font-display text-2xl font-bold mt-1">{datasetEntries.length}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground">Diagnosticos</p>
                  <p className="font-display text-2xl font-bold mt-1">{diagnostics.length}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground">Status report</p>
                  <p className="font-display text-2xl font-bold mt-1">{report.status}</p>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Catalogo de datasets</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="relative mb-3">
                  <Search className="h-4 w-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
                  <Input className="pl-9" placeholder="Buscar dataset" value={datasetQuery} onChange={(e) => setDatasetQuery(e.target.value)} />
                </div>
                <div className="rounded-lg border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/50 border-b">
                        <th className="text-left p-2 font-medium">Dataset</th>
                        <th className="text-left p-2 font-medium">Categoria</th>
                        <th className="text-left p-2 font-medium">Confianca</th>
                        <th className="text-right p-2 font-medium">Linhas</th>
                        <th className="text-right p-2 font-medium">Colunas</th>
                      </tr>
                    </thead>
                    <tbody>
                      {datasetEntries.map((d) => (
                        <tr key={d.key} className="border-b last:border-0">
                          <td className="p-2">
                            <p className="font-medium">{d.label}</p>
                            <p className="text-xs text-muted-foreground">{d.key}</p>
                          </td>
                          <td className="p-2">{d.category}</td>
                          <td className="p-2"><Badge variant="outline">{d.confidence}</Badge></td>
                          <td className="p-2 text-right font-mono">{d.rows.toLocaleString("pt-BR")}</td>
                          <td className="p-2 text-right font-mono">{d.columns.length}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="actions" className="space-y-4">
            {diagnostics.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">Nenhum diagnostico encontrado neste report.</CardContent>
              </Card>
            ) : (
              diagnostics.map((d, idx) => (
                <Card key={idx}>
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="h-4 w-4 mt-0.5 text-amber-500" />
                      <div className="space-y-1 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-medium">{d.title || "Diagnostico"}</p>
                          <Badge variant={d.priority === "P0" ? "destructive" : d.priority === "P1" ? "default" : "secondary"}>{d.priority || "P2"}</Badge>
                        </div>
                        {d.description ? <p className="text-sm text-muted-foreground">{d.description}</p> : null}
                        {d.action ? <p className="text-sm"><span className="font-medium">Acao:</span> {d.action}</p> : null}
                        {d.evidence ? <p className="text-xs font-mono text-muted-foreground">{d.evidence}</p> : null}
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
