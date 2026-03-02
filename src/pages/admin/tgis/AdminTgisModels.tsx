import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, UploadCloud, Undo2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { TgisAdminHeader, fmtCompact, fmtDate } from "./shared";

export default function AdminTgisModels() {
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [rows, setRows] = useState<any[]>([]);
  const [clusterId, setClusterId] = useState<string>("");
  const [version, setVersion] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await (supabase as any)
      .from("tgis_model_versions")
      .select("id,cluster_id,version,lora_fal_path,status,promoted_by,promoted_at,created_at,updated_at")
      .order("updated_at", { ascending: false })
      .limit(300);
    if (error) setError(error.message);
    setRows(Array.isArray(data) ? data : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function promote() {
    if (!clusterId || !version) return;
    setActing(true);
    const { data, error } = await supabase.functions.invoke("tgis-admin-promote-model", {
      body: {
        clusterId: Number(clusterId),
        version,
        syncManifest: true,
      },
    });
    if (error || data?.success === false) setError(error?.message || data?.error || "promote_failed");
    await load();
    setActing(false);
  }

  async function rollback() {
    if (!clusterId || !version) return;
    setActing(true);
    const { data, error } = await supabase.functions.invoke("tgis-admin-rollback-model", {
      body: { clusterId: Number(clusterId), toVersion: version },
    });
    if (error || data?.success === false) setError(error?.message || data?.error || "rollback_failed");
    await load();
    setActing(false);
  }

  const stats = useMemo(() => {
    return {
      active: rows.filter((r) => r.status === "active").length,
      candidate: rows.filter((r) => r.status === "candidate").length,
      failed: rows.filter((r) => r.status === "failed").length,
      total: rows.length,
    };
  }, [rows]);

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-6 py-8">
      <TgisAdminHeader
        title="TGIS Models"
        subtitle="Catalogo de versoes LoRA por cluster com promote/rollback auditavel."
        right={(
          <div className="flex flex-wrap items-center gap-2">
            <Input className="w-28" placeholder="cluster" value={clusterId} onChange={(e) => setClusterId(e.target.value.replace(/[^0-9]/g, ""))} />
            <Input className="w-40" placeholder="version" value={version} onChange={(e) => setVersion(e.target.value)} />
            <Button variant="outline" className="gap-2" onClick={rollback} disabled={acting || loading || !clusterId || !version}>
              <Undo2 className="h-4 w-4" />
              Rollback
            </Button>
            <Button className="gap-2" onClick={promote} disabled={acting || loading || !clusterId || !version}>
              {acting ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
              Promote
            </Button>
            <Button variant="outline" className="gap-2" onClick={load} disabled={loading}>
              <RefreshCw className="h-4 w-4" />
              Reload
            </Button>
          </div>
        )}
      />

      {error ? <Card className="border-destructive/40"><CardContent className="pt-6 text-sm text-destructive">{error}</CardContent></Card> : null}

      <div className="grid gap-3 md:grid-cols-4">
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Total</p><p className="mt-1 text-2xl font-semibold">{fmtCompact(stats.total)}</p></CardContent></Card>
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Active</p><p className="mt-1 text-2xl font-semibold">{fmtCompact(stats.active)}</p></CardContent></Card>
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Candidate</p><p className="mt-1 text-2xl font-semibold">{fmtCompact(stats.candidate)}</p></CardContent></Card>
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Failed</p><p className="mt-1 text-2xl font-semibold">{fmtCompact(stats.failed)}</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Model versions</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No model versions yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
                    <th className="px-2 py-2">Cluster</th>
                    <th className="px-2 py-2">Version</th>
                    <th className="px-2 py-2">Status</th>
                    <th className="px-2 py-2">LoRA path</th>
                    <th className="px-2 py-2">Promoted at</th>
                    <th className="px-2 py-2">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={`m:${row.id}`} className="border-b border-border/30">
                      <td className="px-2 py-2">{row.cluster_id}</td>
                      <td className="px-2 py-2 font-medium">{row.version}</td>
                      <td className="px-2 py-2"><Badge variant="outline">{row.status}</Badge></td>
                      <td className="px-2 py-2 text-xs">{row.lora_fal_path}</td>
                      <td className="px-2 py-2">{fmtDate(row.promoted_at)}</td>
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
