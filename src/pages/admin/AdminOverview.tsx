import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { dataAdminOverviewBundle, dataDelete, dataRpc, dataSelect, dataUpdate } from "@/lib/discoverDataApi";
import {
  Loader2, Sparkles, CheckCircle2, RefreshCcw, Gauge, Users, AlertTriangle,
  ShieldAlert, EyeOff, Activity, Database, Eye, FileText, Clock, ChevronDown,
  ChevronRight, Radio, Circle, ArrowRight, Zap, Hash, Layers, AlertCircle,
  Timer, Lock, CalendarClock, BarChart3, Target, Search, XCircle, Trash2, PauseCircle, PlayCircle
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

function fmtDurationMs(ms: number | null | undefined): string {
  if (ms == null || Number.isNaN(ms)) return "-";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem === 0 ? `${min}m` : `${min}m ${rem}s`;
}

function fmtAge(iso: string | null | undefined): string {
  if (!iso) return "-";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "-";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}min`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
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
  referenceCollections: number;
}

interface LookupPipelineData {
  calls24h: number;
  ok24h: number;
  fail24h: number;
  calls1h: number;
  ok1h: number;
  fail1h: number;
  p95ms24h: number | null;
  avgMs24h: number | null;
  lastOkAt: string | null;
  lastErrorAt: string | null;
  failRate24hPct: number;
  coverageInternalCardPct: number;
  coverageDiscoverySignalsPct: number;
  coverageWeeklyPerfPct: number;
  errorBreakdown: Array<{ error_type: string; count: number }>;
}

interface RalphHealthData {
  hoursWindow: number;
  runsTotal: number;
  runsRunning: number;
  runsSuccess: number;
  runsFailed: number;
  runsCancelled: number;
  successRatePct: number;
  avgDurationMs: number | null;
  p95DurationMs: number | null;
  openIncidents: number;
  criticalOpenIncidents: number;
  lastRunAt: string | null;
}

interface RalphRunRow {
  id: string;
  mode: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  updated_at: string;
  error_message: string | null;
  target_scope: string[] | null;
  summary?: any;
}

interface RalphActionRow {
  id: number;
  run_id: string;
  step_index: number;
  phase: string;
  tool_name: string | null;
  target: string | null;
  status: string;
  latency_ms: number;
  created_at: string;
  details?: any;
}

interface RalphEvalRow {
  id: number;
  run_id: string;
  suite: string;
  metric: string;
  value: number | null;
  threshold: number | null;
  pass: boolean;
  created_at: string;
}

interface RalphIncidentRow {
  id: number;
  run_id: string | null;
  severity: "info" | "warn" | "error" | "critical";
  incident_type: string;
  message: string;
  resolved: boolean;
  created_at: string;
  resolved_at: string | null;
}

interface RalphMemoryData {
  snapshots24h: number;
  itemsTotal: number;
  docsTotal: number;
  decisionsOpen: number;
  topItemLabel: string | null;
  topItemImportance: number | null;
}

interface RalphOpsData {
  proposeRuns: number;
  applyRuns: number;
  promotableRuns: number;
  guardActivations: number;
  blockedTransitions: number;
  buildGateFails: number;
  opsApplyFails: number;
  latestFailureSignature: string | null;
  latestActiveFeature: string | null;
}

interface CronJob {
  jobid: number; name: string; schedule: string; active: boolean;
}

interface SystemAlert {
  alert_key: string;
  severity: "ok" | "warn" | "error";
  message: string;
  details: any;
  updated_at: string;
}

interface MonitoringHeartbeat {
  exposureTickAt: string | null;
  metadataEventAt: string | null;
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
  const ageFromIso = (iso: string | null | undefined): number | null => {
    if (!iso) return null;
    const ts = new Date(iso).getTime();
    if (!Number.isFinite(ts)) return null;
    const age = Math.floor((Date.now() - ts) / 1000);
    return age >= 0 ? age : null;
  };

  switch (alert.alert_key) {
    case "exposure_stale": {
      const stale = Number(d.stale_targets || 0);
      if (alert.severity === "ok") return {
        title: "Exposure Pipeline",
        description: "Todos os targets estão coletando dentro do SLA.",
      };
      return {
        title: "Exposure Pipeline com Atraso",
        description: `${stale} target${stale > 1 ? "s" : ""} não coletou dados no tempo esperado.`,
        detail: `O cron 'orchestrate-minute' pode ter falhado ou a API da Epic está lenta. Targets em atraso não geram dados de exposição.`,
        action: stale > 2 ? "⚠️ Verifique os logs do cron e o status da API da Epic." : "Monitorar.",
      };
    }
    case "exposure_data_flow": {
      const ticks1h = Number(d.ticks_1h || 0);
      const lastAge = d.last_tick_age_seconds != null ? Number(d.last_tick_age_seconds) : ageFromIso(d.last_tick);
      const ageStr = lastAge != null
        ? (lastAge < 60 ? `${lastAge}s` : lastAge < 3600 ? `${Math.round(lastAge / 60)}min` : `${Math.round(lastAge / 3600)}h`)
        : (ticks1h > 0 ? "recente" : "nunca");
      if (alert.severity === "ok") return {
        title: "Exposure Data Flow",
        description: `${ticks1h} ticks OK na última hora. Último: ${ageStr} atrás.`,
      };
      return {
        title: "🚨 Exposure Collector PARADO",
        description: `${ticks1h} ticks na última hora. Último tick OK: ${ageStr} atrás.`,
        detail: "O cron 'orchestrate-minute' pode estar falhando com erros de autenticação (401/403) ou a Edge Function não está sendo executada. Isso significa que NENHUM dado de exposição está sendo coletado.",
        action: "⚠️ Verifique imediatamente os logs da Edge Function 'discover-exposure-collector'.",
      };
    }
    case "metadata_data_flow": {
      const fetched1h = Number(d.fetched_1h || 0);
      const lastAge = d.last_fetch_age_seconds != null ? Number(d.last_fetch_age_seconds) : ageFromIso(d.last_fetch);
      const ageStr = lastAge != null
        ? (lastAge < 60 ? `${lastAge}s` : lastAge < 3600 ? `${Math.round(lastAge / 60)}min` : `${Math.round(lastAge / 3600)}h`)
        : (fetched1h > 0 ? "recente" : "nunca");
      if (alert.severity === "ok") return {
        title: "Metadata Data Flow",
        description: `${fetched1h} fetches na última hora. Último: ${ageStr} atrás.`,
      };
      return {
        title: "🚨 Metadata Collector PARADO",
        description: `${fetched1h} fetches na última hora. Último fetch: ${ageStr} atrás.`,
        detail: "O cron 'discover-links-metadata-orchestrate-min' pode estar falhando. Nenhum metadado está sendo coletado — títulos, imagens e dados de collections não estão sendo atualizados.",
        action: "⚠️ Verifique os logs da Edge Function 'discover-links-metadata-collector'.",
      };
    }
    case "collector_pipeline": {
      const phase = d.phase || "idle";
      const ageSec = d.age_seconds != null ? Number(d.age_seconds) : null;
      const ageStr = ageSec != null ? (ageSec < 60 ? `${ageSec}s` : ageSec < 3600 ? `${Math.round(ageSec / 60)}min` : `${Math.round(ageSec / 3600)}h`) : "desconhecido";
      if (alert.severity === "ok") return {
        title: "Collector Pipeline",
        description: phase === "done" ? `Último report concluído (${ageStr} atrás).` : `Pipeline idle.`,
      };
      return {
        title: "🚨 Collector Pipeline TRAVADO",
        description: `Fase '${phase}' sem progresso há ${ageStr}.`,
        detail: "O report semanal está travado. O cron 'discover-collector-orchestrate-min' pode estar falhando com erros de autenticação. Verifique os logs da Edge Function.",
        action: "⚠️ Verifique logs do 'discover-collector'. Considere reiniciar o report.",
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
          ? `Volume muito alto. Verifique se o cron metadata está rodando e se não há erros 429.`
          : `Collector processando mas não na velocidade necessária. Backlog deve reduzir gradualmente.`,
        action: due > 100000 ? "⚠️ Verifique logs do metadata collector." : undefined,
      };
    }
    case "intel_freshness": {
      const ageSec = d.age_seconds != null ? Number(d.age_seconds) : null;
      const ageStr = ageSec != null
        ? (ageSec < 60 ? `${ageSec}s` : ageSec < 3600 ? `${Math.round(ageSec / 60)} min` : `${Math.floor(ageSec / 3600)}h ${Math.round((ageSec % 3600) / 60)}m`)
        : "desconhecido";
      if (alert.severity === "ok") return {
        title: "Intel Público",
        description: `Dados atualizados há ${ageStr}.`,
      };
      return {
        title: "Intel Público Desatualizado",
        description: `Última atualização há ${ageStr}.`,
        detail: ageSec != null && ageSec > 1800
          ? `Dados públicos defasados >30min. O cron 'intel-refresh-5min' pode ter falhado.`
          : `Leve atraso. Geralmente resolve no próximo ciclo.`,
        action: ageSec != null && ageSec > 3600 ? "⚠️ Verifique cron 'intel-refresh-5min'." : undefined,
      };
    }
    case "link_edges_coverage": {
      const parents = Number(d.parents_resolved || 0);
      const collections = Number(d.collections_total ?? d.collections_resolvable ?? 0);
      const edges = Number(d.edges_total || 0);
      if (collections === 0) return {
        title: "Link Edges Coverage",
        description: "Sem collections resolvíveis no recorte atual.",
        detail: "A cobertura será calculada assim que houver collections set_* ativas na janela.",
      };
      if (alert.severity === "ok") return {
        title: "Link Edges Coverage",
        description: `${parents} collections com edges de ${collections} total (${edges} edges).`,
      };
      return {
        title: "Cobertura de Link Edges Baixa",
        description: `Apenas ${parents} de ${collections} collections têm edges resolvidos.`,
        detail: `Metadata collector precisa processar collections. Execute backfill_recent_collections.`,
        action: "⚠️ Execute backfill_recent_collections.",
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
        description: `${fmt(stale)} edges não atualizados há >60 dias.`,
        detail: `Cleanup diário removerá edges antigos.`,
        action: stale > total * 0.5 ? "⚠️ Verifique metadata collector." : undefined,
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
  const [lookup, setLookup] = useState<LookupPipelineData | null>(null);
  const [ralphHealth, setRalphHealth] = useState<RalphHealthData | null>(null);
  const [ralphRuns, setRalphRuns] = useState<RalphRunRow[]>([]);
  const [ralphActions, setRalphActions] = useState<RalphActionRow[]>([]);
  const [ralphEvals, setRalphEvals] = useState<RalphEvalRow[]>([]);
  const [ralphIncidents, setRalphIncidents] = useState<RalphIncidentRow[]>([]);
  const [ralphMemory, setRalphMemory] = useState<RalphMemoryData | null>(null);

  // Crons
  const [crons, setCrons] = useState<CronJob[]>([]);
  const [cronBulkAction, setCronBulkAction] = useState<"pause" | "resume" | null>(null);
  const [cronRowBusy, setCronRowBusy] = useState<Record<string, boolean>>({});

  // System alerts (materialized in DB by orchestrator)
  const [alerts, setAlerts] = useState<SystemAlert[]>([]);
  const [monitorHeartbeat, setMonitorHeartbeat] = useState<MonitoringHeartbeat>({
    exposureTickAt: null,
    metadataEventAt: null,
  });

  // Weekly pipeline (preserved)
  const [reports, setReports] = useState<any[]>([]);
  const [generating, setGenerating] = useState(false);
  const [activeReportId, setActiveReportId] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [genState, setGenState] = useState<GenerationState>(INITIAL_GEN);
  const [pipelineOpen, setPipelineOpen] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const lastPhaseRef = useRef("idle");
  const fastPollInFlightRef = useRef(false);
  const slowPollInFlightRef = useRef(false);
  const overviewBundleInFlightRef = useRef(false);
  const { toast } = useToast();

  // History tracking for sparklines
  const censusHistory = useRef<Record<string, number[]>>({});
  const metaHistory = useRef<Record<string, number[]>>({});
  const lookupHistory = useRef<Record<string, number[]>>({});

  // Enqueue gap
  const [enqueueLoading, setEnqueueLoading] = useState(false);
  const [metaFlash, setMetaFlash] = useState(false);

  // Backfill collections
  const [backfillLoading, setBackfillLoading] = useState(false);

  const addLog = useCallback((msg: string) => {
    setLogs(p => [...p.slice(-80), { time: timeNow(), message: msg }]);
  }, []);

  const applyOverviewBundle = useCallback((bundle: any) => {
    if (!bundle || typeof bundle !== "object") return;

    const censusRow = (bundle?.census && typeof bundle.census === "object") ? bundle.census : {};
    const censusTotal = Number((censusRow as any).totalIslands || 0);
    const censusReported = Number((censusRow as any).reported || 0);
    const censusSuppressed = Number((censusRow as any).suppressed || 0);
    setCensus({
      totalIslands: censusTotal,
      reported: censusReported,
      suppressed: censusSuppressed,
      otherStatus: Number((censusRow as any).otherStatus || Math.max(0, censusTotal - censusReported - censusSuppressed)),
      withTitle: Number((censusRow as any).withTitle || 0),
      uniqueCreators: Number((censusRow as any).uniqueCreators || 0),
      engineReports: Number((censusRow as any).engineReports || 0),
      weeklyReports: Number((censusRow as any).weeklyReports || 0),
      weeklyPublished: Number((censusRow as any).weeklyPublished || 0),
    });
    const ch = censusHistory.current;
    const pushCH = (key: string, val: number) => { ch[key] = [...(ch[key] || []).slice(-30), val]; };
    pushCH("total", censusTotal);
    pushCH("reported", censusReported);
    pushCH("suppressed", censusSuppressed);

    const metaRow = (bundle?.meta && typeof bundle.meta === "object") ? bundle.meta : {};
    const now = Date.now();
    const withTitle = Number((metaRow as any).withTitle || 0);
    metaSamples.current.push({ ts: now, val: withTitle });
    metaSamples.current = metaSamples.current.filter((s) => now - s.ts < 120_000);
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
      total: Number((metaRow as any).total || 0),
      withTitle,
      withError: Number((metaRow as any).withError || 0),
      pendingNoData: Number((metaRow as any).pendingNoData || 0),
      locked: Number((metaRow as any).locked || 0),
      dueNow: Number((metaRow as any).dueNow || 0),
      islands: Number((metaRow as any).islands || 0),
      collections: Number((metaRow as any).collections || 0),
    });
    const mh = metaHistory.current;
    const pushMH = (key: string, val: number) => { mh[key] = [...(mh[key] || []).slice(-30), val]; };
    pushMH("total", Number((metaRow as any).total || 0));
    pushMH("withTitle", withTitle);

    const exposureRow = (bundle?.exposure && typeof bundle.exposure === "object") ? bundle.exposure : {};
    setExposure({
      targetsTotal: Number((exposureRow as any).targetsTotal || 0),
      targetsOk: Number((exposureRow as any).targetsOk || 0),
      ticks24h: Number((exposureRow as any).ticks24h || 0),
      ticksOk: Number((exposureRow as any).ticksOk || 0),
      ticksFailed: Number((exposureRow as any).ticksFailed || 0),
    });

    const linkRow = (bundle?.linkGraph && typeof bundle.linkGraph === "object") ? bundle.linkGraph : {};
    setLinkGraph({
      edgesTotal: Number((linkRow as any).edgesTotal || 0),
      parentsTotal: Number((linkRow as any).parentsTotal || 0),
      childrenTotal: Number((linkRow as any).childrenTotal || 0),
      collectionsSeen24h: Number((linkRow as any).collectionsSeen24h || 0),
      collectionsResolved24h: Number((linkRow as any).collectionsResolved24h || 0),
      resolution24hPct: (linkRow as any).resolution24hPct != null ? Number((linkRow as any).resolution24hPct) : null,
      edgeAgeSeconds: (linkRow as any).edgeAgeSeconds != null ? Number((linkRow as any).edgeAgeSeconds) : null,
      staleEdges60d: Number((linkRow as any).staleEdges60d || 0),
      collectionsDueNow: Number((linkRow as any).collectionsDueNow || 0),
      referenceCollections: Number((linkRow as any).referenceCollections || 0),
    });

    const lookupRow = (bundle?.lookup && typeof bundle.lookup === "object") ? bundle.lookup : {};
    const lookupErrors = Array.isArray((lookupRow as any).errorBreakdown) ? (lookupRow as any).errorBreakdown : [];
    setLookup({
      calls24h: Number((lookupRow as any).calls24h || 0),
      ok24h: Number((lookupRow as any).ok24h || 0),
      fail24h: Number((lookupRow as any).fail24h || 0),
      calls1h: Number((lookupRow as any).calls1h || 0),
      ok1h: Number((lookupRow as any).ok1h || 0),
      fail1h: Number((lookupRow as any).fail1h || 0),
      p95ms24h: (lookupRow as any).p95ms24h != null ? Number((lookupRow as any).p95ms24h) : null,
      avgMs24h: (lookupRow as any).avgMs24h != null ? Number((lookupRow as any).avgMs24h) : null,
      lastOkAt: (lookupRow as any).lastOkAt || null,
      lastErrorAt: (lookupRow as any).lastErrorAt || null,
      failRate24hPct: Number((lookupRow as any).failRate24hPct || 0),
      coverageInternalCardPct: Number((lookupRow as any).coverageInternalCardPct || 0),
      coverageDiscoverySignalsPct: Number((lookupRow as any).coverageDiscoverySignalsPct || 0),
      coverageWeeklyPerfPct: Number((lookupRow as any).coverageWeeklyPerfPct || 0),
      errorBreakdown: lookupErrors.map((e: any) => ({
        error_type: String(e?.error_type || "unknown"),
        count: Number(e?.count || 0),
      })),
    });
    const lh = lookupHistory.current;
    const pushLH = (key: string, val: number) => { lh[key] = [...(lh[key] || []).slice(-30), val]; };
    pushLH("calls24h", Number((lookupRow as any).calls24h || 0));
    pushLH("p95", Number((lookupRow as any).p95ms24h || 0));
    pushLH("failRate", Number((lookupRow as any).failRate24hPct || 0));

    setAlerts(Array.isArray(bundle?.alerts) ? (bundle.alerts as SystemAlert[]) : []);
    setMonitorHeartbeat({
      exposureTickAt: bundle?.monitorHeartbeat?.exposureTickAt || null,
      metadataEventAt: bundle?.monitorHeartbeat?.metadataEventAt || null,
    });
  }, []);

  const fetchOverviewBundle = useCallback(async (forceRefresh = false) => {
    if (overviewBundleInFlightRef.current && !forceRefresh) return;
    overviewBundleInFlightRef.current = true;
    try {
      const bundle = await dataAdminOverviewBundle(forceRefresh);
      applyOverviewBundle(bundle?.data || {});
    } finally {
      overviewBundleInFlightRef.current = false;
    }
  }, [applyOverviewBundle]);

  const invokeProtectedFunction = useCallback(async (functionName: string, body: Record<string, unknown> = {}) => {
    const { data: authData, error: authError } = await supabase.auth.getSession();
    if (authError || !authData?.session?.access_token) {
      return {
        data: null,
        error: new Error(authError?.message || "auth_session_not_ready"),
      };
    }
    return supabase.functions.invoke(functionName, {
      body,
      headers: {
        Authorization: `Bearer ${authData.session.access_token}`,
      },
    });
  }, []);

  // ─── Fetch functions ─────────────────────────────────────

  const fetchCensus = useCallback(async () => {
    const [censusRpc, reportsRes, weeklyRes] = await Promise.all([
      dataRpc<any>({ fn: "get_census_stats" }),
      dataSelect<any[]>({
        table: "discover_reports",
        columns: "id",
        head: true,
        count: "exact",
      }),
      dataSelect<any[]>({
        table: "weekly_reports",
        columns: "id, published_at",
      }),
    ]);

    const cs = censusRpc as any || {};
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
      weeklyReports: Array.isArray(weeklyRes?.data) ? weeklyRes.data.length : 0,
      weeklyPublished: Array.isArray(weeklyRes?.data) ? weeklyRes.data.filter((r: any) => r.published_at).length : 0,
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
    addLog("Enfileirar GAP: disparando...");
    try {
      const res = await invokeProtectedFunction("discover-enqueue-gap", {});
      if (res.error) throw new Error(res.error.message);
      const d = res.data || {};
      if (d.error) throw new Error(d.error);
      if (!d.success) throw new Error("Resposta inesperada da função");
      const inserted = Number(d.inserted || 0);
      const updated = Number(d.updated || 0);
      const submitted = Number(d.submitted || 0);
      toast({ title: "Enfileiramento concluído", description: `${fmt(inserted)} novas + ${fmt(updated)} atualizadas de ${fmt(submitted)} submetidas (${((d.elapsed_ms || 0) / 1000).toFixed(1)}s).` });
      addLog(`Enfileirar: ${fmt(inserted)} novas (${fmt(updated)} bump) de ${fmt(submitted)}`);
      await fetchOverviewBundle(true);
      setMetaFlash(true);
      setTimeout(() => setMetaFlash(false), 2000);
    } catch (e: any) {
      toast({ title: "Erro ao enfileirar", description: e.message, variant: "destructive" });
      addLog(`Enfileirar ERRO: ${e.message}`);
    } finally {
      setEnqueueLoading(false);
    }
  }, [toast, addLog, fetchOverviewBundle, invokeProtectedFunction]);

  const fetchExposure = useCallback(async () => {
    const twentyFourAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const [targetsR, targetsOkR, ticksR, ticksOkR, ticksFailR] = await Promise.all([
      dataSelect<any[]>({
        table: "discovery_exposure_targets",
        columns: "id",
        head: true,
        count: "exact",
      }),
      dataSelect<any[]>({
        table: "discovery_exposure_targets",
        columns: "id",
        head: true,
        count: "exact",
        filters: [{ op: "not", column: "last_ok_tick_at", operator: "is", value: null }],
      }),
      dataSelect<any[]>({
        table: "discovery_exposure_ticks",
        columns: "id",
        head: true,
        count: "exact",
        filters: [{ op: "gte", column: "ts_start", value: twentyFourAgo }],
      }),
      dataSelect<any[]>({
        table: "discovery_exposure_ticks",
        columns: "id",
        head: true,
        count: "exact",
        filters: [
          { op: "gte", column: "ts_start", value: twentyFourAgo },
          { op: "eq", column: "status", value: "ok" },
        ],
      }),
      dataSelect<any[]>({
        table: "discovery_exposure_ticks",
        columns: "id",
        head: true,
        count: "exact",
        filters: [
          { op: "gte", column: "ts_start", value: twentyFourAgo },
          { op: "eq", column: "status", value: "error" },
        ],
      }),
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
      referenceCollections: Number(s.reference_collections || 0),
    });
  }, []);

  const fetchLookup = useCallback(async () => {
    const [statsRes, errorsRes] = await Promise.all([
      (supabase as any).rpc("get_lookup_pipeline_stats"),
      (supabase as any).rpc("get_lookup_pipeline_error_breakdown", { p_hours: 24, p_limit: 8 }),
    ]);
    const s = statsRes?.data as any;
    if (!s) return;

    const errors = Array.isArray(errorsRes?.data) ? (errorsRes.data as any[]) : [];
    setLookup({
      calls24h: Number(s.calls_24h || 0),
      ok24h: Number(s.ok_24h || 0),
      fail24h: Number(s.fail_24h || 0),
      calls1h: Number(s.calls_1h || 0),
      ok1h: Number(s.ok_1h || 0),
      fail1h: Number(s.fail_1h || 0),
      p95ms24h: s.p95_ms_24h != null ? Number(s.p95_ms_24h) : null,
      avgMs24h: s.avg_ms_24h != null ? Number(s.avg_ms_24h) : null,
      lastOkAt: s.last_ok_at || null,
      lastErrorAt: s.last_error_at || null,
      failRate24hPct: Number(s.fail_rate_24h_pct || 0),
      coverageInternalCardPct: Number(s.coverage_internal_card_pct || 0),
      coverageDiscoverySignalsPct: Number(s.coverage_discovery_signals_pct || 0),
      coverageWeeklyPerfPct: Number(s.coverage_weekly_perf_pct || 0),
      errorBreakdown: errors.map((e: any) => ({
        error_type: String(e.error_type || "unknown"),
        count: Number(e.count || 0),
      })),
    });

    const lh = lookupHistory.current;
    const pushLH = (key: string, val: number) => { lh[key] = [...(lh[key] || []).slice(-30), val]; };
    pushLH("calls24h", Number(s.calls_24h || 0));
    pushLH("p95", Number(s.p95_ms_24h || 0));
    pushLH("failRate", Number(s.fail_rate_24h_pct || 0));
  }, []);

  const fetchRalph = useCallback(async () => {
    try {
      const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const [
        healthRes,
        runsRes,
        actionsRes,
        evalsRes,
        incidentsRes,
        snapshots24hRes,
        memoryItemsRes,
        memoryDocsRes,
        openDecisionsRes,
        topMemoryItemRes,
      ] = await Promise.all([
        (supabase as any).rpc("get_ralph_health", { p_hours: 24 }),
        supabase
          .from("ralph_runs" as any)
          .select("id,mode,status,started_at,ended_at,updated_at,error_message,target_scope,summary")
          .order("started_at", { ascending: false })
          .limit(24),
        supabase
          .from("ralph_actions" as any)
          .select("id,run_id,step_index,phase,tool_name,target,status,latency_ms,created_at,details")
          .order("created_at", { ascending: false })
          .limit(30),
        supabase
          .from("ralph_eval_results" as any)
          .select("id,run_id,suite,metric,value,threshold,pass,created_at")
          .order("created_at", { ascending: false })
          .limit(10),
        supabase
          .from("ralph_incidents" as any)
          .select("id,run_id,severity,incident_type,message,resolved,created_at,resolved_at")
          .order("created_at", { ascending: false })
          .limit(10),
        supabase
          .from("ralph_memory_snapshots" as any)
          .select("id", { count: "exact", head: true })
          .gte("created_at", since24h),
        supabase
          .from("ralph_memory_items" as any)
          .select("id", { count: "exact", head: true }),
        supabase
          .from("ralph_memory_documents" as any)
          .select("id", { count: "exact", head: true })
          .eq("is_active", true),
        supabase
          .from("ralph_memory_decisions" as any)
          .select("id", { count: "exact", head: true })
          .neq("status", "accepted")
          .neq("status", "rejected"),
        supabase
          .from("ralph_memory_items" as any)
          .select("summary,importance")
          .order("importance", { ascending: false })
          .order("last_seen_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      const h = healthRes?.data as any;
      if (h && typeof h === "object") {
        setRalphHealth({
          hoursWindow: Number(h.hours_window || 24),
          runsTotal: Number(h.runs_total || 0),
          runsRunning: Number(h.runs_running || 0),
          runsSuccess: Number(h.runs_success || 0),
          runsFailed: Number(h.runs_failed || 0),
          runsCancelled: Number(h.runs_cancelled || 0),
          successRatePct: Number(h.success_rate_pct || 0),
          avgDurationMs: h.avg_duration_ms != null ? Number(h.avg_duration_ms) : null,
          p95DurationMs: h.p95_duration_ms != null ? Number(h.p95_duration_ms) : null,
          openIncidents: Number(h.open_incidents || 0),
          criticalOpenIncidents: Number(h.critical_open_incidents || 0),
          lastRunAt: h.last_run_at || null,
        });
      } else {
        setRalphHealth(null);
      }

      setRalphRuns(((runsRes?.data || []) as any[]).map((r) => ({
        id: String(r.id),
        mode: String(r.mode || "custom"),
        status: String(r.status || "unknown"),
        started_at: String(r.started_at || ""),
        ended_at: r.ended_at || null,
        updated_at: String(r.updated_at || ""),
        error_message: r.error_message || null,
        target_scope: Array.isArray(r.target_scope) ? r.target_scope.map(String) : null,
        summary: r.summary || null,
      })));

      setRalphActions(((actionsRes?.data || []) as any[]).map((a) => ({
        id: Number(a.id || 0),
        run_id: String(a.run_id || ""),
        step_index: Number(a.step_index || 0),
        phase: String(a.phase || "execute"),
        tool_name: a.tool_name || null,
        target: a.target || null,
        status: String(a.status || "ok"),
        latency_ms: Number(a.latency_ms || 0),
        created_at: String(a.created_at || ""),
        details: a.details || null,
      })));

      setRalphEvals(((evalsRes?.data || []) as any[]).map((e) => ({
        id: Number(e.id || 0),
        run_id: String(e.run_id || ""),
        suite: String(e.suite || "default"),
        metric: String(e.metric || "unknown"),
        value: e.value != null ? Number(e.value) : null,
        threshold: e.threshold != null ? Number(e.threshold) : null,
        pass: Boolean(e.pass),
        created_at: String(e.created_at || ""),
      })));

      setRalphIncidents(((incidentsRes?.data || []) as any[]).map((i) => ({
        id: Number(i.id || 0),
        run_id: i.run_id || null,
        severity: (i.severity || "warn") as RalphIncidentRow["severity"],
        incident_type: String(i.incident_type || "generic"),
        message: String(i.message || ""),
        resolved: Boolean(i.resolved),
        created_at: String(i.created_at || ""),
        resolved_at: i.resolved_at || null,
      })));

      setRalphMemory({
        snapshots24h: Number((snapshots24hRes as any)?.count || 0),
        itemsTotal: Number((memoryItemsRes as any)?.count || 0),
        docsTotal: Number((memoryDocsRes as any)?.count || 0),
        decisionsOpen: Number((openDecisionsRes as any)?.count || 0),
        topItemLabel: (topMemoryItemRes as any)?.data?.summary || null,
        topItemImportance: (topMemoryItemRes as any)?.data?.importance != null
          ? Number((topMemoryItemRes as any).data.importance)
          : null,
      });
    } catch {
      // Keep UI resilient if Ralph tables/RPCs are unavailable
      setRalphHealth(null);
      setRalphRuns([]);
      setRalphActions([]);
      setRalphEvals([]);
      setRalphIncidents([]);
      setRalphMemory(null);
    }
  }, []);

  const handleBackfillCollections = useCallback(async () => {
    setBackfillLoading(true);
    try {
      const res = await invokeProtectedFunction("discover-links-metadata-collector", {
        mode: "backfill_recent_collections",
        lookbackHours: 72,
        maxCodes: 5000,
        dueWithinMinutes: 0,
      });
      if (res.error) throw new Error(res.error.message);
      const d = res.data || {};
      const eq = d.enqueued || {};
      const total = (typeof eq === "number") ? eq : ((eq.inserted || 0) + (eq.updated || 0));
      toast({
        title: "Backfill disparado",
        description: `${fmt(total)} collections enfileiradas (${eq.inserted || 0} novas, ${eq.updated || 0} atualizadas).`,
      });
      addLog(`Backfill collections: ${JSON.stringify(d)}`);
      await fetchOverviewBundle(true);
    } catch (e: any) {
      toast({ title: "Erro no backfill", description: e.message, variant: "destructive" });
      addLog(`Backfill erro: ${e.message}`);
    } finally {
      setBackfillLoading(false);
    }
  }, [toast, addLog, fetchOverviewBundle, invokeProtectedFunction]);

  const fetchCrons = useCallback(async () => {
    const { data, error } = await invokeProtectedFunction("discover-cron-admin", { mode: "list" });
    if (error || !data?.success) return;
    const rows = ((data?.rows || []) as any[]).map((r: any) => ({
      jobid: Number(r.jobid || 0),
      name: String(r.jobname || r.name || ""),
      schedule: String(r.schedule || "-"),
      active: Boolean(r.active),
    })) as CronJob[];
    setCrons(rows);
  }, [invokeProtectedFunction]);

  const handleSetCronActive = useCallback(async (jobname: string, active: boolean) => {
    setCronRowBusy((p) => ({ ...p, [jobname]: true }));
    try {
      const { data, error } = await invokeProtectedFunction("discover-cron-admin", {
        mode: "set",
        jobname,
        active,
      });
      if (error || !data?.success) throw new Error(data?.error || error?.message || "erro");
      toast({
        title: active ? "Cron ativado" : "Cron pausado",
        description: jobname,
      });
      addLog(`Cron ${jobname} -> ${active ? "active" : "paused"}`);
      await fetchCrons();
    } catch (e: any) {
      toast({
        title: "Falha ao atualizar cron",
        description: e.message || "erro",
        variant: "destructive",
      });
    } finally {
      setCronRowBusy((p) => {
        const n = { ...p };
        delete n[jobname];
        return n;
      });
    }
  }, [toast, addLog, fetchCrons, invokeProtectedFunction]);

  const handlePauseAllCrons = useCallback(async () => {
    setCronBulkAction("pause");
    try {
      const { error, data } = await invokeProtectedFunction("discover-cron-admin", { mode: "pause" });
      if (error || !data?.success) throw new Error(data?.error || error?.message || "erro");
      const updated = Number((data?.result && (data.result.updated ?? data.result?.[0]?.updated)) || 0);
      toast({ title: "Crons pausados", description: `${updated} job(s) atualizados.` });
      addLog(`Pause all crons: ${updated} atualizados`);
      await fetchCrons();
    } catch (e: any) {
      toast({ title: "Falha ao pausar crons", description: e.message || "erro", variant: "destructive" });
    } finally {
      setCronBulkAction(null);
    }
  }, [toast, addLog, fetchCrons, invokeProtectedFunction]);

  const handleResumeAllCrons = useCallback(async () => {
    setCronBulkAction("resume");
    try {
      const { error, data } = await invokeProtectedFunction("discover-cron-admin", { mode: "resume" });
      if (error || !data?.success) throw new Error(data?.error || error?.message || "erro");
      const updated = Number((data?.result && (data.result.updated ?? data.result?.[0]?.updated)) || 0);
      toast({ title: "Crons reativados", description: `${updated} job(s) atualizados.` });
      addLog(`Resume all crons: ${updated} atualizados`);
      await fetchCrons();
    } catch (e: any) {
      toast({ title: "Falha ao reativar crons", description: e.message || "erro", variant: "destructive" });
    } finally {
      setCronBulkAction(null);
    }
  }, [toast, addLog, fetchCrons, invokeProtectedFunction]);

  const fetchAlerts = useCallback(async () => {
    const [alertsRes, exposureBeatRes, metadataBeatRes] = await Promise.all([
      dataSelect<any[]>({
        table: "system_alerts_current",
        columns: "alert_key,severity,message,details,updated_at",
        order: [{ column: "alert_key", ascending: true }],
      }),
      dataSelect<any>({
        table: "discovery_exposure_ticks",
        columns: "ts_start",
        order: [{ column: "ts_start", ascending: false }],
        limit: 1,
        single: "maybeSingle",
      }),
      dataSelect<any>({
        table: "discover_link_metadata_events",
        columns: "created_at",
        order: [{ column: "created_at", ascending: false }],
        limit: 1,
        single: "maybeSingle",
      }),
    ]);

    setAlerts((alertsRes.data || []) as any);

    setMonitorHeartbeat({
      exposureTickAt: (exposureBeatRes.data as any)?.ts_start || null,
      metadataEventAt: (metadataBeatRes.data as any)?.created_at || null,
    });
  }, []);

  const fetchReports = useCallback(async () => {
    const { data } = await dataSelect<any[]>({
      table: "discover_reports",
      columns: "*",
      order: [{ column: "created_at", ascending: false }],
      limit: 5,
    });
    if (data) setReports(data);
  }, []);

  // ─── Polling ──────────────────────────────────────────────

  // Fast polling for metadata (15s), slower for heavy blocks (60s), only while tab is visible.
  useEffect(() => {
    let cancelled = false;
    const hasDocument = typeof document !== "undefined";
    const isVisible = () => !hasDocument || document.visibilityState === "visible";

    const tickFast = async (force = false) => {
      if (cancelled || (!force && !isVisible())) return;
      if (fastPollInFlightRef.current) return;
      fastPollInFlightRef.current = true;
      try {
        await fetchOverviewBundle(false);
        if (!cancelled) setLastRefresh(timeNow());
      } finally {
        fastPollInFlightRef.current = false;
      }
    };

    const tickSlow = async (force = false) => {
      if (cancelled || (!force && !isVisible())) return;
      if (slowPollInFlightRef.current) return;
      slowPollInFlightRef.current = true;
      try {
        await Promise.all([
          fetchOverviewBundle(false),
          fetchRalph(),
          fetchCrons(),
          fetchReports(),
        ]);
      } finally {
        slowPollInFlightRef.current = false;
      }
    };

    void tickFast(true);
    void tickSlow(true);

    const fastId = window.setInterval(() => void tickFast(false), 15_000);
    const slowId = window.setInterval(() => void tickSlow(false), 60_000);

    const onVisibilityChange = () => {
      if (!isVisible()) return;
      void tickFast(true);
      void tickSlow(true);
    };

    if (hasDocument) {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }

    return () => {
      cancelled = true;
      window.clearInterval(fastId);
      window.clearInterval(slowId);
      if (hasDocument) {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
    };
  }, [fetchOverviewBundle, fetchRalph, fetchCrons, fetchReports]);

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
    const { data: report } = await dataSelect<any>({
      table: "discover_reports",
      columns: "*",
      filters: [{ op: "eq", column: "id", value: reportId }],
      single: "single",
    });
    if (report) applyReportState(report, logPhase);
  }, [applyReportState]);

  const triggerOrchestrateTick = useCallback(async (reportId: string) => {
    const { data, error } = await invokeProtectedFunction("discover-collector", { mode: "orchestrate", reportId });
    if (error) { addLog(`Tick falhou: ${error.message}`); return; }
    if (data?.throughput_per_min != null) {
      addLog(`Tick: ${fmt(data.metrics_done_count)}/${fmt(data.queue_total)} | ${fmt(data.throughput_per_min)} ilhas/min | workers ${data.workers_active ?? 0}`);
    } else addLog("Tick orchestrate executado.");
  }, [addLog, invokeProtectedFunction]);

  useEffect(() => {
    (async () => {
      const { data: active } = await dataSelect<any>({
        table: "discover_reports",
        columns: "*",
        filters: [{ op: "in", column: "phase", value: ["catalog", "metrics", "finalize", "ai"] }],
        order: [{ column: "created_at", ascending: false }],
        limit: 1,
        single: "maybeSingle",
      });
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
    const startRes = await invokeProtectedFunction("discover-collector", { mode: "start" });
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

  const handleCancelReport = async (reportId: string) => {
    try {
      await dataUpdate({
        table: "discover_reports",
        values: {
          status: "cancelled",
          phase: "done",
        } as any,
        filters: [{ op: "eq", column: "id", value: reportId }],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast({ title: "Erro", description: message, variant: "destructive" });
      return;
    }
    toast({ title: "Report cancelado" });
    if (activeReportId === reportId) {
      setActiveReportId(null);
      setGenerating(false);
      setGenState(INITIAL_GEN);
    }
    await fetchReports();
  };

  const handleDeleteReport = async (reportId: string) => {
    try {
      await dataDelete({
        table: "discover_reports",
        filters: [{ op: "eq", column: "id", value: reportId }],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast({ title: "Erro ao deletar", description: message, variant: "destructive" });
      return;
    }
    toast({ title: "Report deletado" });
    if (activeReportId === reportId) {
      setActiveReportId(null);
      setGenerating(false);
      setGenState(INITIAL_GEN);
    }
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
  const lookupHealth: HealthStatus = !lookup
    ? "idle"
    : lookup.calls1h === 0
      ? "warn"
      : lookup.failRate24hPct >= 10 || (lookup.p95ms24h ?? 0) > 3000
        ? "error"
        : lookup.failRate24hPct >= 3 || (lookup.p95ms24h ?? 0) > 1800
          ? "warn"
          : "ok";
  const ralphHealthStatus: HealthStatus = !ralphHealth
    ? "idle"
    : ralphHealth.criticalOpenIncidents > 0
      ? "error"
      : ralphHealth.openIncidents > 0 || ralphHealth.runsFailed > 0 || ralphHealth.successRatePct < 80
        ? "warn"
        : "ok";
  const ralphOps: RalphOpsData = useMemo(() => {
    const proposeRuns = ralphRuns.filter((r) => String(r.summary?.edit_mode_effective || "").toLowerCase() === "propose").length;
    const applyRuns = ralphRuns.filter((r) => String(r.summary?.edit_mode_effective || "").toLowerCase() === "apply").length;
    const promotableRuns = ralphRuns.filter((r) => String(r.status || "").toLowerCase() === "promotable").length;
    const guardActivations = ralphActions.filter((a) => a.phase === "guard" && a.status === "warn").length;
    const blockedTransitions = ralphRuns.filter((r) => Boolean(r.summary?.feature_transition?.blocked_feature_id)).length;
    const buildGateFails = ralphIncidents.filter((i) => i.incident_type === "build_gate_failed" && !i.resolved).length;
    const opsApplyFails = ralphIncidents.filter((i) => i.incident_type === "ops_apply_failed" && !i.resolved).length;
    const latestBuildFailAction = ralphActions.find((a) =>
      a.phase === "gate" &&
      a.target === "build" &&
      a.status === "error" &&
      typeof a.details?.failure_signature === "string"
    );
    const latestRunWithFeature = ralphRuns.find((r) => typeof r.summary?.active_feature?.title === "string");
    return {
      proposeRuns,
      applyRuns,
      promotableRuns,
      guardActivations,
      blockedTransitions,
      buildGateFails,
      opsApplyFails,
      latestFailureSignature: latestBuildFailAction?.details?.failure_signature || null,
      latestActiveFeature: latestRunWithFeature?.summary?.active_feature?.title || null,
    };
  }, [ralphRuns, ralphActions, ralphIncidents]);
  const reportHealth: HealthStatus = generating ? "ok" : genState.phase === "done" ? "ok" : "idle";
  const cronActiveCount = crons.filter((c) => c.active).length;
  const cronHealth: HealthStatus = crons.length === 0
    ? "idle"
    : cronActiveCount === crons.length
      ? "ok"
      : cronActiveCount === 0
        ? "error"
        : "warn";

  const metaPct = meta && meta.total > 0 ? (meta.withTitle / meta.total) * 100 : 0;
  const metaGap = (census?.totalIslands || 0) - (meta?.islands || 0);
  const metaPending = meta ? meta.total - meta.withTitle : 0;
  const metaEta = metaThroughput && metaThroughput > 0 && metaPending > 0 ? Math.ceil(metaPending / metaThroughput) : null;

  const alertBad = alerts.filter(a => a.severity !== "ok");
  const alertStatus: HealthStatus =
    alertBad.length === 0 ? "ok" : alertBad.some(a => a.severity === "error") ? "error" : "warn";

  // Monitoring health: check if alerts themselves are stale (>5 min old)
  const ageSeconds = (iso: string | null | undefined): number | null => {
    if (!iso) return null;
    const ts = new Date(iso).getTime();
    if (!Number.isFinite(ts)) return null;
    const age = (Date.now() - ts) / 1000;
    return age >= 0 ? age : null;
  };
  const alertsMaxAge = alerts.length > 0
    ? Math.max(...alerts.map(a => a.updated_at ? (Date.now() - new Date(a.updated_at).getTime()) / 1000 : 999999))
    : 999999;
  const freshestSignalAges = [
    ageSeconds(monitorHeartbeat.exposureTickAt),
    ageSeconds(monitorHeartbeat.metadataEventAt),
    ageSeconds(lookup?.lastOkAt || null),
    ageSeconds(ralphHealth?.lastRunAt || null),
  ].filter((v): v is number => v != null);
  const freshestSignalAge = freshestSignalAges.length > 0 ? Math.min(...freshestSignalAges) : null;
  const alertsStale = alerts.length === 0 || alertsMaxAge > 300;
  const hasFreshSignal = freshestSignalAge != null && freshestSignalAge <= 300;
  const monitoringOffline = alertsStale && !hasFreshSignal;
  const monitoringLagging = alertsStale && hasFreshSignal;
  const monitoringStatus: HealthStatus = monitoringOffline ? "error" : monitoringLagging ? "warn" : alertStatus;

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
            <div className="flex items-center gap-1.5"><HealthDot status={lookupHealth} label={`${lookup?.ok1h || 0}/${lookup?.calls1h || 0} lookup ok (1h)`} /><span className="text-muted-foreground">Lookup</span></div>
            <div className="flex items-center gap-1.5"><HealthDot status={ralphHealthStatus} label={`${ralphHealth?.runsRunning || 0} running · ${ralphHealth?.openIncidents || 0} incidentes`} /><span className="text-muted-foreground">Ralph</span></div>
            <div className="flex items-center gap-1.5"><HealthDot status={reportHealth} label={generating ? "Em andamento" : "Idle"} /><span className="text-muted-foreground">Report</span></div>
            <div className="flex items-center gap-1.5"><HealthDot status={monitoringStatus} label={monitoringOffline ? "Monitoramento offline" : monitoringLagging ? "Monitoramento com atraso de refresh" : `${alertBad.length} alertas ativos`} /><span className="text-muted-foreground">Alertas</span></div>
            <div className="flex items-center gap-1.5"><HealthDot status={cronHealth} label={`${cronActiveCount}/${crons.length || 0} ativos`} /><span className="text-muted-foreground">Crons</span></div>
          </div>
        </CardContent>
      </Card>

      {/* ── Monitoring Offline Banner ──────────────────────── */}
      {monitoringOffline && (
        <Card className="border-destructive bg-destructive/10">
          <CardContent className="py-3 px-4">
            <div className="flex items-center gap-3">
              <ShieldAlert className="h-5 w-5 text-destructive shrink-0" />
              <div>
                <p className="font-semibold text-sm text-destructive">⚠️ MONITORAMENTO OFFLINE</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {alerts.length === 0
                    ? "Nenhum alerta cadastrado no banco. O cron 'system-alerts-refresh-2min' pode não ter executado ainda."
                    : `Os alertas não são atualizados há ${Math.round(alertsMaxAge / 60)} minutos. O sistema de monitoramento pode estar falhando — os indicadores acima podem estar DESATUALIZADOS e não refletem o estado real.`}
                </p>
                <p className="text-xs text-destructive font-medium mt-1">
                  Isso significa que erros podem estar ocorrendo sem serem detectados. Verifique os logs das Edge Functions manualmente.
                </p>
              </div>
            </div>
          </CardContent>
         </Card>
       )}
      {monitoringLagging && (
        <Card className="border-yellow-500/40 bg-yellow-500/10">
          <CardContent className="py-3 px-4">
            <div className="flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-yellow-500 shrink-0" />
              <div>
                <p className="font-semibold text-sm text-yellow-600">Monitoramento com atraso de refresh</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Alertas materializados estao atrasados ({Math.round(alertsMaxAge / 60)}min), mas ha atividade recente nos pipelines
                  {freshestSignalAge != null ? ` (ultimo sinal ha ${Math.round(freshestSignalAge / 60)}min).` : "."}
                </p>
                <p className="text-xs text-yellow-700 font-medium mt-1">
                  Acao recomendada: validar cron de refresh de alertas e logs da funcao compute_system_alerts.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

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
                  Resolucao 24h: {fmt(linkGraph?.collectionsResolved24h)} / {fmt(linkGraph?.collectionsSeen24h)} resolvíveis
                </span>
                <span className="text-sm font-mono font-bold">
                  {linkGraph?.resolution24hPct != null ? `${(linkGraph.resolution24hPct * 100).toFixed(1)}%` : "--"}
                </span>
              </div>
              <Progress value={linkGraph?.resolution24hPct != null ? linkGraph.resolution24hPct * 100 : 0} className="h-3" />
              <div className="flex justify-between mt-1 text-[10px] text-muted-foreground">
                <span>edges: {fmt(linkGraph?.edgesTotal)} · due: {fmt(linkGraph?.collectionsDueNow)}</span>
                <span className="text-muted-foreground/60">+{fmt(linkGraph?.referenceCollections)} reference_* (não resolvíveis)</span>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
              <StatCard icon={Layers} label="Edges" value={fmt(linkGraph?.edgesTotal)} />
              <StatCard icon={Hash} label="Parents" value={fmt(linkGraph?.parentsTotal)} />
              <StatCard icon={Hash} label="Children" value={fmt(linkGraph?.childrenTotal)} />
              <StatCard icon={CalendarClock} label="Resolvíveis" value={fmt(linkGraph?.collectionsSeen24h)} sub="set_* only" />
              <StatCard icon={CheckCircle2} label="Resolved 24h" value={fmt(linkGraph?.collectionsResolved24h)} color="success" />
              <StatCard icon={EyeOff} label="Reference" value={fmt(linkGraph?.referenceCollections)} sub="API não suporta" />
              <StatCard icon={AlertTriangle} label="Stale >60d" value={fmt(linkGraph?.staleEdges60d)} color={linkGraph && linkGraph.staleEdges60d > 10000 ? "warning" : "default"} />
            </div>

            <div className="rounded-lg border bg-muted/30 p-3 space-y-1.5 text-xs">
              <p className="font-semibold text-sm">Notify / Acoes Recomendadas</p>
              {(linkGraph?.resolution24hPct ?? 0) < 0.5 && (linkGraph?.collectionsSeen24h || 0) > 5 ? (
                <p className="text-destructive">Cobertura baixa de rails resolvidos ({fmt(linkGraph?.collectionsResolved24h)}/{fmt(linkGraph?.collectionsSeen24h)} resolvíveis). Executar backfill e revisar logs.</p>
              ) : (linkGraph?.collectionsSeen24h || 0) === 0 ? (
                <p className="text-muted-foreground">Nenhuma coleção resolvível ativa no momento. {(linkGraph?.referenceCollections || 0) > 0 ? `(${fmt(linkGraph?.referenceCollections)} reference_* ignoradas — API não suporta)` : ""}</p>
              ) : (
                <p className="text-muted-foreground">✅ Cobertura de rails dentro do esperado. {(linkGraph?.referenceCollections || 0) > 0 ? `(${fmt(linkGraph?.referenceCollections)} reference_* excluídas da métrica)` : ""}</p>
              )}
              {(linkGraph?.edgeAgeSeconds ?? 0) > 21600 ? (
                <p className="text-yellow-600">Link graph desatualizado (&gt; 6h). Verifique cron do metadata orchestrate.</p>
              ) : null}
              <div className="pt-1.5 border-t flex items-center justify-end">
                <Button size="sm" variant="outline" onClick={handleBackfillCollections} disabled={backfillLoading} className="text-xs">
                  {backfillLoading ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Zap className="h-3 w-3 mr-1" />}
                  Backfill Collections (72h)
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div>
        <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
          <Search className="h-4 w-4" /> Lookup Pipeline
        </h2>
        <Card>
          <CardContent className="pt-4 pb-4 space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
              <StatCard icon={Activity} label="Calls 24h" value={fmt(lookup?.calls24h)} sparkData={lookupHistory.current.calls24h} />
              <StatCard icon={CheckCircle2} label="OK 24h" value={fmt(lookup?.ok24h)} color="success" />
              <StatCard icon={AlertTriangle} label="Fail 24h" value={fmt(lookup?.fail24h)} color={(lookup?.fail24h || 0) > 0 ? "destructive" : "default"} />
              <StatCard icon={Gauge} label="p95 (ms)" value={lookup?.p95ms24h != null ? fmt(lookup.p95ms24h) : "-"} sparkData={lookupHistory.current.p95} />
              <StatCard icon={Clock} label="Avg (ms)" value={lookup?.avgMs24h != null ? fmt(lookup.avgMs24h) : "-"} />
              <StatCard icon={ShieldAlert} label="Fail rate" value={lookup ? `${lookup.failRate24hPct.toFixed(2)}%` : "-"} color={(lookup?.failRate24hPct || 0) >= 3 ? "warning" : "default"} sparkData={lookupHistory.current.failRate} />
              <StatCard icon={Layers} label="Coverage card" value={lookup ? `${lookup.coverageInternalCardPct.toFixed(1)}%` : "-"} />
              <StatCard icon={BarChart3} label="Coverage discover" value={lookup ? `${lookup.coverageDiscoverySignalsPct.toFixed(1)}%` : "-"} />
            </div>

            <div className="rounded-lg border bg-muted/30 p-3 space-y-1.5 text-xs">
              <p className="font-semibold text-sm">Notify / Acoes Recomendadas</p>
              {!lookup ? (
                <p className="text-muted-foreground">Aguardando dados do lookup pipeline.</p>
              ) : (
                <>
                  {lookup.calls1h === 0 ? (
                    <p className="text-destructive">Nenhuma chamada no lookup na ultima hora. Verifique uso da ferramenta e logs da edge function.</p>
                  ) : lookup.failRate24hPct >= 10 ? (
                    <p className="text-destructive">Fail rate alto ({lookup.failRate24hPct.toFixed(2)}%). Prioridade alta: revisar erros por tipo.</p>
                  ) : lookup.failRate24hPct >= 3 ? (
                    <p className="text-yellow-600">Fail rate em atencao ({lookup.failRate24hPct.toFixed(2)}%). Monitorar.</p>
                  ) : (
                    <p className="text-muted-foreground">Lookup pipeline dentro do esperado.</p>
                  )}
                  {(lookup.p95ms24h ?? 0) > 3000 && (
                    <p className="text-destructive">Latencia p95 acima de 3s ({lookup.p95ms24h}ms). Verificar enrichment e IO externo.</p>
                  )}
                  {(lookup.coverageInternalCardPct ?? 0) < 70 && (
                    <p className="text-yellow-600">Coverage de internalCard baixa ({lookup.coverageInternalCardPct.toFixed(1)}%).</p>
                  )}
                </>
              )}

              <div className="pt-1 border-t">
                <p className="text-muted-foreground text-[11px] mb-1">Top erros (24h):</p>
                {lookup?.errorBreakdown?.length ? (
                  <div className="grid sm:grid-cols-2 gap-1">
                    {lookup.errorBreakdown.map((e) => (
                      <p key={e.error_type} className="text-[11px]">
                        <span className="font-mono">{e.error_type}</span>: {fmt(e.count)}
                      </p>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-muted-foreground">Sem erros no periodo.</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div>
        <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
          <Sparkles className="h-4 w-4" /> Ralph Monitor
        </h2>
        <Card>
          <CardContent className="pt-4 pb-4 space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
              <StatCard
                icon={Radio}
                label="Status"
                value={!ralphHealth ? "Idle" : ralphHealth.runsRunning > 0 ? "Running" : "Idle"}
                color={!ralphHealth ? "default" : ralphHealth.runsRunning > 0 ? "success" : "default"}
              />
              <StatCard icon={Activity} label="Runs (24h)" value={fmt(ralphHealth?.runsTotal)} />
              <StatCard
                icon={CheckCircle2}
                label="Success (24h)"
                value={ralphHealth ? `${ralphHealth.successRatePct.toFixed(1)}%` : "-"}
                color={(ralphHealth?.successRatePct || 0) >= 90 ? "success" : (ralphHealth?.successRatePct || 0) >= 75 ? "warning" : "destructive"}
              />
              <StatCard icon={Loader2} label="Running now" value={fmt(ralphHealth?.runsRunning)} />
              <StatCard
                icon={AlertTriangle}
                label="Open incidents"
                value={fmt(ralphHealth?.openIncidents)}
                color={(ralphHealth?.openIncidents || 0) > 0 ? "warning" : "default"}
              />
              <StatCard
                icon={ShieldAlert}
                label="Critical open"
                value={fmt(ralphHealth?.criticalOpenIncidents)}
                color={(ralphHealth?.criticalOpenIncidents || 0) > 0 ? "destructive" : "default"}
              />
              <StatCard icon={Clock} label="Avg duration" value={fmtDurationMs(ralphHealth?.avgDurationMs)} />
              <StatCard icon={Gauge} label="P95 duration" value={fmtDurationMs(ralphHealth?.p95DurationMs)} />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <StatCard icon={Layers} label="Memory items" value={fmt(ralphMemory?.itemsTotal)} />
              <StatCard icon={FileText} label="Semantic docs" value={fmt(ralphMemory?.docsTotal)} />
              <StatCard icon={BarChart3} label="Snapshots 24h" value={fmt(ralphMemory?.snapshots24h)} />
              <StatCard
                icon={AlertCircle}
                label="Decisions open"
                value={fmt(ralphMemory?.decisionsOpen)}
                color={(ralphMemory?.decisionsOpen || 0) > 0 ? "warning" : "default"}
              />
              <StatCard
                icon={Hash}
                label="Last run"
                value={fmtAge(ralphHealth?.lastRunAt)}
                sub={ralphHealth?.lastRunAt ? new Date(ralphHealth.lastRunAt).toLocaleString("pt-BR") : undefined}
              />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard icon={CheckCircle2} label="Propose runs" value={fmt(ralphOps.proposeRuns)} />
              <StatCard icon={Zap} label="Apply runs" value={fmt(ralphOps.applyRuns)} />
              <StatCard icon={ShieldAlert} label="Guard activations" value={fmt(ralphOps.guardActivations)} color={ralphOps.guardActivations > 0 ? "warning" : "default"} />
              <StatCard icon={AlertTriangle} label="Blocked features" value={fmt(ralphOps.blockedTransitions)} color={ralphOps.blockedTransitions > 0 ? "warning" : "default"} />
            </div>

            <div className="rounded-lg border bg-muted/30 p-3 space-y-1.5 text-xs">
              <p className="font-semibold text-sm">Context / Learning</p>
              <p className="text-muted-foreground">
                Top memory item:{" "}
                <span className="font-mono font-semibold">{ralphMemory?.topItemLabel || "n/a"}</span>{" "}
                {ralphMemory?.topItemImportance != null ? `(importance ${ralphMemory.topItemImportance})` : ""}
              </p>
              <p className="text-muted-foreground">
                Runs tracked: {ralphRuns.length} | Actions tracked: {ralphActions.length} | Evals tracked: {ralphEvals.length}
              </p>
              <p className="text-muted-foreground">
                Feature ativa recente: <span className="font-mono">{ralphOps.latestActiveFeature || "n/a"}</span>
              </p>
              <p className="text-muted-foreground">
                Build fail signature recente: <span className="font-mono">{ralphOps.latestFailureSignature || "n/a"}</span>
              </p>
              <p className="text-muted-foreground">
                Incidentes abertos: build_gate_failed={ralphOps.buildGateFails} | ops_apply_failed={ralphOps.opsApplyFails}
              </p>
            </div>

            <div className="grid lg:grid-cols-2 gap-4">
              <div className="rounded-lg border p-3 space-y-2">
                <p className="text-sm font-semibold">Latest runs</p>
                {ralphRuns.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No run data yet.</p>
                ) : (
                  <div className="space-y-2">
                    {ralphRuns.slice(0, 6).map((r) => (
                      <div key={r.id} className="rounded border bg-muted/20 p-2 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono">{r.id.slice(0, 8)}...</span>
                          <Badge
                            variant={r.status === "promotable" || r.status === "completed" ? "default" : r.status === "running" ? "secondary" : "destructive"}
                            className="text-[10px]"
                          >
                            {r.status}
                          </Badge>
                        </div>
                        <p className="text-muted-foreground mt-1">mode={r.mode} · started {fmtAge(r.started_at)} ago</p>
                        {Array.isArray(r.target_scope) && r.target_scope.length > 0 && (
                          <p className="text-muted-foreground">scope: {r.target_scope.join(", ")}</p>
                        )}
                        {r.summary?.edit_mode_effective && (
                          <p className="text-muted-foreground">edit_mode: {String(r.summary.edit_mode_effective)}</p>
                        )}
                        {r.summary?.active_feature?.title && (
                          <p className="text-muted-foreground">feature: {String(r.summary.active_feature.title)}</p>
                        )}
                        {r.summary?.feature_transition?.blocked_feature_id && (
                          <p className="text-yellow-600 mt-1">
                            feature blocked: {String(r.summary.feature_transition.blocked_feature_id).slice(0, 8)}...
                          </p>
                        )}
                        {r.error_message && <p className="text-destructive mt-1 line-clamp-2">{r.error_message}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-lg border p-3 space-y-2">
                <p className="text-sm font-semibold">Latest actions / thinking</p>
                {ralphActions.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No action data yet.</p>
                ) : (
                  <div className="space-y-2">
                    {ralphActions.slice(0, 8).map((a) => (
                      <div key={a.id} className="rounded border bg-muted/20 p-2 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono">#{a.step_index} · {a.phase}</span>
                          <Badge variant={a.status === "ok" ? "default" : a.status === "warn" ? "secondary" : "destructive"} className="text-[10px]">
                            {a.status}
                          </Badge>
                        </div>
                        <p className="text-muted-foreground mt-1">{a.tool_name || "-"} · {fmtDurationMs(a.latency_ms)} · {fmtAge(a.created_at)} ago</p>
                        {(a.details?.text_preview || a.details?.reason || a.details?.error || a.target) && (
                          <p className="text-muted-foreground mt-1 line-clamp-3 font-mono">
                            {String(a.details?.text_preview || a.details?.reason || a.details?.error || a.target)}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="grid lg:grid-cols-2 gap-4">
              <div className="rounded-lg border p-3 space-y-2">
                <p className="text-sm font-semibold">Latest evals</p>
                {ralphEvals.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No eval data yet.</p>
                ) : (
                  <div className="space-y-2">
                    {ralphEvals.slice(0, 8).map((e) => (
                      <div key={e.id} className="rounded border bg-muted/20 p-2 text-xs flex items-center justify-between gap-2">
                        <div>
                          <p className="font-mono">{e.suite}.{e.metric}</p>
                          <p className="text-muted-foreground">value={e.value != null ? e.value : "-"} · threshold={e.threshold != null ? e.threshold : "-"}</p>
                        </div>
                        <Badge variant={e.pass ? "default" : "destructive"} className="text-[10px]">
                          {e.pass ? "pass" : "fail"}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-lg border p-3 space-y-2">
                <p className="text-sm font-semibold">Latest incidents</p>
                {ralphIncidents.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No incidents found.</p>
                ) : (
                  <div className="space-y-2">
                    {ralphIncidents.slice(0, 8).map((i) => (
                      <div key={i.id} className="rounded border bg-muted/20 p-2 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono">{i.incident_type}</span>
                          <div className="flex items-center gap-2">
                            <Badge
                              variant={i.severity === "critical" || i.severity === "error" ? "destructive" : i.severity === "warn" ? "secondary" : "default"}
                              className="text-[10px]"
                            >
                              {i.severity}
                            </Badge>
                            <Badge variant={i.resolved ? "default" : "secondary"} className="text-[10px]">
                              {i.resolved ? "resolved" : "open"}
                            </Badge>
                          </div>
                        </div>
                        <p className="text-muted-foreground mt-1 line-clamp-2">{i.message}</p>
                        <p className="text-muted-foreground mt-1">created {fmtAge(i.created_at)} ago</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Section 5: Cron Jobs ───────────────────────────── */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
          <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Timer className="h-4 w-4" /> Cron Jobs
          </h2>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="text-xs"
              onClick={handlePauseAllCrons}
              disabled={cronBulkAction !== null || crons.length === 0}
            >
              {cronBulkAction === "pause" ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <PauseCircle className="h-3 w-3 mr-1" />}
              Pausar todos
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-xs"
              onClick={handleResumeAllCrons}
              disabled={cronBulkAction !== null || crons.length === 0}
            >
              {cronBulkAction === "resume" ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <PlayCircle className="h-3 w-3 mr-1" />}
              Reativar todos
            </Button>
          </div>
        </div>
        <Card>
          <CardContent className="py-3 px-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left font-medium px-4 py-2">Job</th>
                    <th className="text-left font-medium px-4 py-2">Schedule</th>
                    <th className="text-left font-medium px-4 py-2">Status</th>
                    <th className="text-left font-medium px-4 py-2">Ação</th>
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
                      <td className="px-4 py-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-[10px]"
                          onClick={() => handleSetCronActive(c.name, !c.active)}
                          disabled={cronBulkAction !== null || Boolean(cronRowBusy[c.name])}
                        >
                          {cronRowBusy[c.name] ? (
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                          ) : c.active ? (
                            <PauseCircle className="h-3 w-3 mr-1" />
                          ) : (
                            <PlayCircle className="h-3 w-3 mr-1" />
                          )}
                          {c.active ? "Pausar" : "Ativar"}
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {crons.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-4 text-center text-muted-foreground">
                        Sem dados de cron disponíveis.
                      </td>
                    </tr>
                  )}
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
            {reports.map((r) => {
              const isRunning = ["collecting", "analyzing"].includes(r.status) || ["catalog", "metrics", "finalize", "ai"].includes(r.phase);
              return (
                <Card key={r.id}>
                  <CardContent className="flex items-center justify-between py-3">
                    <div>
                      <p className="font-display font-semibold text-sm">Semana {r.week_number}/{r.year}</p>
                      <p className="text-[10px] text-muted-foreground">{r.phase} · {r.reported_count || 0} reported</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={r.status === "completed" ? "default" : r.status === "cancelled" ? "destructive" : "secondary"} className="text-[10px]">{r.status}</Badge>
                      {isRunning && (
                        <Button variant="destructive" size="sm" className="text-xs" onClick={() => handleCancelReport(r.id)}>
                          <XCircle className="h-3 w-3 mr-1" /> Cancelar
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" className="text-xs text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => handleDeleteReport(r.id)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                      <Button variant="outline" size="sm" className="text-xs" asChild>
                        <Link to="/admin/reports">Ver</Link>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
