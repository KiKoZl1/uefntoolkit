import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DppiAdminHeader, fmtDate } from "./shared";
import { dataSelect } from "@/lib/discoverDataApi";

export default function AdminDppiFeedback() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      const { data } = await dataSelect<any[]>({
        table: "dppi_feedback_events",
        columns: "created_at,source,user_id,island_code,panel_name,region,surface_name,event_type,event_value",
        order: [{ column: "created_at", ascending: false }],
        limit: 200,
      });
      setRows(Array.isArray(data) ? data : []);
      setLoading(false);
    })();
  }, []);

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-6 py-8">
      <DppiAdminHeader title="DPPI Feedback" subtitle="Eventos de feedback operacional para ajuste de modelo e produto." />

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Feedback stream</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem eventos de feedback.</p>
          ) : (
            <div className="space-y-2">
              {rows.map((row, idx) => (
                <div key={`${row.created_at || idx}`} className="rounded-md border p-3 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">{row.event_type || "-"}</p>
                    <p className="text-muted-foreground">{fmtDate(row.created_at)}</p>
                  </div>
                  <p className="mt-1 text-muted-foreground">
                    source={row.source || "-"} • island={row.island_code || "-"} • panel={row.panel_name || "-"} • {row.region || "-"}/{row.surface_name || "-"}
                  </p>
                  <pre className="mt-2 overflow-auto rounded bg-muted/40 p-2 text-[11px]">{JSON.stringify(row.event_value || {}, null, 2)}</pre>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

