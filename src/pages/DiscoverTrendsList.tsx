import { useEffect, useState, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { TrendingUp, Play, Users, Clock, Loader2, Calendar, Sparkles, CheckCircle2, XCircle } from "lucide-react";
import { ReportListSkeleton } from "@/components/discover/ReportSkeleton";

interface DiscoverReport {
  id: string;
  week_start: string;
  week_end: string;
  week_number: number;
  year: number;
  status: string;
  island_count: number | null;
  platform_kpis: any;
  created_at: string;
}

interface LogEntry {
  time: string;
  message: string;
}

const statusMap: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  collecting: { label: "Coletando...", variant: "secondary" },
  analyzing: { label: "Analisando...", variant: "secondary" },
  completed: { label: "Pronto", variant: "default" },
  error: { label: "Erro", variant: "destructive" },
};

function formatNumber(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString("pt-BR");
}

function timeNow() {
  return new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

const TARGET_ISLANDS = 2000;

export default function DiscoverTrendsList() {
  const [reports, setReports] = useState<DiscoverReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [liveIslands, setLiveIslands] = useState(0);
  const [liveStatus, setLiveStatus] = useState("");
  const abortRef = useRef(false);
  const reportIdRef = useRef<string | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const addLog = useCallback((message: string) => {
    setLogs(prev => [...prev.slice(-50), { time: timeNow(), message }]);
  }, []);

  const fetchReports = async () => {
    const { data, error } = await supabase
      .from("discover_reports")
      .select("*")
      .order("week_start", { ascending: false })
      .limit(8);
    if (!error && data) setReports(data as DiscoverReport[]);
    setLoading(false);
  };

  useEffect(() => { fetchReports(); }, []);

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // Polling: check report progress from DB every 3s
  const startPolling = useCallback((reportId: string) => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = setInterval(async () => {
      const { data } = await supabase
        .from("discover_reports")
        .select("island_count, status, platform_kpis")
        .eq("id", reportId)
        .single();
      if (data) {
        const count = data.island_count || 0;
        setLiveIslands(count);
        setLiveStatus(data.status);
        const pct = Math.min(95, Math.round((count / TARGET_ISLANDS) * 100));
        setProgress(pct);
        setProgressLabel(`${count} ilhas coletadas de ${TARGET_ISLANDS} (${pct}%)`);
        if (data.status === "completed" || data.status === "error") {
          stopPolling();
        }
      }
    }, 3000);
  }, []);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const handleGenerate = async () => {
    setGenerating(true);
    setProgress(0);
    setLogs([]);
    setLiveIslands(0);
    setLiveStatus("collecting");
    setProgressLabel("Iniciando coleta de ilhas...");
    abortRef.current = false;
    reportIdRef.current = null;
    addLog("Iniciando geração do relatório...");

    try {
      let reportId: string | null = null;
      let cursor: string | null = null;
      let done = false;
      let passCount = 0;

      while (!done && !abortRef.current) {
        passCount++;
        addLog(`Lote ${passCount}: enviando requisição para coletor...`);

        const res = await supabase.functions.invoke("discover-collector", {
          body: { reportId, cursor, targetIslands: TARGET_ISLANDS, mode: "collect" },
        });

        if (res.error) throw res.error;
        const data = res.data;
        if (!data.success) throw new Error(data.error || "Falha na coleta");

        reportId = data.reportId;
        reportIdRef.current = reportId;
        cursor = data.cursor;
        done = data.done;

        // Start polling after first successful call
        if (passCount === 1 && reportId) {
          startPolling(reportId);
        }

        const collected = data.totalCollected || 0;
        const batchNew = data.batchCollected || 0;
        const pct = data.progress || 0;
        setProgress(Math.min(pct, 95));
        setLiveIslands(collected);
        setProgressLabel(`${collected} ilhas coletadas de ${TARGET_ISLANDS} (${pct}%)`);
        addLog(`Lote ${passCount} concluído: +${batchNew} novas ilhas | Total: ${collected} | ${pct}%`);

        if (!done) {
          addLog(`Aguardando próximo lote... (cursor: ${cursor?.slice(0, 12)}...)`);
          await new Promise((r) => setTimeout(r, 1000));
        }
      }

      if (abortRef.current) {
        addLog("⚠️ Geração cancelada pelo usuário");
        setProgressLabel("Cancelado");
        stopPolling();
        setGenerating(false);
        return;
      }

      // Trigger AI analysis
      stopPolling();
      setProgress(97);
      setProgressLabel("Gerando análise com IA...");
      addLog("Coleta finalizada! Gerando narrativas com IA...");

      if (reportId) {
        await supabase.functions.invoke("discover-report-ai", { body: { reportId } });
      }

      setProgress(100);
      setProgressLabel("✅ Relatório completo!");
      addLog("✅ Relatório gerado com sucesso!");
      toast({ title: "Relatório gerado!", description: `Coleta finalizada com sucesso.` });

      fetchReports();
      setTimeout(() => {
        setGenerating(false);
        setProgress(0);
        setProgressLabel("");
        setLogs([]);
      }, 4000);
    } catch (e: any) {
      stopPolling();
      addLog(`❌ Erro: ${e.message || "Falha desconhecida"}`);
      toast({ title: "Erro", description: e.message || "Falha ao gerar relatório", variant: "destructive" });
      setGenerating(false);
      setProgress(0);
      setProgressLabel("");
    }
  };

  const handleCancel = () => {
    abortRef.current = true;
    addLog("Cancelando...");
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-display text-2xl font-bold flex items-center gap-2">
            <TrendingUp className="h-6 w-6 text-primary" />
            Discover Trends
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Relatórios semanais automáticos do ecossistema Fortnite Discovery
          </p>
        </div>
        <div className="flex gap-2">
          {generating && (
            <Button variant="outline" onClick={handleCancel}>
              <XCircle className="h-4 w-4 mr-2" /> Cancelar
            </Button>
          )}
          <Button onClick={handleGenerate} disabled={generating}>
            {generating ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Gerando...</>
            ) : (
              <><Sparkles className="h-4 w-4 mr-2" /> Gerar Report</>
            )}
          </Button>
        </div>
      </div>

      {/* Progress Panel */}
      {generating && (
        <Card className="mb-6 border-primary/30">
          <CardContent className="pt-4 pb-4 space-y-4">
            {/* Status header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {progress >= 100 ? (
                  <CheckCircle2 className="h-5 w-5 text-primary" />
                ) : (
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                )}
                <span className="text-sm font-medium">{progressLabel}</span>
              </div>
              <span className="text-xs text-muted-foreground font-mono">{progress}%</span>
            </div>

            {/* Progress bar */}
            <Progress value={progress} className="h-3" />

            {/* Live stats */}
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-xs text-muted-foreground">Ilhas Coletadas</p>
                <p className="font-display font-bold text-lg text-primary">{formatNumber(liveIslands)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Alvo</p>
                <p className="font-display font-bold text-lg">{formatNumber(TARGET_ISLANDS)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Status</p>
                <p className="font-display font-bold text-lg capitalize">{liveStatus}</p>
              </div>
            </div>

            {/* Live logs */}
            <div className="bg-muted/50 rounded-md border max-h-40 overflow-y-auto p-3 font-mono text-xs space-y-1">
              {logs.length === 0 ? (
                <p className="text-muted-foreground">Aguardando logs...</p>
              ) : (
                logs.map((log, i) => (
                  <div key={i} className="flex gap-2">
                    <span className="text-muted-foreground shrink-0">[{log.time}]</span>
                    <span>{log.message}</span>
                  </div>
                ))
              )}
              <div ref={logsEndRef} />
            </div>

            <p className="text-xs text-muted-foreground">
              A coleta pode levar alguns minutos. A API da Epic é consultada em lotes para respeitar os limites de taxa.
            </p>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <ReportListSkeleton />
      ) : reports.length === 0 ? (
        <Card className="text-center py-16">
          <CardContent>
            <TrendingUp className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="font-display text-lg font-semibold mb-2">Nenhum relatório ainda</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Gere seu primeiro relatório para ver os dados do ecossistema Discovery.
            </p>
            <Button onClick={handleGenerate} disabled={generating}>
              <Sparkles className="h-4 w-4 mr-2" /> Gerar Primeiro Report
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {reports.map((r) => {
            const kpis = r.platform_kpis || {};
            const status = statusMap[r.status] || { label: r.status, variant: "outline" as const };
            return (
              <Link to={`/app/discover-trends/${r.id}`} key={r.id}>
                <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="font-display text-base">
                        Semana {r.week_number}/{r.year}
                      </CardTitle>
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {new Date(r.week_start).toLocaleDateString("pt-BR")} — {new Date(r.week_end).toLocaleDateString("pt-BR")}
                    </p>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="text-center">
                        <Users className="h-4 w-4 mx-auto text-primary mb-1" />
                        <p className="text-xs text-muted-foreground">Ilhas</p>
                        <p className="font-display font-semibold text-sm">{formatNumber(r.island_count)}</p>
                      </div>
                      <div className="text-center">
                        <Play className="h-4 w-4 mx-auto text-accent mb-1" />
                        <p className="text-xs text-muted-foreground">Plays</p>
                        <p className="font-display font-semibold text-sm">{formatNumber(kpis.totalPlays)}</p>
                      </div>
                      <div className="text-center">
                        <Clock className="h-4 w-4 mx-auto text-warning mb-1" />
                        <p className="text-xs text-muted-foreground">Minutos</p>
                        <p className="font-display font-semibold text-sm">{formatNumber(kpis.totalMinutesPlayed)}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}