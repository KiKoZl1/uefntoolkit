import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { KpiCard } from "@/components/discover/KpiCard";
import { RankingTable } from "@/components/discover/RankingTable";
import { SectionHeader } from "@/components/discover/SectionHeader";
import { AiNarrative } from "@/components/discover/AiNarrative";
import {
  ArrowLeft, Activity, Users, Play, Clock, TrendingUp, TrendingDown, Star, ThumbsUp,
  BarChart3, Crown, Map as MapIcon, Layers, Zap, Target, PieChart, Tags, Sparkles,
  AlertTriangle, Flame, UserPlus, HeartPulse, Skull, Rocket, Share2, Copy, EyeOff,
} from "lucide-react";
import { ReportPageSkeleton } from "@/components/discover/ReportSkeleton";
import {
  PieChart as RPieChart, Pie, Cell, Legend, Tooltip, ResponsiveContainer,
} from "recharts";
import { useToast } from "@/hooks/use-toast";
import ReactMarkdown from "react-markdown";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  TooltipProvider,
  Tooltip as UITooltip,
  TooltipTrigger as UITooltipTrigger,
  TooltipContent as UITooltipContent,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const PIE_COLORS = [
  "hsl(60, 100%, 58%)", "hsl(333, 100%, 51%)", "hsl(225, 100%, 50%)",
  "hsl(269, 95%, 40%)", "hsl(142, 71%, 45%)", "hsl(38, 92%, 50%)",
  "hsl(7, 100%, 58%)", "hsl(200, 80%, 50%)", "hsl(120, 60%, 45%)",
  "hsl(340, 75%, 55%)",
];

function hashHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

function fmt(n: number | null | undefined): string {
  if (n == null) return "—";
  const num = Number(n);
  if (isNaN(num)) return "—";
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + "M";
  if (num >= 1_000) return (num / 1_000).toFixed(1) + "K";
  if (Number.isInteger(num)) return num.toLocaleString("en-US");
  return num.toFixed(2);
}

function pct(n: number | null | undefined): string {
  if (n == null) return "—";
  return (Number(n) * 100).toFixed(1) + "%";
}

interface WeeklyReport {
  id: string;
  week_key: string;
  public_slug: string;
  title_public: string | null;
  subtitle_public: string | null;
  editor_note: string | null;
  date_from: string;
  date_to: string;
  kpis_json: any;
  rankings_json: any;
  ai_sections_json: any;
  editor_sections_json: any;
  cover_image_url?: string | null;
}

export default function ReportView() {
  const { slug } = useParams<{ slug: string }>();
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "pt-BR" ? "pt-BR" : "en-US";
  const [report, setReport] = useState<WeeklyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fmtDateTime = (iso: string): string => {
    try { return new Date(iso).toLocaleString(locale, { hour12: false }); } catch { return iso; }
  };

  useEffect(() => {
    if (!slug) return;
    supabase
      .from("weekly_reports")
      .select("*")
      .eq("public_slug", slug)
      .eq("status", "published")
      .single()
      .then(({ data }) => {
        if (data) setReport(data as WeeklyReport);
        setLoading(false);
      });
  }, [slug]);

  if (loading) return <ReportPageSkeleton />;
  if (!report) {
    return (
      <div className="p-6 text-center py-20">
        <p className="text-muted-foreground mb-4">{t("reports.notFound")}</p>
        <Button variant="outline" asChild>
          <Link to="/reports"><ArrowLeft className="h-4 w-4 mr-2" /> {t("reports.viewAll")}</Link>
        </Button>
      </div>
    );
  }

  const kpis = report.kpis_json || {};
  const rankings = report.rankings_json || {};
  const aiSections = report.ai_sections_json || {};
  const editorSections = report.editor_sections_json || {};
  const exposure = rankings.discoveryExposure || null;

  const getNarrative = (sectionNum: number): string | null => {
    const edited = editorSections[`section${sectionNum}`];
    if (edited) return edited;
    const ai = aiSections[`section${sectionNum}`];
    return ai?.narrative || null;
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    toast({ title: t("common.linkCopied") });
  };

  const categoryData = rankings.categoryPopularity
    ? Object.entries(rankings.categoryPopularity).map(([name, value]) => ({
        name: (!name || name === "None") ? "Fortnite UGC" : name,
        value: value as number,
      }))
    : [];

  return (
    <div className="px-6 py-8 max-w-6xl mx-auto pb-20">
      {(report as any).cover_image_url && (
        <div className="rounded-xl overflow-hidden mb-6 max-h-64">
          <img src={(report as any).cover_image_url} alt="Report cover" className="w-full h-64 object-cover" />
        </div>
      )}

      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <Button variant="ghost" size="sm" className="mb-2" asChild>
            <Link to="/reports"><ArrowLeft className="h-4 w-4 mr-1" /> {t("reports.allReports")}</Link>
          </Button>
          <h1 className="font-display text-3xl font-bold">{report.title_public || report.week_key}</h1>
          {report.subtitle_public && <p className="text-muted-foreground mt-1">{report.subtitle_public}</p>}
          <p className="text-sm text-muted-foreground mt-1">
            {new Date(report.date_from).toLocaleDateString(locale)} — {new Date(report.date_to).toLocaleDateString(locale)}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleCopyLink}>
            <Copy className="h-4 w-4 mr-1" /> {t("common.copyLink")}
          </Button>
        </div>
      </div>

      {report.editor_note && (
        <div className="rounded-xl border border-accent/30 bg-accent/5 p-6 mb-8">
          <p className="text-xs font-semibold text-accent uppercase tracking-wider mb-2">{t("reports.editorNote")}</p>
          <div className="prose prose-sm max-w-none text-foreground/80">
            <ReactMarkdown>{report.editor_note}</ReactMarkdown>
          </div>
        </div>
      )}

      {/* Section 1 */}
      <SectionHeader icon={Activity} number={1} title={t("reportSections.s1Title")} description={t("reportSections.s1Desc")} />
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-4">
        <KpiCard icon={MapIcon} label={t("kpis.activeIslands")} value={fmt(kpis.activeIslands)} change={kpis.wowActiveIslands} />
        <KpiCard icon={Users} label={t("kpis.creators")} value={fmt(kpis.totalCreators)} />
        <KpiCard icon={Sparkles} label={t("kpis.newMaps")} value={fmt(kpis.newMapsThisWeek)} />
        <KpiCard icon={UserPlus} label={t("kpis.newCreators")} value={fmt(kpis.newCreatorsThisWeek)} />
        <KpiCard icon={HeartPulse} label={t("kpis.revived")} value={fmt(kpis.revivedCount)} />
        <KpiCard icon={Skull} label={t("kpis.dead")} value={fmt(kpis.deadCount)} />
      </div>
      <AiNarrative text={getNarrative(1)} />

      <div className="border-t border-border my-8" />

      {/* Section 2 */}
      <SectionHeader icon={Flame} number={2} title={t("reportSections.s2Title")} description={t("reportSections.s2Desc")} />
      {rankings.trendingTopics?.length > 0 && (
        <div className="grid md:grid-cols-2 gap-4 mb-4">
          <RankingTable title={t("rankings.trendsByPlays")} icon={Flame} items={rankings.trendingTopics || []} />
        </div>
      )}
      <AiNarrative text={getNarrative(2)} />

      <div className="border-t border-border my-8" />

      {/* Section 3 */}
      <SectionHeader icon={Play} number={3} title={t("reportSections.s3Title")} description={t("reportSections.s3Desc")} />
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
        <KpiCard icon={Play} label={t("kpis.totalPlays")} value={fmt(kpis.totalPlays)} change={kpis.wowTotalPlays} />
        <KpiCard icon={Clock} label={t("kpis.totalMinutes")} value={fmt(kpis.totalMinutesPlayed)} change={kpis.wowTotalMinutes} />
        <KpiCard icon={Users} label={t("kpis.totalPlayers")} value={fmt(kpis.totalUniquePlayers)} change={kpis.wowTotalPlayers} />
        <KpiCard icon={BarChart3} label={t("kpis.avgCCU")} value={fmt(kpis.avgCCUPerMap)} />
        <KpiCard icon={Clock} label={t("kpis.avgDuration")} value={fmt(kpis.avgPlayDuration)} suffix=" min" />
      </div>
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <RankingTable title={t("rankings.topPeakCCU")} icon={BarChart3} items={rankings.topPeakCCU || []} />
        <RankingTable title={t("rankings.topUniquePlayers")} icon={Users} items={rankings.topUniquePlayers || []} />
      </div>
      <AiNarrative text={getNarrative(3)} />

      <div className="border-t border-border my-8" />

      {/* Section 4 */}
      <SectionHeader icon={Sparkles} number={4} title={t("reportSections.s4Title")} description={t("reportSections.s4Desc")} />
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <RankingTable title={t("rankings.topNewByPlays")} icon={Play} items={rankings.topNewIslandsByPlaysPublished || rankings.topNewIslandsByPlays || []} />
        <RankingTable title={t("rankings.topNewByPlayers")} icon={Users} items={rankings.topNewIslandsByPlayersPublished || rankings.topNewIslandsByPlayers || []} />
      </div>
      {rankings.mostUpdatedIslandsThisWeek?.length > 0 && (
        <div className="grid md:grid-cols-2 gap-4 mb-4">
          <RankingTable title={t("rankings.mostUpdated")} icon={Zap} items={rankings.mostUpdatedIslandsThisWeek || []} />
        </div>
      )}
      <AiNarrative text={getNarrative(4)} />

      <div className="border-t border-border my-8" />

      {/* Section 5 */}
      <SectionHeader icon={TrendingUp} number={5} title={t("reportSections.s5Title")} description={t("reportSections.s5Desc")} />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <KpiCard icon={TrendingUp} label={t("kpis.avgD1")} value={pct(kpis.avgRetentionD1)} />
        <KpiCard icon={TrendingUp} label={t("kpis.avgD7")} value={pct(kpis.avgRetentionD7)} />
        <KpiCard icon={Star} label={t("kpis.favToPlay")} value={pct(kpis.favToPlayRatio)} />
        <KpiCard icon={ThumbsUp} label={t("kpis.recToPlay")} value={pct(kpis.recToPlayRatio)} />
      </div>
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <RankingTable title={t("rankings.topD1")} icon={TrendingUp} items={rankings.topRetentionD1 || []} valueFormatter={(v) => pct(Number(v))} />
        <RankingTable title={t("rankings.topD7")} icon={TrendingUp} items={rankings.topRetentionD7 || []} valueFormatter={(v) => pct(Number(v))} />
      </div>
      <AiNarrative text={getNarrative(5)} />

      <div className="border-t border-border my-8" />

      {/* Section 6 */}
      <SectionHeader icon={Crown} number={6} title={t("reportSections.s6Title")} description={t("reportSections.s6Desc")} />
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <RankingTable title={t("rankings.topCreatorsByPlays")} icon={Play} items={rankings.topCreatorsByPlays || []} />
        <RankingTable title={t("rankings.topCreatorsByMinutes")} icon={Clock} items={rankings.topCreatorsByMinutes || []} />
      </div>
      <AiNarrative text={getNarrative(6)} />

      <div className="border-t border-border my-8" />

      {/* Section 7 */}
      <SectionHeader icon={MapIcon} number={7} title={t("reportSections.s7Title")} description={t("reportSections.s7Desc")} />
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <RankingTable title={t("rankings.topAvgMinutes")} icon={Clock} items={rankings.topAvgMinutesPerPlayer || []} valueFormatter={(v) => Number(v).toFixed(1) + " min"} />
        <RankingTable title={t("rankings.topFavorites")} icon={Star} items={rankings.topFavorites || []} />
      </div>
      <AiNarrative text={getNarrative(7)} />

      <div className="border-t border-border my-8" />

      {/* Section 8 */}
      <SectionHeader icon={AlertTriangle} number={8} title={t("reportSections.s8Title")} description={t("reportSections.s8Desc")} />
      <KpiCard icon={AlertTriangle} label={t("kpis.lowPerf")} value={fmt(kpis.failedIslands)} />
      <AiNarrative text={getNarrative(8)} />

      <div className="border-t border-border my-8" />

      {/* Section 9 */}
      <SectionHeader icon={Target} number={9} title={t("reportSections.s9Title")} description={t("reportSections.s9Desc")} />
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <RankingTable title={t("rankings.playsPerPlayer")} icon={Zap} items={rankings.topPlaysPerPlayer || []} valueFormatter={(v) => Number(v).toFixed(2)} />
        <RankingTable title={t("rankings.favsPer100")} icon={Star} items={rankings.topFavsPer100 || []} valueFormatter={(v) => Number(v).toFixed(2)} />
      </div>
      <AiNarrative text={getNarrative(9)} />

      <div className="border-t border-border my-8" />

      {/* Section 10 */}
      <SectionHeader icon={Layers} number={10} title={t("reportSections.s10Title")} description={t("reportSections.s10Desc")} />
      {categoryData.length > 0 && (
        <div className="mb-4">
          <ResponsiveContainer width="100%" height={300}>
            <RPieChart>
              <Pie data={categoryData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100}
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                {categoryData.map((_, idx) => (
                  <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Legend />
              <Tooltip />
            </RPieChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <RankingTable title={t("rankings.topCategories")} icon={Tags} items={rankings.topCategoriesByPlays || []} />
        <RankingTable title={t("rankings.topTags")} icon={Tags} items={rankings.topTags || []} />
      </div>
      <AiNarrative text={getNarrative(10)} />

      <div className="border-t border-border my-8" />

      {/* Section 11 */}
      <SectionHeader icon={Zap} number={11} title={t("reportSections.s11Title")} description={t("reportSections.s11Desc")} />
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <RankingTable title={t("rankings.topFavsPerPlay")} icon={Star} items={rankings.topFavsPerPlay || []} valueFormatter={(v) => Number(v).toFixed(4)} />
        <RankingTable title={t("rankings.topRecsPerPlay")} icon={ThumbsUp} items={rankings.topRecsPerPlay || []} valueFormatter={(v) => Number(v).toFixed(4)} />
      </div>
      <AiNarrative text={getNarrative(11)} />

      <div className="border-t border-border my-8" />

      {/* Section 12 */}
      <SectionHeader icon={Rocket} number={12} title={t("reportSections.s12Title")} description={t("reportSections.s12Desc")} />
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <RankingTable title={t("rankings.topRisers")} icon={TrendingUp} items={rankings.topRisers || []} barColor="bg-success" />
        <RankingTable title={t("rankings.topDecliners")} icon={TrendingDown} items={rankings.topDecliners || []} barColor="bg-destructive" />
      </div>
      <AiNarrative text={getNarrative(12)} />

      <div className="border-t border-border my-8" />

      {/* Section 13 */}
      <SectionHeader icon={HeartPulse} number={13} title={t("reportSections.s13Title")} description={t("reportSections.s13Desc")} />
      <div className="grid grid-cols-2 gap-3 mb-4">
        <KpiCard icon={HeartPulse} label={t("kpis.revived")} value={fmt(kpis.revivedCount)} />
        <KpiCard icon={Skull} label={t("kpis.dead")} value={fmt(kpis.deadCount)} />
      </div>
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <RankingTable title={t("rankings.revivedIslands")} icon={HeartPulse} items={rankings.revivedIslands || []} barColor="bg-success" />
        <RankingTable title={t("rankings.deadIslands")} icon={Skull} items={rankings.deadIslands || []} barColor="bg-destructive" />
      </div>
      <AiNarrative text={getNarrative(13)} />

      {exposure?.profiles?.length > 0 && (
        <>
          <div className="border-t border-border my-8" />
          <TooltipProvider>
            <SectionHeader icon={EyeOff} number={14} title={t("reportSections.s14Title")} description={t("reportSections.s14Desc")} />
            <DiscoveryExposureSection exposure={exposure} weeklyReportId={report.id} t={t} locale={locale} fmtDateTime={fmtDateTime} />
            <AiNarrative text={getNarrative(14)} />
          </TooltipProvider>
        </>
      )}
    </div>
  );
}

function DiscoveryExposureSection({ exposure, weeklyReportId, t, locale, fmtDateTime }: { exposure: any; weeklyReportId: string; t: any; locale: string; fmtDateTime: (iso: string) => string }) {
  const profiles = Array.isArray(exposure?.profiles) ? exposure.profiles : [];
  const panels = Array.isArray(exposure?.panels) ? exposure.panels : [];
  const embeddedTimeline = Array.isArray(exposure?.panelRankTimeline) ? exposure.panelRankTimeline : [];
  const topByPanel = Array.isArray(exposure?.topByPanel) ? exposure.topByPanel : [];

  const rangeStart = new Date(exposure?.meta?.rangeStart || "").getTime();
  const rangeEnd = new Date(exposure?.meta?.rangeEnd || "").getTime();
  const rangeMs = Math.max(1, rangeEnd - rangeStart);

  const [profileId, setProfileId] = useState<string>(profiles[0]?.targetId || "");
  const panelOptions = panels.filter((p: any) => String(p.target_id) === profileId);
  const [panelName, setPanelName] = useState<string>(panelOptions[0]?.panelName || "");
  const [rankMax, setRankMax] = useState<number>(10);
  const [loadingFull, setLoadingFull] = useState(false);
  const [fullTimeline, setFullTimeline] = useState<any[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const activeTimeline = rankMax <= 10 ? embeddedTimeline : fullTimeline;

  useEffect(() => {
    const opts = panels.filter((p: any) => String(p.target_id) === profileId);
    if (!opts.find((p: any) => String(p.panelName) === panelName)) {
      setPanelName(opts[0]?.panelName || "");
    }
  }, [profileId]); // eslint-disable-line react-hooks/exhaustive-deps

  const segs = activeTimeline.filter((s: any) => String(s.targetId) === profileId && String(s.panelName) === panelName);
  const segsByRank = new Map<number, any[]>();
  for (const s of segs) {
    const r = Number(s.rank) || 0;
    if (!segsByRank.has(r)) segsByRank.set(r, []);
    segsByRank.get(r)!.push(s);
  }

  const fetchFull = async (opts?: { append?: boolean }) => {
    if (!weeklyReportId || !profileId || !panelName) return;
    const append = Boolean(opts?.append);
    setLoadingFull(true);
    const off = append ? (nextOffset || 0) : 0;
    const { data, error } = await supabase.functions.invoke("discover-exposure-timeline", {
      body: { weeklyReportId, targetId: profileId, panelName, rankMin: 1, rankMax, offset: off, limit: 20000 },
    });
    setLoadingFull(false);
    if (error) return;
    const segs = Array.isArray(data?.segments) ? data.segments : [];
    setFullTimeline((prev) => (append ? [...prev, ...segs] : segs));
    setNextOffset(data?.nextOffset ?? null);
  };

  useEffect(() => {
    setFullTimeline([]);
    setNextOffset(null);
    if (rankMax <= 10) return;
    fetchFull();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rankMax, profileId, panelName, weeklyReportId]);

  const topRows = topByPanel
    .filter((r: any) => String(r.targetId) === profileId && String(r.panelName) === panelName)
    .sort((a: any, b: any) => Number(b.minutesExposed || 0) - Number(a.minutesExposed || 0))
    .slice(0, 3);

  const profileLabel = (p: any) => {
    const surface = p.surfaceName === "CreativeDiscoverySurface_Frontend" ? "Discovery"
      : p.surfaceName === "CreativeDiscoverySurface_Browse" ? "Browse"
      : p.surfaceName;
    return `${p.region} · ${surface}`;
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">{t("common.config")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <div>
            <p className="text-xs text-muted-foreground mb-1">{t("common.profile")}</p>
            <Select value={profileId} onValueChange={setProfileId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {profiles.map((p: any) => (
                  <SelectItem key={p.targetId} value={p.targetId}>{profileLabel(p)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">{t("common.panel")}</p>
            <Select value={panelName} onValueChange={setPanelName}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {panelOptions.map((p: any) => (
                  <SelectItem key={p.panelName} value={p.panelName}>{p.panelDisplayName || p.panelName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">{t("common.ranks")}</p>
            <Select value={String(rankMax)} onValueChange={(v) => setRankMax(Number(v))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="10">#1..#10 {t("common.embedded")}</SelectItem>
                <SelectItem value="50">#1..#50</SelectItem>
                <SelectItem value="100">#1..#100</SelectItem>
                <SelectItem value="250">#1..#250</SelectItem>
                <SelectItem value="500">#1..#500</SelectItem>
              </SelectContent>
            </Select>
            {rankMax > 10 && (
              <div className="flex items-center justify-between mt-2">
                <Button size="sm" variant="outline" onClick={() => fetchFull()} disabled={loadingFull}>
                  {loadingFull ? t("common.loading") : t("common.reload")}
                </Button>
                {nextOffset != null && (
                  <Button size="sm" variant="outline" onClick={() => fetchFull({ append: true })} disabled={loadingFull}>
                    {t("common.loadMore")}
                  </Button>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {topRows.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">{t("rankings.top3MinutesExposed")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {topRows.map((r: any, idx: number) => (
              <div key={idx} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium truncate">{r.title || r.linkCode}</p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {r.creatorCode ? `@${r.creatorCode}` : r.linkCodeType}
                  </p>
                </div>
                <div className="text-xs font-display font-semibold whitespace-nowrap">
                  {fmt(Number(r.minutesExposed || 0))} min
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {panelName && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Rank Timeline (#1..#{rankMax})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {Array.from({ length: rankMax }).map((_, i) => {
              const rank = i + 1;
              const track = segsByRank.get(rank) || [];
              return (
                <div key={rank} className="flex items-center gap-3">
                  <div className="w-10 text-xs font-mono text-muted-foreground text-right">#{rank}</div>
                  <div className="relative h-6 flex-1 rounded-md bg-muted/40 overflow-hidden border">
                    {track.map((s: any, j: number) => {
                      const a = new Date(s.start).getTime();
                      const b = new Date(s.end).getTime();
                      const left = ((a - rangeStart) / rangeMs) * 100;
                      const width = Math.max(0.5, ((b - a) / rangeMs) * 100);
                      const hue = hashHue(String(s.linkCode || ""));
                      const color = `hsl(${hue}, 75%, 55%)`;
                      return (
                        <UITooltip key={j}>
                          <UITooltipTrigger asChild>
                            <div
                              className="absolute top-0 bottom-0 rounded-sm cursor-pointer"
                              style={{ left: `${Math.max(0, left)}%`, width: `${Math.min(100, width)}%`, backgroundColor: color, opacity: 0.9 }}
                            />
                          </UITooltipTrigger>
                          <UITooltipContent side="top" className="max-w-xs">
                            <div className="space-y-1">
                              <p className="text-xs font-semibold">{s.title || s.linkCode}</p>
                              <p className="text-[11px] text-muted-foreground">
                                {fmtDateTime(s.start)} → {fmtDateTime(s.end)} ({fmt(Number(s.durationMinutes || 0))} min)
                              </p>
                              <p className="text-[11px] text-muted-foreground">
                                Rank #{rank} • CCU max {s.ccuMax != null ? fmt(Number(s.ccuMax)) : "—"} •{" "}
                                {s.creatorCode ? `@${s.creatorCode}` : s.linkCodeType}
                              </p>
                            </div>
                          </UITooltipContent>
                        </UITooltip>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
