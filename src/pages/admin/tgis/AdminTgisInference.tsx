import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TgisAdminHeader, fmtCompact, fmtDate } from "./shared";

function shortText(value: string, max = 180) {
  if (!value) return "-";
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

export default function AdminTgisInference() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<any[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await (supabase as any)
      .from("tgis_generation_log")
      .select("id,user_id,category,cluster_id,cluster_slug,status,variants,latency_ms,cost_usd,provider,model_name,provider_model,prompt_raw,prompt_rewritten,slots_json,metadata_json,processed_intent_json,sanitization_report_json,images_json,normalized_image_url,normalized_width,normalized_height,created_at,error_text")
      .order("created_at", { ascending: false })
      .limit(140);
    setRows(Array.isArray(data) ? data : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    const success = rows.filter((r) => r.status === "success").length;
    const failed = rows.filter((r) => r.status === "failed").length;
    const blocked = rows.filter((r) => r.status === "blocked").length;
    const latencyRows = rows.filter((r) => Number(r.latency_ms) > 0);
    const avgLatency = latencyRows.length
      ? latencyRows.reduce((sum, r) => sum + Number(r.latency_ms || 0), 0) / latencyRows.length
      : 0;
    const totalCost = rows.reduce((sum, r) => sum + Number(r.cost_usd || 0), 0);
    return { success, failed, blocked, avgLatency, totalCost };
  }, [rows]);

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-6 py-8">
      <TgisAdminHeader
        title="TGIS Inference"
        subtitle="Runtime de geracao com rastreabilidade completa: prompt final, skins usadas e imagem final."
        right={<Button variant="outline" className="gap-2" onClick={load} disabled={loading}><RefreshCw className="h-4 w-4" />Reload</Button>}
      />

      <div className="grid gap-3 md:grid-cols-5">
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Success</p><p className="mt-1 text-2xl font-semibold">{fmtCompact(stats.success)}</p></CardContent></Card>
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Failed</p><p className="mt-1 text-2xl font-semibold">{fmtCompact(stats.failed)}</p></CardContent></Card>
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Blocked</p><p className="mt-1 text-2xl font-semibold">{fmtCompact(stats.blocked)}</p></CardContent></Card>
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Avg latency</p><p className="mt-1 text-2xl font-semibold">{Math.round(stats.avgLatency)}ms</p></CardContent></Card>
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Total cost (sample)</p><p className="mt-1 text-2xl font-semibold">${stats.totalCost.toFixed(4)}</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Generation log</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No generation entries yet.</p>
          ) : (
            <div className="space-y-4">
              {rows.map((row) => {
                const meta = (row.metadata_json && typeof row.metadata_json === "object") ? row.metadata_json : {};
                const slots = (row.slots_json && typeof row.slots_json === "object") ? row.slots_json : {};
                const images = Array.isArray(row.images_json) ? row.images_json : [];
                const finalUrl = String(row.normalized_image_url || images?.[0]?.url || "").trim();
                const skinNames = Array.isArray((slots as any).skin_names)
                  ? (slots as any).skin_names.map((x: unknown) => String(x)).filter(Boolean)
                  : [];
                const imageUrls = Array.isArray((slots as any).image_urls)
                  ? (slots as any).image_urls.map((x: unknown) => String(x || "").trim()).filter((x: string) => x.startsWith("http"))
                  : [];
                const skinsCount = Number((slots as any).skins || 0);
                const userRefCount = Number((slots as any).user_ref || 0);
                const refEntries = imageUrls.map((url: string, idx: number) => {
                  const pos = idx + 1;
                  if (idx < skinsCount) {
                    const skinName = skinNames[idx] || `skin_${pos}`;
                    return { url, label: `#${pos} skin`, detail: skinName };
                  }
                  if (idx === skinsCount && userRefCount > 0) {
                    return { url, label: `#${pos} user_ref`, detail: "user uploaded reference" };
                  }
                  return { url, label: `#${pos} cluster_ref`, detail: "cluster style/environment anchor" };
                });
                const promptFinal = String(row.prompt_rewritten || "").trim();
                const promptRaw = String(row.prompt_raw || "").trim();
                const processedIntent = (row.processed_intent_json && typeof row.processed_intent_json === "object")
                  ? row.processed_intent_json
                  : null;
                const sanitization = (row.sanitization_report_json && typeof row.sanitization_report_json === "object")
                  ? row.sanitization_report_json
                  : null;
                const templateSource = String((meta as any).template_source || "fallback");
                const templateVersion = String((meta as any).template_version || "-");

                return (
                  <div key={`g:${row.id}`} className="rounded-lg border border-border/60 p-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>{fmtDate(row.created_at)}</span>
                      <Badge variant="outline">{row.status}</Badge>
                      <span>cluster: {row.cluster_slug || row.cluster_id || "-"}</span>
                      <span>latency: {row.latency_ms ? `${row.latency_ms}ms` : "-"}</span>
                      <span>cost: ${Number(row.cost_usd || 0).toFixed(4)}</span>
                      <span>model: {row.provider_model || row.model_name || "-"}</span>
                      <span>template: {templateSource}/{templateVersion}</span>
                    </div>

                    <div className="mt-3 grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
                      <div className="space-y-2">
                        {finalUrl ? (
                          <a href={finalUrl} target="_blank" rel="noreferrer" className="group block overflow-hidden rounded-md border border-border/60">
                            <img src={finalUrl} alt="generated" className="aspect-video w-full object-cover" loading="lazy" />
                            <div className="flex items-center justify-center gap-1 py-1 text-[11px] text-muted-foreground group-hover:text-primary">
                              Abrir imagem <ExternalLink className="h-3 w-3" />
                            </div>
                          </a>
                        ) : (
                          <div className="flex aspect-video items-center justify-center rounded-md border border-border/60 text-xs text-muted-foreground">sem imagem</div>
                        )}
                        <p className="text-[11px] text-muted-foreground">
                          {Number(row.normalized_width || 0) > 0 && Number(row.normalized_height || 0) > 0
                            ? `${row.normalized_width}x${row.normalized_height}`
                            : "-"}
                        </p>
                      </div>

                      <div className="space-y-2">
                        <div>
                          <p className="text-[11px] font-semibold text-muted-foreground">Prompt final (engineering)</p>
                          <p className="mt-1 text-xs">{shortText(promptFinal, 260)}</p>
                          {promptFinal ? (
                            <details className="mt-1">
                              <summary className="cursor-pointer text-[11px] text-primary">ver completo</summary>
                              <pre className="mt-1 max-h-44 overflow-auto whitespace-pre-wrap rounded border border-border/60 bg-card/40 p-2 text-[11px]">{promptFinal}</pre>
                            </details>
                          ) : null}
                        </div>

                        <div>
                          <p className="text-[11px] font-semibold text-muted-foreground">Prompt do usuario</p>
                          <p className="text-xs">{shortText(promptRaw, 220)}</p>
                        </div>

                        <div>
                          <p className="text-[11px] font-semibold text-muted-foreground">Skins usadas</p>
                          <p className="text-xs">{skinNames.length ? skinNames.join(" | ") : "-"}</p>
                        </div>

                        <div>
                          <p className="text-[11px] font-semibold text-muted-foreground">Slots</p>
                          <p className="text-xs">
                            S{Number((slots as any).skins || 0)} / U{Number((slots as any).user_ref || 0)} / C{Number((slots as any).cluster_refs || 0)}
                          </p>
                        </div>

                        <div>
                          <p className="text-[11px] font-semibold text-muted-foreground">Referencias enviadas ao Nano</p>
                          {refEntries.length ? (
                            <details className="mt-1">
                              <summary className="cursor-pointer text-[11px] text-primary">
                                ver {refEntries.length} referencia(s)
                              </summary>
                              <div className="mt-2 grid grid-cols-2 gap-2 xl:grid-cols-4">
                                {refEntries.map((ref) => (
                                  <a
                                    key={`${row.id}:${ref.label}:${ref.url}`}
                                    href={ref.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="overflow-hidden rounded border border-border/60 bg-card/40"
                                  >
                                    <img src={ref.url} alt={ref.label} className="h-20 w-full object-cover" loading="lazy" />
                                    <div className="border-t border-border/60 px-1 py-1">
                                      <p className="truncate text-[10px] font-medium">{ref.label}</p>
                                      <p className="truncate text-[10px] text-muted-foreground">{ref.detail}</p>
                                    </div>
                                  </a>
                                ))}
                              </div>
                            </details>
                          ) : (
                            <p className="text-xs">-</p>
                          )}
                        </div>

                        <div>
                          <p className="text-[11px] font-semibold text-muted-foreground">Processed intent</p>
                          {processedIntent ? (
                            <pre className="mt-1 max-h-36 overflow-auto whitespace-pre-wrap rounded border border-border/60 bg-card/40 p-2 text-[11px]">
                              {JSON.stringify(processedIntent, null, 2)}
                            </pre>
                          ) : (
                            <p className="text-xs">-</p>
                          )}
                        </div>

                        <div>
                          <p className="text-[11px] font-semibold text-muted-foreground">Sanitization report</p>
                          {sanitization ? (
                            <pre className="mt-1 max-h-36 overflow-auto whitespace-pre-wrap rounded border border-border/60 bg-card/40 p-2 text-[11px]">
                              {JSON.stringify(sanitization, null, 2)}
                            </pre>
                          ) : (
                            <p className="text-xs">-</p>
                          )}
                        </div>

                        {row.error_text ? (
                          <div className="rounded border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                            {row.error_text}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
