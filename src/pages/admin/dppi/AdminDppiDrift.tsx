import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DppiAdminHeader, fmtDate, fmtCompact } from "./shared";
import { dataSelect } from "@/lib/discoverDataApi";

export default function AdminDppiDrift() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      const { data } = await dataSelect<any[]>({
        table: "dppi_drift_metrics",
        columns: "measured_at,model_name,model_version,feature_name,psi,ks,drift_level",
        order: [{ column: "measured_at", ascending: false }],
        limit: 200,
      });
      setRows(Array.isArray(data) ? data : []);
      setLoading(false);
    })();
  }, []);

  const highs = rows.filter((r) => String(r.drift_level || "") === "high").length;

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-6 py-8">
      <DppiAdminHeader title="DPPI Drift" subtitle="Monitor de PSI/KS por feature crítica para detectar mudança de distribuição." />

      <div className="grid gap-3 md:grid-cols-3">
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Rows loaded</p><p className="text-2xl font-semibold">{fmtCompact(rows.length)}</p></CardContent></Card>
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">High drift alerts</p><p className="text-2xl font-semibold">{fmtCompact(highs)}</p></CardContent></Card>
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Latest check</p><p className="text-sm font-medium">{fmtDate(rows[0]?.measured_at)}</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Drift metrics</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem dados de drift.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
                    <th className="px-2 py-2">Measured at</th>
                    <th className="px-2 py-2">Model</th>
                    <th className="px-2 py-2">Feature</th>
                    <th className="px-2 py-2">PSI</th>
                    <th className="px-2 py-2">KS</th>
                    <th className="px-2 py-2">Level</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, idx) => (
                    <tr key={`${row.measured_at || idx}:${row.feature_name || "f"}`} className="border-b border-border/30">
                      <td className="px-2 py-2">{fmtDate(row.measured_at)}</td>
                      <td className="px-2 py-2">{row.model_name}:{row.model_version}</td>
                      <td className="px-2 py-2">{row.feature_name}</td>
                      <td className="px-2 py-2">{Number(row.psi || 0).toFixed(4)}</td>
                      <td className="px-2 py-2">{Number(row.ks || 0).toFixed(4)}</td>
                      <td className="px-2 py-2"><Badge variant={row.drift_level === "high" ? "destructive" : "outline"}>{row.drift_level || "low"}</Badge></td>
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

