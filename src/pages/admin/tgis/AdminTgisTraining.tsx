import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, PlayCircle, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TgisAdminHeader, fmtCompact, fmtDate } from "./shared";

export default function AdminTgisTraining() {
  const [loading, setLoading] = useState(true);
  const [dispatching, setDispatching] = useState(false);
  const [clusterId, setClusterId] = useState<string>("all");
  const [rows, setRows] = useState<any[]>([]);
  const [clusters, setClusters] = useState<any[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const [runsRes, clustersRes] = await Promise.all([
      (supabase as any)
        .from("tgis_training_runs")
        .select("id,cluster_id,status,run_mode,target_version,created_at,started_at,ended_at,error_text")
        .order("created_at", { ascending: false })
        .limit(200),
      (supabase as any)
        .from("tgis_cluster_registry")
        .select("cluster_id,cluster_name")
        .order("cluster_id", { ascending: true }),
    ]);
    setRows(Array.isArray(runsRes.data) ? runsRes.data : []);
    setClusters(Array.isArray(clustersRes.data) ? clustersRes.data : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function queueRun(dryRun: boolean) {
    setDispatching(true);
    await supabase.functions.invoke("tgis-admin-start-training", {
      body: {
        dryRun,
        runMode: dryRun ? "dry_run" : "manual",
        clusterId: clusterId === "all" ? null : Number(clusterId),
      },
    });
    await load();
    setDispatching(false);
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
                <SelectItem value="all">All clusters</SelectItem>
                {clusters.map((c) => (
                  <SelectItem key={`c:${c.cluster_id}`} value={String(c.cluster_id)}>#{c.cluster_id} {c.cluster_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" className="gap-2" onClick={load} disabled={loading}>
              <RefreshCw className="h-4 w-4" />
              Reload
            </Button>
            <Button variant="outline" className="gap-2" onClick={() => queueRun(true)} disabled={dispatching || loading}>
              {dispatching ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
              Queue dry-run
            </Button>
            <Button className="gap-2" onClick={() => queueRun(false)} disabled={dispatching || loading}>
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
                    <th className="px-2 py-2">Target version</th>
                    <th className="px-2 py-2">Status</th>
                    <th className="px-2 py-2">Created</th>
                    <th className="px-2 py-2">Started</th>
                    <th className="px-2 py-2">Ended</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={`tr:${row.id}`} className="border-b border-border/30">
                      <td className="px-2 py-2">{row.id}</td>
                      <td className="px-2 py-2">{row.cluster_id ?? "all"}</td>
                      <td className="px-2 py-2">{row.run_mode}</td>
                      <td className="px-2 py-2">{row.target_version || "-"}</td>
                      <td className="px-2 py-2"><Badge variant="outline">{row.status}</Badge></td>
                      <td className="px-2 py-2">{fmtDate(row.created_at)}</td>
                      <td className="px-2 py-2">{fmtDate(row.started_at)}</td>
                      <td className="px-2 py-2">{fmtDate(row.ended_at)}</td>
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
