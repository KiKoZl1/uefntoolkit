import { useEffect, useState, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { TrendingUp, Play, Users, Clock, Loader2, Calendar, Sparkles, CheckCircle2, XCircle, Trash2, Search } from "lucide-react";
import { ReportListSkeleton } from "@/components/discover/ReportSkeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

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

export default function DiscoverTrendsList() {
  const [reports, setReports] = useState<DiscoverReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [liveIslands, setLiveIslands] = useState(0);
  const [liveStatus, setLiveStatus] = useState("");
  const [totalAvailable, setTotalAvailable] = useState<number | null>(null);
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

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

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
    setLiveStatus("discovering");
    setTotalAvailable(null);
    setProgressLabel("Descobrindo total de ilhas na API...");
    abortRef.current = false;
    reportIdRef.current = null;
    addLog("🔍 Fase 1: Descobrindo quantas ilhas existem na API da Epic...");

    try {
      // ============ PHASE 1: DISCOVERY — count total islands available ============
      let discoveredTotal = 0;
      let discoverCursor: string | null = null;
      let discoveryExhausted = false;

      while (!discoveryExhausted && !abortRef.current) {
        const res = await supabase.functions.invoke("discover-collector", {
          body: { mode: "discover", discoverCursor, previousCount: discoveredTotal },
        });

        if (res.error || !res.data?.success) {
          addLog(`⚠️ Erro na descoberta: ${res.data?.error || res.error?.message}`);
          break;
        }

        discoveredTotal = res.data.totalDiscovered;
        discoverCursor = res.data.discoverCursor;
        discoveryExhausted = res.data.exhausted;
        setProgressLabel(`Descobrindo ilhas... ${formatNumber(discoveredTotal)} encontradas`);
        addLog(`🔍 Descobertas até agora: ${formatNumber(discoveredTotal)} ilhas`);
      }

      if (abortRef.current) {
        addLog("⚠️ Geração cancelada pelo usuário");
        setGenerating(false);
        return;
      }

      setTotalAvailable(discoveredTotal);
      addLog(`✅ Fase 1 concluída: ${formatNumber(discoveredTotal)} ilhas disponíveis na API`);
      addLog("📊 Fase 2: Coletando métricas de cada ilha (ignorando ilhas sem dados)...");
      setLiveStatus("collecting");

      // ============ PHASE 2: COLLECT — fetch metrics for all islands ============
      let reportId: string | null = null;
      let cursor: string | null = null;
      let done = false;
      let passCount = 0;
      let totalSkippedNull = 0;

      while (!done && !abortRef.current) {
        passCount++;
        addLog(`Lote ${passCount}: coletando métricas...`);

        let res: any = null;
        let lastError: any = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            res = await supabase.functions.invoke("discover-collector", {
              body: { reportId, cursor, mode: "collect" },
            });
            if (!res.error) break;
            lastError = res.error;
          } catch (e) {
            lastError = e;
          }
          if (attempt < 3) {
            addLog(`⚠️ Tentativa ${attempt} falhou, retentando em 3s...`);
            await new Promise((r) => setTimeout(r, 3000));
          }
        }

        if (res?.error || !res?.data?.success) {
          const errMsg = res?.data?.error || lastError?.message || "Falha na coleta";
          throw new Error(errMsg);
        }

        const data = res.data;
        reportId = data.reportId;
        reportIdRef.current = reportId;
        cursor = data.cursor;
        done = data.done;
        totalSkippedNull += data.skippedNull || 0;

        if (passCount === 1 && reportId) {
          startPolling(reportId);
        }

        const collected = data.totalCollected || 0;
        const batchNew = data.batchCollected || 0;
        setLiveIslands(collected);

        // Dynamic progress: collected / total discovered
        const pct = discoveredTotal > 0
          ? Math.min(95, Math.round((collected / discoveredTotal) * 100))
          : 0;
        setProgress(pct);
        setProgressLabel(`${formatNumber(collected)} ilhas com dados / ${formatNumber(discoveredTotal)} total (${pct}%)`);
        addLog(`Lote ${passCount}: +${batchNew} novas | ${totalSkippedNull} sem dados | Total: ${formatNumber(collected)} | ${pct}%`);

        if (!done) {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }

      if (abortRef.current) {
        addLog("⚠️ Geração cancelada pelo usuário");
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
      addLog(`✅ Relatório gerado! ${formatNumber(liveIslands)} ilhas com dados (${totalSkippedNull} sem dados ignoradas)`);
      toast({ title: "Relatório gerado!", description: `Coleta finalizada com sucesso.` });

      fetchReports();
      setTimeout(() => {
        setGenerating(false);
        setProgress(0);
        setProgressLabel("");
        setLogs([]);
        setTotalAvailable(null);
      }, 4000);
    } catch (e: any) {
      stopPolling();
      addLog(`⚠️ Erro na coleta: ${e.message || "Falha desconhecida"}`);

      const savedReportId = reportIdRef.current;
      if (savedReportId) {
        addLog(`Finalizando com os dados já coletados...`);
        setProgressLabel("Finalizando com dados parciais...");
        setProgress(96);
        try {
          await supabase.functions.invoke("discover-collector", {
            body: { reportId: savedReportId, mode: "finalize" },
          });

          setProgress(98);
          setProgressLabel("Gerando análise com IA (dados parciais)...");
          addLog("Gerando narrativas com IA sobre dados parciais...");
          await supabase.functions.invoke("discover-report-ai", { body: { reportId: savedReportId } });

          setProgress(100);
          setProgressLabel("✅ Relatório parcial gerado!");
          addLog(`✅ Relatório gerado com dados parciais`);
          toast({ title: "Relatório parcial gerado", description: `Coleta parou mas o relatório foi salvo.` });
          fetchReports();
          setTimeout(() => {
            setGenerating(false);
            setProgress(0);
            setProgressLabel("");
            setLogs([]);
            setTotalAvailable(null);
          }, 4000);
          return;
        } catch (finalizeErr: any) {
          addLog(`❌ Falha ao finalizar dados parciais: ${finalizeErr.message}`);
        }
      }

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

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const { error } = await supabase.from("discover_reports").delete().eq("id", id);
    if (error) {
      toast({ title: "Erro", description: "Falha ao deletar relatório", variant: "destructive" });
    } else {
      toast({ title: "Deletado", description: "Relatório removido com sucesso." });
      setReports((prev) => prev.filter((r) => r.id !== id));
    }
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
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {progress >= 100 ? (
                  <CheckCircle2 className="h-5 w-5 text-primary" />
                ) : liveStatus === "discovering" ? (
                  <Search className="h-5 w-5 animate-pulse text-primary" />
                ) : (
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                )}
                <span className="text-sm font-medium">{progressLabel}</span>
              </div>
              <span className="text-xs text-muted-foreground font-mono">{progress}%</span>
            </div>

            <Progress value={progress} className="h-3" />

            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-xs text-muted-foreground">Ilhas com Dados</p>
                <p className="font-display font-bold text-lg text-primary">{formatNumber(liveIslands)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total na API</p>
                <p className="font-display font-bold text-lg">
                  {totalAvailable != null ? formatNumber(totalAvailable) : "Descobrindo..."}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Status</p>
                <p className="font-display font-bold text-lg capitalize">{liveStatus}</p>
              </div>
            </div>

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
              Sem limite fixo — o sistema coleta todas as ilhas disponíveis na API da Epic, ignorando ilhas sem dados.
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
                      <div className="flex items-center gap-2">
                        <Badge variant={status.variant}>{status.label}</Badge>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => e.preventDefault()}>
                              <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Deletar relatório?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Essa ação não pode ser desfeita. O relatório da Semana {r.week_number}/{r.year} será removido permanentemente.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction onClick={(e) => handleDelete(r.id, e)}>Deletar</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
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
