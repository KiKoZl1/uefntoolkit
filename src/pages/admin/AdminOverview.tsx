import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Sparkles, CheckCircle2, RefreshCcw, Gauge, Users, AlertTriangle, ShieldAlert, EyeOff } from "lucide-react";

interface GenerationState {
  phase: "idle" | "catalog" | "metrics" | "finalize" | "ai" | "done";
  reportId: string | null;
  catalogDiscovered: number;
  queueTotal: number;
  metricsDone: number;
  reported: number;
  suppressed: number;
  errors: number;
  progressPct: number;
  pendingCount: number;
  processingCount: number;
  doneCount: number;
  workersActive: number;
  throughputPerMin: number;
  staleRequeuedCount: number;
  rateLimitedCount: number;
  suppressedCount: number;
}

interface LogEntry {
  time: string;
  message: string;
}

function formatNumber(n: number | null | undefined): string {
  if (n == null) return "-";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString("pt-BR");
}

function timeNow() {
  return new Date().toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function AdminOverview() {
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [activeReportId, setActiveReportId] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [genState, setGenState] = useState<GenerationState>({
    phase: "idle",
    reportId: null,
    catalogDiscovered: 0,
    queueTotal: 0,
    metricsDone: 0,
    reported: 0,
    suppressed: 0,
    errors: 0,
    progressPct: 0,
    pendingCount: 0,
    processingCount: 0,
    doneCount: 0,
    workersActive: 0,
    throughputPerMin: 0,
    staleRequeuedCount: 0,
    rateLimitedCount: 0,
    suppressedCount: 0,
  });
  const logsEndRef = useRef<HTMLDivElement>(null);
  const lastPhaseRef = useRef<string>("idle");
  const { toast } = useToast();

  const addLog = useCallback((message: string) => {
    setLogs((prev) => [...prev.slice(-80), { time: timeNow(), message }]);
  }, []);

  const fetchReports = useCallback(async () => {
    const { data } = await supabase
      .from("discover_reports")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(5);
    if (data) setReports(data);
    setLoading(false);
  }, []);

  const applyReportState = useCallback((report: any, logPhase = true) => {
    const phase = (report?.phase || "idle") as GenerationState["phase"];
    setGenState({
      phase,
      reportId: report?.id || null,
      catalogDiscovered: report?.catalog_discovered_count || 0,
      queueTotal: report?.queue_total || 0,
      metricsDone: report?.metrics_done_count || 0,
      reported: report?.reported_count || 0,
      suppressed: report?.suppressed_count || 0,
      errors: report?.error_count || 0,
      progressPct: report?.progress_pct || 0,
      pendingCount: report?.pending_count || 0,
      processingCount: report?.processing_count || 0,
      doneCount: report?.done_count || 0,
      workersActive: report?.workers_active || 0,
      throughputPerMin: Math.round(report?.throughput_per_min || 0),
      staleRequeuedCount: report?.stale_requeued_count || 0,
      rateLimitedCount: report?.rate_limited_count || 0,
      suppressedCount: report?.suppressed_count || 0,
    });

    if (logPhase && lastPhaseRef.current !== phase) {
      addLog(`Fase -> ${phase}`);
      lastPhaseRef.current = phase;
    }

    const running = ["catalog", "metrics", "finalize", "ai"].includes(phase);
    setGenerating(running);
    if (!running && phase === "done") {
      addLog("Pipeline concluido.");
    }
  }, [addLog]);

  const fetchActiveReportState = useCallback(async (reportId: string, logPhase = true) => {
    const { data: report, error } = await supabase
      .from("discover_reports")
      .select("*")
      .eq("id", reportId)
      .single();

    if (error || !report) {
      addLog("Nao foi possivel atualizar status do report.");
      return;
    }
    applyReportState(report, logPhase);
  }, [addLog, applyReportState]);

  const triggerOrchestrateTick = useCallback(async (reportId: string) => {
    const { data, error } = await supabase.functions.invoke("discover-collector", {
      body: { mode: "orchestrate", reportId },
    });
    if (error) {
      addLog(`Tick falhou: ${error.message}`);
      return;
    }
    if (data?.throughput_per_min != null || data?.workers_active != null) {
      addLog(
        `Tick: ${formatNumber(data.metrics_done_count)}/${formatNumber(data.queue_total)} | ${formatNumber(data.throughput_per_min)} ilhas/min | workers ${data.workers_active ?? 0}`
      );
    } else {
      addLog("Tick orchestrate executado.");
    }
  }, [addLog]);

  useEffect(() => {
    fetchReports();

    (async () => {
      const { data: active } = await supabase
        .from("discover_reports")
        .select("*")
        .in("phase", ["catalog", "metrics", "finalize", "ai"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (active) {
        setActiveReportId(active.id);
        addLog(`Acompanhando report ativo: ${active.id.slice(0, 8)}...`);
        applyReportState(active, false);
      }
    })();
  }, [addLog, applyReportState, fetchReports]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  useEffect(() => {
    if (!activeReportId) return;
    const timer = setInterval(() => {
      fetchActiveReportState(activeReportId, true);
    }, 5000);
    return () => clearInterval(timer);
  }, [activeReportId, fetchActiveReportState]);

  const handleGenerate = async () => {
    setLogs([]);
    addLog("Iniciando pipeline...");
    setGenerating(true);

    const startRes = await supabase.functions.invoke("discover-collector", { body: { mode: "start" } });
    if (startRes.error || !startRes.data?.success) {
      addLog(`Falha no start: ${startRes.data?.error || startRes.error?.message || "erro"}`);
      setGenerating(false);
      return;
    }

    const reportId = startRes.data.reportId as string;
    setActiveReportId(reportId);
    addLog(`Report criado: ${reportId.slice(0, 8)}...`);
    await triggerOrchestrateTick(reportId);
    await fetchActiveReportState(reportId, false);
    await fetchReports();
    toast({ title: "Pipeline iniciado", description: "Backend vai continuar executando sem depender da aba." });
  };

  const handleRefreshTick = async () => {
    if (!activeReportId) return;
    await triggerOrchestrateTick(activeReportId);
    await fetchActiveReportState(activeReportId, false);
    await fetchReports();
  };

  const phaseLabel: Record<string, string> = {
    idle: "",
    catalog: "Catalogando",
    metrics: "Coletando metricas",
    finalize: "Finalizando rankings",
    ai: "Gerando IA",
    done: "Concluido",
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-display text-2xl font-bold">Admin Overview</h1>
          <p className="text-sm text-muted-foreground">Inicie o report e acompanhe o progresso server-driven.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleRefreshTick} disabled={!activeReportId}>
            <RefreshCcw className="h-4 w-4 mr-2" /> Tick Agora
          </Button>
          <Button onClick={handleGenerate} disabled={generating}>
            {generating ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Em andamento...</> : <><Sparkles className="h-4 w-4 mr-2" /> Gerar Report</>}
          </Button>
        </div>
      </div>

      {(generating || genState.phase === "done") && (
        <Card className="mb-6 border-primary/30">
          <CardContent className="pt-4 pb-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {genState.phase === "done"
                  ? <CheckCircle2 className="h-5 w-5 text-primary" />
                  : <Loader2 className="h-5 w-5 animate-spin text-primary" />}
                <span className="text-sm font-medium">{phaseLabel[genState.phase]}</span>
              </div>
              <span className="text-xs font-mono">{genState.progressPct}%</span>
            </div>
            <Progress value={genState.progressPct} className="h-3" />

            <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 text-center text-xs">
              <div><p className="text-muted-foreground">{genState.phase === "catalog" ? "Descobertas" : "Na fila"}</p><p className="font-bold">{formatNumber(genState.phase === "catalog" ? genState.catalogDiscovered : genState.queueTotal)}</p></div>
              <div><p className="text-muted-foreground">Processadas</p><p className="font-bold">{formatNumber(genState.metricsDone)}</p></div>
              <div><p className="text-muted-foreground">Pendentes</p><p className="font-bold">{formatNumber(genState.pendingCount)}</p></div>
              <div><p className="text-muted-foreground">Processing</p><p className="font-bold">{formatNumber(genState.processingCount)}</p></div>
              <div><p className="text-muted-foreground">Done</p><p className="font-bold">{formatNumber(genState.doneCount)}</p></div>
              <div><p className="text-muted-foreground">Erros</p><p className="font-bold text-destructive">{formatNumber(genState.errors)}</p></div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-center text-xs">
              <div className="rounded-md border bg-muted/40 p-2">
                <p className="text-muted-foreground flex items-center justify-center gap-1"><Gauge className="h-3.5 w-3.5" /> Throughput</p>
                <p className="font-semibold">{formatNumber(genState.throughputPerMin)} ilhas/min</p>
              </div>
              <div className="rounded-md border bg-muted/40 p-2">
                <p className="text-muted-foreground flex items-center justify-center gap-1"><Users className="h-3.5 w-3.5" /> Workers</p>
                <p className="font-semibold">{genState.workersActive}</p>
              </div>
              <div className="rounded-md border bg-muted/40 p-2">
                <p className="text-muted-foreground flex items-center justify-center gap-1"><EyeOff className="h-3.5 w-3.5" /> Suprimidas</p>
                <p className="font-semibold">{formatNumber(genState.suppressedCount)}</p>
              </div>
              <div className={`rounded-md border p-2 ${genState.rateLimitedCount > 0 ? "bg-destructive/10 border-destructive/30" : "bg-muted/40"}`}>
                <p className="text-muted-foreground flex items-center justify-center gap-1"><ShieldAlert className="h-3.5 w-3.5" /> 429 Rate Limit</p>
                <p className={`font-semibold ${genState.rateLimitedCount > 0 ? "text-destructive" : ""}`}>{formatNumber(genState.rateLimitedCount)}</p>
              </div>
              <div className="rounded-md border bg-muted/40 p-2">
                <p className="text-muted-foreground flex items-center justify-center gap-1"><AlertTriangle className="h-3.5 w-3.5" /> Requeue stale</p>
                <p className="font-semibold">{formatNumber(genState.staleRequeuedCount)}</p>
              </div>
            </div>

            <div className="bg-muted/50 rounded-md border max-h-44 overflow-y-auto p-3 font-mono text-xs space-y-1">
              {logs.map((log, i) => (
                <div key={i} className="flex gap-2">
                  <span className="text-muted-foreground shrink-0">[{log.time}]</span>
                  <span>{log.message}</span>
                </div>
              ))}
              <div ref={logsEndRef} />
            </div>
          </CardContent>
        </Card>
      )}

      <h2 className="font-display text-lg font-semibold mb-4">Ultimos Reports (Engine)</h2>
      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : (
        <div className="space-y-3">
          {reports.map((r) => (
            <Card key={r.id}>
              <CardContent className="flex items-center justify-between py-4">
                <div>
                  <p className="font-display font-semibold">Semana {r.week_number}/{r.year}</p>
                  <p className="text-xs text-muted-foreground">{r.phase} · {r.reported_count || 0} reported</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={r.status === "completed" ? "default" : "secondary"}>{r.status}</Badge>
                  <Button variant="outline" size="sm" asChild>
                    <Link to="/admin/reports">Ver</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
