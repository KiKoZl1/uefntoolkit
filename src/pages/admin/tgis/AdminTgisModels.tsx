import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, FlaskConical, Loader2, RefreshCw, Trash2, Undo2, UploadCloud } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { TgisAdminHeader, fmtCompact, fmtDate } from "./shared";

type LoadOpts = { silent?: boolean };

export default function AdminTgisModels() {
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [rows, setRows] = useState<any[]>([]);
  const [runByModel, setRunByModel] = useState<Record<string, any>>({});
  const [clusterNameById, setClusterNameById] = useState<Record<string, string>>({});
  const [clusterId, setClusterId] = useState<string>("");
  const [version, setVersion] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [qaPrompt, setQaPrompt] = useState<string>("Fortnite Creative thumbnail, dynamic action, strong focal subject, high contrast");
  const [qaCategory, setQaCategory] = useState<string>("combat");
  const [qaReferenceImageUrl, setQaReferenceImageUrl] = useState<string>("");
  const [qaLoading, setQaLoading] = useState(false);
  const [qaResult, setQaResult] = useState<any | null>(null);

  const load = useCallback(async (opts: LoadOpts = {}) => {
    const silent = Boolean(opts.silent && rows.length > 0);
    if (!silent) setLoading(true);
    setError(null);
    const [modelsRes, runsRes, clustersRes] = await Promise.all([
      (supabase as any)
        .from("tgis_model_versions")
        .select("id,cluster_id,version,lora_fal_path,artifact_uri,status,promoted_by,promoted_at,created_at,updated_at")
        .order("updated_at", { ascending: false })
        .limit(160),
      (supabase as any)
        .from("tgis_training_runs")
        .select("id,cluster_id,target_version,status,fal_request_id,output_lora_url,ended_at,updated_at")
        .order("updated_at", { ascending: false })
        .limit(220),
      (supabase as any)
        .from("tgis_cluster_registry")
        .select("cluster_id,cluster_name")
        .order("cluster_id", { ascending: true }),
    ]);
    if (modelsRes.error) setError(modelsRes.error.message);
    setRows(Array.isArray(modelsRes.data) ? modelsRes.data : []);
    const byKey: Record<string, any> = {};
    for (const r of Array.isArray(runsRes.data) ? runsRes.data : []) {
      const key = `${r.cluster_id}:${r.target_version}`;
      if (!key || byKey[key]) continue;
      byKey[key] = r;
    }
    setRunByModel(byKey);
    const byCluster: Record<string, string> = {};
    for (const c of Array.isArray(clustersRes.data) ? clustersRes.data : []) {
      byCluster[String(c.cluster_id)] = String(c.cluster_name || `cluster_${c.cluster_id}`);
    }
    setClusterNameById(byCluster);
    if (!silent) setLoading(false);
  }, [rows.length]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => void load({ silent: true }), 30_000);
    return () => window.clearInterval(id);
  }, [load]);

  function pickRow(row: any) {
    const cid = String(row.cluster_id || "");
    const ver = String(row.version || "");
    setClusterId(cid);
    setVersion(ver);
    const cname = String(clusterNameById[cid] || "");
    const guess = cname.startsWith("cluster_") ? cname.replace(/^cluster_/, "") : cname;
    if (guess) setQaCategory(guess);
  }

  async function promote(clusterIdValue = clusterId, versionValue = version) {
    if (!clusterIdValue || !versionValue) return;
    setActing(true);
    const { data, error } = await supabase.functions.invoke("tgis-admin-promote-model", {
      body: {
        clusterId: Number(clusterIdValue),
        version: versionValue,
        syncManifest: true,
      },
    });
    if (error || data?.success === false) setError(error?.message || data?.error || "promote_failed");
    await load();
    setActing(false);
  }

  async function rollback(clusterIdValue = clusterId, versionValue = version) {
    if (!clusterIdValue || !versionValue) return;
    setActing(true);
    const { data, error } = await supabase.functions.invoke("tgis-admin-rollback-model", {
      body: { clusterId: Number(clusterIdValue), toVersion: versionValue },
    });
    if (error || data?.success === false) setError(error?.message || data?.error || "rollback_failed");
    await load();
    setActing(false);
  }

  async function deleteModel(clusterIdValue: string, versionValue: string) {
    if (!clusterIdValue || !versionValue) return;
    if (!window.confirm(`Delete model cluster ${clusterIdValue} version ${versionValue}?`)) return;
    setActing(true);
    const { data, error } = await supabase.functions.invoke("tgis-admin-delete-model", {
      body: { clusterId: Number(clusterIdValue), version: versionValue },
    });
    if (error || data?.success === false) setError(error?.message || data?.error || "delete_failed");
    await load();
    setActing(false);
  }

  async function runQa() {
    if (!clusterId || !version) {
      setError("pick_cluster_and_version_for_qa");
      return;
    }
    if (!qaPrompt.trim() || !qaCategory.trim()) {
      setError("qa_prompt_and_category_required");
      return;
    }
    setQaLoading(true);
    setQaResult(null);
    const qaTags = qaCategory
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean)
      .slice(0, 8);
    const { data, error } = await supabase.functions.invoke("tgis-generate", {
      body: {
        prompt: qaPrompt.trim(),
        tags: qaTags.length ? qaTags : ["combat"],
        cameraAngle: "eye",
        contextBoost: true,
        referenceImageUrl: qaReferenceImageUrl.trim() || undefined,
      },
    });
    if (error || data?.success === false) {
      setError(error?.message || data?.error || "qa_generate_failed");
      setQaLoading(false);
      return;
    }
    setQaResult(data);
    setQaLoading(false);
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
        subtitle="Catalogo de versoes LoRA por cluster com promote/rollback/delecao e QA visual antes de promote."
        right={(
          <div className="flex flex-wrap items-center gap-2">
            <Input className="w-28" placeholder="cluster" value={clusterId} onChange={(e) => setClusterId(e.target.value.replace(/[^0-9]/g, ""))} />
            <Input className="w-44" placeholder="version" value={version} onChange={(e) => setVersion(e.target.value)} />
            <Button variant="outline" className="gap-2" onClick={() => rollback()} disabled={acting || loading || !clusterId || !version}>
              <Undo2 className="h-4 w-4" />
              Rollback
            </Button>
            <Button className="gap-2" onClick={() => promote()} disabled={acting || loading || !clusterId || !version}>
              {acting ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
              Promote
            </Button>
            <Button variant="outline" className="gap-2" onClick={() => load()} disabled={loading}>
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
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Candidate QA (before promote)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 md:grid-cols-4">
            <Input value={qaCategory} onChange={(e) => setQaCategory(e.target.value)} placeholder="category (ex: combat)" />
            <Input value={qaPrompt} onChange={(e) => setQaPrompt(e.target.value)} placeholder="prompt" />
            <Input value={qaReferenceImageUrl} onChange={(e) => setQaReferenceImageUrl(e.target.value)} placeholder="referenceImageUrl (optional)" />
            <Input value={clusterId} readOnly placeholder="cluster id" />
          </div>
          <div className="flex items-center gap-2">
            <Button className="gap-2" onClick={runQa} disabled={qaLoading || !clusterId || !version}>
              {qaLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />}
              Run QA with selected model
            </Button>
            <span className="text-xs text-muted-foreground">Selected: cluster {clusterId || "-"} / version {version || "-"}</span>
          </div>
          {(qaResult?.images?.length || qaResult?.image?.url) ? (
            <div className="grid gap-3 md:grid-cols-2">
              {(qaResult?.images?.length
                ? qaResult.images
                : [{ url: qaResult?.image?.url, seed: 0 }]
              ).map((img: any, idx: number) => (
                <a key={`qa:${idx}`} href={String(img.url)} target="_blank" rel="noreferrer" className="overflow-hidden rounded-md border border-border/60">
                  <img src={String(img.url)} alt={`qa-${idx}`} className="h-auto w-full object-cover" />
                  <div className="px-2 py-1 text-xs text-muted-foreground">seed: {img.seed}</div>
                </a>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

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
                    <th className="px-2 py-2">Training run</th>
                    <th className="px-2 py-2">Run output LoRA</th>
                    <th className="px-2 py-2">Promoted at</th>
                    <th className="px-2 py-2">Updated</th>
                    <th className="px-2 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const rk = `${row.cluster_id}:${row.version}`;
                    const rr = runByModel[rk];
                    const rowClusterId = String(row.cluster_id);
                    const rowVersion = String(row.version || "");
                    const canDelete = row.status !== "active";
                    return (
                      <tr key={`m:${row.id}`} className="border-b border-border/30">
                        <td className="px-2 py-2">{row.cluster_id}</td>
                        <td className="px-2 py-2 font-medium">{row.version}</td>
                        <td className="px-2 py-2"><Badge variant="outline">{row.status}</Badge></td>
                        <td className="max-w-[360px] truncate px-2 py-2 text-xs" title={row.lora_fal_path}>{row.lora_fal_path}</td>
                        <td className="px-2 py-2 text-xs">{rr ? `#${rr.id} (${rr.status})` : "-"}</td>
                        <td className="max-w-[260px] truncate px-2 py-2 text-xs" title={rr?.output_lora_url || ""}>{rr?.output_lora_url || "-"}</td>
                        <td className="px-2 py-2">{fmtDate(row.promoted_at)}</td>
                        <td className="px-2 py-2">{fmtDate(row.updated_at)}</td>
                        <td className="px-2 py-2">
                          <div className="flex flex-wrap gap-1">
                            <Button size="sm" variant="outline" onClick={() => pickRow(row)} className="h-7 px-2">Use</Button>
                            <Button size="sm" variant="outline" onClick={() => rollback(rowClusterId, rowVersion)} disabled={acting} className="h-7 px-2">
                              <Undo2 className="mr-1 h-3.5 w-3.5" />
                              Rollback
                            </Button>
                            <Button size="sm" onClick={() => promote(rowClusterId, rowVersion)} disabled={acting} className="h-7 px-2">
                              <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                              Promote
                            </Button>
                            <Button size="sm" variant="destructive" onClick={() => deleteModel(rowClusterId, rowVersion)} disabled={acting || !canDelete} className="h-7 px-2">
                              <Trash2 className="mr-1 h-3.5 w-3.5" />
                              Delete
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
