import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { BarChart3, ArrowLeft, FileText, Clock } from "lucide-react";
import ZipUploader from "@/components/ZipUploader";
import type { ProcessingResult } from "@/lib/parsing/zipProcessor";
import type { MetricsResult } from "@/lib/parsing/metricsEngine";

interface Project {
  id: string;
  name: string;
  island_code: string | null;
}

interface UploadRecord {
  id: string;
  file_name: string;
  status: string;
  csv_count: number;
  created_at: string;
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

  const fetchData = async () => {
    if (!id) return;
    const [projRes, uploadsRes] = await Promise.all([
      supabase.from("projects").select("id, name, island_code").eq("id", id).single(),
      supabase.from("uploads").select("id, file_name, status, csv_count, created_at, reports(id, status)").eq("project_id", id).order("created_at", { ascending: false }),
    ]);
    if (projRes.data) setProject(projRes.data);
    if (uploadsRes.data) setUploads(uploadsRes.data as any);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [id]);

  const handleUploadComplete = async (result: ProcessingResult, metrics: MetricsResult) => {
    if (!user || !id) return;
    setSaving(true);

    try {
      // Create upload record
      const { data: uploadRow, error: uploadErr } = await supabase.from("uploads").insert({
        project_id: id,
        user_id: user.id,
        file_name: `upload_${new Date().toISOString().slice(0, 10)}.zip`,
        status: "completed",
        csv_count: result.csvCount,
        warnings: result.logs.filter(l => l.type === 'warning').map(l => l.message) as any,
      }).select().single();

      if (uploadErr || !uploadRow) throw uploadErr;

      // Create report
      const { data: reportRow, error: reportErr } = await supabase.from("reports").insert({
        project_id: id,
        upload_id: uploadRow.id,
        user_id: user.id,
        status: "completed",
        parsed_data: result.datasets as any,
        metrics: { kpis: metrics.kpis, timeseries: metrics.timeseries, rankings: metrics.rankings } as any,
        diagnostics: metrics.diagnostics as any,
      }).select().single();

      if (reportErr || !reportRow) throw reportErr;

      toast({ title: "Relatório gerado!", description: `${result.csvCount} CSVs processados, ${result.totalRows} linhas.` });
      
      // Refresh list & navigate to report
      await fetchData();
      navigate(`/app/projects/${id}/reports/${reportRow.id}`);
    } catch (err: any) {
      toast({ title: "Erro ao salvar", description: err?.message || "Tente novamente.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

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
        <p className="text-muted-foreground">Projeto não encontrado.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <nav className="flex items-center justify-between px-6 py-4 border-b max-w-6xl mx-auto">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
            <BarChart3 className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="font-display text-lg font-bold">Island Analytics</span>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-6 py-8">
        <Link to="/app" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6">
          <ArrowLeft className="h-4 w-4" /> Voltar aos projetos
        </Link>

        <div className="mb-8">
          <h1 className="font-display text-2xl font-bold">{project.name}</h1>
          {project.island_code && <p className="text-sm text-muted-foreground">Código: {project.island_code}</p>}
        </div>

        {/* Upload Section */}
        <div className="mb-10">
          <h2 className="font-display text-lg font-semibold mb-4">Novo Upload</h2>
          <ZipUploader onComplete={handleUploadComplete} disabled={saving} />
          {saving && (
            <p className="text-sm text-muted-foreground mt-2 animate-pulse">Salvando relatório...</p>
          )}
        </div>

        {/* Upload History */}
        <h2 className="font-display text-lg font-semibold mb-4">Histórico de Uploads</h2>
        {uploads.length === 0 ? (
          <Card className="text-center py-12">
            <CardContent>
              <p className="text-sm text-muted-foreground">Nenhum upload ainda. Use a área acima para enviar seu primeiro ZIP.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {uploads.map((u) => (
              <Card key={u.id} className="hover:shadow-sm transition-shadow">
                <CardContent className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                      <FileText className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">{u.file_name}</p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {new Date(u.created_at).toLocaleDateString("pt-BR")} · {u.csv_count} CSVs · {u.status}
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
      </main>
    </div>
  );
}
