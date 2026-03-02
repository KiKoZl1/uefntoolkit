import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TgisAdminHeader, fmtCompact, fmtDate } from "./shared";

export default function AdminTgisInference() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<any[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await (supabase as any)
      .from("tgis_generation_log")
      .select("id,user_id,category,cluster_id,lora_version,status,variants,latency_ms,cost_usd,provider,model_name,created_at,error_text")
      .order("created_at", { ascending: false })
      .limit(300);
    setRows(Array.isArray(data) ? data : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    const success = rows.filter((r) => r.status === "success").length;
    const failed = rows.filter((r) => r.status === "failed").length;
    const blocked = rows.filter((r) => r.status === "blocked").length;
    const avgLatency = rows.filter((r) => Number(r.latency_ms) > 0).reduce((sum, r, _, arr) => sum + Number(r.latency_ms || 0) / Math.max(1, arr.length), 0);
    const totalCost = rows.reduce((sum, r) => sum + Number(r.cost_usd || 0), 0);
    return { success, failed, blocked, avgLatency, totalCost };
  }, [rows]);

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-6 py-8">
      <TgisAdminHeader
        title="TGIS Inference"
        subtitle="Runtime de geracao: latencia, taxa de erro, status por chamada e rastreabilidade."
        right={<Button variant="outline" className="gap-2" onClick={load} disabled={loading}><RefreshCw className="h-4 w-4" />Reload</Button>}
      />

      <div className="grid gap-3 md:grid-cols-5">
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Success</p><p className="mt-1 text-2xl font-semibold">{fmtCompact(stats.success)}</p></CardContent></Card>
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Failed</p><p className="mt-1 text-2xl font-semibold">{fmtCompact(stats.failed)}</p></CardContent></Card>
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Blocked</p><p className="mt-1 text-2xl font-semibold">{fmtCompact(stats.blocked)}</p></CardContent></Card>
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Avg latency</p><p className="mt-1 text-2xl font-semibold">{Math.round(stats.avgLatency)}ms</p></CardContent></Card>
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Total cost (sample)</p><p className="mt-1 text-2xl font-semibold">${stats.totalCost.toFixed(4)}</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Generation log</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No generation entries yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
                    <th className="px-2 py-2">Created</th>
                    <th className="px-2 py-2">Status</th>
                    <th className="px-2 py-2">Category</th>
                    <th className="px-2 py-2">Cluster</th>
                    <th className="px-2 py-2">Variants</th>
                    <th className="px-2 py-2">Latency</th>
                    <th className="px-2 py-2">Cost</th>
                    <th className="px-2 py-2">Model</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={`g:${row.id}`} className="border-b border-border/30">
                      <td className="px-2 py-2">{fmtDate(row.created_at)}</td>
                      <td className="px-2 py-2"><Badge variant="outline">{row.status}</Badge></td>
                      <td className="px-2 py-2">{row.category}</td>
                      <td className="px-2 py-2">{row.cluster_id ?? "-"}</td>
                      <td className="px-2 py-2">{row.variants}</td>
                      <td className="px-2 py-2">{row.latency_ms ? `${row.latency_ms}ms` : "-"}</td>
                      <td className="px-2 py-2">${Number(row.cost_usd || 0).toFixed(4)}</td>
                      <td className="px-2 py-2 text-xs">{row.provider}/{row.model_name}</td>
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
