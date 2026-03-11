import { useCallback, useEffect, useState } from "react";
import { Loader2, PlayCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DppiAdminHeader, fmtDate } from "./shared";
import { dataSelect } from "@/lib/discoverDataApi";

export default function AdminDppiTraining() {
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [rows, setRows] = useState<any[]>([]);
  const [readiness, setReadiness] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: authData, error: authError } = await supabase.auth.getSession();
    if (authError || !authData?.session?.access_token) {
      setReadiness(null);
      setRows([]);
      setLoading(false);
      return;
    }

    const [logsRes, healthRes] = await Promise.all([
      dataSelect<any[]>({
        table: "dppi_training_log",
        columns: "id,requested_at,started_at,ended_at,status,model_name,model_version,task_type,error_text",
        order: [{ column: "requested_at", ascending: false }],
        limit: 100,
      }),
      supabase.functions.invoke("dppi-health", {
        body: {},
        headers: {
          Authorization: `Bearer ${authData.session.access_token}`,
        },
      }),
    ]);

    setRows(Array.isArray(logsRes.data) ? logsRes.data : []);
    setReadiness((healthRes.data as any)?.training_readiness ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function queue(taskType: "entry" | "survival") {
    if (readiness && readiness.ready === false) return;

    setRunning(true);
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
    setRunning(false);
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-6 py-8">
      <DppiAdminHeader
        title="DPPI Training"
        subtitle="Fila e historico de treinos no worker de ML."
        right={
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="gap-2"
              disabled={running || (readiness && readiness.ready === false)}
              onClick={() => queue("entry")}
            >
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />} Queue entry
            </Button>
            <Button
              className="gap-2"
              disabled={running || (readiness && readiness.ready === false)}
              onClick={() => queue("survival")}
            >
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />} Queue survival
            </Button>
          </div>
        }
      />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Training readiness gate</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span>Status</span>
            <Badge variant={readiness?.ready ? "outline" : "destructive"}>
              {readiness?.ready ? "ready" : "blocked"}
            </Badge>
          </div>
          <div className="flex items-center justify-between">
            <span>Coverage days</span>
            <span>{readiness?.coverage_days ?? "-"}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Required days</span>
            <span>{readiness?.required_days ?? "-"}</span>
          </div>
          <p className="text-xs text-muted-foreground">Reason: {readiness?.reason || "-"}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Training runs</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-7 w-7 animate-spin text-primary" />
            </div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum treino registrado.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
                    <th className="px-2 py-2">Run</th>
                    <th className="px-2 py-2">Model</th>
                    <th className="px-2 py-2">Task</th>
                    <th className="px-2 py-2">Status</th>
                    <th className="px-2 py-2">Requested</th>
                    <th className="px-2 py-2">Started</th>
                    <th className="px-2 py-2">Ended</th>
                    <th className="px-2 py-2">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b border-border/30 align-top">
                      <td className="px-2 py-2 font-mono text-xs">#{row.id}</td>
                      <td className="px-2 py-2">
                        {row.model_name}:{row.model_version}
                      </td>
                      <td className="px-2 py-2">{row.task_type}</td>
                      <td className="px-2 py-2">
                        <Badge variant="outline">{row.status}</Badge>
                      </td>
                      <td className="px-2 py-2">{fmtDate(row.requested_at)}</td>
                      <td className="px-2 py-2">{fmtDate(row.started_at)}</td>
                      <td className="px-2 py-2">{fmtDate(row.ended_at)}</td>
                      <td className="px-2 py-2 text-xs text-destructive">{row.error_text || "-"}</td>
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
