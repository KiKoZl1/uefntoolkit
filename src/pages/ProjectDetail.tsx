import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  BarChart3, ArrowLeft, FileText, Clock, Upload, AlertTriangle,
  Save, Search, Loader2, CheckCircle2, XCircle,
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

interface UploadRecord {
  id: string;
  file_name: string;
  status: string;
  csv_count: number;
  created_at: string;
  warnings: any;
  reports: { id: string; status: string }[];
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

  // Edit state
  const [editName, setEditName] = useState("");
  const [editCode, setEditCode] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  // History filters
  const [histSearch, setHistSearch] = useState("");
  const [histStatus, setHistStatus] = useState<string>("all");

  const fetchData = async () => {
    if (!id) return;
    const [projRes, uploadsRes] = await Promise.all([
      supabase.from("projects").select("id, name, island_code, description").eq("id", id).single(),
      supabase.from("uploads").select("id, file_name, status, csv_count, created_at, warnings, reports(id, status)").eq("project_id", id).order("created_at", { ascending: false }),
    ]);
    if (projRes.data) {
      setProject(projRes.data);
      setEditName(projRes.data.name);
      setEditCode(projRes.data.island_code || "");
      setEditDesc(projRes.data.description || "");
    }
    if (uploadsRes.data) setUploads(uploadsRes.data as any);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [id]);

  const handleSaveProject = async () => {
    if (!id) return;
    setEditSaving(true);
    const { error } = await supabase.from("projects").update({
      name: editName,
      island_code: editCode || null,
      description: editDesc || null,
    }).eq("id", id);
    if (error) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Projeto atualizado!" });
      setProject(p => p ? { ...p, name: editName, island_code: editCode || null, description: editDesc || null } : p);
    }
    setEditSaving(false);
  };

  const handleUploadComplete = async (result: ProcessingResult, metrics: MetricsResult) => {
    if (!user || !id) return;
    setSaving(true);
    try {
      const { data: uploadRow, error: uploadErr } = await supabase.from("uploads").insert({
        project_id: id,
        user_id: user.id,
        file_name: `upload_${new Date().toISOString().slice(0, 10)}.zip`,
        status: "completed",
        csv_count: result.csvCount,
        warnings: result.logs.filter(l => l.type === 'warning').map(l => l.message) as any,
      }).select().single();

      if (uploadErr || !uploadRow) throw uploadErr;

      const { data: reportRow, error: reportErr } = await supabase.from("reports").insert({
        project_id: id,
        upload_id: uploadRow.id,
        user_id: user.id,
        status: "completed",
        parsed_data: result.datasets as any,
        metrics: { kpis: metrics.kpis, timeseries: metrics.timeseries, rankings: metrics.rankings, distributions: metrics.distributions } as any,
        diagnostics: metrics.diagnostics as any,
      }).select().single();

      if (reportErr || !reportRow) throw reportErr;

      toast({ title: "Relatório gerado!", description: `${result.csvCount} CSVs processados, ${result.totalRows} linhas.` });
      await fetchData();
      navigate(`/app/projects/${id}/reports/${reportRow.id}`);
    } catch (err: any) {
      toast({ title: "Erro ao salvar", description: err?.message || "Tente novamente.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const filteredUploads = uploads.filter(u => {
    if (histStatus !== "all" && u.status !== histStatus) return false;
    if (histSearch) {
      const q = histSearch.toLowerCase();
      if (!u.file_name.toLowerCase().includes(q) && !u.created_at.includes(q)) return false;
    }
    return true;
  });

  // Stats
  const totalUploads = uploads.length;
  const totalReports = uploads.reduce((sum, u) => sum + (u.reports?.length || 0), 0);
  const totalCsvs = uploads.reduce((sum, u) => sum + (u.csv_count || 0), 0);
  const totalWarnings = uploads.reduce((sum, u) => sum + (Array.isArray(u.warnings) ? u.warnings.length : 0), 0);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-muted-foreground">Projeto não encontrado.</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8">
      <Link to="/app" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-4 w-4" /> Voltar ao Workspace
      </Link>

      {/* Project Info / Edit */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Informações do Projeto</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Código da Ilha</Label>
              <Input value={editCode} onChange={(e) => setEditCode(e.target.value)} placeholder="0000-0000-0000" />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Descrição</Label>
            <Textarea value={editDesc} onChange={(e) => setEditDesc(e.target.value)} placeholder="Notas sobre o projeto..." rows={2} />
          </div>
          <Button onClick={handleSaveProject} disabled={editSaving} size="sm">
            {editSaving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
            Salvar
          </Button>
        </CardContent>
      </Card>

      {/* Operational Snapshot */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <Upload className="h-4 w-4 mx-auto text-primary mb-1" />
            <p className="text-xs text-muted-foreground">Uploads</p>
            <p className="font-display font-bold text-lg">{totalUploads}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <FileText className="h-4 w-4 mx-auto text-primary mb-1" />
            <p className="text-xs text-muted-foreground">Reports</p>
            <p className="font-display font-bold text-lg">{totalReports}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <BarChart3 className="h-4 w-4 mx-auto text-primary mb-1" />
            <p className="text-xs text-muted-foreground">CSVs Processados</p>
            <p className="font-display font-bold text-lg">{totalCsvs}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <AlertTriangle className="h-4 w-4 mx-auto text-yellow-500 mb-1" />
            <p className="text-xs text-muted-foreground">Warnings</p>
            <p className="font-display font-bold text-lg">{totalWarnings}</p>
          </CardContent>
        </Card>
      </div>

      {/* Upload Section */}
      <div>
        <h2 className="font-display text-lg font-semibold mb-4">Novo Upload</h2>
        <ZipUploader onComplete={handleUploadComplete} disabled={saving} />
        {saving && (
          <p className="text-sm text-muted-foreground mt-2 animate-pulse">Salvando relatório...</p>
        )}
      </div>

      {/* Upload History */}
      <div>
        <h2 className="font-display text-lg font-semibold mb-4">Histórico de Uploads</h2>

        <div className="flex gap-3 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input value={histSearch} onChange={(e) => setHistSearch(e.target.value)} placeholder="Buscar..." className="pl-10" />
          </div>
          <Select value={histStatus} onValueChange={setHistStatus}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="completed">Completo</SelectItem>
              <SelectItem value="pending">Pendente</SelectItem>
              <SelectItem value="error">Erro</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {filteredUploads.length === 0 ? (
          <Card className="text-center py-12">
            <CardContent>
              <p className="text-sm text-muted-foreground">
                {uploads.length === 0 ? "Nenhum upload ainda." : "Nenhum resultado para o filtro atual."}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {filteredUploads.map((u) => (
              <Card key={u.id} className="hover:shadow-sm transition-shadow">
                <CardContent className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                      <FileText className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">{u.file_name}</p>
                      <p className="text-xs text-muted-foreground flex items-center gap-2">
                        <Clock className="h-3 w-3" />
                        {new Date(u.created_at).toLocaleDateString("pt-BR")} · {u.csv_count} CSVs
                        <Badge variant={u.status === "completed" ? "default" : u.status === "error" ? "destructive" : "secondary"} className="text-[10px]">
                          {u.status === "completed" ? <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" /> : u.status === "error" ? <XCircle className="h-2.5 w-2.5 mr-0.5" /> : null}
                          {u.status}
                        </Badge>
                      </p>
                    </div>
                  </div>
                  {u.reports?.[0] && (
                    <Button size="sm" variant="outline" asChild>
                      <Link to={`/app/projects/${project.id}/reports/${u.reports[0].id}`}>
                        Ver Relatório
                      </Link>
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
