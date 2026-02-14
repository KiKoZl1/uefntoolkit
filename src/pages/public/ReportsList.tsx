import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, Users, Play, Clock, Loader2 } from "lucide-react";

interface WeeklyReport {
  id: string;
  week_key: string;
  public_slug: string;
  title_public: string | null;
  subtitle_public: string | null;
  date_from: string;
  date_to: string;
  kpis_json: any;
  published_at: string | null;
}

function fmt(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString("pt-BR");
}

export default function ReportsList() {
  const [reports, setReports] = useState<WeeklyReport[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("weekly_reports")
      .select("*")
      .eq("status", "published")
      .order("date_from", { ascending: false })
      .then(({ data }) => {
        if (data) setReports(data as WeeklyReport[]);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="px-6 py-12 max-w-6xl mx-auto">
      <div className="mb-10">
        <h1 className="font-display text-3xl font-bold">Weekly Reports</h1>
        <p className="text-muted-foreground mt-1">Relatórios semanais do ecossistema Fortnite Discovery</p>
      </div>

      {reports.length === 0 ? (
        <Card className="text-center py-16">
          <CardContent>
            <p className="text-muted-foreground">Nenhum report publicado ainda. Volte em breve!</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {reports.map((r) => {
            const kpis = r.kpis_json || {};
            return (
              <Link to={`/reports/${r.public_slug}`} key={r.id}>
                <Card className="hover:shadow-lg transition-shadow cursor-pointer h-full border-border/50">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="font-display text-base">
                        {r.title_public || r.week_key}
                      </CardTitle>
                      <Badge>Publicado</Badge>
                    </div>
                    {r.subtitle_public && (
                      <p className="text-xs text-muted-foreground">{r.subtitle_public}</p>
                    )}
                    <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                      <Calendar className="h-3 w-3" />
                      {new Date(r.date_from).toLocaleDateString("pt-BR")} — {new Date(r.date_to).toLocaleDateString("pt-BR")}
                    </p>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="text-center">
                        <Users className="h-4 w-4 mx-auto text-primary mb-1" />
                        <p className="text-xs text-muted-foreground">Ilhas</p>
                        <p className="font-display font-semibold text-sm">{fmt(kpis.activeIslands)}</p>
                      </div>
                      <div className="text-center">
                        <Play className="h-4 w-4 mx-auto text-accent mb-1" />
                        <p className="text-xs text-muted-foreground">Plays</p>
                        <p className="font-display font-semibold text-sm">{fmt(kpis.totalPlays)}</p>
                      </div>
                      <div className="text-center">
                        <Clock className="h-4 w-4 mx-auto text-warning mb-1" />
                        <p className="text-xs text-muted-foreground">Minutos</p>
                        <p className="font-display font-semibold text-sm">{fmt(kpis.totalMinutesPlayed)}</p>
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
