import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, PlayCircle, RefreshCw, Trash2, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { TgisAdminHeader, fmtCompact, fmtDate } from "./shared";

export default function AdminTgisTraining() {
  const [loading, setLoading] = useState(true);
  const [dispatching, setDispatching] = useState(false);
  const [clusterId, setClusterId] = useState<string>("");
  const [stepsOverride, setStepsOverride] = useState<string>("2000");
  const [learningRateOverride, setLearningRateOverride] = useState<string>("0.0005");
  const [maxImagesOverride, setMaxImagesOverride] = useState<string>("");
  const [targetVersion, setTargetVersion] = useState<string>("");
  const [rowActingId, setRowActingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [clusters, setClusters] = useState<any[]>([]);
  const [clusterMeta, setClusterMeta] = useState<Record<string, { name: string; slug: string; family: string }>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [runsRes, clustersRes] = await Promise.all([
      (supabase as any)
        .from("tgis_training_runs")
        .select("id,cluster_id,status,run_mode,training_provider,fal_request_id,dataset_images_count,target_version,created_at,started_at,ended_at,error_text")
        .order("created_at", { ascending: false })
        .limit(200),
      (supabase as any)
        .from("tgis_cluster_registry")
        .select("cluster_id,cluster_name,cluster_slug,cluster_family")
        .order("cluster_id", { ascending: true }),
    ]);
    setRows(Array.isArray(runsRes.data) ? runsRes.data : []);
    const cRows = Array.isArray(clustersRes.data) ? clustersRes.data : [];
    setClusters(cRows);
    const meta: Record<string, { name: string; slug: string; family: string }> = {};
    for (const c of cRows) {
      meta[String(c.cluster_id)] = {
        name: String(c.cluster_name || ""),
        slug: String(c.cluster_slug || ""),
        family: String(c.cluster_family || ""),
      };
    }
    setClusterMeta(meta);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!clusterId && clusters.length > 0) {
      setClusterId(String(clusters[0].cluster_id));
    }
  }, [clusterId, clusters]);

  useEffect(() => {
    if (targetVersion.trim()) return;
    if (!clusterId) return;
    const d = new Date();
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    const hh = String(d.getUTCHours()).padStart(2, "0");
    const mm = String(d.getUTCMinutes()).padStart(2, "0");
    setTargetVersion(`v${y}${m}${day}_${hh}${mm}_c${clusterId}`);
  }, [clusterId, targetVersion]);

  async function queueRun(dryRun: boolean) {
    setDispatching(true);
    setError(null);
    const steps = stepsOverride.trim() || "2000";
    const lr = learningRateOverride.trim() || "0.0005";
    const maxImages = maxImagesOverride.trim();
    const { data, error } = await supabase.functions.invoke("tgis-admin-start-training", {
      body: {
        dryRun,
        runMode: dryRun ? "dry_run" : "manual",
        clusterId: Number(clusterId),
        stepsOverride: steps ? Number(steps) : undefined,
        learningRateOverride: lr ? Number(lr) : undefined,
        maxImagesOverride: maxImages ? Number(maxImages) : undefined,
        targetVersion: targetVersion.trim() || undefined,
      },
    });
    if (error || data?.success === false) {
      setError(error?.message || data?.error || "queue_failed");
    }
    await load();
    setDispatching(false);
  }

  async function cancelRun(runId: number) {
    if (!window.confirm(`Cancel run #${runId}?`)) return;
    setRowActingId(runId);
    setError(null);
    const { data, error } = await supabase.functions.invoke("tgis-admin-training-run-action", {
      body: { runId, action: "cancel" },
    });
    if (error || data?.success === false) {
      setError(error?.message || data?.error || "cancel_failed");
    }
    await load();
    setRowActingId(null);
  }

  async function deleteRun(runId: number) {
    if (!window.confirm(`Delete run #${runId}? This cannot be undone.`)) return;
    setRowActingId(runId);
    setError(null);
    const { data, error } = await supabase.functions.invoke("tgis-admin-training-run-action", {
      body: { runId, action: "delete" },
    });
    if (error || data?.success === false) {
      setError(error?.message || data?.error || "delete_failed");
    }
    await load();
    setRowActingId(null);
  }

  const stats = useMemo(() => {
    const queued = rows.filter((r) => r.status === "queued").length;
    const running = rows.filter((r) => r.status === "running").length;
    const success = rows.filter((r) => r.status === "success").length;
    const failed = rows.filter((r) => r.status === "failed").length;
    return { queued, running, success, failed };
  }, [rows]);

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-6 py-8">
      <TgisAdminHeader
        title="TGIS Training"
        subtitle="Fila de treino LoRA por cluster e status operacional do pipeline de treino."
        right={(
          <div className="flex flex-wrap items-center gap-2">
            <Select value={clusterId} onValueChange={setClusterId}>
              <SelectTrigger className="w-[210px]"><SelectValue placeholder="Target cluster" /></SelectTrigger>
              <SelectContent>
                {clusters.map((c) => (
                  <SelectItem key={`c:${c.cluster_id}`} value={String(c.cluster_id)}>
                    #{c.cluster_id} {c.cluster_name}{c.cluster_slug ? ` (${c.cluster_slug})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" className="gap-2" onClick={load} disabled={loading}>
              <RefreshCw className="h-4 w-4" />
              Reload
            </Button>
            <input
              className="w-28 rounded-md border border-border/60 bg-background px-2 py-1 text-xs"
              value={stepsOverride}
              onChange={(e) => setStepsOverride(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder="steps"
            />
            <input
              className="w-28 rounded-md border border-border/60 bg-background px-2 py-1 text-xs"
              value={learningRateOverride}
              onChange={(e) => setLearningRateOverride(e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="lr"
            />
            <input
              className="w-40 rounded-md border border-border/60 bg-background px-2 py-1 text-xs"
              value={targetVersion}
              onChange={(e) => setTargetVersion(e.target.value)}
              placeholder="target version"
            />
            <input
              className="w-32 rounded-md border border-border/60 bg-background px-2 py-1 text-xs"
              value={maxImagesOverride}
              onChange={(e) => setMaxImagesOverride(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder="max images"
            />
            <Button variant="outline" className="gap-2" onClick={() => queueRun(true)} disabled={dispatching || loading || !clusterId}>
              {dispatching ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
              Queue dry-run
            </Button>
            <Button className="gap-2" onClick={() => queueRun(false)} disabled={dispatching || loading || !clusterId}>
              {dispatching ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
              Queue training
            </Button>
          </div>
        )}
      />

      <div className="grid gap-3 md:grid-cols-4">
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Queued</p><p className="mt-1 text-2xl font-semibold">{fmtCompact(stats.queued)}</p></CardContent></Card>
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Running</p><p className="mt-1 text-2xl font-semibold">{fmtCompact(stats.running)}</p></CardContent></Card>
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Success</p><p className="mt-1 text-2xl font-semibold">{fmtCompact(stats.success)}</p></CardContent></Card>
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Failed</p><p className="mt-1 text-2xl font-semibold">{fmtCompact(stats.failed)}</p></CardContent></Card>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Training queue</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No training runs yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
                    <th className="px-2 py-2">ID</th>
                    <th className="px-2 py-2">Cluster</th>
                    <th className="px-2 py-2">Mode</th>
                    <th className="px-2 py-2">Provider</th>
                    <th className="px-2 py-2">Request</th>
                    <th className="px-2 py-2">Images</th>
                    <th className="px-2 py-2">Target version</th>
                    <th className="px-2 py-2">Status</th>
                    <th className="px-2 py-2">Created</th>
                    <th className="px-2 py-2">Started</th>
                    <th className="px-2 py-2">Ended</th>
                    <th className="px-2 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={`tr:${row.id}`} className="border-b border-border/30">
                      <td className="px-2 py-2">{row.id}</td>
                      <td className="px-2 py-2">
                        {row.cluster_id ?? "-"}
                        {row.cluster_id && clusterMeta[String(row.cluster_id)]?.slug ? (
                          <div className="text-[11px] text-muted-foreground">
                            {clusterMeta[String(row.cluster_id)]?.slug}
                            {clusterMeta[String(row.cluster_id)]?.family
                              ? ` (${clusterMeta[String(row.cluster_id)]?.family})`
                              : ""}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-2 py-2">{row.run_mode}</td>
                      <td className="px-2 py-2">{row.training_provider || "-"}</td>
                      <td className="px-2 py-2 text-xs">{row.fal_request_id || "-"}</td>
                      <td className="px-2 py-2">{row.dataset_images_count ?? "-"}</td>
                      <td className="px-2 py-2">{row.target_version || "-"}</td>
                      <td className="px-2 py-2"><Badge variant="outline">{row.status}</Badge></td>
                      <td className="px-2 py-2">{fmtDate(row.created_at)}</td>
                      <td className="px-2 py-2">{fmtDate(row.started_at)}</td>
                      <td className="px-2 py-2">{fmtDate(row.ended_at)}</td>
                      <td className="px-2 py-2">
                        <div className="flex flex-wrap gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2"
                            onClick={() => cancelRun(Number(row.id))}
                            disabled={rowActingId === Number(row.id) || !["queued", "running"].includes(String(row.status || ""))}
                          >
                            {rowActingId === Number(row.id) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
                            <span className="ml-1">Cancel</span>
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            className="h-7 px-2"
                            onClick={() => deleteRun(Number(row.id))}
                            disabled={rowActingId === Number(row.id) || String(row.status || "") === "running"}
                          >
                            {rowActingId === Number(row.id) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                            <span className="ml-1">Delete</span>
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
