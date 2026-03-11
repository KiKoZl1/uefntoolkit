import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Calendar, Users, Play, Clock, Loader2, ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { dataSelect } from "@/lib/discoverDataApi";

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
  return n.toLocaleString();
}

export default function ReportsList() {
  const [reports, setReports] = useState<WeeklyReport[]>([]);
  const [loading, setLoading] = useState(true);
  const { t, i18n } = useTranslation();

  useEffect(() => {
    dataSelect<WeeklyReport[]>({
      table: "weekly_reports",
      columns: "*",
      filters: [{ op: "eq", column: "status", value: "published" }],
      order: [{ column: "date_from", ascending: false }],
    }).then(({ data }) => {
      if (data) setReports(data as WeeklyReport[]);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const locale = i18n.language === "pt-BR" ? "pt-BR" : "en-US";

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
        <h1 className="font-display text-3xl font-bold">{t("reports.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("reports.subtitle")}</p>
      </div>

      {reports.length === 0 ? (
        <div className="text-center py-16 rounded-xl border border-border/50 bg-card">
          <p className="text-muted-foreground">{t("reports.noReports")}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {reports.map((r, idx) => {
            const kpis = r.kpis_json || {};
            const isLatest = idx === 0;
            return (
              <Link to={`/reports/${r.public_slug}`} key={r.id}>
                <div className={`group rounded-xl border bg-card p-5 hover:border-primary/30 transition-all cursor-pointer ${isLatest ? "border-primary/20" : "border-border/50"}`}>
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-display text-lg font-semibold truncate">
                          {r.title_public || r.week_key}
                        </h3>
                        {isLatest && (
                          <Badge className="bg-primary/10 text-primary border-primary/20 text-[10px]">
                            Latest
                          </Badge>
                        )}
                      </div>
                      {r.subtitle_public && (
                        <p className="text-sm text-muted-foreground mb-1 truncate">{r.subtitle_public}</p>
                      )}
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {new Date(r.date_from).toLocaleDateString(locale)} — {new Date(r.date_to).toLocaleDateString(locale)}
                      </p>
                    </div>

                    <div className="hidden sm:flex items-center gap-6">
                      <div className="text-center">
                        <Users className="h-4 w-4 mx-auto text-primary mb-1" />
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{t("reports.islands")}</p>
                        <p className="font-display font-bold text-sm">{fmt(kpis.activeIslands)}</p>
                      </div>
                      <div className="text-center">
                        <Play className="h-4 w-4 mx-auto text-success mb-1" />
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{t("reports.plays")}</p>
                        <p className="font-display font-bold text-sm">{fmt(kpis.totalPlays)}</p>
                      </div>
                      <div className="text-center">
                        <Clock className="h-4 w-4 mx-auto text-info mb-1" />
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{t("reports.minutes")}</p>
                        <p className="font-display font-bold text-sm">{fmt(kpis.totalMinutesPlayed)}</p>
                      </div>
                    </div>

                    <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
