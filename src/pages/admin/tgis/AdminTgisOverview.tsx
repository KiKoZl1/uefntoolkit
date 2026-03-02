import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, DatabaseZap, PlayCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TgisAdminHeader, fmtCompact, fmtDate } from "./shared";

export default function AdminTgisOverview() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [runningTrain, setRunningTrain] = useState(false);
  const [payload, setPayload] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase.functions.invoke("tgis-health", { body: {} });
    if (error || data?.success === false) {
      setError(error?.message || data?.error || "failed_to_load_tgis_health");
      setLoading(false);
      return;
    }
    setPayload(data || {});
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(id);
  }, [load]);

  async function runDatasetRefresh() {
    setRefreshing(true);
    await supabase.functions.invoke("tgis-admin-refresh-dataset", { body: {} });
    await load();
    setRefreshing(false);
  }

  async function queueTraining() {
    setRunningTrain(true);
    await supabase.functions.invoke("tgis-admin-start-training", { body: { runMode: "manual", dryRun: true } });
    await load();
    setRunningTrain(false);
  }

  const ov = payload?.overview || {};
  const cards = useMemo(
    () => [
      { label: "Generations (24h)", value: fmtCompact(ov.generations_24h) },
      { label: "Errors (24h)", value: fmtCompact(ov.errors_24h) },
      { label: "Cost today", value: `$${Number(ov.cost_today_usd || 0).toFixed(4)}` },
      { label: "Clusters active", value: `${fmtCompact(ov.clusters_active)} / ${fmtCompact(ov.clusters_total)}` },
      { label: "Active models", value: fmtCompact(ov.active_models) },
    ],
    [ov],
  );

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
            <Button className="gap-2" onClick={queueTraining} disabled={loading || runningTrain}>
              {runningTrain ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
              Queue dry-run train
            </Button>
            <Button variant="outline" className="gap-2" onClick={load} disabled={loading}>
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
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
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
                <div className="flex items-center justify-between"><span>OpenRouter model</span><span>{String(payload?.runtime_config?.openrouter_model || "-")}</span></div>
                <div className="flex items-center justify-between"><span>FAL model</span><span>{String(payload?.runtime_config?.fal_model || "-")}</span></div>
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
                    <p className="mt-1 text-xs text-muted-foreground">{fmtDate(row.created_at)}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}
