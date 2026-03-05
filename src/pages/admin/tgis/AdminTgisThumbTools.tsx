import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TgisAdminHeader, fmtCompact, fmtDate } from "./shared";

type ToolRunRow = {
  id: number;
  asset_id: string | null;
  user_id: string;
  tool_name: string;
  mode: string | null;
  status: string;
  provider: string;
  provider_model: string | null;
  latency_ms: number | null;
  cost_usd: number | null;
  error_text: string | null;
  input_json: Record<string, unknown>;
  output_json: Record<string, unknown>;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
};

export default function AdminTgisThumbTools() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<ToolRunRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await (supabase as any)
      .from("tgis_thumb_tool_runs")
      .select("id,asset_id,user_id,tool_name,mode,status,provider,provider_model,latency_ms,cost_usd,error_text,input_json,output_json,created_at,started_at,ended_at")
      .order("created_at", { ascending: false })
      .limit(200);
    setRows((Array.isArray(data) ? data : []) as ToolRunRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    const success = rows.filter((r) => r.status === "success").length;
    const failed = rows.filter((r) => r.status === "failed").length;
    const running = rows.filter((r) => r.status === "running").length;
    const latencyRows = rows.filter((r) => Number(r.latency_ms) > 0);
    const avgLatency = latencyRows.length ? latencyRows.reduce((sum, r) => sum + Number(r.latency_ms || 0), 0) / latencyRows.length : 0;
    const totalCost = rows.reduce((sum, r) => sum + Number(r.cost_usd || 0), 0);
    return { success, failed, running, avgLatency, totalCost };
  }, [rows]);

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-6 py-8">
      <TgisAdminHeader
        title="TGIS Thumb Tools"
        subtitle="Observabilidade de runs das tools: generate, edit studio, camera control e layer decomposition."
        right={
          <Button variant="outline" className="gap-2" onClick={load} disabled={loading}>
            <RefreshCw className="h-4 w-4" />
            Reload
          </Button>
        }
      />

      <div className="grid gap-3 md:grid-cols-5">
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Success</p><p className="mt-1 text-2xl font-semibold">{fmtCompact(stats.success)}</p></CardContent></Card>
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Failed</p><p className="mt-1 text-2xl font-semibold">{fmtCompact(stats.failed)}</p></CardContent></Card>
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Running</p><p className="mt-1 text-2xl font-semibold">{fmtCompact(stats.running)}</p></CardContent></Card>
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Avg latency</p><p className="mt-1 text-2xl font-semibold">{Math.round(stats.avgLatency)}ms</p></CardContent></Card>
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Total cost</p><p className="mt-1 text-2xl font-semibold">${stats.totalCost.toFixed(4)}</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Runs</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No thumb-tool runs yet.</p>
          ) : (
            <div className="space-y-4">
              {rows.map((row) => (
                <div key={row.id} className="rounded-lg border border-border/60 p-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>{fmtDate(row.created_at)}</span>
                    <Badge variant="outline">{row.status}</Badge>
                    <span>tool: {row.tool_name}</span>
                    <span>mode: {row.mode || "-"}</span>
                    <span>latency: {row.latency_ms ? `${row.latency_ms}ms` : "-"}</span>
                    <span>cost: ${Number(row.cost_usd || 0).toFixed(4)}</span>
                    <span>model: {row.provider_model || "-"}</span>
                    <span>asset: {row.asset_id || "-"}</span>
                  </div>
                  {row.error_text ? (
                    <p className="mt-2 text-xs text-destructive">{row.error_text}</p>
                  ) : null}
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-primary">input_json / output_json</summary>
                    <div className="mt-2 grid gap-2 md:grid-cols-2">
                      <pre className="max-h-52 overflow-auto whitespace-pre-wrap rounded border border-border/60 bg-card/40 p-2 text-[11px]">
                        {JSON.stringify(row.input_json || {}, null, 2)}
                      </pre>
                      <pre className="max-h-52 overflow-auto whitespace-pre-wrap rounded border border-border/60 bg-card/40 p-2 text-[11px]">
                        {JSON.stringify(row.output_json || {}, null, 2)}
                      </pre>
                    </div>
                  </details>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
