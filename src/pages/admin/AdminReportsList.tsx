import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Edit, Eye, Globe, EyeOff } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { dataSelect, dataUpdate } from "@/lib/discoverDataApi";

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
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "pt-BR" ? "pt-BR" : "en-US";
  const [reports, setReports] = useState<WeeklyReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const { toast } = useToast();

  const fetchReports = async () => {
    const { data } = await dataSelect<WeeklyReport[]>({
      table: "weekly_reports",
      columns: "*",
      order: [{ column: "date_from", ascending: false }],
    });
    if (data) setReports(data as WeeklyReport[]);
    setLoading(false);
  };

  useEffect(() => { fetchReports(); }, []);

  const runReportRebuild = async (weeklyReportId: string) => {
    const { data: before } = await dataSelect<any>({
      table: "weekly_reports",
      columns: "rebuild_count,discover_report_id",
      filters: [{ op: "eq", column: "id", value: weeklyReportId }],
      single: "single",
    });
    const beforeCount = Number((before as any)?.rebuild_count || 0);
    const initialReportId = (before as any)?.discover_report_id ? String((before as any).discover_report_id) : null;

    const waitForCountIncrease = async (fromCount: number, timeoutMs = 12 * 60 * 1000) => {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        let current: any = null;
        try {
          const res = await dataSelect<any>({
            table: "weekly_reports",
            columns: "rebuild_count",
            filters: [{ op: "eq", column: "id", value: weeklyReportId }],
            single: "single",
          });
          current = res.data;
        } catch {
          continue;
        }
        const currentCount = Number((current as any)?.rebuild_count || 0);
        if (currentCount > fromCount) return currentCount;
      }
      throw new Error("Rebuild timeout: backend did not confirm completion");
    };

    const isTimeoutLike = (msg: string) => /non-2xx|504|timeout|upstream request timeout/i.test(msg);
    let reportId = initialReportId;
    let stageCount = beforeCount;

    // Step 1: core rebuild only.
    const core = await supabase.functions.invoke("discover-report-rebuild", {
      body: { weeklyReportId, runAi: false, reinjectExposure: false, refreshMetadata: false, buildEvidence: false },
    });
    if (core.error || (core.data as any)?.success === false) {
      const errMsg = core.error?.message || (core.data as any)?.error || "Rebuild failed";
      if (isTimeoutLike(errMsg)) {
        stageCount = await waitForCountIncrease(stageCount);
      } else {
        throw new Error(`[core] ${errMsg}`);
      }
    } else {
      stageCount += 1;
      reportId = (core.data as any)?.reportId ? String((core.data as any).reportId) : reportId;
    }

    if (!reportId) {
      const { data: wrAfter } = await dataSelect<any>({
        table: "weekly_reports",
        columns: "discover_report_id",
        filters: [{ op: "eq", column: "id", value: weeklyReportId }],
        single: "single",
      });
      reportId = (wrAfter as any)?.discover_report_id ? String((wrAfter as any).discover_report_id) : null;
    }
    if (!reportId) throw new Error("Missing discover_report_id after core rebuild");

    // Step 2: evidence packs (mandatory).
    const evidence = await supabase.functions.invoke("discover-report-rebuild", {
      body: {
        weeklyReportId,
        reportId,
        evidenceOnly: true,
        buildEvidence: true,
        runAi: false,
        reinjectExposure: false,
        refreshMetadata: false,
      },
    });
    if (evidence.error || (evidence.data as any)?.success === false) {
      const errMsg = evidence.error?.message || (evidence.data as any)?.error || "Evidence build failed";
      if (isTimeoutLike(errMsg)) {
        stageCount = await waitForCountIncrease(stageCount);
      } else {
        throw new Error(`[evidence] ${errMsg}`);
      }
    } else {
      stageCount += 1;
    }

    // Step 3: inject discovery exposure payload (light mode).
    const exposure = await supabase.functions.invoke("discover-exposure-report", {
      body: { weeklyReportId, embedTimelineLimit: 0, includeCollections: false },
    });
    if (exposure.error || (exposure.data as any)?.success === false) {
      throw new Error(`[exposure] ${exposure.error?.message || (exposure.data as any)?.error || "Exposure injection failed"}`);
    }

    // Step 4: AI narratives.
    const ai = await supabase.functions.invoke("discover-report-ai", { body: { reportId } });
    if (ai.error || (ai.data as any)?.success === false) {
      throw new Error(`[ai] ${ai.error?.message || (ai.data as any)?.error || "AI generation failed"}`);
    }
  };

  const togglePublish = async (report: WeeklyReport) => {
    const newStatus = report.status === "published" ? "draft" : "published";
    try {
      setPublishingId(report.id);
      if (newStatus === "published") {
        await runReportRebuild(report.id);
      }

      const updates: any = {
        status: newStatus,
        published_at: newStatus === "published" ? new Date().toISOString() : null,
      };
      await dataUpdate({
        table: "weekly_reports",
        values: updates,
        filters: [{ op: "eq", column: "id", value: report.id }],
      });

      toast({ title: newStatus === "published" ? t("admin.published") : t("admin.unpublished") });
      await fetchReports();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: t("common.error"), description: msg, variant: "destructive" });
    } finally {
      setPublishingId(null);
    }
  };

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="font-display text-2xl font-bold">{t("admin.reportsCms")}</h1>
        <p className="text-sm text-muted-foreground">{t("admin.reportsCmsSubtitle")}</p>
      </div>

      {reports.length === 0 ? (
        <Card className="text-center py-16">
          <CardContent>
            <p className="text-muted-foreground">{t("admin.noReportsCms")}</p>
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
                    {new Date(r.date_from).toLocaleDateString(locale)} â€” {new Date(r.date_to).toLocaleDateString(locale)}
                    {r.published_at && ` Â· ${t("admin.publishedOn")} ${new Date(r.published_at).toLocaleDateString(locale)}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={r.status === "published" ? "default" : "secondary"}>
                    {r.status === "published" ? t("common.published") : t("common.draft")}
                  </Badge>
                  {r.status === "published" && r.public_slug && (
                    <Button variant="ghost" size="sm" asChild>
                      <Link to={`/reports/${r.public_slug}`} target="_blank"><Eye className="h-4 w-4" /></Link>
                    </Button>
                  )}
                  <Button variant="outline" size="sm" asChild>
                    <Link to={`/admin/reports/${r.id}/edit`}><Edit className="h-4 w-4 mr-1" /> {t("admin.edit")}</Link>
                  </Button>
                  <Button
                    variant={r.status === "published" ? "destructive" : "default"}
                    size="sm"
                    onClick={() => togglePublish(r)}
                    disabled={publishingId === r.id}
                  >
                    {publishingId === r.id ? (
                      <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> {t("admin.regenerating")}</>
                    ) : (
                      r.status === "published"
                        ? <><EyeOff className="h-4 w-4 mr-1" /> {t("admin.unpublish")}</>
                        : <><Globe className="h-4 w-4 mr-1" /> {t("admin.publish")}</>
                    )}
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

