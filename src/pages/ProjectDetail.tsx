import { useEffect, useMemo, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  BarChart3,
  ArrowLeft,
  FileText,
  Clock,
  Search,
  Filter,
  Save,
  Sparkles,
  Rocket,
  AlertTriangle,
} from "lucide-react";
import ZipUploader from "@/components/ZipUploader";
import type { ProcessingResult } from "@/lib/parsing/zipProcessor";
import type { MetricsResult } from "@/lib/parsing/metricsEngine";

interface Project {
  id: string;
  name: string;
  island_code: string | null;
  description: string | null;
}

interface ReportRow {
  id: string;
  status: string;
  created_at: string;
  metrics: any;
  diagnostics: any[] | null;
  ai_summary: string | null;
}

interface UploadRecord {
  id: string;
  file_name: string;
  status: string;
  csv_count: number;
  created_at: string;
  warnings: string[] | null;
  reports: ReportRow[];
}

function statusVariant(status: string): "default" | "secondary" | "destructive" {
  const norm = (status || "").toLowerCase();
  if (["completed", "done", "success"].includes(norm)) return "default";
  if (["failed", "error"].includes(norm)) return "destructive";
  return "secondary";
}

function formatPercent(v: unknown): string {
  if (typeof v !== "number" || Number.isNaN(v)) return "--";
  const n = v > 1 ? v : v * 100;
  return `${n.toFixed(1)}%`;
}

function metricValue(v: unknown, suffix = ""): string {
  if (typeof v !== "number" || Number.isNaN(v)) return "--";
  return `${v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}${suffix}`;
}

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [project, setProject] = useState<Project | null>(null);
  const [uploads, setUploads] = useState<UploadRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [editName, setEditName] = useState("");
  const [editCode, setEditCode] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [savingProject, setSavingProject] = useState(false);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "completed" | "failed" | "processing">("all");

  const fetchData = async () => {
    if (!id) return;
    const [projRes, uploadsRes] = await Promise.all([
      supabase.from("projects").select("id, name, island_code, description").eq("id", id).single(),
      supabase
        .from("uploads")
        .select("id, file_name, status, csv_count, created_at, warnings, reports(id, status, created_at, metrics, diagnostics, ai_summary)")
        .eq("project_id", id)
        .order("created_at", { ascending: false }),
    ]);

    if (projRes.data) {
      setProject(projRes.data);
      setEditName(projRes.data.name || "");
      setEditCode(projRes.data.island_code || "");
      setEditDescription(projRes.data.description || "");
    }

    if (uploadsRes.data) {
      const normalized = (uploadsRes.data as any[]).map((row) => ({
        ...row,
        reports: Array.isArray(row.reports) ? row.reports : [],
      }));
      setUploads(normalized);
    }

    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, [id]);

  const handleUploadComplete = async (result: ProcessingResult, metrics: MetricsResult) => {
    if (!user || !id) return;
    setSaving(true);

    try {
      const { data: uploadRow, error: uploadErr } = await supabase
        .from("uploads")
        .insert({
          project_id: id,
          user_id: user.id,
          file_name: `upload_${new Date().toISOString().slice(0, 10)}.zip`,
          status: "completed",
          csv_count: result.csvCount,
          warnings: result.logs.filter((l) => l.type === "warning").map((l) => l.message) as any,
        })
        .select()
        .single();

      if (uploadErr || !uploadRow) throw uploadErr;

      const { data: reportRow, error: reportErr } = await supabase
        .from("reports")
        .insert({
          project_id: id,
          upload_id: uploadRow.id,
          user_id: user.id,
          status: "completed",
          parsed_data: result.datasets as any,
          metrics: {
            kpis: metrics.kpis,
            timeseries: metrics.timeseries,
            rankings: metrics.rankings,
            distributions: metrics.distributions,
          } as any,
          diagnostics: metrics.diagnostics as any,
        })
        .select()
        .single();

      if (reportErr || !reportRow) throw reportErr;

      toast({
        title: "Relatorio gerado",
        description: `${result.csvCount} CSVs processados, ${result.totalRows.toLocaleString("pt-BR")} linhas.`,
      });

      await fetchData();
      navigate(`/app/projects/${id}/reports/${reportRow.id}`);
    } catch (err: any) {
      toast({ title: "Erro ao salvar", description: err?.message || "Tente novamente.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveProject = async () => {
    if (!project) return;
    setSavingProject(true);

    const islandCode = editCode.trim();
    const islandCodeOk = !islandCode || /^\d{4}-\d{4}-\d{4}$/.test(islandCode);
    if (!islandCodeOk) {
      toast({ title: "Codigo invalido", description: "Use o formato 0000-0000-0000.", variant: "destructive" });
      setSavingProject(false);
      return;
    }

    const { error } = await supabase
      .from("projects")
      .update({
        name: editName.trim(),
        island_code: islandCode || null,
        description: editDescription.trim() || null,
      })
      .eq("id", project.id);

    if (error) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Projeto atualizado" });
      await fetchData();
    }
    setSavingProject(false);
  };

  const latestReport = useMemo(() => {
    const all = uploads.flatMap((u) => u.reports || []);
    if (all.length === 0) return null;
    return [...all].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))[0];
  }, [uploads]);

  const latestKpis = ((latestReport?.metrics as any)?.kpis || {}) as Record<string, unknown>;
  const latestDiagnostics = (latestReport?.diagnostics || []) as any[];

  const filteredUploads = useMemo(() => {
    const q = search.trim().toLowerCase();
    return uploads.filter((u) => {
      const statusOk = statusFilter === "all" ? true : (u.status || "").toLowerCase() === statusFilter;
      const textOk = !q || (u.file_name || "").toLowerCase().includes(q);
      return statusOk && textOk;
    });
  }, [uploads, search, statusFilter]);

  const totals = useMemo(() => {
    const reportCount = uploads.reduce((acc, u) => acc + (u.reports?.length || 0), 0);
    const csvCount = uploads.reduce((acc, u) => acc + Number(u.csv_count || 0), 0);
    const warningCount = uploads.reduce((acc, u) => acc + (Array.isArray(u.warnings) ? u.warnings.length : 0), 0);
    return {
      uploadCount: uploads.length,
      reportCount,
      csvCount,
      warningCount,
    };
  }, [uploads]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-muted-foreground">Projeto nao encontrado.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <nav className="flex items-center justify-between px-6 py-4 border-b max-w-7xl mx-auto">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
            <BarChart3 className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="font-display text-lg font-bold">CSV Analytics Workspace</span>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        <Link to="/app" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" /> Voltar aos projetos
        </Link>

        <section className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-xl">{project.name}</CardTitle>
              <CardDescription>
                {project.island_code ? `Codigo da ilha: ${project.island_code}` : "Sem codigo de ilha cadastrado"}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Nome do projeto</Label>
                <Input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Ex: My Island Main" />
              </div>
              <div className="space-y-2">
                <Label>Codigo da ilha</Label>
                <Input value={editCode} onChange={(e) => setEditCode(e.target.value)} placeholder="0000-0000-0000" />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Descricao</Label>
                <Textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} placeholder="Objetivo do projeto, publico, metas de KPI..." />
              </div>
              <div className="md:col-span-2 flex justify-end">
                <Button onClick={handleSaveProject} disabled={savingProject || !editName.trim()}>
                  <Save className="h-4 w-4 mr-2" /> {savingProject ? "Salvando..." : "Salvar projeto"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" /> Snapshot rapido
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between"><span className="text-muted-foreground">Uploads</span><span className="font-medium">{totals.uploadCount}</span></div>
              <div className="flex items-center justify-between"><span className="text-muted-foreground">Reports</span><span className="font-medium">{totals.reportCount}</span></div>
              <div className="flex items-center justify-between"><span className="text-muted-foreground">CSVs totais</span><span className="font-medium">{totals.csvCount}</span></div>
              <div className="flex items-center justify-between"><span className="text-muted-foreground">Warnings</span><span className="font-medium">{totals.warningCount}</span></div>
              {latestReport ? (
                <Button className="w-full mt-2" asChild>
                  <Link to={`/app/projects/${project.id}/reports/${latestReport.id}`}>
                    <Rocket className="h-4 w-4 mr-2" /> Abrir ultimo report
                  </Link>
                </Button>
              ) : null}
            </CardContent>
          </Card>
        </section>

        <section className="space-y-4">
          <h2 className="font-display text-lg font-semibold">Novo upload</h2>
          <ZipUploader onComplete={handleUploadComplete} disabled={saving} />
          {saving ? <p className="text-sm text-muted-foreground animate-pulse">Salvando report no banco...</p> : null}
        </section>

        {latestReport ? (
          <section>
            <h2 className="font-display text-lg font-semibold mb-4">Ultimo report: sinais principais</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">CTR</p><p className="font-display text-xl font-bold">{formatPercent(latestKpis.ctr)}</p></CardContent></Card>
              <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Retencao D1</p><p className="font-display text-xl font-bold">{formatPercent(latestKpis.retention_d1)}</p></CardContent></Card>
              <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Retencao D7</p><p className="font-display text-xl font-bold">{formatPercent(latestKpis.retention_d7)}</p></CardContent></Card>
              <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Nota media</p><p className="font-display text-xl font-bold">{metricValue(latestKpis.avg_rating, "/10")}</p></CardContent></Card>
              <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Fila P95</p><p className="font-display text-xl font-bold">{metricValue(latestKpis.queue_p95, "s")}</p></CardContent></Card>
            </div>

            <Card className="mt-4">
              <CardHeader>
                <CardTitle className="text-base">Top diagnosticos do ultimo report</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {latestDiagnostics.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum diagnostico relevante no ultimo report.</p>
                ) : (
                  latestDiagnostics.slice(0, 3).map((d, idx) => (
                    <div key={idx} className="rounded-lg border p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold">{d.title || "Diagnostico"}</p>
                        <Badge variant={d.priority === "P0" ? "destructive" : d.priority === "P1" ? "default" : "secondary"}>{d.priority || "P2"}</Badge>
                      </div>
                      {d.evidence ? <p className="text-xs text-muted-foreground mt-1">{d.evidence}</p> : null}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </section>
        ) : null}

        <section className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <h2 className="font-display text-lg font-semibold">Historico de uploads</h2>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative">
                <Search className="h-4 w-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
                <Input className="pl-9 w-full sm:w-64" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nome do arquivo" />
              </div>
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-muted-foreground" />
                <select
                  className="h-10 rounded-md border bg-background px-3 text-sm"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as any)}
                >
                  <option value="all">Todos os status</option>
                  <option value="completed">Completed</option>
                  <option value="processing">Processing</option>
                  <option value="failed">Failed</option>
                </select>
              </div>
            </div>
          </div>

          {filteredUploads.length === 0 ? (
            <Card className="text-center py-12">
              <CardContent>
                <p className="text-sm text-muted-foreground">Nenhum upload para o filtro atual.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {filteredUploads.map((u) => {
                const firstReport = u.reports?.[0];
                const warningCount = Array.isArray(u.warnings) ? u.warnings.length : 0;
                return (
                  <Card key={u.id} className="hover:shadow-sm transition-shadow">
                    <CardContent className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between">
                      <div className="flex items-start gap-4">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                          <FileText className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <p className="font-medium text-sm">{u.file_name}</p>
                          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                            <Clock className="h-3 w-3" />
                            {new Date(u.created_at).toLocaleString("pt-BR")} - {u.csv_count} CSVs
                          </p>
                          <div className="flex flex-wrap gap-2 mt-2">
                            <Badge variant={statusVariant(u.status)}>{u.status}</Badge>
                            {warningCount > 0 ? (
                              <Badge variant="secondary" className="inline-flex items-center gap-1">
                                <AlertTriangle className="h-3 w-3" /> {warningCount} warning(s)
                              </Badge>
                            ) : null}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {firstReport ? (
                          <Button size="sm" variant="outline" asChild>
                            <Link to={`/app/projects/${project.id}/reports/${firstReport.id}`}>Ver report</Link>
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">Sem report vinculado</span>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
