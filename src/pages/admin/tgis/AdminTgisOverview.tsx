import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, RefreshCw, DatabaseZap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { TgisAdminHeader, fmtCompact, fmtDate } from "./shared";

export default function AdminTgisOverview() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [payload, setPayload] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const hasLoadedRef = useRef(false);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = Boolean(opts?.silent && hasLoadedRef.current);
    if (!silent) setLoading(true);
    const { data, error } = await supabase.functions.invoke("tgis-health", { body: {} });
    if (error || data?.success === false) {
      setError(error?.message || data?.error || "failed_to_load_tgis_health");
      if (!silent) setLoading(false);
      return;
    }
    setError(null);
    setPayload(data || {});
    hasLoadedRef.current = true;
    if (!silent) setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load({ silent: true }), 30_000);
    return () => window.clearInterval(id);
  }, [load]);

  async function runDatasetRefresh() {
    setRefreshing(true);
    await supabase.functions.invoke("tgis-admin-refresh-dataset", { body: {} });
    await load();
    setRefreshing(false);
  }

  const ov = payload?.overview || {};
  const cards = useMemo(
    () => [
      { label: "Generations (24h)", value: fmtCompact(ov.generations_24h) },
      { label: "Errors (24h)", value: fmtCompact(ov.errors_24h) },
      { label: "Error rate (24h)", value: `${(Number(ov.error_rate_24h || 0) * 100).toFixed(1)}%` },
      { label: "Avg latency (24h)", value: `${fmtCompact(ov.avg_latency_ms_24h)}ms` },
      { label: "P95 latency (24h)", value: `${fmtCompact(ov.p95_latency_ms_24h)}ms` },
      { label: "Cost today", value: `$${Number(ov.cost_today_usd || 0).toFixed(4)}` },
      { label: "Clusters active", value: `${fmtCompact(ov.clusters_active)} / ${fmtCompact(ov.clusters_total)}` },
      { label: "Active models", value: fmtCompact(ov.active_models) },
      { label: "Training running", value: fmtCompact(ov.training_running) },
      { label: "Training queued", value: fmtCompact(ov.training_queued) },
      { label: "Taxonomy rules", value: fmtCompact(ov.taxonomy_rules_active) },
    ],
    [ov],
  );
  const latestClustering = useMemo(() => {
    const rows = Array.isArray(payload?.dataset_recent) ? payload.dataset_recent : [];
    return rows.find((r: any) => String(r?.run_type || "") === "clustering") || null;
  }, [payload?.dataset_recent]);
  const latestClusteringSummary = latestClustering?.summary_json || {};
  const workerLatest = payload?.worker_latest || null;
  const workerTs = workerLatest?.ts ? new Date(workerLatest.ts).getTime() : 0;
  const workerAgeSec = workerTs > 0 ? Math.max(0, Math.floor((Date.now() - workerTs) / 1000)) : null;
  const workerHealthy = workerAgeSec != null && workerAgeSec <= 120;

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-6 py-8">
      <TgisAdminHeader
        title={t("adminTgis.title")}
        subtitle={t("adminTgis.subtitle")}
        right={(
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="gap-2" onClick={runDatasetRefresh} disabled={loading || refreshing}>
              {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <DatabaseZap className="h-4 w-4" />}
              Refresh dataset
            </Button>
            <Button variant="outline" className="gap-2" onClick={() => void load()} disabled={loading}>
              <RefreshCw className="h-4 w-4" />
              Reload
            </Button>
          </div>
        )}
      />

      {loading ? (
        <div className="flex justify-center py-14">
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
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-8">
            {cards.map((c) => (
              <Card key={c.label}>
                <CardContent className="pt-5">
                  <p className="text-xs text-muted-foreground">{c.label}</p>
                  <p className="mt-1 text-2xl font-semibold">{c.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Runtime config</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center justify-between"><span>Beta closed</span><Badge variant="outline">{payload?.runtime_config?.beta_closed ? "true" : "false"}</Badge></div>
                <div className="flex items-center justify-between"><span>Training enabled</span><Badge variant="outline">{payload?.runtime_config?.training_enabled ? "true" : "false"}</Badge></div>
                <div className="flex items-center justify-between"><span>User quota/day</span><span>{fmtCompact(payload?.runtime_config?.max_generations_per_user_per_day)}</span></div>
                <div className="flex items-center justify-between"><span>Global budget/day</span><span>${Number(payload?.runtime_config?.global_daily_budget_usd || 0).toFixed(2)}</span></div>
                <div className="flex items-center justify-between"><span>Generate provider</span><span>{String(payload?.runtime_config?.generate_provider || "-")}</span></div>
                <div className="flex items-center justify-between"><span>Nano model</span><span>{String(payload?.runtime_config?.nano_model || "-")}</span></div>
                <div className="flex items-center justify-between"><span>Context boost default</span><span>{String(Boolean(payload?.runtime_config?.context_boost_default))}</span></div>
                <div className="flex items-center justify-between"><span>Max refs total</span><span>{fmtCompact(payload?.runtime_config?.max_total_refs)}</span></div>
                <div className="flex items-center justify-between"><span>Max skin refs</span><span>{fmtCompact(payload?.runtime_config?.max_skin_refs)}</span></div>
                <p className="pt-2 text-xs text-muted-foreground">Cluster families</p>
                {Object.entries(payload?.cluster_family_distribution || {}).map(([k, v]) => (
                  <div key={`fam:${k}`} className="flex items-center justify-between text-xs">
                    <span>{k}</span>
                    <span>{fmtCompact(Number(v || 0))}</span>
                  </div>
                ))}
                <p className="pt-2 text-xs text-muted-foreground">Provider model (24h)</p>
                {Object.entries(payload?.provider_model_distribution_24h || {}).map(([k, v]) => (
                  <div key={`mdl:${k}`} className="flex items-center justify-between text-xs">
                    <span>{k}</span>
                    <span>{fmtCompact(Number(v || 0))}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between text-xs">
                  <span>Context boost ON/OFF (24h)</span>
                  <span>{fmtCompact(payload?.context_boost_24h?.on || 0)}/{fmtCompact(payload?.context_boost_24h?.off || 0)}</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Recent status</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p className="text-xs text-muted-foreground">Dataset runs</p>
                {(payload?.dataset_recent || []).slice(0, 4).map((row: any) => (
                  <div key={`d:${row.id}`} className="rounded-md border p-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{row.run_type}</span>
                      <Badge variant="outline">{row.status}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{fmtDate(row.created_at)}</p>
                  </div>
                ))}
                <p className="pt-2 text-xs text-muted-foreground">Training runs</p>
                {(payload?.training_recent || []).slice(0, 4).map((row: any) => (
                  <div key={`t:${row.id}`} className="rounded-md border p-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">cluster {row.cluster_id ?? "all"}</span>
                      <Badge variant="outline">{row.status}</Badge>
                    </div>
                    {row.provider_status ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {row.provider_status} {row.progress_pct != null ? `- ${Number(row.progress_pct).toFixed(1)}%` : ""}
                      </p>
                    ) : null}
                    <p className="mt-1 text-xs text-muted-foreground">{fmtDate(row.created_at)}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Recluster audit (latest)</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm md:grid-cols-4">
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">Rows</p>
                <p className="mt-1 text-lg font-semibold">{fmtCompact(latestClusteringSummary?.rows_total || 0)}</p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">Clusters</p>
                <p className="mt-1 text-lg font-semibold">{fmtCompact(latestClusteringSummary?.clusters_total || 0)}</p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">Purity</p>
                <p className="mt-1 text-lg font-semibold">
                  {latestClusteringSummary?.global_weighted_purity != null
                    ? `${(Number(latestClusteringSummary.global_weighted_purity) * 100).toFixed(1)}%`
                    : "-"}
                </p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">Misc rate</p>
                <p className="mt-1 text-lg font-semibold">
                  {latestClusteringSummary?.misc_rate != null
                    ? `${(Number(latestClusteringSummary.misc_rate) * 100).toFixed(1)}%`
                    : "-"}
                </p>
              </div>
              <p className="text-xs text-muted-foreground md:col-span-4">
                Last clustering run: {latestClustering ? fmtDate(latestClustering.created_at) : "-"}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Local worker</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span>Status</span>
                <Badge variant="outline">{workerHealthy ? "online" : "offline/stale"}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span>Host</span>
                <span>{workerLatest?.worker_host || "-"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Last heartbeat</span>
                <span>{fmtDate(workerLatest?.ts)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Age</span>
                <span>{workerAgeSec != null ? `${Math.floor(workerAgeSec / 60)}m ${workerAgeSec % 60}s` : "-"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Queue depth</span>
                <span>{Number(workerLatest?.queue_depth || 0)}</span>
              </div>
              {!workerHealthy ? (
                <p className="text-xs text-muted-foreground">
                  Start worker locally with `powershell -ExecutionPolicy Bypass -File ml/tgis/deploy/start_local_worker.ps1`
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Live training progress</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(payload?.training_running || []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No running training jobs.</p>
              ) : (
                (payload?.training_running || []).map((row: any) => {
                  const pct = Math.max(0, Math.min(100, Number(row.progress_pct || 0)));
                  const etaSec = Number(row.eta_seconds || 0);
                  const etaMin = etaSec > 0 ? Math.ceil(etaSec / 60) : 0;
                  return (
                    <div key={`live:${row.id}`} className="rounded-md border border-border/60 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium">
                          Run #{row.id} - cluster {row.cluster_id ?? "all"} - {row.target_version || "-"}
                        </p>
                        <Badge variant="outline">{row.provider_status || row.status}</Badge>
                      </div>
                      <div className="mt-2">
                        <Progress value={pct} className="h-2.5" />
                      </div>
                      <div className="mt-2 grid gap-2 text-xs text-muted-foreground md:grid-cols-5">
                        <span>Progress: {pct.toFixed(1)}%</span>
                        <span>ETA: {etaMin > 0 ? `${etaMin} min` : "-"}</span>
                        <span>Elapsed: {row.elapsed_seconds ? `${Math.floor(Number(row.elapsed_seconds) / 60)} min` : "-"}</span>
                        <span>Cost est.: ${Number(row.estimated_cost_usd || 0).toFixed(4)}</span>
                        <span>Polled: {fmtDate(row.status_polled_at)}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
