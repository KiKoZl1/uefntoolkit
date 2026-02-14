import { useEffect, useState, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { TrendingUp, Play, Users, Clock, Loader2, Calendar, Sparkles, CheckCircle2, XCircle, Search, Database } from "lucide-react";

// Re-use the full generation logic from DiscoverTrendsList
// This is the admin-only version that controls report generation

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

interface LogEntry { time: string; message: string; }

function formatNumber(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString("pt-BR");
}

function timeNow() {
  return new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function AdminOverview() {
  const [reports, setReports] = useState<any[]>([]);
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
    const { data } = await supabase
      .from("discover_reports")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(5);
    if (data) setReports(data);
    setLoading(false);
  };

  const resumeReport = useCallback(async (report: any) => {
    const reportId = report.id;
    const phase = report.phase as string;
    setGenerating(true);
    setGenState({
      phase: phase as any, reportId,
      catalogDiscovered: report.catalog_discovered_count || 0,
      estimatedTotal: report.estimated_total,
      queueTotal: report.queue_total,
      metricsDone: report.metrics_done_count || 0,
      reported: report.reported_count || 0,
      suppressed: report.suppressed_count || 0,
      errors: report.error_count || 0,
      progressPct: report.progress_pct || 0,
    });
    addLog(`🔄 Retomando (fase: ${phase})...`);
    await runPipeline(reportId, phase);
  }, [addLog]);

  useEffect(() => {
    fetchReports().then(() => {
      // Check for in-progress
    });
  }, []);

  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logs]);

  const runPipeline = async (reportId: string, startPhase: string) => {
    try {
      if (startPhase === "catalog") {
        let catalogPhase = true;
        while (catalogPhase && !abortRef.current) {
          const res = await supabase.functions.invoke("discover-collector", { body: { mode: "catalog", reportId } });
          if (res.error || !res.data?.success) throw new Error(res.data?.error || "Catalog failed");
          const d = res.data;
          setGenState(s => ({ ...s, phase: "catalog", catalogDiscovered: d.catalog_discovered_count, queueTotal: d.queue_total, progressPct: d.progress_pct }));
          addLog(`📂 ${formatNumber(d.catalog_discovered_count)} ilhas`);
          if (d.catalog_done || d.phase === "metrics") { catalogPhase = false; addLog(`✅ Catálogo: ${formatNumber(d.queue_total)} ilhas`); }
          await new Promise(r => setTimeout(r, 500));
        }
      }
      if (abortRef.current) { addLog("⚠️ Cancelado"); setGenerating(false); return; }

      if (startPhase === "catalog" || startPhase === "metrics") {
        addLog("📊 Métricas...");
        let metricsPhase = true;
        while (metricsPhase && !abortRef.current) {
          let res: any;
          for (let i = 1; i <= 3; i++) {
            res = await supabase.functions.invoke("discover-collector", { body: { mode: "metrics", reportId } });
            if (!res.error) break;
            if (i < 3) await new Promise(r => setTimeout(r, 3000));
          }
          if (res.error || !res.data?.success) throw new Error(res.data?.error || "Metrics failed");
          const d = res.data;
          setGenState(s => ({ ...s, phase: "metrics", metricsDone: d.metrics_done_count, queueTotal: d.queue_total, reported: d.reported_count, suppressed: d.suppressed_count, errors: d.error_count, progressPct: d.progress_pct }));
          addLog(`📊 ${formatNumber(d.metrics_done_count)}/${formatNumber(d.queue_total)} | ✅${d.reported_count} 🚫${d.suppressed_count}`);
          if (d.phase === "finalize") { metricsPhase = false; }
          await new Promise(r => setTimeout(r, 500));
        }
      }
      if (abortRef.current) { addLog("⚠️ Cancelado"); setGenerating(false); return; }

      if (["catalog", "metrics", "finalize"].includes(startPhase)) {
        setGenState(s => ({ ...s, phase: "finalize", progressPct: 95 }));
        addLog("🧮 Finalizando...");
        const fr = await supabase.functions.invoke("discover-collector", { body: { mode: "finalize", reportId } });
        if (fr.error || !fr.data?.success) throw new Error(fr.data?.error || "Finalize failed");
        addLog(`✅ Rankings calculados`);
      }

      setGenState(s => ({ ...s, phase: "ai", progressPct: 97 }));
      addLog("🤖 IA...");
      await supabase.functions.invoke("discover-report-ai", { body: { reportId } });

      setGenState(s => ({ ...s, phase: "done", progressPct: 100 }));
      addLog("🎉 Completo!");
      toast({ title: "Report gerado!" });
      fetchReports();
      setTimeout(() => { setGenerating(false); setGenState(s => ({ ...s, phase: "idle" })); setLogs([]); }, 4000);
    } catch (e: any) {
      addLog(`❌ ${e.message}`);
      setTimeout(() => { setGenerating(false); setGenState(s => ({ ...s, phase: "idle" })); }, 3000);
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setLogs([]);
    abortRef.current = false;
    setGenState({ phase: "catalog", reportId: null, catalogDiscovered: 0, estimatedTotal: null, queueTotal: null, metricsDone: 0, reported: 0, suppressed: 0, errors: 0, progressPct: 0 });

    addLog("🚀 Iniciando...");
    const startRes = await supabase.functions.invoke("discover-collector", { body: { mode: "start" } });
    if (startRes.error || !startRes.data?.success) {
      addLog(`❌ ${startRes.data?.error || "Failed"}`);
      setGenerating(false);
      return;
    }
    const reportId = startRes.data.reportId;
    setGenState(s => ({ ...s, reportId, estimatedTotal: startRes.data.estimated_total }));
    addLog(`📋 Report criado (est: ${formatNumber(startRes.data.estimated_total)})`);
    await runPipeline(reportId, "catalog");
  };

  const phaseLabel: Record<string, string> = {
    idle: "", catalog: "Indexando...", metrics: "Métricas...", finalize: "Rankings...", ai: "IA...", done: "✅ Completo!",
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-display text-2xl font-bold">Admin Overview</h1>
          <p className="text-sm text-muted-foreground">Gerencie a geração de reports semanais</p>
        </div>
        <div className="flex gap-2">
          {generating && (
            <Button variant="outline" onClick={() => { abortRef.current = true; }}>
              <XCircle className="h-4 w-4 mr-2" /> Cancelar
            </Button>
          )}
          <Button onClick={handleGenerate} disabled={generating}>
            {generating ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Gerando...</> : <><Sparkles className="h-4 w-4 mr-2" /> Gerar Report</>}
          </Button>
        </div>
      </div>

      {generating && (
        <Card className="mb-6 border-primary/30">
          <CardContent className="pt-4 pb-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {genState.phase === "done" ? <CheckCircle2 className="h-5 w-5 text-primary" /> : <Loader2 className="h-5 w-5 animate-spin text-primary" />}
                <span className="text-sm font-medium">{phaseLabel[genState.phase]}</span>
              </div>
              <span className="text-xs font-mono">{genState.progressPct}%</span>
            </div>
            <Progress value={genState.progressPct} className="h-3" />
            <div className="grid grid-cols-5 gap-3 text-center text-xs">
              <div><p className="text-muted-foreground">Catalogadas</p><p className="font-bold">{formatNumber(genState.catalogDiscovered)}</p></div>
              <div><p className="text-muted-foreground">Na Fila</p><p className="font-bold">{genState.queueTotal != null ? formatNumber(genState.queueTotal) : "..."}</p></div>
              <div><p className="text-muted-foreground">Com Dados</p><p className="font-bold text-primary">{formatNumber(genState.reported)}</p></div>
              <div><p className="text-muted-foreground">Suprimidas</p><p className="font-bold">{formatNumber(genState.suppressed)}</p></div>
              <div><p className="text-muted-foreground">Erros</p><p className="font-bold text-destructive">{formatNumber(genState.errors)}</p></div>
            </div>
            <div className="bg-muted/50 rounded-md border max-h-40 overflow-y-auto p-3 font-mono text-xs space-y-1">
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

      <h2 className="font-display text-lg font-semibold mb-4">Últimos Reports (Engine)</h2>
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
                    <Link to={`/admin/reports`}>Ver</Link>
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
