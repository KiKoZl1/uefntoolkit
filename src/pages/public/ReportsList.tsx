import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Calendar, Users, Play, Clock, ArrowRight, Inbox } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PageState } from "@/components/ui/page-state";
import { usePublicReportsQuery } from "@/hooks/queries/publicQueries";

function fmt(n: number | null | undefined): string {
  if (n == null) return "-";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString();
}

export default function ReportsList() {
  const { t, i18n } = useTranslation();
  const { data: reports = [], isLoading, isError, refetch } = usePublicReportsQuery();

  const locale = i18n.language === "pt-BR" ? "pt-BR" : "en-US";

  if (isLoading) {
    return (
      <div className="px-6 py-12 max-w-6xl mx-auto">
        <PageState variant="section" title={t("common.loading")} description={t("reports.subtitle")} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="px-6 py-12 max-w-6xl mx-auto">
        <PageState
          variant="section"
          tone="error"
          title={t("common.error")}
          description={t("reports.noReports")}
          action={{ label: t("common.reload"), onClick: () => void refetch() }}
        />
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
        <PageState
          variant="section"
          title={t("reports.noReports")}
          description={t("reports.subtitle")}
          icon={<Inbox className="h-5 w-5 text-primary" />}
        />
      ) : (
        <div className="space-y-4">
          {reports.map((report, idx) => {
            const kpis = (report.kpis_json as Record<string, number>) || {};
            const isLatest = idx === 0;
            return (
              <Link to={`/reports/${report.public_slug}`} key={report.id}>
                <div
                  className={`group rounded-xl border bg-card p-5 hover:border-primary/30 transition-all cursor-pointer ${
                    isLatest ? "border-primary/20" : "border-border/50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-display text-lg font-semibold truncate">{report.title_public || report.week_key}</h3>
                        {isLatest && (
                          <Badge className="bg-primary/10 text-primary border-primary/20 text-[10px]">
                            {t("reports.latest")}
                          </Badge>
                        )}
                      </div>
                      {report.subtitle_public ? (
                        <p className="text-sm text-muted-foreground mb-1 truncate">{report.subtitle_public}</p>
                      ) : null}
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {new Date(report.date_from).toLocaleDateString(locale)} - {new Date(report.date_to).toLocaleDateString(locale)}
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
