import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { RefreshCcw, Wrench, AlertTriangle, CheckCircle2, Clock, ListChecks, PauseCircle, PlayCircle, KeyRound, Copy, StopCircle, Activity } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type TargetRow = {
  id: string;
  region: string;
  surface_name: string;
  platform: string;
  locale: string;
  interval_minutes: number;
  next_due_at: string;
  locked_at: string | null;
  last_ok_tick_at: string | null;
  last_failed_tick_at: string | null;
  last_status: string;
  last_error: string | null;
};

type TickRow = {
  id: string;
  target_id: string;
  ts_start: string;
  ts_end: string | null;
  status: string;
  panels_count: number;
  entries_count: number;
  duration_ms: number | null;
  branch: string | null;
  error_message: string | null;
};

function fmtAgo(iso: string | null | undefined, allowFuture = false): string {
  if (!iso) return "-";
  const diff = Date.now() - new Date(iso).getTime();
  if (!isFinite(diff)) return "-";
  if (diff < 0) {
    if (!allowFuture) return "-";
    const ms = Math.abs(diff);
    const m = Math.floor(ms / 60000);
    if (m < 1) return "em <1m";
    if (m < 60) return `em ${m}m`;
    const h = Math.floor(m / 60);
    return `em ${h}h`;
  }
  const m = Math.floor(diff / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m}m ${rs}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 24) return `${h}h ${rm}m`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return `${d}d ${rh}h`;
}

function fmtNum(n: number | null | undefined): string {
  if (n == null) return "-";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString("pt-BR");
}

function surfaceLabel(s: string): string {
  if (s === "CreativeDiscoverySurface_Frontend") return "Frontend";
  if (s === "CreativeDiscoverySurface_Browse") return "Browse";
  return s;
}

type PipelineStatus = "running" | "paused" | "stopped";

function derivePipelineStatus(targets: TargetRow[]): PipelineStatus {
  if (!targets.length) return "stopped";
  const allPaused = targets.every((t) => t.last_status === "paused");
  if (allPaused) return "paused";
  const anyActive = targets.some((t) => t.last_status !== "paused" && t.last_ok_tick_at);
  if (anyActive) return "running";
  return "stopped";
}

function computeUptime(ticks: TickRow[], targets: TargetRow[]): number | null {
  // Uptime = time since the pipeline last had all targets OK without interruption
  // Find the most recent failed tick across all targets
  const okTargets = targets.filter((t) => t.last_ok_tick_at && t.last_status !== "paused");
  if (!okTargets.length) return null;
  
  // Find earliest last_ok among active targets as start of current "run"
  const lastFailed = targets
    .map((t) => t.last_failed_tick_at)
    .filter(Boolean)
    .sort()
    .reverse()[0];
  
  const firstOkAfterFail = okTargets
    .map((t) => new Date(t.last_ok_tick_at!).getTime())
    .sort()[0];
  
  if (lastFailed) {
    const failTs = new Date(lastFailed).getTime();
    if (failTs > firstOkAfterFail) return null; // currently broken
    return Date.now() - failTs;
  }
  
  // No failures ever - uptime since first ok
  return Date.now() - firstOkAfterFail;
}

export default function AdminExposureHealth() {
  const { toast } = useToast();
  const sb: any = supabase;

  const [loading, setLoading] = useState(true);
  const [targets, setTargets] = useState<TargetRow[]>([]);
  const [ticks, setTicks] = useState<TickRow[]>([]);
  const [maintenance, setMaintenance] = useState<any>(null);
  const [configStatus, setConfigStatus] = useState<{ epicOauthClient: boolean; epicDeviceAuth: boolean } | null>(null);
  const [bootstrapOpen, setBootstrapOpen] = useState(false);
  const [authCode, setAuthCode] = useState("");
  const [bootstrapResult, setBootstrapResult] = useState<any>(null);
  const [now, setNow] = useState(Date.now());

  // Live clock for uptime
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const fetchState = useCallback(async () => {
    const { data: t, error: tErr } = await sb
      .from("discovery_exposure_targets")
      .select(
        "id,region,surface_name,platform,locale,interval_minutes,next_due_at,locked_at,last_ok_tick_at,last_failed_tick_at,last_status,last_error",
      )
      .order("region", { ascending: true })
      .order("surface_name", { ascending: true });
    if (tErr) {
      toast({ title: "Falha ao carregar targets", description: tErr.message, variant: "destructive" });
      return;
    }

    const ids = (t || []).map((r: any) => r.id);
    let tickRows: TickRow[] = [];
    if (ids.length) {
      const { data: tk, error: tkErr } = await sb
        .from("discovery_exposure_ticks")
        .select("id,target_id,ts_start,ts_end,status,panels_count,entries_count,duration_ms,branch,error_message")
        .in("target_id", ids)
        .order("ts_start", { ascending: false })
        .limit(250);
      if (tkErr) {
        toast({ title: "Falha ao carregar ticks", description: tkErr.message, variant: "destructive" });
        return;
      }
      tickRows = (tk || []) as TickRow[];
    }

    setTargets((t || []) as TargetRow[]);
    setTicks(tickRows);
    setLoading(false);

    const { data: cfg } = await supabase.functions.invoke("discover-exposure-collector", { body: { mode: "config_status" } });
    if (cfg?.success) setConfigStatus({ epicOauthClient: Boolean(cfg.epicOauthClient), epicDeviceAuth: Boolean(cfg.epicDeviceAuth) });
  }, [sb, toast]);

  // Initial fetch
  useEffect(() => {
    fetchState();
  }, [fetchState]);

  // Realtime subscriptions for auto-refresh
  useEffect(() => {
    const targetsChannel = supabase
      .channel("admin-exposure-targets")
      .on("postgres_changes", { event: "*", schema: "public", table: "discovery_exposure_targets" }, () => {
        fetchState();
      })
      .subscribe();

    const ticksChannel = supabase
      .channel("admin-exposure-ticks")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "discovery_exposure_ticks" }, () => {
        fetchState();
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "discovery_exposure_ticks" }, () => {
        fetchState();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(targetsChannel);
      supabase.removeChannel(ticksChannel);
    };
  }, [fetchState]);

  const ticksByTarget = useMemo(() => {
    const m = new Map<string, TickRow[]>();
    for (const tk of ticks) {
      const id = String(tk.target_id);
      if (!m.has(id)) m.set(id, []);
      m.get(id)!.push(tk);
    }
    return m;
  }, [ticks]);

  const tickTargetLabel = useCallback((targetId: string) => {
    const t = targets.find((x) => x.id === targetId);
    if (!t) return targetId.slice(0, 8);
    return `${t.region} · ${surfaceLabel(t.surface_name)}`;
  }, [targets]);

  const pipelineStatus = useMemo(() => derivePipelineStatus(targets), [targets]);
  const uptime = useMemo(() => computeUptime(ticks, targets), [ticks, targets, now]);

  const overall = useMemo(() => {
    const last24h = ticks.filter((t) => Date.now() - new Date(t.ts_start).getTime() <= 24 * 3600 * 1000);
    const ok = last24h.filter((t) => t.status === "ok").length;
    const failed = last24h.filter((t) => t.status === "failed").length;
    const avgDur = (() => {
      const ds = last24h.filter((t) => t.duration_ms != null && t.status === "ok").map((t) => Number(t.duration_ms));
      if (!ds.length) return null;
      return Math.round(ds.reduce((a, b) => a + b, 0) / ds.length);
    })();
    const totalEntries = last24h.reduce((s, t) => s + Number(t.entries_count || 0), 0);
    return { ticks24h: last24h.length, ok, failed, avgDur, totalEntries };
  }, [ticks]);

  const runOrchestrate = async () => {
    const { error, data } = await supabase.functions.invoke("discover-exposure-collector", { body: { mode: "orchestrate" } });
    if (error) {
      toast({ title: "Orchestrate falhou", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Orchestrate", description: data?.claimed ? "Tick executado." : "Nada due (no-op)." });
  };

  const setPaused = async (paused: boolean) => {
    const { error, data } = await supabase.functions.invoke("discover-exposure-collector", { body: { mode: "set_paused", paused } });
    if (error || data?.success === false) {
      toast({ title: paused ? "Pause falhou" : "Start falhou", description: error?.message || data?.error || "erro", variant: "destructive" });
      return;
    }
    toast({ title: paused ? "Pipeline pausado" : "Pipeline iniciado", description: paused ? "Targets congelados. Cron não fará nada." : "Targets reativados. Cron começará a processar." });
  };

  const handleStart = async () => {
    if (configStatus && !configStatus.epicDeviceAuth) {
      setBootstrapOpen(true);
      toast({ title: "Precisa de Setup Auth", description: "Gere o Device Auth 1x antes de iniciar." });
      return;
    }
    await setPaused(false);
  };

  const runTickTarget = async (targetId: string) => {
    const { error } = await supabase.functions.invoke("discover-exposure-collector", {
      body: { mode: "tick", targetId },
    });
    if (error) {
      toast({ title: "Tick falhou", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Tick", description: "Executado." });
  };

  const runMaintenance = async () => {
    const { error, data } = await supabase.functions.invoke("discover-exposure-collector", { body: { mode: "maintenance" } });
    if (error) {
      toast({ title: "Maintenance falhou", description: error.message, variant: "destructive" });
      return;
    }
    setMaintenance(data?.maintenance || data || null);
    toast({ title: "Maintenance", description: "Executado." });
  };

  const runBootstrap = async () => {
    setBootstrapResult(null);
    const code = authCode.trim();
    if (!code) {
      toast({ title: "Cole o authorizationCode", variant: "destructive" });
      return;
    }
    const { error, data } = await supabase.functions.invoke("discover-exposure-collector", {
      body: { mode: "bootstrap_device_auth", authorizationCode: code },
    });
    if (error || data?.success === false) {
      toast({ title: "Bootstrap falhou", description: error?.message || data?.error || "erro", variant: "destructive" });
      return;
    }
    setBootstrapResult(data);
    toast({ title: "Device Auth gerado", description: "Agora cole esses valores nos Secrets do Lovable/Supabase." });
  };

  const copyEnvBlock = async () => {
    if (!bootstrapResult?.env) return;
    const env = bootstrapResult.env;
    const lines = [
      `EPIC_OAUTH_CLIENT_ID=${env.EPIC_OAUTH_CLIENT_ID ?? ""}`,
      `EPIC_OAUTH_CLIENT_SECRET=*** (use o valor ja configurado)`,
      `EPIC_DEVICE_AUTH_ACCOUNT_ID=${env.EPIC_DEVICE_AUTH_ACCOUNT_ID ?? ""}`,
      `EPIC_DEVICE_AUTH_DEVICE_ID=${env.EPIC_DEVICE_AUTH_DEVICE_ID ?? ""}`,
      `EPIC_DEVICE_AUTH_SECRET=${env.EPIC_DEVICE_AUTH_SECRET ?? ""}`,
    ].join("\n");
    await navigator.clipboard.writeText(lines);
    toast({ title: "Copiado", description: "Bloco de env vars copiado." });
  };

  const statusBadge = useMemo(() => {
    switch (pipelineStatus) {
      case "running":
        return (
          <Badge className="gap-1 bg-emerald-500/15 text-emerald-600 border-emerald-500/30 hover:bg-emerald-500/20">
            <Activity className="h-3.5 w-3.5 animate-pulse" /> Rodando
          </Badge>
        );
      case "paused":
        return (
          <Badge variant="outline" className="gap-1 text-amber-600 border-amber-500/40">
            <PauseCircle className="h-3.5 w-3.5" /> Pausado
          </Badge>
        );
      case "stopped":
        return (
          <Badge variant="outline" className="gap-1 text-muted-foreground">
            <StopCircle className="h-3.5 w-3.5" /> Parado
          </Badge>
        );
    }
  }, [pipelineStatus]);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-display text-2xl font-bold">Exposure Health</h1>
            {statusBadge}
          </div>
          <p className="text-sm text-muted-foreground">
            Pipeline 24/7 · {targets.length} targets · Atualização automática
          </p>
          <div className="flex items-center gap-4 mt-1">
            {configStatus && (
              <p className="text-xs text-muted-foreground">
                OAuth {configStatus.epicOauthClient ? "✓" : "✗"} · DeviceAuth {configStatus.epicDeviceAuth ? "✓" : "✗"}
              </p>
            )}
            {pipelineStatus === "running" && uptime != null && (
              <p className="text-xs text-emerald-600 font-mono">
                Uptime: {fmtDuration(uptime)}
              </p>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          {pipelineStatus !== "running" ? (
            <Button variant="default" onClick={handleStart}>
              <PlayCircle className="h-4 w-4 mr-2" /> Start
            </Button>
          ) : (
            <Button variant="outline" onClick={() => setPaused(true)}>
              <PauseCircle className="h-4 w-4 mr-2" /> Pause
            </Button>
          )}
          <Button variant="outline" onClick={runOrchestrate}>
            <RefreshCcw className="h-4 w-4 mr-2" /> Orchestrate
          </Button>
          <Button variant="outline" onClick={runMaintenance}>
            <Wrench className="h-4 w-4 mr-2" /> Maintenance
          </Button>
          <Button variant="outline" onClick={() => setBootstrapOpen(true)}>
            <KeyRound className="h-4 w-4 mr-2" /> Setup Auth
          </Button>
        </div>
      </div>

      <div className="grid md:grid-cols-5 gap-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Status</CardTitle></CardHeader>
          <CardContent className="text-lg font-display font-bold capitalize">{pipelineStatus === "running" ? "🟢 Rodando" : pipelineStatus === "paused" ? "🟡 Pausado" : "⚫ Parado"}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Ticks (24h)</CardTitle></CardHeader>
          <CardContent className="text-2xl font-display font-bold">{fmtNum(overall.ticks24h)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">OK (24h)</CardTitle></CardHeader>
          <CardContent className="text-2xl font-display font-bold">{fmtNum(overall.ok)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Failed (24h)</CardTitle></CardHeader>
          <CardContent className="text-2xl font-display font-bold">{fmtNum(overall.failed)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Avg Duration</CardTitle></CardHeader>
          <CardContent className="text-2xl font-display font-bold">
            {overall.avgDur == null ? "-" : `${Math.round(overall.avgDur / 1000)}s`}
          </CardContent>
        </Card>
      </div>

      {maintenance && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Última Maintenance</CardTitle></CardHeader>
          <CardContent className="text-xs font-mono whitespace-pre-wrap">
            {JSON.stringify(maintenance, null, 2)}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-primary" />
            Targets ({targets.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading && <p className="text-sm text-muted-foreground">Carregando...</p>}
          {!loading && targets.length === 0 && <p className="text-sm text-muted-foreground">Nenhum target encontrado.</p>}
          {targets.map((t) => {
            const list = ticksByTarget.get(t.id) || [];
            const last = list[0] || null;
            const isPaused = t.last_status === "paused";
            const ok = last?.status === "ok";
            const badge = isPaused ? (
              <Badge variant="outline" className="gap-1 text-amber-600 border-amber-500/40"><PauseCircle className="h-3.5 w-3.5" /> paused</Badge>
            ) : ok ? (
              <Badge variant="secondary" className="gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> ok</Badge>
            ) : last?.status === "failed" ? (
              <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3.5 w-3.5" /> failed</Badge>
            ) : (
              <Badge variant="outline">-</Badge>
            );

            return (
              <div key={t.id} className="rounded-lg border p-4">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-display font-semibold truncate">
                        {t.region} · {surfaceLabel(t.surface_name)}
                      </p>
                      {badge}
                      {t.last_status === "processing" && <Badge variant="outline">processing</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      next_due {fmtAgo(t.next_due_at, true)} · last_ok {fmtAgo(t.last_ok_tick_at)} · last_failed {fmtAgo(t.last_failed_tick_at)}
                      {t.locked_at ? ` · locked ${fmtAgo(t.locked_at)}` : ""}
                    </p>
                    {t.last_error && (
                      <p className="text-xs text-destructive mt-2 break-words">
                        {t.last_error}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => runTickTarget(t.id)}>
                      <Clock className="h-4 w-4 mr-2" /> Tick agora
                    </Button>
                  </div>
                </div>

                {last && (
                  <div className="mt-3 grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
                    <div className="rounded-md bg-muted/40 p-2">
                      <p className="text-muted-foreground">Último tick</p>
                      <p className="font-mono">{new Date(last.ts_start).toLocaleString("pt-BR", { hour12: false })}</p>
                    </div>
                    <div className="rounded-md bg-muted/40 p-2">
                      <p className="text-muted-foreground">Duração</p>
                      <p className="font-mono">{last.duration_ms == null ? "-" : `${Math.round(last.duration_ms / 1000)}s`}</p>
                    </div>
                    <div className="rounded-md bg-muted/40 p-2">
                      <p className="text-muted-foreground">Panels</p>
                      <p className="font-mono">{fmtNum(last.panels_count)}</p>
                    </div>
                    <div className="rounded-md bg-muted/40 p-2">
                      <p className="text-muted-foreground">Entries</p>
                      <p className="font-mono">{fmtNum(last.entries_count)}</p>
                    </div>
                    <div className="rounded-md bg-muted/40 p-2">
                      <p className="text-muted-foreground">Branch</p>
                      <p className="font-mono truncate" title={last.branch || ""}>{last.branch || "-"}</p>
                    </div>
                  </div>
                )}

                {last?.status === "failed" && last.error_message && (
                  <p className="mt-2 text-xs text-destructive break-words">{last.error_message}</p>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Últimos ticks</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {ticks.slice(0, 50).map((t) => (
            <div key={t.id} className="flex items-center justify-between gap-3 text-xs border-b last:border-b-0 py-2">
              <div className="min-w-0">
                <p className="font-medium truncate">{tickTargetLabel(String(t.target_id))}</p>
                <p className="text-[11px] text-muted-foreground truncate">
                  {new Date(t.ts_start).toLocaleString("pt-BR", { hour12: false })} · {t.branch || "-"}
                </p>
                {t.status === "failed" && t.error_message && (
                  <p className="text-[11px] text-destructive truncate">{t.error_message}</p>
                )}
              </div>
              <div className="flex items-center gap-3 whitespace-nowrap">
                <Badge variant={t.status === "ok" ? "secondary" : t.status === "failed" ? "destructive" : "outline"}>
                  {t.status}
                </Badge>
                <span className="font-mono">{t.duration_ms == null ? "-" : `${Math.round(t.duration_ms / 1000)}s`}</span>
                <span className="font-mono">{fmtNum(t.panels_count)} panels</span>
                <span className="font-mono">{fmtNum(t.entries_count)} entries</span>
              </div>
            </div>
          ))}
          {ticks.length === 0 && <p className="text-sm text-muted-foreground">Sem ticks ainda.</p>}
        </CardContent>
      </Card>

      <Dialog open={bootstrapOpen} onOpenChange={setBootstrapOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Setup Device Auth (1x)</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-lg border p-3 text-xs text-muted-foreground">
              Cole aqui o <span className="font-mono">authorizationCode</span> gerado via Epic ID redirect.
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">authorizationCode</p>
              <Input value={authCode} onChange={(e) => setAuthCode(e.target.value)} placeholder="ex: 0797bc8d58794bc982a49db3248dae46" />
            </div>
            {bootstrapResult?.env && (
              <div className="rounded-lg border p-3 text-xs font-mono whitespace-pre-wrap">
                {`EPIC_OAUTH_CLIENT_ID=${bootstrapResult.env.EPIC_OAUTH_CLIENT_ID ?? ""}\n` +
                  `EPIC_OAUTH_CLIENT_SECRET=*** (use o valor ja configurado)\n` +
                  `EPIC_DEVICE_AUTH_ACCOUNT_ID=${bootstrapResult.env.EPIC_DEVICE_AUTH_ACCOUNT_ID ?? ""}\n` +
                  `EPIC_DEVICE_AUTH_DEVICE_ID=${bootstrapResult.env.EPIC_DEVICE_AUTH_DEVICE_ID ?? ""}\n` +
                  `EPIC_DEVICE_AUTH_SECRET=${bootstrapResult.env.EPIC_DEVICE_AUTH_SECRET ?? ""}`}
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            {bootstrapResult?.env && (
              <Button variant="outline" onClick={copyEnvBlock}>
                <Copy className="h-4 w-4 mr-2" /> Copiar env
              </Button>
            )}
            <Button onClick={runBootstrap}>Gerar Device Auth</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
