import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, DatabaseZap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TgisAdminHeader, fmtCompact, fmtDate } from "./shared";

export default function AdminTgisDataset() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [rows, setRows] = useState<any[]>([]);
  const [candidates, setCandidates] = useState<any[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const [runsRes, candidateRes] = await Promise.all([
      (supabase as any)
        .from("tgis_dataset_runs")
        .select("id,run_type,status,created_at,started_at,ended_at,summary_json,error_text")
        .order("created_at", { ascending: false })
        .limit(100),
      (supabase as any).rpc("get_tgis_training_candidates", { p_min_score: 0.45, p_limit: 30 }),
    ]);
    setRows(Array.isArray(runsRes.data) ? runsRes.data : []);
    setCandidates(Array.isArray(candidateRes.data) ? candidateRes.data : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function runRefresh() {
    setRefreshing(true);
    await supabase.functions.invoke("tgis-admin-refresh-dataset", { body: {} });
    await load();
    setRefreshing(false);
  }

  const summary = useMemo(() => {
    const success = rows.filter((x) => x.status === "success").length;
    const failed = rows.filter((x) => x.status === "failed").length;
    return { success, failed, total: rows.length };
  }, [rows]);

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-6 py-8">
      <TgisAdminHeader
        title="TGIS Dataset"
        subtitle="Execucoes de pipeline de dataset, score e candidatos para treino."
        right={(
          <div className="flex gap-2">
            <Button variant="outline" className="gap-2" onClick={load} disabled={loading}>
              <RefreshCw className="h-4 w-4" />
              Reload
            </Button>
            <Button className="gap-2" onClick={runRefresh} disabled={refreshing || loading}>
              {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <DatabaseZap className="h-4 w-4" />}
              Run refresh
            </Button>
          </div>
        )}
      />

      <div className="grid gap-3 md:grid-cols-4">
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Runs</p><p className="mt-1 text-2xl font-semibold">{fmtCompact(summary.total)}</p></CardContent></Card>
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Success</p><p className="mt-1 text-2xl font-semibold">{fmtCompact(summary.success)}</p></CardContent></Card>
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Failed</p><p className="mt-1 text-2xl font-semibold">{fmtCompact(summary.failed)}</p></CardContent></Card>
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Candidates (sample)</p><p className="mt-1 text-2xl font-semibold">{fmtCompact(candidates.length)}</p></CardContent></Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Recent dataset runs</CardTitle></CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex justify-center py-10"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>
            ) : rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No runs yet.</p>
            ) : (
              <div className="space-y-2">
                {rows.slice(0, 20).map((row) => (
                  <div key={`r:${row.id}`} className="rounded-md border p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium">{row.run_type}</p>
                      <Badge variant="outline">{row.status}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{fmtDate(row.created_at)}</p>
                    {row.error_text ? <p className="mt-1 text-xs text-destructive">{row.error_text}</p> : null}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Top training candidates (score)</CardTitle></CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex justify-center py-10"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>
            ) : candidates.length === 0 ? (
              <p className="text-sm text-muted-foreground">No candidates returned.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
                      <th className="px-2 py-2">Island</th>
                      <th className="px-2 py-2">Tag</th>
                      <th className="px-2 py-2">Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {candidates.slice(0, 20).map((row: any, idx: number) => (
                      <tr key={`cand:${row.link_code}:${idx}`} className="border-b border-border/30">
                        <td className="px-2 py-2 text-xs">{row.link_code}</td>
                        <td className="px-2 py-2">{row.tag_group}</td>
                        <td className="px-2 py-2 font-medium">{Number(row.quality_score || 0).toFixed(4)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
