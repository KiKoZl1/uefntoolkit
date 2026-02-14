import { useEffect, useState, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { TrendingUp, Play, Users, Clock, Loader2, Calendar, Sparkles, CheckCircle2, XCircle, Trash2, Search, Database, AlertTriangle } from "lucide-react";
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

interface GenerationState {
  phase: "idle" | "catalog" | "metrics" | "finalize" | "ai" | "done";
  reportId: string | null;
  catalogDiscovered: number;
  estimatedTotal: number | null;
  queueTotal: number | null;
  metricsDone: number;
  reported: number;
  suppressed: number;
  errors: number;
  progressPct: number;
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
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [genState, setGenState] = useState<GenerationState>({
    phase: "idle", reportId: null, catalogDiscovered: 0, estimatedTotal: null,
    queueTotal: null, metricsDone: 0, reported: 0, suppressed: 0, errors: 0, progressPct: 0,
  });
  const abortRef = useRef(false);
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

  const handleGenerate = async () => {
    setGenerating(true);
    setLogs([]);
    abortRef.current = false;
    setGenState({
      phase: "catalog", reportId: null, catalogDiscovered: 0, estimatedTotal: null,
      queueTotal: null, metricsDone: 0, reported: 0, suppressed: 0, errors: 0, progressPct: 0,
    });

    try {
      // ===== START =====
      addLog("🚀 Iniciando novo relatório...");
      const startRes = await supabase.functions.invoke("discover-collector", {
        body: { mode: "start" },
      });
      if (startRes.error || !startRes.data?.success) {
        throw new Error(startRes.data?.error || startRes.error?.message || "Failed to start");
      }

      const reportId = startRes.data.reportId;
      const estimatedTotal = startRes.data.estimated_total;
      setGenState(s => ({ ...s, reportId, estimatedTotal }));
      addLog(`📋 Report criado. Estimativa: ${estimatedTotal ? formatNumber(estimatedTotal) : "desconhecida"}`);

      // ===== CATALOG LOOP =====
      addLog("📂 Fase Catálogo: Indexando ilhas da API...");
      let catalogPhase = true;

      while (catalogPhase && !abortRef.current) {
        const res = await supabase.functions.invoke("discover-collector", {
          body: { mode: "catalog", reportId },
        });

        if (res.error || !res.data?.success) {
          throw new Error(res.data?.error || res.error?.message || "Catalog failed");
        }

        const d = res.data;
        setGenState(s => ({
          ...s,
          phase: "catalog",
          catalogDiscovered: d.catalog_discovered_count,
          queueTotal: d.queue_total,
          progressPct: d.progress_pct,
        }));

        addLog(`📂 Indexadas: ${formatNumber(d.catalog_discovered_count)} ilhas`);

        if (d.catalog_done || d.phase === "metrics") {
          catalogPhase = false;
          addLog(`✅ Catálogo completo: ${formatNumber(d.queue_total || d.catalog_discovered_count)} ilhas na fila`);
        }

        await new Promise(r => setTimeout(r, 500));
      }

      if (abortRef.current) { addLog("⚠️ Cancelado"); setGenerating(false); return; }

      // ===== METRICS LOOP =====
      addLog("📊 Fase Métricas: Coletando dados de cada ilha...");
      let metricsPhase = true;

      while (metricsPhase && !abortRef.current) {
        let res: any;
        for (let attempt = 1; attempt <= 3; attempt++) {
          res = await supabase.functions.invoke("discover-collector", {
            body: { mode: "metrics", reportId },
          });
          if (!res.error) break;
          if (attempt < 3) {
            addLog(`⚠️ Tentativa ${attempt} falhou, retentando...`);
            await new Promise(r => setTimeout(r, 3000));
          }
        }

        if (res.error || !res.data?.success) {
          throw new Error(res.data?.error || res.error?.message || "Metrics failed");
        }

        const d = res.data;
        setGenState(s => ({
          ...s,
          phase: "metrics",
          metricsDone: d.metrics_done_count,
          queueTotal: d.queue_total,
          reported: d.reported_count,
          suppressed: d.suppressed_count,
          errors: d.error_count,
          progressPct: d.progress_pct,
        }));

        addLog(`📊 Processadas: ${formatNumber(d.metrics_done_count)}/${formatNumber(d.queue_total)} | ✅${d.reported_count} 🚫${d.suppressed_count} ❌${d.error_count} | Concurrency: ${d.concurrency || "?"}`);

        if (d.phase === "finalize") {
          metricsPhase = false;
          addLog(`✅ Métricas completas!`);
        }

        await new Promise(r => setTimeout(r, 500));
      }

      if (abortRef.current) { addLog("⚠️ Cancelado"); setGenerating(false); return; }

      // ===== FINALIZE =====
      setGenState(s => ({ ...s, phase: "finalize", progressPct: 95 }));
      addLog("🧮 Fase Finalize: Calculando rankings e KPIs...");

      const finalizeRes = await supabase.functions.invoke("discover-collector", {
        body: { mode: "finalize", reportId },
      });

      if (finalizeRes.error || !finalizeRes.data?.success) {
        throw new Error(finalizeRes.data?.error || finalizeRes.error?.message || "Finalize failed");
      }

      addLog(`✅ Rankings calculados: ${formatNumber(finalizeRes.data.reported_count)} ilhas reportadas`);

      // ===== AI =====
      setGenState(s => ({ ...s, phase: "ai", progressPct: 97 }));
      addLog("🤖 Fase IA: Gerando narrativas com IA...");

      await supabase.functions.invoke("discover-report-ai", { body: { reportId } });

      // ===== DONE =====
      setGenState(s => ({ ...s, phase: "done", progressPct: 100 }));
      addLog("🎉 Relatório completo!");
      toast({ title: "Relatório gerado!", description: "Coleta e análise finalizadas com sucesso." });

      fetchReports();
      setTimeout(() => {
        setGenerating(false);
        setGenState(s => ({ ...s, phase: "idle", progressPct: 0 }));
        setLogs([]);
      }, 4000);

    } catch (e: any) {
      addLog(`❌ Erro: ${e.message || "Falha desconhecida"}`);

      // Try to finalize with partial data
      const savedReportId = genState.reportId;
      if (savedReportId && genState.metricsDone > 0) {
        addLog("🔄 Tentando finalizar com dados parciais...");
        try {
          await supabase.functions.invoke("discover-collector", { body: { reportId: savedReportId, mode: "finalize" } });
          await supabase.functions.invoke("discover-report-ai", { body: { reportId: savedReportId } });
          addLog("✅ Relatório parcial salvo!");
          toast({ title: "Relatório parcial", description: "Salvo com os dados coletados até o momento." });
          fetchReports();
        } catch (finalErr: any) {
          addLog(`❌ Falha ao finalizar parcial: ${finalErr.message}`);
        }
      }

      toast({ title: "Erro", description: e.message, variant: "destructive" });
      setTimeout(() => {
        setGenerating(false);
        setGenState(s => ({ ...s, phase: "idle" }));
      }, 3000);
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

  const phaseLabel = {
    idle: "",
    catalog: "Indexando ilhas...",
    metrics: "Coletando métricas...",
    finalize: "Calculando rankings...",
    ai: "Gerando narrativas com IA...",
    done: "✅ Relatório completo!",
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
                {genState.phase === "done" ? (
                  <CheckCircle2 className="h-5 w-5 text-primary" />
                ) : genState.phase === "catalog" ? (
                  <Search className="h-5 w-5 animate-pulse text-primary" />
                ) : genState.phase === "finalize" ? (
                  <Database className="h-5 w-5 animate-pulse text-primary" />
                ) : (
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                )}
                <span className="text-sm font-medium">{phaseLabel[genState.phase]}</span>
              </div>
              <span className="text-xs text-muted-foreground font-mono">{genState.progressPct}%</span>
            </div>

            <Progress value={genState.progressPct} className="h-3" />

            {/* Stats Grid */}
            <div className="grid grid-cols-5 gap-3 text-center">
              <div>
                <p className="text-xs text-muted-foreground">Catalogadas</p>
                <p className="font-display font-bold text-lg">{formatNumber(genState.catalogDiscovered)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Na Fila</p>
                <p className="font-display font-bold text-lg">{genState.queueTotal != null ? formatNumber(genState.queueTotal) : "..."}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Com Dados</p>
                <p className="font-display font-bold text-lg text-primary">{formatNumber(genState.reported)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Suprimidas</p>
                <p className="font-display font-bold text-lg text-muted-foreground">{formatNumber(genState.suppressed)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Erros</p>
                <p className="font-display font-bold text-lg text-destructive">{formatNumber(genState.errors)}</p>
              </div>
            </div>

            {/* Metrics progress detail */}
            {genState.phase === "metrics" && genState.queueTotal && (
              <div className="text-xs text-muted-foreground text-center">
                {formatNumber(genState.metricsDone)} / {formatNumber(genState.queueTotal)} processadas
              </div>
            )}

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
              Pipeline em 3 fases: Catálogo → Métricas (com probe 1d) → Rankings + IA. Sem limite fixo.
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
