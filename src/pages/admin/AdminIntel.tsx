import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw } from "lucide-react";
import { dataSelect } from "@/lib/discoverDataApi";

export default function AdminIntel() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "pt-BR" ? "pt-BR" : "en-US";

  const [loading, setLoading] = useState(true);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [premiumCount, setPremiumCount] = useState<number>(0);
  const [emergingCount, setEmergingCount] = useState<number>(0);
  const [pollutionCount, setPollutionCount] = useState<number>(0);
  const [refreshing, setRefreshing] = useState(false);
  const [lastResult, setLastResult] = useState<any>(null);
  const [partnerSignals, setPartnerSignals] = useState<any[]>([]);
  const [partnerWeekKey, setPartnerWeekKey] = useState<string | null>(null);

  function fmt(n: number | null | undefined): string {
    if (n == null) return "-";
    const num = Number(n);
    if (Number.isNaN(num)) return "-";
    if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + "M";
    if (num >= 1_000) return (num / 1_000).toFixed(1) + "K";
    if (Number.isInteger(num)) return num.toLocaleString("en-US");
    return num.toFixed(2);
  }

  async function loadCounts() {
    setLoading(true);
    const [p, e, pol, latestReport] = await Promise.all([
      dataSelect<any[]>({
        table: "discovery_public_premium_now",
        columns: "as_of",
        count: "exact",
        limit: 1,
      }),
      dataSelect<any[]>({
        table: "discovery_public_emerging_now",
        columns: "as_of",
        count: "exact",
        limit: 1,
      }),
      dataSelect<any[]>({
        table: "discovery_public_pollution_creators_now",
        columns: "as_of",
        count: "exact",
        limit: 1,
      }),
      dataSelect<any>({
        table: "weekly_reports",
        columns: "week_key,rankings_json,published_at",
        filters: [{ op: "eq", column: "status", value: "published" }],
        order: [{ column: "published_at", ascending: false }],
        limit: 1,
        single: "maybeSingle",
      }),
    ]);
    setPremiumCount(p.count || 0);
    setEmergingCount(e.count || 0);
    setPollutionCount(pol.count || 0);
    setAsOf(p.data?.[0]?.as_of || e.data?.[0]?.as_of || pol.data?.[0]?.as_of || null);
    const reportRow = latestReport.data as any;
    const partnerRows = Array.isArray(reportRow?.rankings_json?.partnerSignals)
      ? reportRow.rankings_json.partnerSignals
      : [];
    setPartnerSignals(partnerRows);
    setPartnerWeekKey(reportRow?.week_key || null);
    setLoading(false);
  }

  async function refreshNow() {
    setRefreshing(true);
    const { data, error } = await supabase.functions.invoke("discover-exposure-collector", {
      body: { mode: "intel_refresh" },
    });
    if (!error) setLastResult(data);
    await loadCounts();
    setRefreshing(false);
  }

  useEffect(() => {
    loadCounts();
    const interval = setInterval(loadCounts, 60_000);
    return () => clearInterval(interval);
  }, []);

  const asOfLabel = useMemo(() => {
    if (!asOf) return "—";
    return new Date(asOf).toLocaleString(locale);
  }, [asOf, locale]);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="px-6 py-10 max-w-6xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">{t("adminIntel.title")}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{t("adminIntel.subtitle")}</p>
        </div>
        <Button onClick={refreshNow} disabled={refreshing} className="gap-2">
          {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {t("adminIntel.refreshNow")}
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <Badge variant="secondary" className="font-mono">as_of: {asOfLabel}</Badge>
        <Badge variant="secondary" className="font-mono">premium_rows: {premiumCount}</Badge>
        <Badge variant="secondary" className="font-mono">emerging_rows: {emergingCount}</Badge>
        <Badge variant="secondary" className="font-mono">pollution_rows: {pollutionCount}</Badge>
      </div>

      {lastResult && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">{t("adminIntel.lastRefreshResult")}</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="text-xs whitespace-pre-wrap bg-muted/40 border rounded-md p-3 overflow-auto">
              {JSON.stringify(lastResult, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">
            Partner Signals {partnerWeekKey ? `- ${partnerWeekKey}` : ""}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Internal codename tracking for potential partner IP onboarding. This panel is aggregated by codename/project only and never exposes island codes or island names.
          </p>
          {partnerSignals.length === 0 ? (
            <p className="text-sm text-muted-foreground">No partner codename signals found in the latest published report.</p>
          ) : (
            <div className="space-y-2">
              {partnerSignals.map((s: any, idx: number) => (
                <div key={`${s.codename || "sig"}:${idx}`} className="border rounded-md p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{s.projectName || s.codename || "Partner Signal"}</p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      codename: {s.codename || "n/a"} - islands: {fmt(s.islands)} - players: {fmt(s.players)}
                    </p>
                  </div>
                  <div className="text-xs text-right whitespace-nowrap">
                    <div className="font-semibold">{fmt(s.plays)} plays</div>
                    <div className="text-muted-foreground">{Number(s.sharePlaysPct || 0).toFixed(2)}%</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">{t("adminIntel.notesTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>{t("adminIntel.notesP1")}</p>
          <p>{t("adminIntel.notesP2")}</p>
        </CardContent>
      </Card>
    </div>
  );
}
