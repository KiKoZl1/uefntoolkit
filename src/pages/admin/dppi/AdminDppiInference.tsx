import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DppiAdminHeader, fmtCompact, fmtDate } from "./shared";
import { dataSelect } from "@/lib/discoverDataApi";

export default function AdminDppiInference() {
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [logs, setLogs] = useState<any[]>([]);
  const [oppsCount, setOppsCount] = useState<number>(0);

  const load = useCallback(async () => {
    setLoading(true);
    const [logsRes, oppsRes] = await Promise.all([
      dataSelect<any[]>({
        table: "dppi_inference_log",
        columns: "ts,mode,processed_rows,failed_rows,latency_ms,model_name,model_version,error_text",
        order: [{ column: "ts", ascending: false }],
        limit: 100,
      }),
      dataSelect<any[]>({
        table: "dppi_opportunities",
        columns: "id",
        head: true,
        count: "exact",
      }),
    ]);

    setLogs(Array.isArray(logsRes.data) ? logsRes.data : []);
    setOppsCount(Number(oppsRes.count || 0));
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function runBatchNow() {
    setTriggering(true);
    await supabase.functions.invoke("dppi-refresh-batch", {
      body: {
        mode: "refresh",
        region: "NAE",
        surfaceName: "CreativeDiscoverySurface_Frontend",
        batchTargets: 8,
      },
    });
    await load();
    setTriggering(false);
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-6 py-8">
      <DppiAdminHeader
        title="DPPI Inference"
        subtitle="Execução batch de inferência e materialização de oportunidades por painel."
        right={
          <Button className="gap-2" onClick={runBatchNow} disabled={triggering}>
            {triggering ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Run inference batch
          </Button>
        }
      />

      <div className="grid gap-3 md:grid-cols-3">
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Opportunity rows</p><p className="text-2xl font-semibold">{fmtCompact(oppsCount)}</p></CardContent></Card>
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Recent runs</p><p className="text-2xl font-semibold">{fmtCompact(logs.length)}</p></CardContent></Card>
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Failures (recent)</p><p className="text-2xl font-semibold">{fmtCompact(logs.reduce((s, r) => s + Number(r.failed_rows || 0), 0))}</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Inference log</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>
          ) : logs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem logs de inferência.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
                    <th className="px-2 py-2">Timestamp</th>
                    <th className="px-2 py-2">Mode</th>
                    <th className="px-2 py-2">Processed</th>
                    <th className="px-2 py-2">Failed</th>
                    <th className="px-2 py-2">Latency (ms)</th>
                    <th className="px-2 py-2">Model</th>
                    <th className="px-2 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((row, idx) => (
                    <tr key={`${row.ts || idx}`} className="border-b border-border/30">
                      <td className="px-2 py-2">{fmtDate(row.ts)}</td>
                      <td className="px-2 py-2">{row.mode || "-"}</td>
                      <td className="px-2 py-2">{fmtCompact(row.processed_rows)}</td>
                      <td className="px-2 py-2">{fmtCompact(row.failed_rows)}</td>
                      <td className="px-2 py-2">{fmtCompact(row.latency_ms)}</td>
                      <td className="px-2 py-2">{row.model_name && row.model_version ? `${row.model_name}:${row.model_version}` : "-"}</td>
                      <td className="px-2 py-2">
                        <Badge variant={row.error_text ? "destructive" : "outline"}>{row.error_text ? "error" : "ok"}</Badge>
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

