import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DppiAdminHeader, fmtDate } from "./shared";
import { dataSelect } from "@/lib/discoverDataApi";

export default function AdminDppiModels() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      const { data } = await dataSelect<any[]>({
        table: "dppi_model_registry",
        columns: "model_name,model_version,task_type,status,trained_at,published_at,updated_at,metrics_json",
        order: [{ column: "updated_at", ascending: false }],
        limit: 100,
      });
      setRows(Array.isArray(data) ? data : []);
      setLoading(false);
    })();
  }, []);

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-6 py-8">
      <DppiAdminHeader
        title="DPPI Models"
        subtitle="Registro completo de versões, status e métricas dos modelos entry/survival."
      />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Model registry</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem modelos registrados.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
                    <th className="px-2 py-2">Model</th>
                    <th className="px-2 py-2">Version</th>
                    <th className="px-2 py-2">Task</th>
                    <th className="px-2 py-2">Status</th>
                    <th className="px-2 py-2">Trained</th>
                    <th className="px-2 py-2">Published</th>
                    <th className="px-2 py-2">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, idx) => (
                    <tr key={`${row.model_name}:${row.model_version}:${idx}`} className="border-b border-border/30">
                      <td className="px-2 py-2 font-medium">{row.model_name}</td>
                      <td className="px-2 py-2">{row.model_version}</td>
                      <td className="px-2 py-2">{row.task_type}</td>
                      <td className="px-2 py-2"><Badge variant="outline">{row.status}</Badge></td>
                      <td className="px-2 py-2">{fmtDate(row.trained_at)}</td>
                      <td className="px-2 py-2">{fmtDate(row.published_at)}</td>
                      <td className="px-2 py-2">{fmtDate(row.updated_at)}</td>
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

