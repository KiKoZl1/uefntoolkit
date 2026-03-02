import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, UploadCloud } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TgisAdminHeader, fmtDate } from "./shared";

export default function AdminTgisClusters() {
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await (supabase as any)
      .from("tgis_cluster_registry")
      .select("cluster_id,cluster_name,trigger_word,categories_json,lora_version,lora_fal_path,is_active,updated_at")
      .order("cluster_id", { ascending: true });
    if (error) setError(error.message);
    setRows(Array.isArray(data) ? data : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function syncManifest() {
    setSyncing(true);
    await supabase.functions.invoke("tgis-admin-sync-manifest", { body: {} });
    await load();
    setSyncing(false);
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-6 py-8">
      <TgisAdminHeader
        title="TGIS Clusters"
        subtitle="Registro dos clusters, trigger words e versão LoRA ativa por cluster."
        right={(
          <div className="flex gap-2">
            <Button variant="outline" className="gap-2" onClick={load} disabled={loading}>
              <RefreshCw className="h-4 w-4" />
              Reload
            </Button>
            <Button className="gap-2" onClick={syncManifest} disabled={syncing || loading}>
              {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
              Sync manifest
            </Button>
          </div>
        )}
      />

      {error ? (
        <Card className="border-destructive/40"><CardContent className="pt-6 text-sm text-destructive">{error}</CardContent></Card>
      ) : null}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Cluster registry</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No clusters registered.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
                    <th className="px-2 py-2">Cluster</th>
                    <th className="px-2 py-2">Trigger</th>
                    <th className="px-2 py-2">Categories</th>
                    <th className="px-2 py-2">LoRA</th>
                    <th className="px-2 py-2">Version</th>
                    <th className="px-2 py-2">Status</th>
                    <th className="px-2 py-2">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={`c:${row.cluster_id}`} className="border-b border-border/30">
                      <td className="px-2 py-2 font-medium">#{row.cluster_id} {row.cluster_name}</td>
                      <td className="px-2 py-2">{row.trigger_word || "-"}</td>
                      <td className="px-2 py-2">{Array.isArray(row.categories_json) ? row.categories_json.join(", ") : "-"}</td>
                      <td className="px-2 py-2 text-xs">{row.lora_fal_path || "-"}</td>
                      <td className="px-2 py-2">{row.lora_version || "-"}</td>
                      <td className="px-2 py-2"><Badge variant="outline">{row.is_active ? "active" : "inactive"}</Badge></td>
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
