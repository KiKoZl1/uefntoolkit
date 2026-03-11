import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, Loader2, RefreshCw, PlayCircle, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DppiAdminHeader, fmtCompact, fmtDate } from "./shared";

export default function AdminDppiOverview() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [trainingDispatching, setTrainingDispatching] = useState(false);
  const [payload, setPayload] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    setError(null);

    const { data: authData, error: authError } = await supabase.auth.getSession();
    if (authError || !authData?.session?.access_token) {
      setError(authError?.message || "auth_session_not_ready");
      if (!opts?.silent) setLoading(false);
      return;
    }

    const { data, error } = await supabase.functions.invoke("dppi-health", {
      body: {},
      headers: {
        Authorization: `Bearer ${authData.session.access_token}`,
      },
    });
    if (error || data?.success === false) {
      setError(error?.message || data?.error || "failed_to_load_dppi_health");
      if (!opts?.silent) setLoading(false);
      return;
    }
    setPayload(data);
    if (!opts?.silent) setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const hasDocument = typeof document !== "undefined";
    const id = window.setInterval(() => {
      if (hasDocument && document.visibilityState !== "visible") return;
      void load({ silent: true });
    }, 60_000);
    const onVisibilityChange = () => {
      if (!hasDocument || document.visibilityState !== "visible") return;
      void load({ silent: true });
    };
    if (hasDocument) {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }
    return () => {
      window.clearInterval(id);
      if (hasDocument) {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
    };
  }, [load]);

  async function runRefreshBatch() {
    setRefreshing(true);
    await supabase.functions.invoke("dppi-refresh-batch", {
      body: {
        mode: "refresh",
        region: "NAE",
        surfaceName: "CreativeDiscoverySurface_Frontend",
        batchTargets: 8,
      },
    });
    await load();
    setRefreshing(false);
  }

  async function queueTraining(taskType: "entry" | "survival") {
    const readiness = payload?.training_readiness;
    if (readiness && readiness.ready === false) return;

    setTrainingDispatching(true);
    await supabase.functions.invoke("dppi-train-dispatch", {
      body: {
        taskType,
        modelName: `dppi_${taskType}`,
        region: "NAE",
        surfaceName: "CreativeDiscoverySurface_Frontend",
        minDays: 60,
      },
    });
    await load();
    setTrainingDispatching(false);
  }

  const overview = payload?.overview || {};
  const coverage = overview.coverage || {};
  const training = overview.training || {};
  const inference = overview.inference || {};
  const models = overview.models || {};
  const readiness = payload?.training_readiness || null;
  const workerLatest = payload?.worker_latest || null;

  const cards = useMemo(
    () => [
      { label: "Hourly rows (24h)", value: fmtCompact(coverage.hourly_rows_24h) },
      { label: "Daily rows (30d)", value: fmtCompact(coverage.daily_rows_30d) },
      { label: "Entry labels (7d)", value: fmtCompact(coverage.labels_entry_7d) },
      { label: "Survival labels (7d)", value: fmtCompact(coverage.labels_survival_7d) },
      { label: "Inference rows", value: fmtCompact(inference.rows_now) },
      { label: "Inference errors (24h)", value: fmtCompact(inference.errors_24h) },
      { label: "Registered models", value: fmtCompact(models.registered) },
      { label: "Production models", value: fmtCompact(models.production) },
    ],
    [coverage, inference, models],
  );

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-6 py-8">
      <DppiAdminHeader
        title="DPPI Command Center"
        subtitle="Monitoramento ponta a ponta do pipeline DPPI: coleta, treino, inferencia, calibracao e releases."
        right={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" className="gap-2" onClick={runRefreshBatch} disabled={refreshing || loading}>
              {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh batch
            </Button>
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => queueTraining("entry")}
              disabled={trainingDispatching || loading || (readiness && readiness.ready === false)}
            >
              {trainingDispatching ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />} Queue Entry Train
            </Button>
            <Button
              className="gap-2"
              onClick={() => queueTraining("survival")}
              disabled={trainingDispatching || loading || (readiness && readiness.ready === false)}
            >
              {trainingDispatching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Queue Survival Train
            </Button>
          </div>
        }
      />

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : null}

      {error ? (
        <Card className="border-destructive/40">
          <CardContent className="pt-6 text-sm text-destructive">{error}</CardContent>
        </Card>
      ) : null}

      {!loading && !error ? (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {cards.map((card) => (
              <Card key={card.label}>
                <CardContent className="pt-5">
                  <p className="text-xs text-muted-foreground">{card.label}</p>
                  <p className="mt-1 text-2xl font-semibold">{card.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Training health</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center justify-between"><span>Last status</span><Badge variant="outline">{String(training.last_status || "-")}</Badge></div>
                <div className="flex items-center justify-between"><span>Queued</span><span>{fmtCompact(training.queued)}</span></div>
                <div className="flex items-center justify-between"><span>Running</span><span>{fmtCompact(training.running)}</span></div>
                <div className="text-xs text-muted-foreground">Last request: {fmtDate(training.last_requested_at)}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Inference health</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center justify-between"><span>Rows now</span><span>{fmtCompact(inference.rows_now)}</span></div>
                <div className="flex items-center justify-between"><span>Errors 24h</span><span>{fmtCompact(inference.errors_24h)}</span></div>
                <div className="text-xs text-muted-foreground">Last generated: {fmtDate(inference.last_generated_at)}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Operations</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center justify-between"><span>As of</span><span>{fmtDate(payload?.as_of)}</span></div>
                <div className="flex items-center justify-between"><span>Cron jobs</span><span>{fmtCompact(payload?.cron_jobs?.length || 0)}</span></div>
                <div className="text-xs text-muted-foreground">Use as subrotas para detalhes de modelos, drift, calibracao e feedback.</div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Training readiness</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center justify-between"><span>Status</span><Badge variant={readiness?.ready ? "outline" : "destructive"}>{readiness?.ready ? "ready" : "blocked"}</Badge></div>
                <div className="flex items-center justify-between"><span>Coverage days</span><span>{fmtCompact(readiness?.coverage_days)}</span></div>
                <div className="flex items-center justify-between"><span>Required days</span><span>{fmtCompact(readiness?.required_days)}</span></div>
                <div className="text-xs text-muted-foreground">Reason: {String(readiness?.reason || "-")}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Worker status (Hetzner)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center justify-between"><span>Host</span><span>{String(workerLatest?.worker_host || "-")}</span></div>
                <div className="flex items-center justify-between"><span>CPU</span><span>{workerLatest?.cpu_pct != null ? `${Number(workerLatest.cpu_pct).toFixed(1)}%` : "-"}</span></div>
                <div className="flex items-center justify-between"><span>Memory</span><span>{workerLatest?.mem_pct != null ? `${Number(workerLatest.mem_pct).toFixed(1)}%` : "-"}</span></div>
                <div className="flex items-center justify-between"><span>Disk</span><span>{workerLatest?.disk_pct != null ? `${Number(workerLatest.disk_pct).toFixed(1)}%` : "-"}</span></div>
                <div className="flex items-center justify-between"><span>Queue depth</span><span>{fmtCompact(workerLatest?.queue_depth)}</span></div>
                <div className="text-xs text-muted-foreground">Last heartbeat: {fmtDate(workerLatest?.ts)}</div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2"><Activity className="h-4 w-4" /> Recent logs</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 lg:grid-cols-2">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Training</p>
                <div className="space-y-2">
                  {(payload?.training_recent || []).slice(0, 5).map((row: any) => (
                    <div key={`tr:${row.id}`} className="rounded-md border p-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{row.model_name}:{row.model_version}</span>
                        <Badge variant="outline">{row.status}</Badge>
                      </div>
                      <p className="mt-1 text-muted-foreground">{fmtDate(row.requested_at)} • {row.task_type}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Inference</p>
                <div className="space-y-2">
                  {(payload?.inference_recent || []).slice(0, 5).map((row: any, idx: number) => (
                    <div key={`inf:${row.ts || idx}`} className="rounded-md border p-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{row.mode || "-"}</span>
                        <span>{fmtCompact(row.processed_rows)} rows</span>
                      </div>
                      <p className="mt-1 text-muted-foreground">{fmtDate(row.ts)} • fail {fmtCompact(row.failed_rows)}</p>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
