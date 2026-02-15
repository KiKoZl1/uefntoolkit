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

// ─── StatCard ─────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, sub, color }: {
  icon: React.ElementType; label: string; value: string; sub?: string; color?: "destructive" | "success" | "warning" | "default";
}) {
  const colorMap = {
    destructive: "text-destructive",
    success: "text-green-500",
    warning: "text-yellow-500",
    default: "text-foreground",
  };
  return (
    <div className="rounded-lg border bg-card p-3 space-y-1">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        <span className="text-xs truncate">{label}</span>
      </div>
      <p className={`font-display text-lg font-bold leading-none ${colorMap[color || "default"]}`}>{value}</p>
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

interface CronJob {
  name: string; schedule: string; active: boolean;
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

// ─── Component ────────────────────────────────────────────────

export default function AdminOverview() {
  const [lastRefresh, setLastRefresh] = useState(timeNow());

  // Census
  const [census, setCensus] = useState<CensusData | null>(null);

  // Metadata
  const [meta, setMeta] = useState<MetaData | null>(null);
  const [metaThroughput, setMetaThroughput] = useState<number | null>(null);
  const prevMetaTitle = useRef<number | null>(null);
  const prevMetaTs = useRef<number>(Date.now());

  // Exposure
  const [exposure, setExposure] = useState<ExposureData | null>(null);

  // Crons
  const [crons, setCrons] = useState<CronJob[]>([]);

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

  const addLog = useCallback((msg: string) => {
    setLogs(p => [...p.slice(-80), { time: timeNow(), message: msg }]);
  }, []);

  // ─── Fetch functions ─────────────────────────────────────

  const fetchCensus = useCallback(async () => {
    const [reportsRes, weeklyRes] = await Promise.all([
      supabase.from("discover_reports").select("id", { count: "exact", head: true }),
      supabase.from("weekly_reports").select("id, published_at"),
    ]);

    // Cache census via raw counts
    const { count: totalIslands } = await supabase.from("discover_islands_cache").select("island_code", { count: "exact", head: true });
    const { count: reported } = await supabase.from("discover_islands_cache").select("island_code", { count: "exact", head: true }).eq("last_status", "reported");
    const { count: suppressed } = await supabase.from("discover_islands_cache").select("island_code", { count: "exact", head: true }).eq("last_status", "suppressed");
    const { count: withTitle } = await supabase.from("discover_islands_cache").select("island_code", { count: "exact", head: true }).not("title", "is", null);
    const { count: uniqueCreators } = await supabase.from("discover_islands_cache").select("creator_code", { count: "exact", head: true }).not("creator_code", "is", null);

    const total = totalIslands || 0;
    const rep = reported || 0;
    const sup = suppressed || 0;

    setCensus({
      totalIslands: total,
      reported: rep,
      suppressed: sup,
      otherStatus: total - rep - sup,
      withTitle: withTitle || 0,
      uniqueCreators: uniqueCreators || 0,
      engineReports: reportsRes?.count || 0,
      weeklyReports: weeklyRes?.data?.length || 0,
      weeklyPublished: weeklyRes?.data?.filter((r: any) => r.published_at)?.length || 0,
    });
  }, []);

  const fetchMeta = useCallback(async () => {
    const [totalR, titleR, errorR, pendingR, lockedR, dueR, islandR, collR] = await Promise.all([
      supabase.from("discover_link_metadata").select("link_code", { count: "exact", head: true }),
      supabase.from("discover_link_metadata").select("link_code", { count: "exact", head: true }).not("title", "is", null),
      supabase.from("discover_link_metadata").select("link_code", { count: "exact", head: true }).not("last_error", "is", null).is("title", null),
      supabase.from("discover_link_metadata").select("link_code", { count: "exact", head: true }).is("title", null).is("last_error", null),
      supabase.from("discover_link_metadata").select("link_code", { count: "exact", head: true }).not("locked_at", "is", null),
      supabase.from("discover_link_metadata").select("link_code", { count: "exact", head: true }).lte("next_due_at", new Date().toISOString()),
      supabase.from("discover_link_metadata").select("link_code", { count: "exact", head: true }).eq("link_code_type", "island"),
      supabase.from("discover_link_metadata").select("link_code", { count: "exact", head: true }).eq("link_code_type", "collection"),
    ]);

    const wt = titleR?.count || 0;
    const now = Date.now();

    // Throughput calc
    if (prevMetaTitle.current !== null) {
      const delta = wt - prevMetaTitle.current;
      const elapsedMin = (now - prevMetaTs.current) / 1000 / 60;
      if (elapsedMin > 0.05 && delta >= 0) {
        setMetaThroughput(Math.round(delta / elapsedMin));
      }
    }
    prevMetaTitle.current = wt;
    prevMetaTs.current = now;

    setMeta({
      total: totalR?.count || 0,
      withTitle: wt,
      withError: errorR?.count || 0,
      pendingNoData: pendingR?.count || 0,
      locked: lockedR?.count || 0,
      dueNow: dueR?.count || 0,
      islands: islandR?.count || 0,
      collections: collR?.count || 0,
    });
  }, []);

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

  const fetchReports = useCallback(async () => {
    const { data } = await supabase.from("discover_reports").select("*").order("created_at", { ascending: false }).limit(5);
    if (data) setReports(data);
  }, []);

  // ─── Polling ──────────────────────────────────────────────

  useEffect(() => {
    const tick = async () => {
      await Promise.all([fetchCensus(), fetchMeta(), fetchExposure(), fetchCrons(), fetchReports()]);
      setLastRefresh(timeNow());
    };
    tick();
    const id = setInterval(tick, 10_000);
    return () => clearInterval(id);
  }, [fetchCensus, fetchMeta, fetchExposure, fetchCrons, fetchReports]);

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
  const reportHealth: HealthStatus = generating ? "ok" : genState.phase === "done" ? "ok" : "idle";

  const metaPct = meta && meta.total > 0 ? (meta.withTitle / meta.total) * 100 : 0;
  const metaGap = (census?.totalIslands || 0) - (meta?.total || 0);
  const metaEta = metaThroughput && metaThroughput > 0 && meta ? Math.ceil((meta.total - meta.withTitle) / metaThroughput) : null;

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
            <div className="flex items-center gap-1.5"><HealthDot status={reportHealth} label={generating ? "Em andamento" : "Idle"} /><span className="text-muted-foreground">Report</span></div>
            <div className="flex items-center gap-1.5"><HealthDot status="ok" label="7/7 ativos" /><span className="text-muted-foreground">Crons</span></div>
          </div>
        </CardContent>
      </Card>

      {/* ── Section 2: Database Census ─────────────────────── */}
      <div>
        <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
          <Database className="h-4 w-4" /> Database Census
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard icon={Layers} label="Total Ilhas" value={fmt(census?.totalIslands)} />
          <StatCard icon={CheckCircle2} label="Reported" value={fmt(census?.reported)} sub={census ? pct(census.reported, census.totalIslands) : undefined} color="success" />
          <StatCard icon={EyeOff} label="Suprimidas" value={fmt(census?.suppressed)} sub={census ? pct(census.suppressed, census.totalIslands) : undefined} />
          <StatCard icon={AlertCircle} label="Outro Status" value={fmt(census?.otherStatus)} />
          <StatCard icon={FileText} label="Com Titulo (Cache)" value={fmt(census?.withTitle)} sub={census ? pct(census.withTitle, census.totalIslands) : undefined} color={census && census.withTitle < census.totalIslands * 0.01 ? "destructive" : "default"} />
          <StatCard icon={Users} label="Criadores Unicos" value={fmt(census?.uniqueCreators)} />
          <StatCard icon={BarChart3} label="Reports Engine" value={fmt(census?.engineReports)} />
          <StatCard icon={FileText} label="Weekly Reports" value={census ? `${census.weeklyReports} (${census.weeklyPublished} pub.)` : "-"} />
        </div>
      </div>

      {/* ── Section 3: Metadata Pipeline ───────────────────── */}
      <div>
        <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
          <Hash className="h-4 w-4" /> Metadata Pipeline
        </h2>
        <Card>
          <CardContent className="pt-4 pb-4 space-y-4">
            {/* Progress bar */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-medium">Preenchimento: {fmt(meta?.withTitle)} / {fmt(meta?.total)}</span>
                <span className="text-sm font-mono font-bold">{metaPct.toFixed(1)}%</span>
              </div>
              <Progress value={metaPct} className="h-3" />
              <div className="flex justify-between mt-1 text-[10px] text-muted-foreground">
                <span>{metaThroughput !== null ? `${fmt(metaThroughput)} ilhas/min` : "Calculando throughput..."}</span>
                <span>{metaEta !== null ? (metaEta <= 0 ? "Concluido" : `ETA: ~${metaEta} min`) : "ETA: --"}</span>
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
              <div className="pt-1 border-t">
                <span className="text-muted-foreground">GAP:</span>{" "}
                <span className="font-bold text-destructive">{fmt(metaGap)}</span>{" "}
                <span className="text-muted-foreground">ilhas do cache sem metadata enfileirado</span>
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
