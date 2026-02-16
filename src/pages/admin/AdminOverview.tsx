import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, Sparkles, CheckCircle2, RefreshCcw, Gauge, Users, AlertTriangle,
  ShieldAlert, EyeOff, Activity, Database, Eye, FileText, Clock, ChevronDown,
  ChevronRight, Radio, Circle, ArrowRight, Zap, Hash, Layers, AlertCircle,
  Timer, Lock, CalendarClock, BarChart3, Target
} from "lucide-react";

// ─── Formatters ───────────────────────────────────────────────

function fmt(n: number | null | undefined): string {
  if (n == null) return "-";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString("pt-BR");
}

function pct(part: number, total: number): string {
  if (!total) return "0%";
  return `${((part / total) * 100).toFixed(1)}%`;
}

function timeNow() {
  return new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// ─── HealthDot ────────────────────────────────────────────────

type HealthStatus = "ok" | "warn" | "error" | "idle";

function HealthDot({ status, label }: { status: HealthStatus; label: string }) {
  const colors: Record<HealthStatus, string> = {
    ok: "bg-green-500",
    warn: "bg-yellow-500",
    error: "bg-red-500",
    idle: "bg-muted-foreground/40",
  };
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={`inline-block h-2.5 w-2.5 rounded-full ${colors[status]} shrink-0`} />
      </TooltipTrigger>
      <TooltipContent side="bottom"><p className="text-xs">{label}</p></TooltipContent>
    </Tooltip>
  );
}

// ─── MiniSparkline ────────────────────────────────────────────

function MiniSparkline({ data, color = "currentColor" }: { data: number[]; color?: string }) {
  if (data.length < 2) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const w = 56, h = 18;
  const points = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * (h - 2) - 1}`).join(" ");
  return (
    <svg width={w} height={h} className="shrink-0 opacity-70">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ─── StatCard ─────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, sub, color, sparkData }: {
  icon: React.ElementType; label: string; value: string; sub?: string; color?: "destructive" | "success" | "warning" | "default";
  sparkData?: number[];
}) {
  const colorMap = {
    destructive: "text-destructive",
    success: "text-green-500",
    warning: "text-yellow-500",
    default: "text-foreground",
  };
  const sparkColorMap: Record<string, string> = {
    destructive: "#ef4444", success: "#22c55e", warning: "#eab308", default: "#6366f1",
  };
  return (
    <div className="rounded-lg border bg-card p-3 space-y-1">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        <span className="text-xs truncate">{label}</span>
      </div>
      <div className="flex items-center justify-between gap-1">
        <p className={`font-display text-lg font-bold leading-none ${colorMap[color || "default"]}`}>{value}</p>
        {sparkData && sparkData.length >= 2 && <MiniSparkline data={sparkData} color={sparkColorMap[color || "default"]} />}
      </div>
      {sub && <p className="text-[10px] text-muted-foreground leading-tight">{sub}</p>}
    </div>
  );
}

// ─── Types ────────────────────────────────────────────────────

interface CensusData {
  totalIslands: number; reported: number; suppressed: number; otherStatus: number;
  withTitle: number; uniqueCreators: number; engineReports: number;
  weeklyReports: number; weeklyPublished: number;
}

interface MetaData {
  total: number; withTitle: number; withError: number; pendingNoData: number;
  locked: number; dueNow: number; islands: number; collections: number;
}

interface ExposureData {
  targetsTotal: number; targetsOk: number; ticks24h: number; ticksOk: number; ticksFailed: number;
}

interface LinkGraphData {
  edgesTotal: number;
  parentsTotal: number;
  childrenTotal: number;
  collectionsSeen24h: number;
  collectionsResolved24h: number;
  resolution24hPct: number | null;
  edgeAgeSeconds: number | null;
  staleEdges60d: number;
  collectionsDueNow: number;
}

interface CronJob {
  name: string; schedule: string; active: boolean;
}

interface SystemAlert {
  alert_key: string;
  severity: "ok" | "warn" | "error";
  message: string;
  details: any;
  updated_at: string;
}

interface GenerationState {
  phase: "idle" | "catalog" | "metrics" | "finalize" | "ai" | "done";
  reportId: string | null; catalogDiscovered: number; queueTotal: number;
  metricsDone: number; reported: number; suppressed: number; errors: number;
  progressPct: number; pendingCount: number; processingCount: number;
  doneCount: number; workersActive: number; throughputPerMin: number;
  staleRequeuedCount: number; rateLimitedCount: number; suppressedCount: number;
}

interface LogEntry { time: string; message: string; }

const INITIAL_GEN: GenerationState = {
  phase: "idle", reportId: null, catalogDiscovered: 0, queueTotal: 0,
  metricsDone: 0, reported: 0, suppressed: 0, errors: 0, progressPct: 0,
  pendingCount: 0, processingCount: 0, doneCount: 0, workersActive: 0,
  throughputPerMin: 0, staleRequeuedCount: 0, rateLimitedCount: 0, suppressedCount: 0,
};

// ─── Alert Info Helper ────────────────────────────────────────

function getAlertInfo(alert: SystemAlert): { title: string; description: string; detail?: string; action?: string } {
  const d = alert.details || {};

  switch (alert.alert_key) {
    case "exposure_stale": {
      const stale = Number(d.stale_targets || 0);
      if (alert.severity === "ok") return {
        title: "Exposure Pipeline",
        description: "Todos os targets estão coletando dentro do SLA.",
      };
      return {
        title: "Exposure Pipeline com Atraso",
        description: `${stale} target${stale > 1 ? "s" : ""} não coletou dados no tempo esperado (2x o intervalo configurado).`,
        detail: `Isso pode significar que o cron 'orchestrate-minute' falhou ou que a API da Epic está lenta/fora do ar. Targets em atraso não geram dados de exposição, afetando rankings e intel.`,
        action: stale > 2 ? "⚠️ Verifique os logs do cron e o status da API da Epic." : "Monitorar — pode se resolver sozinho no próximo tick.",
      };
    }
    case "metadata_backlog": {
      const due = Number(d.due_now || 0);
      if (alert.severity === "ok") return {
        title: "Metadata Backlog",
        description: `Backlog saudável (${fmt(due)} pendentes).`,
      };
      return {
        title: "Backlog de Metadados Crescendo",
        description: `${fmt(due)} itens prontos para coleta aguardando processamento.`,
        detail: due > 50000
          ? `O volume é muito alto. O collector pode não conseguir processar tudo a tempo. Verifique se o cron 'discover-links-metadata-orchestrate-min' está rodando e se não há muitos erros 429.`
          : `O collector está processando mas não na velocidade necessária. Isso é esperado após enfileirar um grande volume. O backlog deve reduzir gradualmente.`,
        action: due > 100000 ? "⚠️ Considere verificar os logs do metadata collector para erros." : undefined,
      };
    }
    case "intel_freshness": {
      const ageSec = d.age_seconds != null ? Number(d.age_seconds) : null;
      const asOf = d.as_of ? new Date(d.as_of) : null;
      const ageStr = ageSec != null
        ? (ageSec < 60 ? `${ageSec}s` : ageSec < 3600 ? `${Math.round(ageSec / 60)} min` : `${Math.floor(ageSec / 3600)}h ${Math.round((ageSec % 3600) / 60)}m`)
        : "desconhecido";
      if (alert.severity === "ok") return {
        title: "Intel Público",
        description: `Dados atualizados há ${ageStr}. Premium, Emerging e Pollution estão frescos.`,
      };
      return {
        title: "Intel Público Desatualizado",
        description: `Última atualização há ${ageStr}${asOf ? ` (${asOf.toLocaleTimeString("pt-BR")})` : ""}.`,
        detail: ageSec != null && ageSec > 1800
          ? `Os dados públicos (Premium Now, Emerging, Pollution) estão defasados há mais de 30 minutos. O cron 'intel-refresh-5min' pode ter falhado. Páginas públicas mostram dados antigos.`
          : `Leve atraso na atualização do Intel. Geralmente se resolve no próximo ciclo do cron (a cada 5 min).`,
        action: ageSec != null && ageSec > 3600 ? "⚠️ Verifique os logs do cron 'intel-refresh-5min'." : undefined,
      };
    }
    case "link_edges_coverage": {
      const seen = Number(d.collections_seen_24h || 0);
      const resolved = Number(d.collections_resolved_24h || 0);
      const pctVal = d.resolution_24h_pct != null ? Number(d.resolution_24h_pct) * 100 : null;
      if (alert.severity === "ok") return {
        title: "Rails Resolver Coverage",
        description: seen === 0
          ? "Nenhuma collection recente para resolver nas ultimas 24h."
          : `Cobertura de collections saudavel: ${resolved}/${seen} (${pctVal?.toFixed(1)}%).`,
      };
      return {
        title: "Rails Resolver com Cobertura Baixa",
        description: `${resolved}/${seen} collections recentes resolvidas (${pctVal?.toFixed(1) || 0}%).`,
        detail: "As colecoes do Discovery (Homebar/reference/ref_panel) podem aparecer sem expansao completa para ilhas filhas.",
        action: "Rode backfill_recent_collections e verifique erros do discover-links-metadata-collector.",
      };
    }
    case "link_edges_freshness": {
      const ageSec = d.edge_age_seconds != null ? Number(d.edge_age_seconds) : null;
      const stale = Number(d.stale_edges_60d || 0);
      const ageStr = ageSec == null
        ? "desconhecida"
        : ageSec < 60 ? `${ageSec}s` : ageSec < 3600 ? `${Math.round(ageSec / 60)} min` : `${Math.round(ageSec / 3600)}h`;
      if (alert.severity === "ok") return {
        title: "Link Graph Freshness",
        description: `Edges atualizadas (${ageStr}), stale(60d): ${fmt(stale)}.`,
      };
      return {
        title: "Link Graph Desatualizado",
        description: `Ultima atualizacao de edges: ${ageStr}. stale(60d): ${fmt(stale)}.`,
        detail: "O grafo parent->child pode estar desatualizado e afetar o render de rails resolvidos no admin/public.",
        action: "Verifique cron metadata e execute maintenance (cleanup_discover_link_edges).",
      };
    }
    case "link_edges_coverage": {
      const parents = Number(d.parents_resolved || 0);
      const collections = Number(d.collections_total || 0);
      const edges = Number(d.edges_total || 0);
      if (alert.severity === "ok") return {
        title: "Link Edges Coverage",
        description: `${parents} collections com edges resolvidos de ${collections} total (${edges} edges).`,
      };
      return {
        title: "Cobertura de Link Edges Baixa",
        description: `Apenas ${parents} de ${collections} collections têm edges resolvidos.`,
        detail: `O metadata collector precisa processar collections para resolver seus filhos. Verifique se o cron está rodando e considere executar um backfill_recent_collections.`,
        action: "⚠️ Execute backfill_recent_collections para aquecer a cobertura.",
      };
    }
    case "link_edges_freshness": {
      const stale = Number(d.stale_60d || 0);
      const total = Number(d.total || 0);
      if (alert.severity === "ok") return {
        title: "Link Edges Freshness",
        description: `Edges atualizados. ${stale} stale de ${total} total.`,
      };
      return {
        title: "Link Edges Desatualizados",
        description: `${fmt(stale)} edges não são atualizados há mais de 60 dias (${total} total).`,
        detail: `Edges stale podem causar dados obsoletos nos rails resolvidos. O cleanup diário removerá edges com mais de 60 dias.`,
        action: stale > total * 0.5 ? "⚠️ Verifique se o metadata collector está processando collections." : undefined,
      };
    }
    default:
      return {
        title: alert.message,
        description: `Alerta: ${alert.alert_key}`,
        detail: JSON.stringify(d),
      };
  }
}

// ─── Component ────────────────────────────────────────────────

export default function AdminOverview() {
  const [lastRefresh, setLastRefresh] = useState(timeNow());

  // Census
  const [census, setCensus] = useState<CensusData | null>(null);

  // Metadata
  const [meta, setMeta] = useState<MetaData | null>(null);
  const [metaThroughput, setMetaThroughput] = useState<number | null>(null);

  // Exposure
  const [exposure, setExposure] = useState<ExposureData | null>(null);

  // Rails / Link graph
  const [linkGraph, setLinkGraph] = useState<LinkGraphData | null>(null);

  // Crons
  const [crons, setCrons] = useState<CronJob[]>([]);

  // System alerts (materialized in DB by orchestrator)
  const [alerts, setAlerts] = useState<SystemAlert[]>([]);

  // Weekly pipeline (preserved)
  const [reports, setReports] = useState<any[]>([]);
  const [generating, setGenerating] = useState(false);
  const [activeReportId, setActiveReportId] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [genState, setGenState] = useState<GenerationState>(INITIAL_GEN);
  const [pipelineOpen, setPipelineOpen] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const lastPhaseRef = useRef("idle");
  const { toast } = useToast();

  // History tracking for sparklines
  const censusHistory = useRef<Record<string, number[]>>({});
  const metaHistory = useRef<Record<string, number[]>>({});

  // Enqueue gap
  const [enqueueLoading, setEnqueueLoading] = useState(false);
  const [metaFlash, setMetaFlash] = useState(false);

  const addLog = useCallback((msg: string) => {
    setLogs(p => [...p.slice(-80), { time: timeNow(), message: msg }]);
  }, []);

  // ─── Fetch functions ─────────────────────────────────────

  const fetchCensus = useCallback(async () => {
    const [censusRpc, reportsRes, weeklyRes] = await Promise.all([
      supabase.rpc("get_census_stats"),
      supabase.from("discover_reports").select("id", { count: "exact", head: true }),
      supabase.from("weekly_reports").select("id, published_at"),
    ]);

    const cs = censusRpc?.data as any || {};
    const total = Number(cs.total_islands || 0);
    const rep = Number(cs.reported || 0);
    const sup = Number(cs.suppressed || 0);

    setCensus({
      totalIslands: total,
      reported: rep,
      suppressed: sup,
      otherStatus: total - rep - sup,
      withTitle: Number(cs.with_title || 0),
      uniqueCreators: Number(cs.unique_creators || 0),
      engineReports: reportsRes?.count || 0,
      weeklyReports: weeklyRes?.data?.length || 0,
      weeklyPublished: weeklyRes?.data?.filter((r: any) => r.published_at)?.length || 0,
    });

    const h = censusHistory.current;
    const pushH = (key: string, val: number) => { h[key] = [...(h[key] || []).slice(-30), val]; };
    pushH("total", total);
    pushH("reported", rep);
    pushH("suppressed", sup);
  }, []);

  // Rolling throughput: keep last N samples with timestamps
  const metaSamples = useRef<{ ts: number; val: number }[]>([]);

  const fetchMeta = useCallback(async () => {
    const { data: ms, error } = await supabase.rpc("get_metadata_pipeline_stats");
    if (error || !ms) return;

    const stats = ms as any;
    const wt = Number(stats.with_title || 0);
    const now = Date.now();

    // Rolling throughput over 60s window
    metaSamples.current.push({ ts: now, val: wt });
    // Keep only last 2 minutes of samples
    metaSamples.current = metaSamples.current.filter(s => now - s.ts < 120_000);
    if (metaSamples.current.length >= 2) {
      const oldest = metaSamples.current[0];
      const newest = metaSamples.current[metaSamples.current.length - 1];
      const deltaVal = newest.val - oldest.val;
      const deltaMin = (newest.ts - oldest.ts) / 60_000;
      if (deltaMin > 0.1 && deltaVal >= 0) {
        setMetaThroughput(Math.round(deltaVal / deltaMin));
      }
    }

    setMeta({
      total: Number(stats.total || 0),
      withTitle: wt,
      withError: Number(stats.with_error || 0),
      pendingNoData: Number(stats.pending_no_data || 0),
      locked: Number(stats.locked || 0),
      dueNow: Number(stats.due_now || 0),
      islands: Number(stats.islands || 0),
      collections: Number(stats.collections || 0),
    });

    const mh = metaHistory.current;
    const pushMH = (key: string, val: number) => { mh[key] = [...(mh[key] || []).slice(-30), val]; };
    pushMH("total", Number(stats.total || 0));
    pushMH("withTitle", wt);
  }, []);

  const handleEnqueue = useCallback(async () => {
    setEnqueueLoading(true);
    try {
      const res = await supabase.functions.invoke("discover-enqueue-gap", { body: {} });
      if (res.error) throw new Error(res.error.message);
      const d = res.data || {};
      const inserted = Number(d.inserted || 0);
      const updated = Number(d.updated || 0);
      const submitted = Number(d.submitted || 0);
      toast({ title: "Enfileiramento concluído", description: `${fmt(inserted)} novas + ${fmt(updated)} atualizadas de ${fmt(submitted)} submetidas (${((d.elapsed_ms || 0) / 1000).toFixed(1)}s).` });
      addLog(`Enfileirar: ${fmt(inserted)} novas (${fmt(updated)} bump) de ${fmt(submitted)}`);
      await Promise.all([fetchMeta(), fetchCensus()]);
      setMetaFlash(true);
      setTimeout(() => setMetaFlash(false), 2000);
    } catch (e: any) {
      toast({ title: "Erro ao enfileirar", description: e.message, variant: "destructive" });
    } finally {
      setEnqueueLoading(false);
    }
  }, [toast, addLog, fetchMeta, fetchCensus]);

  const fetchExposure = useCallback(async () => {
    const twentyFourAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const [targetsR, targetsOkR, ticksR, ticksOkR, ticksFailR] = await Promise.all([
      supabase.from("discovery_exposure_targets").select("id", { count: "exact", head: true }),
      supabase.from("discovery_exposure_targets").select("id", { count: "exact", head: true }).not("last_ok_tick_at", "is", null),
      supabase.from("discovery_exposure_ticks").select("id", { count: "exact", head: true }).gte("ts_start", twentyFourAgo),
      supabase.from("discovery_exposure_ticks").select("id", { count: "exact", head: true }).gte("ts_start", twentyFourAgo).eq("status", "ok"),
      supabase.from("discovery_exposure_ticks").select("id", { count: "exact", head: true }).gte("ts_start", twentyFourAgo).eq("status", "error"),
    ]);
    setExposure({
      targetsTotal: targetsR?.count || 0,
      targetsOk: targetsOkR?.count || 0,
      ticks24h: ticksR?.count || 0,
      ticksOk: ticksOkR?.count || 0,
      ticksFailed: ticksFailR?.count || 0,
    });
  }, []);

  const fetchLinkGraph = useCallback(async () => {
    const { data, error } = await supabase.rpc("get_link_graph_stats");
    if (error || !data) return;
    const s = data as any;
    setLinkGraph({
      edgesTotal: Number(s.edges_total || 0),
      parentsTotal: Number(s.parents_total || 0),
      childrenTotal: Number(s.children_total || 0),
      collectionsSeen24h: Number(s.collections_seen_24h || 0),
      collectionsResolved24h: Number(s.collections_resolved_24h || 0),
      resolution24hPct: s.resolution_24h_pct != null ? Number(s.resolution_24h_pct) : null,
      edgeAgeSeconds: s.edge_age_seconds != null ? Number(s.edge_age_seconds) : null,
      staleEdges60d: Number(s.stale_edges_60d || 0),
      collectionsDueNow: Number(s.collections_due_now || 0),
    });
  }, []);

  const fetchCrons = useCallback(async () => {
    // We can't query cron.job directly from client, use hardcoded known crons with health inference
    const knownCrons: CronJob[] = [
      { name: "orchestrate-minute (Exposure)", schedule: "* * * * *", active: true },
      { name: "discover-collector-orchestrate-min", schedule: "* * * * *", active: true },
      { name: "discover-links-metadata-orchestrate-min", schedule: "* * * * *", active: true },
      { name: "discover-exposure-intel-refresh-5min", schedule: "*/5 * * * *", active: true },
      { name: "raw-cleanup-hourly", schedule: "5 * * * *", active: true },
      { name: "maintenance-daily", schedule: "7 0 * * *", active: true },
      { name: "discover-collector-weekly-v2", schedule: "0 6 * * 1", active: true },
    ];
    setCrons(knownCrons);
  }, []);

  const fetchAlerts = useCallback(async () => {
    const { data, error } = await supabase
      .from("system_alerts_current" as any)
      .select("alert_key,severity,message,details,updated_at")
      .order("alert_key", { ascending: true });
    if (error) return;
    setAlerts((data || []) as any);
  }, []);

  const fetchReports = useCallback(async () => {
    const { data } = await supabase.from("discover_reports").select("*").order("created_at", { ascending: false }).limit(5);
    if (data) setReports(data);
  }, []);

  // ─── Polling ──────────────────────────────────────────────

  // Fast polling for metadata (5s), slower for everything else (30s)
  useEffect(() => {
    const tickFast = async () => {
      await fetchMeta();
      setLastRefresh(timeNow());
    };
    const tickSlow = async () => {
      await Promise.all([fetchCensus(), fetchExposure(), fetchLinkGraph(), fetchCrons(), fetchReports(), fetchAlerts()]);
    };
    tickFast();
    tickSlow();
    const fastId = setInterval(tickFast, 5_000);
    const slowId = setInterval(tickSlow, 30_000);
    return () => { clearInterval(fastId); clearInterval(slowId); };
  }, [fetchCensus, fetchMeta, fetchExposure, fetchLinkGraph, fetchCrons, fetchReports, fetchAlerts]);

  // ─── Weekly pipeline (preserved logic) ────────────────────

  const applyReportState = useCallback((report: any, logPhase = true) => {
    const phase = (report?.phase || "idle") as GenerationState["phase"];
    setGenState({
      phase, reportId: report?.id || null,
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
    if (!running && phase === "done") addLog("Pipeline concluido.");
  }, [addLog]);

  const fetchActiveReportState = useCallback(async (reportId: string, logPhase = true) => {
    const { data: report } = await supabase.from("discover_reports").select("*").eq("id", reportId).single();
    if (report) applyReportState(report, logPhase);
  }, [applyReportState]);

  const triggerOrchestrateTick = useCallback(async (reportId: string) => {
    const { data, error } = await supabase.functions.invoke("discover-collector", { body: { mode: "orchestrate", reportId } });
    if (error) { addLog(`Tick falhou: ${error.message}`); return; }
    if (data?.throughput_per_min != null) {
      addLog(`Tick: ${fmt(data.metrics_done_count)}/${fmt(data.queue_total)} | ${fmt(data.throughput_per_min)} ilhas/min | workers ${data.workers_active ?? 0}`);
    } else addLog("Tick orchestrate executado.");
  }, [addLog]);

  useEffect(() => {
    (async () => {
      const { data: active } = await supabase.from("discover_reports").select("*").in("phase", ["catalog", "metrics", "finalize", "ai"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (active) {
        setActiveReportId(active.id);
        setPipelineOpen(true);
        addLog(`Acompanhando report ativo: ${active.id.slice(0, 8)}...`);
        applyReportState(active, false);
      }
    })();
  }, [addLog, applyReportState]);

  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logs]);

  useEffect(() => {
    if (!activeReportId) return;
    const timer = setInterval(() => fetchActiveReportState(activeReportId, true), 5000);
    return () => clearInterval(timer);
  }, [activeReportId, fetchActiveReportState]);

  const handleGenerate = async () => {
    setLogs([]); addLog("Iniciando pipeline..."); setGenerating(true); setPipelineOpen(true);
    const startRes = await supabase.functions.invoke("discover-collector", { body: { mode: "start" } });
    if (startRes.error || !startRes.data?.success) {
      addLog(`Falha no start: ${startRes.data?.error || startRes.error?.message || "erro"}`);
      setGenerating(false); return;
    }
    const reportId = startRes.data.reportId as string;
    setActiveReportId(reportId);
    addLog(`Report criado: ${reportId.slice(0, 8)}...`);
    await triggerOrchestrateTick(reportId);
    await fetchActiveReportState(reportId, false);
    await fetchReports();
    toast({ title: "Pipeline iniciado", description: "Backend continua executando sem depender da aba." });
  };

  const handleRefreshTick = async () => {
    if (!activeReportId) return;
    await triggerOrchestrateTick(activeReportId);
    await fetchActiveReportState(activeReportId, false);
    await fetchReports();
  };

  // ─── Computed health statuses ─────────────────────────────

  const dbHealth: HealthStatus = census ? "ok" : "idle";
  const metaHealth: HealthStatus = !meta ? "idle" : meta.total === 0 ? "idle" : (meta.withTitle / meta.total) > 0.9 ? "ok" : (meta.withTitle / meta.total) > 0.5 ? "warn" : "error";
  const exposureHealth: HealthStatus = !exposure ? "idle" : exposure.ticksFailed > 5 ? "error" : exposure.targetsOk > 0 ? "ok" : "warn";
  const railsHealth: HealthStatus = !linkGraph
    ? "idle"
    : linkGraph.collectionsSeen24h === 0
      ? "idle"
      : (linkGraph.resolution24hPct || 0) >= 0.85
        ? "ok"
        : (linkGraph.resolution24hPct || 0) >= 0.5
          ? "warn"
          : "error";
  const reportHealth: HealthStatus = generating ? "ok" : genState.phase === "done" ? "ok" : "idle";

  const metaPct = meta && meta.total > 0 ? (meta.withTitle / meta.total) * 100 : 0;
  const metaGap = (census?.totalIslands || 0) - (meta?.islands || 0);
  const metaPending = meta ? meta.total - meta.withTitle : 0;
  const metaEta = metaThroughput && metaThroughput > 0 && metaPending > 0 ? Math.ceil(metaPending / metaThroughput) : null;

  const alertBad = alerts.filter(a => a.severity !== "ok");
  const alertStatus: HealthStatus =
    alertBad.length === 0 ? "ok" : alertBad.some(a => a.severity === "error") ? "error" : "warn";

  const phaseLabel: Record<string, string> = {
    idle: "", catalog: "Catalogando", metrics: "Coletando metricas",
    finalize: "Finalizando rankings", ai: "Gerando IA", done: "Concluido",
  };

  // ─── Render ───────────────────────────────────────────────

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold flex items-center gap-2">
            <Activity className="h-6 w-6 text-primary" /> Command Center
          </h1>
          <p className="text-sm text-muted-foreground">Monitoramento em tempo real de todos os subsistemas.</p>
        </div>
        <div className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Radio className="h-3 w-3 text-green-500 animate-pulse" />
          Atualizado: {lastRefresh}
        </div>
      </div>

      {/* ── Section 1: System Health Bar ────────────────────── */}
      <Card>
        <CardContent className="py-3 px-4">
          <div className="flex flex-wrap items-center gap-4 text-xs">
            <div className="flex items-center gap-1.5"><HealthDot status={dbHealth} label="Database conectada" /><span className="text-muted-foreground">Database</span></div>
            <div className="flex items-center gap-1.5"><HealthDot status={exposureHealth} label={`${exposure?.ticksFailed || 0} falhas 24h`} /><span className="text-muted-foreground">Exposure</span></div>
            <div className="flex items-center gap-1.5"><HealthDot status={metaHealth} label={`${metaPct.toFixed(1)}% preenchido`} /><span className="text-muted-foreground">Metadata</span></div>
            <div className="flex items-center gap-1.5"><HealthDot status={railsHealth} label={`${linkGraph?.collectionsResolved24h || 0}/${linkGraph?.collectionsSeen24h || 0} collections resolvidas (24h)`} /><span className="text-muted-foreground">Rails</span></div>
            <div className="flex items-center gap-1.5"><HealthDot status={reportHealth} label={generating ? "Em andamento" : "Idle"} /><span className="text-muted-foreground">Report</span></div>
            <div className="flex items-center gap-1.5"><HealthDot status={alertStatus} label={`${alertBad.length} alertas ativos`} /><span className="text-muted-foreground">Alertas</span></div>
            <div className="flex items-center gap-1.5"><HealthDot status="ok" label="7/7 ativos" /><span className="text-muted-foreground">Crons</span></div>
          </div>
        </CardContent>
      </Card>

      {/* ── Alerts Section (always visible) ──────────────── */}
      <Card className={alertBad.length > 0 ? "border-destructive/30" : "border-green-500/30"}>
        <CardHeader className="py-3">
          <CardTitle className="text-sm flex items-center gap-2">
            {alertBad.length > 0 ? (
              <><AlertTriangle className="h-4 w-4 text-destructive" /> {alertBad.length} Alerta{alertBad.length > 1 ? "s" : ""} Ativo{alertBad.length > 1 ? "s" : ""}</>
            ) : (
              <><CheckCircle2 className="h-4 w-4 text-green-500" /> Todos os sistemas operacionais</>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 pb-3 space-y-3">
          {alerts.map((a) => {
            const age = a.updated_at ? Math.round((Date.now() - new Date(a.updated_at).getTime()) / 1000) : null;
            const ageStr = age != null ? (age < 60 ? `${age}s atrás` : age < 3600 ? `${Math.round(age / 60)}min atrás` : `${Math.round(age / 3600)}h ${Math.round((age % 3600) / 60)}m atrás`) : "";
            const info = getAlertInfo(a);
            return (
              <div
                key={a.alert_key}
                className={`rounded-lg border p-3 space-y-1.5 ${
                  a.severity === "error" ? "bg-destructive/5 border-destructive/20" :
                  a.severity === "warn" ? "bg-yellow-500/5 border-yellow-500/20" :
                  "bg-green-500/5 border-green-500/20"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2">
                    <span className={`mt-1 inline-block h-2.5 w-2.5 rounded-full shrink-0 ${
                      a.severity === "error" ? "bg-red-500 animate-pulse" :
                      a.severity === "warn" ? "bg-yellow-500" : "bg-green-500"
                    }`} />
                    <div>
                      <div className="font-semibold text-sm">{info.title}</div>
                      <p className="text-xs text-muted-foreground mt-0.5">{info.description}</p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <Badge variant={a.severity === "error" ? "destructive" : a.severity === "warn" ? "secondary" : "default"} className="text-[10px]">
                      {a.severity === "error" ? "Crítico" : a.severity === "warn" ? "Atenção" : "OK"}
                    </Badge>
                    <div className="text-[10px] text-muted-foreground mt-0.5">{ageStr}</div>
                  </div>
                </div>
                {info.detail && (
                  <div className="ml-4.5 pl-2 border-l-2 border-muted text-[11px] text-muted-foreground">
                    {info.detail}
                  </div>
                )}
                {info.action && (
                  <div className="ml-4.5 text-[11px] font-medium text-primary">{info.action}</div>
                )}
              </div>
            );
          })}
          {alerts.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-2">Nenhum alerta cadastrado. Execute o system alerts via cron.</p>
          )}
        </CardContent>
      </Card>

      {/* ── Section 2: Database Census ─────────────────────── */}
      <div>
        <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
          <Database className="h-4 w-4" /> Database Census
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard icon={Layers} label="Total Ilhas" value={fmt(census?.totalIslands)} sparkData={censusHistory.current.total} />
          <StatCard icon={CheckCircle2} label="Reported" value={fmt(census?.reported)} sub={census ? pct(census.reported, census.totalIslands) : undefined} color="success" sparkData={censusHistory.current.reported} />
          <StatCard icon={EyeOff} label="Suprimidas" value={fmt(census?.suppressed)} sub={census ? pct(census.suppressed, census.totalIslands) : undefined} sparkData={censusHistory.current.suppressed} />
          <StatCard icon={AlertCircle} label="Outro Status" value={fmt(census?.otherStatus)} sparkData={censusHistory.current.otherStatus} />
          <StatCard icon={FileText} label="Com Titulo (Cache)" value={fmt(census?.withTitle)} sub={census ? pct(census.withTitle, census.totalIslands) : undefined} color={census && census.withTitle < census.totalIslands * 0.01 ? "destructive" : "default"} sparkData={censusHistory.current.withTitle} />
          <StatCard icon={Users} label="Criadores Unicos" value={fmt(census?.uniqueCreators)} sparkData={censusHistory.current.uniqueCreators} />
          <StatCard icon={BarChart3} label="Reports Engine" value={fmt(census?.engineReports)} sparkData={censusHistory.current.engineReports} />
          <StatCard icon={FileText} label="Weekly Reports" value={census ? `${census.weeklyReports} (${census.weeklyPublished} pub.)` : "-"} sparkData={censusHistory.current.weeklyReports} />
        </div>
      </div>

      {/* ── Section 3: Metadata Pipeline ───────────────────── */}
      <div>
        <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
          <Hash className="h-4 w-4" /> Metadata Pipeline
        </h2>
        <Card className={`transition-all duration-500 ${metaFlash ? "ring-2 ring-primary/50 bg-primary/5" : ""}`}>
          <CardContent className="pt-4 pb-4 space-y-4">
            {/* Progress bar */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-medium">Preenchimento: {fmt(meta?.withTitle)} / {fmt(meta?.total)} enfileiradas</span>
                <span className="text-sm font-mono font-bold">{metaPct.toFixed(1)}%</span>
              </div>
              <Progress value={metaPct} className="h-3" />
              <div className="flex justify-between mt-1 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  {metaThroughput !== null && metaThroughput > 0 ? (
                    <><Zap className="h-3 w-3 text-green-500" /> {fmt(metaThroughput)} ilhas/min</>
                  ) : metaThroughput === 0 ? (
                    <><Clock className="h-3 w-3" /> Parado — aguardando collector</>
                  ) : (
                    <><Clock className="h-3 w-3" /> Calculando throughput...</>
                  )}
                </span>
                <span>
                  {metaEta !== null ? (
                    metaEta <= 0 ? "✓ Concluído" : `ETA: ~${metaEta < 60 ? `${metaEta} min` : `${Math.round(metaEta / 60)}h ${metaEta % 60}m`}`
                  ) : (metaPending > 0 ? `${fmt(metaPending)} pendentes` : "ETA: --")}
                </span>
              </div>
            </div>

            {/* Detail grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
              <StatCard icon={Layers} label="Total Enfileirado" value={fmt(meta?.total)} />
              <StatCard icon={CheckCircle2} label="Com Titulo" value={fmt(meta?.withTitle)} color="success" />
              <StatCard icon={Clock} label="Pendentes s/ dados" value={fmt(meta?.pendingNoData)} color={meta && meta.pendingNoData > 100 ? "warning" : "default"} />
              <StatCard icon={AlertTriangle} label="Com Erro" value={fmt(meta?.withError)} color={meta && meta.withError > 0 ? "destructive" : "default"} />
              <StatCard icon={CalendarClock} label="Due Agora" value={fmt(meta?.dueNow)} />
              <StatCard icon={Lock} label="Locked (proc.)" value={fmt(meta?.locked)} />
              <StatCard icon={Zap} label="Throughput" value={metaThroughput !== null ? `${fmt(metaThroughput)}/min` : "--"} />
            </div>

            {/* Gap analysis */}
            <div className="rounded-lg border bg-muted/30 p-3 space-y-1.5 text-xs">
              <p className="font-semibold text-sm">Análise de Cobertura</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div><span className="text-muted-foreground">Ilhas no Cache:</span> <span className="font-bold">{fmt(census?.totalIslands)}</span></div>
                <div><span className="text-muted-foreground">Metadata Enfileirado:</span> <span className="font-bold">{fmt(meta?.total)}</span> <span className="text-muted-foreground">({census && meta ? pct(meta.total, census.totalIslands) : "--"})</span></div>
                <div><span className="text-muted-foreground">Islands:</span> <span className="font-bold">{fmt(meta?.islands)}</span></div>
                <div><span className="text-muted-foreground">Collections:</span> <span className="font-bold">{fmt(meta?.collections)}</span></div>
              </div>
              <div className="pt-1 border-t flex items-center justify-between gap-2">
                <div>
                  <span className="text-muted-foreground">GAP:</span>{" "}
                  <span className={`font-bold ${metaGap > 0 ? "text-destructive" : "text-green-500"}`}>{fmt(metaGap)}</span>{" "}
                  <span className="text-muted-foreground">ilhas do cache sem metadata enfileirado</span>
                </div>
                <Button size="sm" variant="outline" onClick={handleEnqueue} disabled={enqueueLoading || metaGap <= 0} className="text-xs shrink-0">
                  {enqueueLoading ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Zap className="h-3 w-3 mr-1" />}
                  Enfileirar GAP
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Section 4: Exposure Pipeline ───────────────────── */}
      <div>
        <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
          <Eye className="h-4 w-4" /> Exposure Pipeline
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <StatCard icon={Radio} label="Status" value={exposure && exposure.targetsOk > 0 ? "Running" : "Idle"} color={exposure && exposure.targetsOk > 0 ? "success" : "default"} />
          <StatCard icon={Target} label="Targets" value={exposure ? `${exposure.targetsOk}/${exposure.targetsTotal}` : "-"} />
          <StatCard icon={Activity} label="Ticks (24h)" value={fmt(exposure?.ticks24h)} />
          <StatCard icon={CheckCircle2} label="OK (24h)" value={fmt(exposure?.ticksOk)} color="success" />
          <StatCard icon={AlertTriangle} label="Falhas (24h)" value={fmt(exposure?.ticksFailed)} color={exposure && exposure.ticksFailed > 0 ? "destructive" : "default"} />
        </div>
        <div className="mt-2">
          <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" asChild>
            <Link to="/admin/exposure"><ArrowRight className="h-3 w-3 mr-1" /> Ver detalhes do Exposure</Link>
          </Button>
        </div>
      </div>

      <div>
        <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
          <Target className="h-4 w-4" /> Rails Resolver / Link Graph
        </h2>
        <Card>
          <CardContent className="pt-4 pb-4 space-y-4">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-medium">
                  Resolucao 24h: {fmt(linkGraph?.collectionsResolved24h)} / {fmt(linkGraph?.collectionsSeen24h)} collections
                </span>
                <span className="text-sm font-mono font-bold">
                  {linkGraph?.resolution24hPct != null ? `${(linkGraph.resolution24hPct * 100).toFixed(1)}%` : "--"}
                </span>
              </div>
              <Progress value={linkGraph?.resolution24hPct != null ? linkGraph.resolution24hPct * 100 : 0} className="h-3" />
              <div className="flex justify-between mt-1 text-[10px] text-muted-foreground">
                <span>edges total: {fmt(linkGraph?.edgesTotal)}</span>
                <span>collections due now: {fmt(linkGraph?.collectionsDueNow)}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
              <StatCard icon={Layers} label="Edges" value={fmt(linkGraph?.edgesTotal)} />
              <StatCard icon={Hash} label="Parents" value={fmt(linkGraph?.parentsTotal)} />
              <StatCard icon={Hash} label="Children" value={fmt(linkGraph?.childrenTotal)} />
              <StatCard icon={CalendarClock} label="Seen 24h" value={fmt(linkGraph?.collectionsSeen24h)} />
              <StatCard icon={CheckCircle2} label="Resolved 24h" value={fmt(linkGraph?.collectionsResolved24h)} color="success" />
              <StatCard icon={AlertTriangle} label="Stale >60d" value={fmt(linkGraph?.staleEdges60d)} color={linkGraph && linkGraph.staleEdges60d > 10000 ? "warning" : "default"} />
            </div>

            <div className="rounded-lg border bg-muted/30 p-3 space-y-1.5 text-xs">
              <p className="font-semibold text-sm">Notify / Acoes Recomendadas</p>
              {(linkGraph?.resolution24hPct ?? 0) < 0.5 && (linkGraph?.collectionsSeen24h || 0) > 0 ? (
                <p className="text-destructive">Cobertura baixa de rails resolvidos. Executar backfill_recent_collections e revisar logs do metadata collector.</p>
              ) : (
                <p className="text-muted-foreground">Cobertura de rails dentro do esperado.</p>
              )}
              {(linkGraph?.edgeAgeSeconds ?? 0) > 21600 ? (
                <p className="text-yellow-600">Link graph desatualizado (&gt; 6h). Verifique cron do metadata orchestrate.</p>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Section 5: Cron Jobs ───────────────────────────── */}
      <div>
        <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
          <Timer className="h-4 w-4" /> Cron Jobs
        </h2>
        <Card>
          <CardContent className="py-3 px-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left font-medium px-4 py-2">Job</th>
                    <th className="text-left font-medium px-4 py-2">Schedule</th>
                    <th className="text-left font-medium px-4 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {crons.map((c) => (
                    <tr key={c.name} className="border-b last:border-0">
                      <td className="px-4 py-2 font-mono">{c.name}</td>
                      <td className="px-4 py-2 font-mono text-muted-foreground">{c.schedule}</td>
                      <td className="px-4 py-2">
                        <Badge variant={c.active ? "default" : "destructive"} className="text-[10px]">
                          {c.active ? "Ativo" : "Inativo"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Section 6: Weekly Report Pipeline (collapsible) ─ */}
      <Collapsible open={pipelineOpen} onOpenChange={setPipelineOpen}>
        <div className="flex items-center justify-between">
          <CollapsibleTrigger asChild>
            <button className="flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors">
              {pipelineOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              <Sparkles className="h-4 w-4" /> Weekly Report Pipeline
            </button>
          </CollapsibleTrigger>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleRefreshTick} disabled={!activeReportId}>
              <RefreshCcw className="h-3.5 w-3.5 mr-1.5" /> Tick
            </Button>
            <Button size="sm" onClick={handleGenerate} disabled={generating}>
              {generating ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Em andamento...</> : <><Sparkles className="h-3.5 w-3.5 mr-1.5" /> Gerar Report</>}
            </Button>
          </div>
        </div>

        <CollapsibleContent className="mt-3 space-y-4">
          {(generating || genState.phase === "done") && (
            <Card className="border-primary/30">
              <CardContent className="pt-4 pb-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {genState.phase === "done" ? <CheckCircle2 className="h-5 w-5 text-primary" /> : <Loader2 className="h-5 w-5 animate-spin text-primary" />}
                    <span className="text-sm font-medium">{phaseLabel[genState.phase]}</span>
                  </div>
                  <span className="text-xs font-mono">{genState.progressPct}%</span>
                </div>
                <Progress value={genState.progressPct} className="h-3" />

                <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 text-center text-xs">
                  <div><p className="text-muted-foreground">{genState.phase === "catalog" ? "Descobertas" : "Na fila"}</p><p className="font-bold">{fmt(genState.phase === "catalog" ? genState.catalogDiscovered : genState.queueTotal)}</p></div>
                  <div><p className="text-muted-foreground">Processadas</p><p className="font-bold">{fmt(genState.metricsDone)}</p></div>
                  <div><p className="text-muted-foreground">Pendentes</p><p className="font-bold">{fmt(genState.pendingCount)}</p></div>
                  <div><p className="text-muted-foreground">Processing</p><p className="font-bold">{fmt(genState.processingCount)}</p></div>
                  <div><p className="text-muted-foreground">Done</p><p className="font-bold">{fmt(genState.doneCount)}</p></div>
                  <div><p className="text-muted-foreground">Erros</p><p className="font-bold text-destructive">{fmt(genState.errors)}</p></div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-center text-xs">
                  <div className="rounded-md border bg-muted/40 p-2"><p className="text-muted-foreground flex items-center justify-center gap-1"><Gauge className="h-3.5 w-3.5" /> Throughput</p><p className="font-semibold">{fmt(genState.throughputPerMin)} ilhas/min</p></div>
                  <div className="rounded-md border bg-muted/40 p-2"><p className="text-muted-foreground flex items-center justify-center gap-1"><Users className="h-3.5 w-3.5" /> Workers</p><p className="font-semibold">{genState.workersActive}</p></div>
                  <div className="rounded-md border bg-muted/40 p-2"><p className="text-muted-foreground flex items-center justify-center gap-1"><EyeOff className="h-3.5 w-3.5" /> Suprimidas</p><p className="font-semibold">{fmt(genState.suppressedCount)}</p></div>
                  <div className={`rounded-md border p-2 ${genState.rateLimitedCount > 0 ? "bg-destructive/10 border-destructive/30" : "bg-muted/40"}`}><p className="text-muted-foreground flex items-center justify-center gap-1"><ShieldAlert className="h-3.5 w-3.5" /> 429 Rate Limit</p><p className={`font-semibold ${genState.rateLimitedCount > 0 ? "text-destructive" : ""}`}>{fmt(genState.rateLimitedCount)}</p></div>
                  <div className="rounded-md border bg-muted/40 p-2"><p className="text-muted-foreground flex items-center justify-center gap-1"><AlertTriangle className="h-3.5 w-3.5" /> Requeue stale</p><p className="font-semibold">{fmt(genState.staleRequeuedCount)}</p></div>
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

          <h3 className="font-display text-sm font-semibold">Últimos Reports</h3>
          <div className="space-y-2">
            {reports.map((r) => (
              <Card key={r.id}>
                <CardContent className="flex items-center justify-between py-3">
                  <div>
                    <p className="font-display font-semibold text-sm">Semana {r.week_number}/{r.year}</p>
                    <p className="text-[10px] text-muted-foreground">{r.phase} · {r.reported_count || 0} reported</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={r.status === "completed" ? "default" : "secondary"} className="text-[10px]">{r.status}</Badge>
                    <Button variant="outline" size="sm" className="text-xs" asChild>
                      <Link to="/admin/reports">Ver</Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
