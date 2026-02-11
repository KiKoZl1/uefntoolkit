import { useEffect, useState, useMemo, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { BarChart3, ArrowLeft, AlertTriangle, Bot, Send, Loader2, Sparkles } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell } from "recharts";
import ReactMarkdown from "react-markdown";

// ── Types ──

interface ReportData {
  id: string;
  status: string;
  parsed_data: Record<string, { columns: string[]; rows: Record<string, any>[] }> | null;
  metrics: {
    kpis: Record<string, number | string | null>;
    timeseries: Record<string, { date: string; value: number }[]>;
    rankings: Record<string, { name: string; value: number }[]>;
    distributions?: Record<string, { label: string; value: number }[]>;
  };
  diagnostics: any[];
  ai_summary: string | null;
}

type ChatMsg = { role: "user" | "assistant"; content: string };

// ── Helpers ──

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-analyst`;
const COLORS = [
  "hsl(var(--primary))", "hsl(var(--accent))", 
  "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899"
];

function rebuildRankingsFromParsedData(
  savedRankings: Record<string, { name: string; value: number }[]>,
  parsedData: Record<string, { columns: string[]; rows: Record<string, any>[] }> | null
): Record<string, { name: string; value: number }[]> {
  if (!parsedData) return savedRankings;
  const datePattern = /^\d{4}-\d{2}-\d{2}/;
  const dateHints = ['date', 'data', 'dia', 'day', 'semana', 'week'];

  const unpivot = (datasetKey: string, rankingKey: string) => {
    const ranking = savedRankings[rankingKey];
    if (!ranking || !ranking.some(r => datePattern.test(r.name))) return;
    const ds = parsedData[datasetKey];
    if (!ds) return;
    const valueCols = ds.columns.filter(c => {
      const cn = c.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      return !dateHints.some(h => cn === h);
    });
    if (valueCols.length <= 1) return;
    savedRankings[rankingKey] = valueCols.map(col => ({
      name: col.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
      value: ds.rows.reduce((sum, r) => sum + (typeof r[col] === 'number' ? r[col] : 0), 0),
    })).sort((a, b) => b.value - a.value).slice(0, 10);
  };

  const pivotMappings: [string, string][] = [
    ['acq_impressions_source', 'impressions_by_source'],
    ['acq_impressions_country', 'impressions_by_country'],
    ['acq_impressions_platform', 'impressions_by_platform'],
    ['acq_clicks_country', 'clicks_by_country'],
    ['acq_clicks_platform', 'clicks_by_platform'],
    ['acq_clicks_source', 'clicks_by_source'],
    ['eng_playtime_country', 'playtime_by_country'],
    ['eng_playtime_platform', 'playtime_by_platform'],
    ['eng_active_country', 'active_by_country'],
    ['eng_active_platform', 'active_by_platform'],
  ];
  pivotMappings.forEach(([ds, rk]) => unpivot(ds, rk));
  return savedRankings;
}

// ── Sub-components ──

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
  if (!data || data.length === 0) return <p className="text-sm text-muted-foreground">Sem dados.</p>;
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
        <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
        <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', fontSize: 12 }} />
        <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={false} name={label} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function RankingTable({ data, nameLabel, valueLabel }: { data: { name: string; value: number }[]; nameLabel: string; valueLabel: string }) {
  if (!data || data.length === 0) return <p className="text-sm text-muted-foreground">Sem dados.</p>;
  return (
    <div className="rounded-lg border overflow-hidden">
      <table className="w-full text-sm">
        <thead><tr className="border-b bg-muted/50"><th className="text-left p-2 font-medium">{nameLabel}</th><th className="text-right p-2 font-medium">{valueLabel}</th></tr></thead>
        <tbody>
          {data.map((r, i) => (
            <tr key={i} className="border-b last:border-0"><td className="p-2">{r.name}</td><td className="p-2 text-right font-mono">{r.value.toLocaleString('pt-BR')}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DistributionChart({ data, title }: { data: { label: string; value: number }[]; title: string }) {
  if (!data || data.length === 0) return null;
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="label" tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" />
            <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
            <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', fontSize: 12 }} />
            <Bar dataKey="value" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const variant = priority === 'P0' ? 'destructive' : priority === 'P1' ? 'default' : 'secondary';
  return <Badge variant={variant}>{priority}</Badge>;
}

// ── AI Chat ──

function AiChat({ reportData }: { reportData: ReportData }) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;
    const userMsg: ChatMsg = { role: "user", content: input.trim() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setIsLoading(true);

    let assistantSoFar = "";
    const upsertAssistant = (chunk: string) => {
      assistantSoFar += chunk;
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant") {
          return prev.map((m, i) => i === prev.length - 1 ? { ...m, content: assistantSoFar } : m);
        }
        return [...prev, { role: "assistant", content: assistantSoFar }];
      });
    };

    try {
      const resp = await fetch(CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          messages: newMessages,
          reportData: {
            kpis: reportData.metrics?.kpis,
            rankings: reportData.metrics?.rankings,
            distributions: reportData.metrics?.distributions,
            diagnostics: reportData.diagnostics,
          },
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Erro desconhecido" }));
        toast({ title: "Erro", description: err.error, variant: "destructive" });
        setIsLoading(false);
        return;
      }

      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
          let line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") break;
          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) upsertAssistant(content);
          } catch { buffer = line + "\n" + buffer; break; }
        }
      }
    } catch (e) {
      toast({ title: "Erro de conexão", description: "Não foi possível conectar ao analista de IA.", variant: "destructive" });
    }
    setIsLoading(false);
  };

  return (
    <Card className="flex flex-col h-[500px]">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Bot className="h-4 w-4" /> Analista de Game Design IA
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col overflow-hidden p-0 px-6 pb-4">
        <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-4 mb-4">
          {messages.length === 0 && (
            <div className="text-center py-8 text-muted-foreground text-sm space-y-2">
              <Bot className="h-10 w-10 mx-auto opacity-50" />
              <p>Pergunte sobre seus dados!</p>
              <div className="flex flex-wrap gap-2 justify-center mt-3">
                {["Por que meu D7 está baixo?", "Como melhorar o CTR?", "Análise completa"].map(q => (
                  <Button key={q} variant="outline" size="sm" className="text-xs" onClick={() => { setInput(q); }}>
                    {q}
                  </Button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                {m.role === 'assistant' ? (
                  <div className="prose prose-sm dark:prose-invert max-w-none">
                    <ReactMarkdown>{m.content}</ReactMarkdown>
                  </div>
                ) : m.content}
              </div>
            </div>
          ))}
          {isLoading && messages[messages.length - 1]?.role !== 'assistant' && (
            <div className="flex justify-start">
              <div className="bg-muted rounded-lg px-3 py-2"><Loader2 className="h-4 w-4 animate-spin" /></div>
            </div>
          )}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); sendMessage(); }} className="flex gap-2">
          <Input
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Pergunte sobre seus dados..."
            disabled={isLoading}
            className="flex-1"
          />
          <Button type="submit" size="icon" disabled={isLoading || !input.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

// ── AI Summary Generator ──

function AiSummary({ reportData, savedSummary, reportId }: { reportData: ReportData; savedSummary: string | null; reportId: string }) {
  const [summary, setSummary] = useState(savedSummary || "");
  const [generating, setGenerating] = useState(false);
  const { toast } = useToast();

  const generate = async () => {
    setGenerating(true);
    setSummary("");
    let soFar = "";

    try {
      const resp = await fetch(CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          mode: "summary",
          reportData: {
            kpis: reportData.metrics?.kpis,
            rankings: reportData.metrics?.rankings,
            distributions: reportData.metrics?.distributions,
            diagnostics: reportData.diagnostics,
          },
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Erro" }));
        toast({ title: "Erro", description: err.error, variant: "destructive" });
        setGenerating(false);
        return;
      }

      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n")) !== -1) {
          let line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line.startsWith("data: ")) continue;
          const json = line.slice(6).trim();
          if (json === "[DONE]") break;
          try {
            const p = JSON.parse(json);
            const c = p.choices?.[0]?.delta?.content;
            if (c) { soFar += c; setSummary(soFar); }
          } catch { buffer = line + "\n" + buffer; break; }
        }
      }

      // Save summary to DB
      await supabase.from("reports").update({ ai_summary: soFar }).eq("id", reportId);
    } catch {
      toast({ title: "Erro", description: "Falha na geração.", variant: "destructive" });
    }
    setGenerating(false);
  };

  if (!summary && !generating) {
    return (
      <Card className="text-center py-8">
        <CardContent>
          <Sparkles className="h-10 w-10 mx-auto text-primary mb-3" />
          <h3 className="font-display font-semibold mb-2">Diagnóstico por IA</h3>
          <p className="text-sm text-muted-foreground mb-4">Gere um resumo executivo completo com diagnóstico e recomendações baseadas nos seus dados.</p>
          <Button onClick={generate}><Sparkles className="h-4 w-4 mr-2" /> Gerar Análise IA</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" /> Análise do Consultor IA
          {generating && <Loader2 className="h-4 w-4 animate-spin" />}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <ReactMarkdown>{summary}</ReactMarkdown>
        </div>
        {!generating && (
          <Button variant="outline" size="sm" onClick={generate} className="mt-4">
            <Sparkles className="h-3 w-3 mr-1" /> Regenerar
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ── Main Dashboard ──

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

  const { kpis, timeseries, rankings, distributions } = useMemo(() => {
    if (!report?.metrics) return { kpis: {} as any, timeseries: {} as any, rankings: {} as any, distributions: {} as any };
    const { kpis, timeseries, rankings: savedRankings, distributions } = report.metrics;
    const rankings = rebuildRankingsFromParsedData({ ...savedRankings }, report.parsed_data);
    return { kpis: kpis || {}, timeseries: timeseries || {}, rankings, distributions: distributions || {} };
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
            <TabsTrigger value="changelog">Changelog</TabsTrigger>
            <TabsTrigger value="actions">Plano de Ação</TabsTrigger>
            <TabsTrigger value="ai">🤖 IA</TabsTrigger>
          </TabsList>

          {/* ── SUMMARY ── */}
          <TabsContent value="summary" className="space-y-6">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              <KpiCard label="Impressões" value={kpis.total_impressions} />
              <KpiCard label="Cliques" value={kpis.total_clicks} />
              <KpiCard label="CTR" value={kpis.ctr} unit="%" />
              <KpiCard label="Jogos" value={kpis.total_games} />
              <KpiCard label="Pessoas Ativas" value={kpis.total_active_people} />
              <KpiCard label="Tempo Médio/Jogador" value={kpis.avg_playtime_per_player} unit="min" />
              <KpiCard label="Retenção D1" value={typeof kpis.retention_d1 === 'number' ? (kpis.retention_d1 > 1 ? kpis.retention_d1 : (kpis.retention_d1 * 100)) : null} unit="%" />
              <KpiCard label="Retenção D7" value={typeof kpis.retention_d7 === 'number' ? (kpis.retention_d7 > 1 ? kpis.retention_d7 : (kpis.retention_d7 * 100)) : null} unit="%" />
              <KpiCard label="Nota Média" value={kpis.avg_rating} unit="/10" />
              <KpiCard label="Fila Média" value={kpis.queue_avg} unit="s" />
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
                  {diagnostics.slice(0, 5).map((d: any, i: number) => (
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

            <AiSummary reportData={report} savedSummary={report.ai_summary} reportId={report.id} />
          </TabsContent>

          {/* ── ACQUISITION ── */}
          <TabsContent value="acquisition" className="space-y-6">
            <div className="grid lg:grid-cols-2 gap-6">
              <Card><CardHeader><CardTitle className="text-sm">Impressões</CardTitle></CardHeader><CardContent><TimeseriesChart data={timeseries.impressions} label="Impressões" /></CardContent></Card>
              <Card><CardHeader><CardTitle className="text-sm">Cliques</CardTitle></CardHeader><CardContent><TimeseriesChart data={timeseries.clicks} label="Cliques" /></CardContent></Card>
            </div>
            {timeseries.ctr && (
              <Card><CardHeader><CardTitle className="text-sm">CTR ao longo do tempo</CardTitle></CardHeader><CardContent><TimeseriesChart data={timeseries.ctr} label="CTR %" color="#f59e0b" /></CardContent></Card>
            )}
            <div className="grid lg:grid-cols-3 gap-6">
              {rankings.impressions_by_source?.length > 0 && <Card><CardHeader><CardTitle className="text-sm">Top Fontes (Impressões)</CardTitle></CardHeader><CardContent><RankingTable data={rankings.impressions_by_source} nameLabel="Fonte" valueLabel="Impressões" /></CardContent></Card>}
              {rankings.clicks_by_country?.length > 0 && <Card><CardHeader><CardTitle className="text-sm">Top Países (Cliques)</CardTitle></CardHeader><CardContent><RankingTable data={rankings.clicks_by_country} nameLabel="País" valueLabel="Cliques" /></CardContent></Card>}
              {rankings.clicks_by_platform?.length > 0 && <Card><CardHeader><CardTitle className="text-sm">Por Plataforma (Cliques)</CardTitle></CardHeader><CardContent><RankingTable data={rankings.clicks_by_platform} nameLabel="Plataforma" valueLabel="Cliques" /></CardContent></Card>}
            </div>
            <div className="grid lg:grid-cols-3 gap-6">
              {rankings.clicks_by_source?.length > 0 && <Card><CardHeader><CardTitle className="text-sm">Top Fontes (Cliques)</CardTitle></CardHeader><CardContent><RankingTable data={rankings.clicks_by_source} nameLabel="Fonte" valueLabel="Cliques" /></CardContent></Card>}
              {rankings.impressions_by_country?.length > 0 && <Card><CardHeader><CardTitle className="text-sm">Top Países (Impressões)</CardTitle></CardHeader><CardContent><RankingTable data={rankings.impressions_by_country} nameLabel="País" valueLabel="Impressões" /></CardContent></Card>}
              {rankings.impressions_by_platform?.length > 0 && <Card><CardHeader><CardTitle className="text-sm">Por Plataforma (Impressões)</CardTitle></CardHeader><CardContent><RankingTable data={rankings.impressions_by_platform} nameLabel="Plataforma" valueLabel="Impressões" /></CardContent></Card>}
            </div>
          </TabsContent>

          {/* ── ENGAGEMENT ── */}
          <TabsContent value="engagement" className="space-y-6">
            <div className="grid lg:grid-cols-2 gap-6">
              <Card><CardHeader><CardTitle className="text-sm">Tempo de Jogo</CardTitle></CardHeader><CardContent><TimeseriesChart data={timeseries.playtime} label="Playtime" /></CardContent></Card>
              <Card><CardHeader><CardTitle className="text-sm">Pessoas Ativas</CardTitle></CardHeader><CardContent><TimeseriesChart data={timeseries.active_people} label="Ativos" /></CardContent></Card>
            </div>
            <div className="grid lg:grid-cols-2 gap-6">
              {timeseries.games && <Card><CardHeader><CardTitle className="text-sm">Jogos/Partidas</CardTitle></CardHeader><CardContent><TimeseriesChart data={timeseries.games} label="Jogos" color="#22c55e" /></CardContent></Card>}
              {timeseries.queue_avg && <Card><CardHeader><CardTitle className="text-sm">Tempo de Fila (Média)</CardTitle></CardHeader><CardContent><TimeseriesChart data={timeseries.queue_avg} label="Fila (s)" color="#f59e0b" /></CardContent></Card>}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <KpiCard label="Fila P25" value={kpis.queue_p25} unit="s" />
              <KpiCard label="Fila Média" value={kpis.queue_avg} unit="s" />
              <KpiCard label="Fila P75" value={kpis.queue_p75} unit="s" />
              <KpiCard label="Fila P95" value={kpis.queue_p95} unit="s" />
            </div>
            {distributions.session_duration && <DistributionChart data={distributions.session_duration} title="Distribuição de Duração de Sessão" />}
            <div className="grid lg:grid-cols-2 gap-6">
              {rankings.playtime_by_country?.length > 0 && <Card><CardHeader><CardTitle className="text-sm">Tempo de Jogo por País</CardTitle></CardHeader><CardContent><RankingTable data={rankings.playtime_by_country} nameLabel="País" valueLabel="Tempo" /></CardContent></Card>}
              {rankings.playtime_by_platform?.length > 0 && <Card><CardHeader><CardTitle className="text-sm">Tempo de Jogo por Plataforma</CardTitle></CardHeader><CardContent><RankingTable data={rankings.playtime_by_platform} nameLabel="Plataforma" valueLabel="Tempo" /></CardContent></Card>}
            </div>
            <div className="grid lg:grid-cols-2 gap-6">
              {rankings.active_by_country?.length > 0 && <Card><CardHeader><CardTitle className="text-sm">Ativos por País</CardTitle></CardHeader><CardContent><RankingTable data={rankings.active_by_country} nameLabel="País" valueLabel="Ativos" /></CardContent></Card>}
              {rankings.active_by_platform?.length > 0 && <Card><CardHeader><CardTitle className="text-sm">Ativos por Plataforma</CardTitle></CardHeader><CardContent><RankingTable data={rankings.active_by_platform} nameLabel="Plataforma" valueLabel="Ativos" /></CardContent></Card>}
            </div>
          </TabsContent>

          {/* ── RETENTION ── */}
          <TabsContent value="retention" className="space-y-6">
            <div className="grid grid-cols-2 gap-4 mb-4">
              <KpiCard label="Retenção D1" value={typeof kpis.retention_d1 === 'number' ? (kpis.retention_d1 > 1 ? kpis.retention_d1 : (kpis.retention_d1 * 100)) : null} unit="%" />
              <KpiCard label="Retenção D7" value={typeof kpis.retention_d7 === 'number' ? (kpis.retention_d7 > 1 ? kpis.retention_d7 : (kpis.retention_d7 * 100)) : null} unit="%" />
            </div>
            <div className="grid lg:grid-cols-2 gap-6">
              <Card><CardHeader><CardTitle className="text-sm">Retenção D1</CardTitle></CardHeader><CardContent><TimeseriesChart data={timeseries.retention_d1} label="D1" /></CardContent></Card>
              <Card><CardHeader><CardTitle className="text-sm">Retenção D7</CardTitle></CardHeader><CardContent><TimeseriesChart data={timeseries.retention_d7} label="D7" /></CardContent></Card>
            </div>
            {timeseries.new_players && (
              <Card><CardHeader><CardTitle className="text-sm">Novos Jogadores</CardTitle></CardHeader><CardContent><TimeseriesChart data={timeseries.new_players} label="Novos" color="#8b5cf6" /></CardContent></Card>
            )}
          </TabsContent>

          {/* ── SURVEYS ── */}
          <TabsContent value="surveys" className="space-y-6">
            <div className="grid lg:grid-cols-2 gap-6">
              <Card><CardHeader><CardTitle className="text-sm">Avaliação 1-10 ao longo do tempo</CardTitle></CardHeader><CardContent><TimeseriesChart data={timeseries.rating} label="Nota" /></CardContent></Card>
              <KpiCard label="Nota Média" value={kpis.avg_rating} unit="/10" />
            </div>
            <div className="grid lg:grid-cols-2 gap-6">
              {distributions.rating_summary && <DistributionChart data={distributions.rating_summary} title="Avaliação 1-10 — Distribuição" />}
              {distributions.rating_benchmark && <DistributionChart data={distributions.rating_benchmark} title="Avaliação 1-10 — Benchmark" />}
            </div>
            <div className="grid lg:grid-cols-2 gap-6">
              {timeseries.fun && <Card><CardHeader><CardTitle className="text-sm">Diversão ao longo do tempo</CardTitle></CardHeader><CardContent><TimeseriesChart data={timeseries.fun} label="Diversão" color="#22c55e" /></CardContent></Card>}
              {timeseries.difficulty && <Card><CardHeader><CardTitle className="text-sm">Dificuldade ao longo do tempo</CardTitle></CardHeader><CardContent><TimeseriesChart data={timeseries.difficulty} label="Dificuldade" color="#f59e0b" /></CardContent></Card>}
            </div>
            <div className="grid lg:grid-cols-2 gap-6">
              {distributions.fun_summary && <DistributionChart data={distributions.fun_summary} title="Diversão — Resumo" />}
              {distributions.fun_benchmark && <DistributionChart data={distributions.fun_benchmark} title="Diversão — Benchmark" />}
            </div>
            <div className="grid lg:grid-cols-2 gap-6">
              {distributions.difficulty_summary && <DistributionChart data={distributions.difficulty_summary} title="Dificuldade — Distribuição" />}
              {distributions.difficulty_benchmark && <DistributionChart data={distributions.difficulty_benchmark} title="Dificuldade — Benchmark" />}
            </div>
          </TabsContent>

          {/* ── CHANGELOG ── */}
          <TabsContent value="changelog" className="space-y-6">
            {distributions.changelog && distributions.changelog.length > 0 ? (
              <Card>
                <CardHeader><CardTitle className="text-sm">Histórico de Versões</CardTitle></CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {distributions.changelog.map((v: any, i: number) => (
                      <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                        <Badge variant="outline">v{i + 1}</Badge>
                        <p className="text-sm">{v.label}</p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card className="text-center py-12"><CardContent><p className="text-muted-foreground">Sem dados de changelog/versões neste relatório.</p></CardContent></Card>
            )}
          </TabsContent>

          {/* ── ACTION PLAN ── */}
          <TabsContent value="actions" className="space-y-4">
            {diagnostics.length === 0 ? (
              <Card className="text-center py-12"><CardContent><p className="text-muted-foreground">Sem diagnósticos identificados. Seus dados parecem saudáveis!</p></CardContent></Card>
            ) : (
              diagnostics.map((d: any, i: number) => (
                <Card key={i}>
                  <CardContent className="p-5">
                    <div className="flex items-start gap-3">
                      <PriorityBadge priority={d.priority} />
                      <div className="flex-1 space-y-1">
                        <p className="font-display font-semibold">{d.title}</p>
                        <p className="text-sm text-muted-foreground">{d.description}</p>
                        <p className="text-xs font-mono bg-muted/50 rounded px-2 py-1 inline-block">{d.evidence}</p>
                        <p className="text-sm mt-2"><span className="font-medium">Ação:</span> {d.action}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>

          {/* ── AI CHAT ── */}
          <TabsContent value="ai">
            <AiChat reportData={report} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
