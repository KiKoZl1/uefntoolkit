import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { RefreshCcw, Wrench, AlertTriangle, CheckCircle2, Clock, ListChecks, PauseCircle, PlayCircle, KeyRound, Copy } from "lucide-react";
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

function fmtAgo(iso: string | null | undefined): string {
  if (!iso) return "-";
  const ms = Date.now() - new Date(iso).getTime();
  if (!isFinite(ms) || ms < 0) return "-";
  const m = Math.floor(ms / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
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

export default function AdminExposureHealth() {
  const { toast } = useToast();
  const sb: any = supabase; // tables not in generated types yet

  const [loading, setLoading] = useState(true);
  const [targets, setTargets] = useState<TargetRow[]>([]);
  const [ticks, setTicks] = useState<TickRow[]>([]);
  const [maintenance, setMaintenance] = useState<any>(null);
  const [configStatus, setConfigStatus] = useState<{ epicOauthClient: boolean; epicDeviceAuth: boolean } | null>(null);
  const [bootstrapOpen, setBootstrapOpen] = useState(false);
  const [authCode, setAuthCode] = useState("");
  const [bootstrapResult, setBootstrapResult] = useState<any>(null);

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

  useEffect(() => {
    fetchState();
    const timer = setInterval(fetchState, 10000);
    return () => clearInterval(timer);
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
    fetchState();
  };

  const setPaused = async (paused: boolean) => {
    const { error, data } = await supabase.functions.invoke("discover-exposure-collector", { body: { mode: "set_paused", paused } });
    if (error || data?.success === false) {
      toast({ title: paused ? "Pause falhou" : "Start falhou", description: error?.message || data?.error || "erro", variant: "destructive" });
      return;
    }
    toast({ title: paused ? "Sistema pausado" : "Sistema iniciado", description: paused ? "Targets foram congelados." : "Targets reativados." });
    fetchState();
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
    fetchState();
  };

  const runMaintenance = async () => {
    const { error, data } = await supabase.functions.invoke("discover-exposure-collector", { body: { mode: "maintenance" } });
    if (error) {
      toast({ title: "Maintenance falhou", description: error.message, variant: "destructive" });
      return;
    }
    setMaintenance(data?.maintenance || data || null);
    toast({ title: "Maintenance", description: "Executado." });
    fetchState();
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

  const copySecretsHint = async () => {
    const hint = [
      "Cole estes secrets nas Edge Functions:",
      "- discover-exposure-collector",
      "- discover-exposure-report",
      "",
      "E depois clique Start na tela Exposure.",
    ].join("\n");
    await navigator.clipboard.writeText(hint);
    toast({ title: "Copiado", description: "Instrucoes copiadas." });
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl font-bold">Exposure Health</h1>
          <p className="text-sm text-muted-foreground">
            Status do coletor 24/7 (targets, ticks, falhas e cadência).
          </p>
          {configStatus && (
            <p className="text-xs text-muted-foreground mt-2">
              Config: OAuth {configStatus.epicOauthClient ? "OK" : "FALTA"} · DeviceAuth {configStatus.epicDeviceAuth ? "OK" : "FALTA"}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleStart}>
            <PlayCircle className="h-4 w-4 mr-2" /> Start
          </Button>
          <Button variant="outline" onClick={() => setPaused(true)}>
            <PauseCircle className="h-4 w-4 mr-2" /> Pause
          </Button>
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

      <div className="grid md:grid-cols-4 gap-3">
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
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Avg Duration (OK)</CardTitle></CardHeader>
          <CardContent className="text-2xl font-display font-bold">
            {overall.avgDur == null ? "-" : `${Math.round(overall.avgDur / 1000)}s`}
          </CardContent>
        </Card>
      </div>

      {maintenance && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Última Maintenance (resultado)</CardTitle></CardHeader>
          <CardContent className="text-xs font-mono whitespace-pre-wrap">
            {JSON.stringify(maintenance, null, 2)}
          </CardContent>
        </Card>
      )}

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
              Cole aqui o <span className="font-mono">authorizationCode</span> gerado via Epic ID redirect. Isso cria um <span className="font-mono">deviceAuth</span>.
              Não compartilhe com terceiros.
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
            <Button variant="outline" onClick={copySecretsHint}>
              <Copy className="h-4 w-4 mr-2" /> Copiar passos
            </Button>
            <Button onClick={runBootstrap}>Gerar Device Auth</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-primary" />
            Targets
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading && <p className="text-sm text-muted-foreground">Carregando...</p>}
          {!loading && targets.length === 0 && <p className="text-sm text-muted-foreground">Nenhum target encontrado.</p>}
          {targets.map((t) => {
            const list = ticksByTarget.get(t.id) || [];
            const last = list[0] || null;
            const ok = last?.status === "ok";
            const badge = ok ? (
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
                      next_due {fmtAgo(t.next_due_at)} · last_ok {fmtAgo(t.last_ok_tick_at)} · last_failed {fmtAgo(t.last_failed_tick_at)}
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
    </div>
  );
}
