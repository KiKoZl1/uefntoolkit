import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DppiAdminHeader, fmtDate } from "./shared";
import { dataSelect } from "@/lib/discoverDataApi";

export default function AdminDppiCalibration() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      const { data } = await dataSelect<any[]>({
        table: "dppi_calibration_metrics",
        columns: "measured_at,model_name,model_version,task_type,prediction_horizon,brier,logloss,ece,calibration_method",
        order: [{ column: "measured_at", ascending: false }],
        limit: 200,
      });
      setRows(Array.isArray(data) ? data : []);
      setLoading(false);
    })();
  }, []);

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-6 py-8">
      <DppiAdminHeader title="DPPI Calibration" subtitle="Acompanhamento de Brier, LogLoss e ECE por horizonte de previsão." />

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Calibration metrics</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem métricas de calibração.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
                    <th className="px-2 py-2">Measured at</th>
                    <th className="px-2 py-2">Model</th>
                    <th className="px-2 py-2">Task</th>
                    <th className="px-2 py-2">Horizon</th>
                    <th className="px-2 py-2">Brier</th>
                    <th className="px-2 py-2">LogLoss</th>
                    <th className="px-2 py-2">ECE</th>
                    <th className="px-2 py-2">Method</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, idx) => (
                    <tr key={`${row.measured_at || idx}:${row.model_name || "m"}`} className="border-b border-border/30">
                      <td className="px-2 py-2">{fmtDate(row.measured_at)}</td>
                      <td className="px-2 py-2">{row.model_name}:{row.model_version}</td>
                      <td className="px-2 py-2">{row.task_type}</td>
                      <td className="px-2 py-2">{row.prediction_horizon}</td>
                      <td className="px-2 py-2">{Number(row.brier || 0).toFixed(4)}</td>
                      <td className="px-2 py-2">{Number(row.logloss || 0).toFixed(4)}</td>
                      <td className="px-2 py-2">{Number(row.ece || 0).toFixed(4)}</td>
                      <td className="px-2 py-2">{row.calibration_method || "-"}</td>
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

