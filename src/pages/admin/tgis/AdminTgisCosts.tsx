import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TgisAdminHeader, fmtCompact } from "./shared";

export default function AdminTgisCosts() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<any[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await (supabase as any)
      .from("tgis_cost_usage_daily")
      .select("day,provider,model_name,generations,images_generated,total_cost_usd,updated_at")
      .order("day", { ascending: false })
      .limit(300);
    setRows(Array.isArray(data) ? data : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    const cost = rows.reduce((sum, r) => sum + Number(r.total_cost_usd || 0), 0);
    const generations = rows.reduce((sum, r) => sum + Number(r.generations || 0), 0);
    const images = rows.reduce((sum, r) => sum + Number(r.images_generated || 0), 0);
    return { cost, generations, images };
  }, [rows]);

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-6 py-8">
      <TgisAdminHeader
        title="TGIS Costs"
        subtitle="Consumo agregado diario por provedor e modelo para controle de budget."
        right={<Button variant="outline" className="gap-2" onClick={load} disabled={loading}><RefreshCw className="h-4 w-4" />Reload</Button>}
      />

      <div className="grid gap-3 md:grid-cols-3">
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Total generations</p><p className="mt-1 text-2xl font-semibold">{fmtCompact(stats.generations)}</p></CardContent></Card>
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Total images</p><p className="mt-1 text-2xl font-semibold">{fmtCompact(stats.images)}</p></CardContent></Card>
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Total cost</p><p className="mt-1 text-2xl font-semibold">${stats.cost.toFixed(4)}</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Daily cost ledger</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No cost rows yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
                    <th className="px-2 py-2">Day</th>
                    <th className="px-2 py-2">Provider</th>
                    <th className="px-2 py-2">Model</th>
                    <th className="px-2 py-2">Generations</th>
                    <th className="px-2 py-2">Images</th>
                    <th className="px-2 py-2">Cost (USD)</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, idx) => (
                    <tr key={`c:${row.day}:${row.provider}:${row.model_name}:${idx}`} className="border-b border-border/30">
                      <td className="px-2 py-2">{row.day}</td>
                      <td className="px-2 py-2">{row.provider}</td>
                      <td className="px-2 py-2 text-xs">{row.model_name}</td>
                      <td className="px-2 py-2">{fmtCompact(row.generations)}</td>
                      <td className="px-2 py-2">{fmtCompact(row.images_generated)}</td>
                      <td className="px-2 py-2">${Number(row.total_cost_usd || 0).toFixed(4)}</td>
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
