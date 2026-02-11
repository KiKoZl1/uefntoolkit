import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { BarChart3, ArrowLeft, Upload, FileText, Clock } from "lucide-react";

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

  useEffect(() => {
    if (!id) return;
    const fetchData = async () => {
      const [projRes, uploadsRes] = await Promise.all([
        supabase.from("projects").select("id, name, island_code").eq("id", id).single(),
        supabase.from("uploads").select("id, file_name, status, csv_count, created_at, reports(id, status)").eq("project_id", id).order("created_at", { ascending: false }),
      ]);
      if (projRes.data) setProject(projRes.data);
      if (uploadsRes.data) setUploads(uploadsRes.data as any);
      setLoading(false);
    };
    fetchData();
  }, [id]);

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

        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="font-display text-2xl font-bold">{project.name}</h1>
            {project.island_code && <p className="text-sm text-muted-foreground">Código: {project.island_code}</p>}
          </div>
          <Button disabled>
            <Upload className="h-4 w-4 mr-2" /> Upload ZIP
          </Button>
        </div>

        {uploads.length === 0 ? (
          <Card className="text-center py-16">
            <CardContent>
              <Upload className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="font-display text-lg font-semibold mb-2">Nenhum upload ainda</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Faça upload do ZIP exportado do painel da Epic para gerar seu primeiro relatório.
              </p>
              <Button disabled>
                <Upload className="h-4 w-4 mr-2" /> Upload ZIP (em breve)
              </Button>
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
