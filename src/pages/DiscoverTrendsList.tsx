import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { TrendingUp, Play, Users, Clock, Loader2, Calendar, Sparkles } from "lucide-react";
import { ReportListSkeleton } from "@/components/discover/ReportSkeleton";

interface DiscoverReport {
  id: string;
  week_start: string;
  week_end: string;
  week_number: number;
  year: number;
  status: string;
  island_count: number | null;
  platform_kpis: any;
  created_at: string;
}

const statusMap: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  collecting: { label: "Coletando...", variant: "secondary" },
  analyzing: { label: "Analisando...", variant: "secondary" },
  completed: { label: "Pronto", variant: "default" },
  error: { label: "Erro", variant: "destructive" },
};

function formatNumber(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString("pt-BR");
}

export default function DiscoverTrendsList() {
  const [reports, setReports] = useState<DiscoverReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const { toast } = useToast();

  const fetchReports = async () => {
    const { data, error } = await supabase
      .from("discover_reports")
      .select("*")
      .order("week_start", { ascending: false })
      .limit(8);
    if (!error && data) setReports(data as DiscoverReport[]);
    setLoading(false);
  };

  useEffect(() => { fetchReports(); }, []);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await supabase.functions.invoke("discover-collector", {
        body: { maxIslands: 100 },
      });
      if (res.error) throw res.error;
      toast({ title: "Coleta iniciada!", description: "O relatório está sendo gerado. Atualize em alguns minutos." });
      // Also trigger AI analysis if reportId is returned
      if (res.data?.reportId) {
        await supabase.functions.invoke("discover-report-ai", {
          body: { reportId: res.data.reportId },
        });
      }
      fetchReports();
    } catch (e: any) {
      toast({ title: "Erro", description: e.message || "Falha ao gerar relatório", variant: "destructive" });
    }
    setGenerating(false);
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-display text-2xl font-bold flex items-center gap-2">
            <TrendingUp className="h-6 w-6 text-primary" />
            Discover Trends
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Relatórios semanais automáticos do ecossistema Fortnite Discovery
          </p>
        </div>
        <Button onClick={handleGenerate} disabled={generating}>
          {generating ? (
            <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Gerando...</>
          ) : (
            <><Sparkles className="h-4 w-4 mr-2" /> Gerar Report</>
          )}
        </Button>
      </div>

      {loading ? (
        <ReportListSkeleton />
      ) : reports.length === 0 ? (
        <Card className="text-center py-16">
          <CardContent>
            <TrendingUp className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="font-display text-lg font-semibold mb-2">Nenhum relatório ainda</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Gere seu primeiro relatório para ver os dados do ecossistema Discovery.
            </p>
            <Button onClick={handleGenerate} disabled={generating}>
              <Sparkles className="h-4 w-4 mr-2" /> Gerar Primeiro Report
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {reports.map((r) => {
            const kpis = r.platform_kpis || {};
            const status = statusMap[r.status] || { label: r.status, variant: "outline" as const };
            return (
              <Link to={`/app/discover-trends/${r.id}`} key={r.id}>
                <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="font-display text-base">
                        Semana {r.week_number}/{r.year}
                      </CardTitle>
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {new Date(r.week_start).toLocaleDateString("pt-BR")} — {new Date(r.week_end).toLocaleDateString("pt-BR")}
                    </p>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="text-center">
                        <Users className="h-4 w-4 mx-auto text-primary mb-1" />
                        <p className="text-xs text-muted-foreground">Ilhas</p>
                        <p className="font-display font-semibold text-sm">{formatNumber(r.island_count)}</p>
                      </div>
                      <div className="text-center">
                        <Play className="h-4 w-4 mx-auto text-accent mb-1" />
                        <p className="text-xs text-muted-foreground">Plays</p>
                        <p className="font-display font-semibold text-sm">{formatNumber(kpis.totalPlays)}</p>
                      </div>
                      <div className="text-center">
                        <Clock className="h-4 w-4 mx-auto text-warning mb-1" />
                        <p className="text-xs text-muted-foreground">Minutos</p>
                        <p className="font-display font-semibold text-sm">{formatNumber(kpis.totalMinutesPlayed)}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
