import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Edit, Eye, Globe, EyeOff } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface WeeklyReport {
  id: string;
  week_key: string;
  status: string;
  title_public: string | null;
  public_slug: string | null;
  date_from: string;
  date_to: string;
  published_at: string | null;
  created_at: string;
}

export default function AdminReportsList() {
  const [reports, setReports] = useState<WeeklyReport[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchReports = async () => {
    const { data } = await supabase
      .from("weekly_reports")
      .select("*")
      .order("date_from", { ascending: false });
    if (data) setReports(data as WeeklyReport[]);
    setLoading(false);
  };

  useEffect(() => { fetchReports(); }, []);

  const togglePublish = async (report: WeeklyReport) => {
    const newStatus = report.status === "published" ? "draft" : "published";
    const updates: any = {
      status: newStatus,
      published_at: newStatus === "published" ? new Date().toISOString() : null,
    };
    const { error } = await supabase.from("weekly_reports").update(updates).eq("id", report.id);
    if (error) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    } else {
      toast({ title: newStatus === "published" ? "Publicado!" : "Despublicado" });
      fetchReports();
    }
  };

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="font-display text-2xl font-bold">Reports CMS</h1>
        <p className="text-sm text-muted-foreground">Gerencie e publique reports semanais</p>
      </div>

      {reports.length === 0 ? (
        <Card className="text-center py-16">
          <CardContent>
            <p className="text-muted-foreground">Nenhum report no CMS. Gere um no Overview primeiro.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {reports.map((r) => (
            <Card key={r.id}>
              <CardContent className="flex items-center justify-between py-4">
                <div>
                  <p className="font-display font-semibold">{r.title_public || r.week_key}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(r.date_from).toLocaleDateString("pt-BR")} — {new Date(r.date_to).toLocaleDateString("pt-BR")}
                    {r.published_at && ` · Publicado em ${new Date(r.published_at).toLocaleDateString("pt-BR")}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={r.status === "published" ? "default" : "secondary"}>
                    {r.status === "published" ? "Publicado" : "Draft"}
                  </Badge>
                  {r.status === "published" && r.public_slug && (
                    <Button variant="ghost" size="sm" asChild>
                      <Link to={`/reports/${r.public_slug}`} target="_blank">
                        <Eye className="h-4 w-4" />
                      </Link>
                    </Button>
                  )}
                  <Button variant="outline" size="sm" asChild>
                    <Link to={`/admin/reports/${r.id}/edit`}>
                      <Edit className="h-4 w-4 mr-1" /> Editar
                    </Link>
                  </Button>
                  <Button
                    variant={r.status === "published" ? "destructive" : "default"}
                    size="sm"
                    onClick={() => togglePublish(r)}
                  >
                    {r.status === "published" ? <><EyeOff className="h-4 w-4 mr-1" /> Despublicar</> : <><Globe className="h-4 w-4 mr-1" /> Publicar</>}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
