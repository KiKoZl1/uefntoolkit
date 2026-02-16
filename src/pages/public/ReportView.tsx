import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/discover/KpiCard";
import { RankingTable } from "@/components/discover/RankingTable";
import { SectionHeader } from "@/components/discover/SectionHeader";
import { AiNarrative } from "@/components/discover/AiNarrative";
import { DistributionChart } from "@/components/discover/DistributionChart";
import {
  ArrowLeft, Activity, Users, Play, Clock, TrendingUp, TrendingDown, Star, ThumbsUp,
  BarChart3, Crown, Map as MapIcon, Layers, Zap, Target, Tags, Sparkles,
  AlertTriangle, Flame, UserPlus, HeartPulse, Skull, Rocket, Copy, EyeOff,
  Magnet, Grid3X3, Anchor, RefreshCw, Baby, UsersRound, Wrench, Crosshair
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

const EPIC_CREATORS = new Set(["epic", "epic labs", "epic games", "fortnite"]);
function isEpicCreator(creator: string | null | undefined): boolean {
  return EPIC_CREATORS.has((creator || "").toLowerCase().trim());
}

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
    const sectionKey = `section${sectionNum}`;
    const edited = editorSections[sectionKey];
    if (edited) return edited;

    const ai = aiSections[sectionKey];
    if (!ai) return null;

    const localeKey = i18n.language.replace("-", "_");
    if (localeKey !== "en" && ai[`narrative_${localeKey}`]) {
      return ai[`narrative_${localeKey}`];
    }
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
        <KpiCard icon={MapIcon} label={t("kpis.activeIslands")} value={fmt(kpis.totalIslands)} change={kpis.wowActiveIslands} />
        <KpiCard icon={Users} label={t("kpis.creators")} value={fmt(kpis.totalCreators)} />
        <KpiCard icon={Sparkles} label={t("kpis.newMaps")} value={fmt(kpis.newMapsThisWeekPublished ?? kpis.newMapsThisWeek)} />
        <KpiCard icon={UserPlus} label={t("kpis.newCreators")} value={fmt(kpis.newCreatorsThisWeek)} />
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
      <AiNarrative text={getNarrative(3)} />

      <div className="border-t border-border my-8" />

      {/* Section 4 (Peak CCU) */}
      <SectionHeader icon={BarChart3} number={4} title={t("reportSections.s4Title")} description={t("reportSections.s4Desc")} />
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <RankingTable title={t("rankings.topPeakCCU")} icon={BarChart3} showImage showBadges items={(rankings.topPeakCCU || []).map((i: any) => ({ ...i, imageUrl: i.image_url }))} />
        <RankingTable title={t("rankings.topPeakCCU_UGC")} icon={BarChart3} showImage showBadges items={(rankings.topPeakCCU_UGC || []).map((i: any) => ({ ...i, imageUrl: i.image_url }))} />
      </div>
      <AiNarrative text={getNarrative(4)} />

      <div className="border-t border-border my-8" />

      {/* Section 5 (New Islands) */}
      <SectionHeader icon={Sparkles} number={5} title={t("reportSections.s5Title")} description={t("reportSections.s5Desc")} />
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <RankingTable title={t("rankings.topNewByPlays")} icon={Play} showImage showBadges items={(rankings.topNewIslandsByPlaysPublished || rankings.topNewIslandsByPlays || []).map((i: any) => ({ ...i, imageUrl: i.image_url }))} />
        <RankingTable title={t("rankings.topNewByCCU")} icon={BarChart3} showImage items={(rankings.topNewIslandsByCCU || []).map((i: any) => ({ ...i, imageUrl: i.image_url }))} />
      </div>
      <AiNarrative text={getNarrative(5)} />

      <div className="border-t border-border my-8" />

      {/* Section 6 (Retention & Loyalty) */}
      <SectionHeader icon={TrendingUp} number={6} title={t("reportSections.s6Title")} description={t("reportSections.s6Desc")} />
      <div className="grid grid-cols-2 sm:grid-cols-2 gap-3 mb-4">
        <KpiCard icon={TrendingUp} label={t("kpis.avgD1")} value={pct(kpis.avgRetentionD1)} />
        <KpiCard icon={TrendingUp} label={t("kpis.avgD7")} value={pct(kpis.avgRetentionD7)} />
      </div>
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <RankingTable title={t("rankings.topD1")} icon={TrendingUp} showImage items={(rankings.topRetentionD1 || []).map((i: any) => ({ ...i, imageUrl: i.image_url }))} valueFormatter={(v) => pct(Number(v))} />
        <RankingTable title={t("rankings.topD7")} icon={TrendingUp} showImage items={(rankings.topRetentionD7 || []).map((i: any) => ({ ...i, imageUrl: i.image_url }))} valueFormatter={(v) => pct(Number(v))} />
      </div>
      {rankings.retentionDistributionD1 && (
        <div className="grid md:grid-cols-2 gap-4 mb-4">
          <DistributionChart title={t("rankings.retentionDistribution") + " (D1)"} data={rankings.retentionDistributionD1} />
          <DistributionChart title={t("rankings.retentionDistribution") + " (D7)"} data={rankings.retentionDistributionD7} />
        </div>
      )}
      <AiNarrative text={getNarrative(6)} />

      <div className="border-t border-border my-8" />

      {/* Section 7 (Creator Performance) */}
      <SectionHeader icon={Crown} number={7} title={t("reportSections.s7Title")} description={t("reportSections.s7Desc")} />
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <RankingTable title={t("rankings.topCreatorsByPlays") + " (UGC)"} icon={Play} showBadges
          items={(rankings.topCreatorsByPlays || []).filter((i: any) => !isEpicCreator(i.name))} />
        <RankingTable title={t("rankings.topCreatorsByMinutes") + " (UGC)"} icon={Clock} showBadges
          items={(rankings.topCreatorsByMinutes || []).filter((i: any) => !isEpicCreator(i.name))} />
      </div>
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <RankingTable title={t("rankings.topCreatorsByPlayers") + " (UGC)"} icon={Users} showBadges
          items={(rankings.topCreatorsByPlayers || []).filter((i: any) => !isEpicCreator(i.name))} />
        <RankingTable title={t("rankings.topCreatorsByCCU") + " (UGC)"} icon={BarChart3} showBadges
          items={(rankings.topCreatorsByCCU || []).filter((i: any) => !isEpicCreator(i.name))} />
      </div>
      <AiNarrative text={getNarrative(7)} />

      <div className="border-t border-border my-8" />

      {/* Section 8 (Map Quality) */}
      <SectionHeader icon={MapIcon} number={8} title={t("reportSections.s8Title")} description={t("reportSections.s8Desc")} />
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <RankingTable title={t("rankings.topAvgMinutes")} icon={Clock} showImage items={(rankings.topAvgMinutesPerPlayer || []).map((i: any) => ({ ...i, imageUrl: i.image_url }))} valueFormatter={(v) => Number(v).toFixed(1) + " min"} />
        <RankingTable title={t("rankings.topMinutesPlayed")} icon={Clock} showImage items={(rankings.topMinutesPlayed || []).map((i: any) => ({ ...i, imageUrl: i.image_url }))} />
      </div>
      <AiNarrative text={getNarrative(8)} />

      <div className="border-t border-border my-8" />

      {/* Section 9 (Low Performance) */}
      <SectionHeader icon={AlertTriangle} number={9} title={t("reportSections.s9Title")} description={t("reportSections.s9Desc")} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div>
          <KpiCard icon={AlertTriangle} label={t("kpis.lowPerf")} value={fmt(kpis.failedIslands)} />
          {rankings.lowPerfHistogram && (
            <div className="mt-4">
              <DistributionChart title={t("rankings.lowPerfHistogram")} data={rankings.lowPerfHistogram} barColor="#ef4444" />
            </div>
          )}
        </div>
        <RankingTable title={t("rankings.lowEngagement")} icon={AlertTriangle} showImage items={(rankings.failedIslandsList || []).map((i: any) => ({ ...i, imageUrl: i.image_url }))} barColor="bg-destructive" />
      </div>
      <AiNarrative text={getNarrative(9)} />

      <div className="border-t border-border my-8" />

      {/* Section 10 (Plays per Player) */}
      <SectionHeader icon={Zap} number={10} title={t("reportSections.s10Title")} description={t("reportSections.s10Desc")} />
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <RankingTable title={t("rankings.playsPerPlayer")} icon={Zap} showImage items={(rankings.topPlaysPerPlayer || []).map((i: any) => ({ ...i, imageUrl: i.image_url }))} valueFormatter={(v) => Number(v).toFixed(2)} />
      </div>
      <AiNarrative text={getNarrative(10)} />

      <div className="border-t border-border my-8" />

      {/* Section 11 (Advocacy) */}
      <SectionHeader icon={Target} number={11} title={t("reportSections.s11Title")} description={t("reportSections.s11Desc")} />
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <RankingTable title={t("rankings.favsPer100")} icon={Star} showImage items={(rankings.topFavsPer100 || []).map((i: any) => ({ ...i, imageUrl: i.image_url }))} valueFormatter={(v) => Number(v).toFixed(2) + "%"} />
        <RankingTable title={t("rankings.recsPer100")} icon={ThumbsUp} showImage items={(rankings.topRecPer100 || []).map((i: any) => ({ ...i, imageUrl: i.image_url }))} valueFormatter={(v) => Number(v).toFixed(2) + "%"} />
      </div>
      <AiNarrative text={getNarrative(11)} />

      <div className="border-t border-border my-8" />

      {/* Section 12 (Efficiency) */}
      <SectionHeader icon={Zap} number={12} title={t("reportSections.s12Title")} description={t("reportSections.s12Desc")} />
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <RankingTable title={t("rankings.topFavsPerPlay")} icon={Star} showImage items={(rankings.topFavsPerPlay || []).map((i: any) => ({ ...i, imageUrl: i.image_url }))} valueFormatter={(v) => Number(v).toFixed(4)} />
        <RankingTable title={t("rankings.topRecsPerPlay")} icon={ThumbsUp} showImage items={(rankings.topRecsPerPlay || []).map((i: any) => ({ ...i, imageUrl: i.image_url }))} valueFormatter={(v) => Number(v).toFixed(4)} />
      </div>
      <AiNarrative text={getNarrative(12)} />

      <div className="border-t border-border my-8" />

      {/* Section 13 (Stickiness) */}
      <SectionHeader icon={Magnet} number={13} title={t("reportSections.s13Title")} description={t("reportSections.s13Desc")} />
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <RankingTable title={t("rankings.topStickinessD1")} icon={Magnet} showImage items={(rankings.topStickinessD1 || []).map((i: any) => ({ ...i, imageUrl: i.image_url }))} />
        <RankingTable title={t("rankings.topStickinessD7")} icon={Magnet} showImage items={(rankings.topStickinessD7 || []).map((i: any) => ({ ...i, imageUrl: i.image_url }))} />
      </div>
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <RankingTable title={t("rankings.topStickinessD1_UGC")} icon={Magnet} showImage items={(rankings.topStickinessD1_UGC || []).map((i: any) => ({ ...i, imageUrl: i.image_url }))} />
        <RankingTable title={t("rankings.topStickinessD7_UGC")} icon={Magnet} showImage items={(rankings.topStickinessD7_UGC || []).map((i: any) => ({ ...i, imageUrl: i.image_url }))} />
      </div>
      <AiNarrative text={getNarrative(13)} />

      <div className="border-t border-border my-8" />

      {/* Section 14 (Retention Adj Engagement) */}
      <SectionHeader icon={Target} number={14} title={t("reportSections.s14Title")} description={t("reportSections.s14Desc")} />
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <RankingTable title={t("rankings.topRetentionAdjD1")} icon={Target} showImage items={(rankings.topRetentionAdjD1 || []).map((i: any) => ({ ...i, imageUrl: i.image_url }))} valueFormatter={(v) => Number(v).toFixed(1)} />
        <RankingTable title={t("rankings.topRetentionAdjD7")} icon={Target} showImage items={(rankings.topRetentionAdjD7 || []).map((i: any) => ({ ...i, imageUrl: i.image_url }))} valueFormatter={(v) => Number(v).toFixed(1)} />
      </div>
      <AiNarrative text={getNarrative(14)} />

      <div className="border-t border-border my-8" />

      {/* Section 15 (Category) */}
      <SectionHeader icon={Layers} number={15} title={t("reportSections.s10Title")} description={t("reportSections.s10Desc")} />
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
      <AiNarrative text={getNarrative(15)} />

      <div className="border-t border-border my-8" />

      {/* Section 16 (Growth/Breakouts) */}
      <SectionHeader icon={Rocket} number={16} title={t("reportSections.s16Title")} description={t("reportSections.s16Desc")} />
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <RankingTable title={t("rankings.topWeeklyGrowth")} icon={Rocket} showImage items={(rankings.topWeeklyGrowth || []).map((i: any) => ({ ...i, imageUrl: i.image_url }))} barColor="bg-success" />
      </div>
      <AiNarrative text={getNarrative(16)} />

      <div className="border-t border-border my-8" />

      {/* Section 17 (Risers) */}
      <SectionHeader icon={TrendingUp} number={17} title={t("reportSections.s12Title")} description={t("reportSections.s12Desc")} />
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <RankingTable title={t("rankings.topRisers")} icon={TrendingUp} showImage items={(rankings.topRisers || []).map((i: any) => ({ ...i, imageUrl: i.image_url }))} barColor="bg-success" />
        <RankingTable title={t("rankings.topDecliners")} icon={TrendingDown} showImage items={(rankings.topDecliners || []).map((i: any) => ({ ...i, imageUrl: i.image_url }))} barColor="bg-destructive" />
      </div>
      <AiNarrative text={getNarrative(17)} />

      <div className="border-t border-border my-8" />

      {/* Section 18 (Lifecycle) */}
      <SectionHeader icon={HeartPulse} number={18} title={t("reportSections.s13Title")} description={t("reportSections.s13Desc")} />
      <div className="grid grid-cols-2 gap-3 mb-4">
        <KpiCard icon={HeartPulse} label={t("kpis.revived")} value={fmt(kpis.revivedCount)} />
        <KpiCard icon={Skull} label={t("kpis.dead")} value={fmt(kpis.deadCount)} />
      </div>
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <RankingTable title={t("rankings.revivedIslands")} icon={HeartPulse} showImage items={(rankings.revivedIslands || []).map((i: any) => ({ ...i, imageUrl: i.image_url }))} barColor="bg-success" />
        <RankingTable title={t("rankings.deadIslands")} icon={Skull} showImage items={(rankings.deadIslands || []).map((i: any) => ({ ...i, imageUrl: i.image_url }))} barColor="bg-destructive" />
      </div>
      <AiNarrative text={getNarrative(18)} />

      <div className="border-t border-border my-8" />

      {/* Section 19 (Exposure) */}
      {exposure?.profiles?.length > 0 && (
        <>
          <TooltipProvider>
            <SectionHeader icon={EyeOff} number={19} title={t("reportSections.s19Title")} description={t("reportSections.s19Desc")} />
            <DiscoveryExposureSection exposure={exposure} weeklyReportId={report.id} t={t} locale={locale} fmtDateTime={fmtDateTime} />
            <AiNarrative text={getNarrative(19)} />
          </TooltipProvider>
        </>
      )}

      <div className="border-t border-border my-8" />

      {/* Section 20 (Multi-Panel Presence) */}
      {rankings.multiPanelPresence?.length > 0 && (
        <>
          <SectionHeader icon={Grid3X3} number={20} title={t("reportSections.s20Title")} description={t("reportSections.s20Desc")} />
          <RankingTable
            title={t("rankings.multiPanelPresence")}
            icon={Grid3X3}
            showImage
            showBadges
            items={(rankings.multiPanelPresence || []).map((item: any) => ({
              name: item.title || item.link_code,
              code: item.link_code,
              subtitle: `@${item.creator_code || "unknown"} · ${item.panels_distinct} panels`,
              value: item.panels_distinct,
              label: `${item.panels_distinct} panels`,
              imageUrl: item.image_url,
            }))}
          />
          <AiNarrative text={getNarrative(20)} />
          <div className="border-t border-border my-8" />
        </>
      )}

      {/* Section 21 (Panel Loyalty) */}
      {rankings.panelLoyalty?.length > 0 && (
        <>
          <SectionHeader icon={Anchor} number={21} title={t("reportSections.s21Title")} description={t("reportSections.s21Desc")} />
          <RankingTable
            title={t("rankings.panelLoyalty")}
            icon={Anchor}
            showImage
            showBadges
            items={(rankings.panelLoyalty || []).map((item: any) => ({
              name: item.title || item.link_code,
              code: item.link_code,
              subtitle: `@${item.creator_code || "unknown"} · ${item.panel_name}`,
              value: item.total_minutes_in_panel,
              label: `${fmt(item.total_minutes_in_panel)} min`,
              imageUrl: item.image_url,
            }))}
          />
          <AiNarrative text={getNarrative(21)} />
          <div className="border-t border-border my-8" />
        </>
      )}

      {/* Section 22 (Most Updated Islands) */}
      {(rankings.mostUpdatedIslandsThisWeek?.length > 0 || rankings.versionEnrichment) && (() => {
        const allUpdated = (rankings.mostUpdatedIslandsThisWeek || []).map((item: any) => ({
          name: item.name || item.title || item.code || item.island_code,
          code: item.code || item.island_code,
          subtitle: `${item.version ? `v${item.version} · ` : ""}@${item.creator || item.creator_code || "unknown"}`,
          value: item.value || item.week_plays || 0,
          imageUrl: item.imageUrl || item.image_url,
          _creator: item.creator || item.creator_code || "",
        }));
        const epicUpdated = allUpdated.filter((i: any) => isEpicCreator(i._creator));
        const ugcUpdated = allUpdated.filter((i: any) => !isEpicCreator(i._creator));
        return (
          <>
            <SectionHeader icon={RefreshCw} number={22} title={t("reportSections.s22Title")} description={t("reportSections.s22Desc")} />
            {rankings.versionEnrichment && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
                <KpiCard icon={RefreshCw} label={t("kpis.avgVersion")} value={String(rankings.versionEnrichment.avgVersion || "—")} />
                <KpiCard icon={RefreshCw} label={t("kpis.v5PlusIslands")} value={fmt(rankings.versionEnrichment.islandsWithVersion5Plus)} />
                <KpiCard icon={RefreshCw} label={t("kpis.totalWithVersion")} value={fmt(rankings.versionEnrichment.totalWithVersion)} />
              </div>
            )}
            <div className="grid md:grid-cols-2 gap-4 mb-4">
              {ugcUpdated.length > 0 && (
                <RankingTable title={t("rankings.mostUpdated") + " (UGC)"} icon={RefreshCw} showBadges showImage items={ugcUpdated.slice(0, 10)} />
              )}
              {epicUpdated.length > 0 && (
                <RankingTable title={t("rankings.mostUpdated") + " (Epic)"} icon={RefreshCw} showImage items={epicUpdated.slice(0, 10)} />
              )}
            </div>
            <AiNarrative text={getNarrative(22)} />
            <div className="border-t border-border my-8" />
          </>
        );
      })()}

      {/* Section 23 (Rookie Creators) */}
      {rankings.rookieCreators?.length > 0 && (
        <>
          <SectionHeader icon={Baby} number={23} title={t("reportSections.s23Title")} description={t("reportSections.s23Desc")} />
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
            <KpiCard icon={UserPlus} label={t("kpis.totalRookieCreators")} value={fmt(rankings.totalRookieCreators)} />
            <KpiCard icon={MapIcon} label={t("kpis.totalRookieIslands")} value={fmt(rankings.totalRookieIslands)} />
          </div>
          <RankingTable
            title={t("rankings.rookieCreators")}
            icon={Baby}
            items={(rankings.rookieCreators || []).map((item: any) => ({
              name: item.creator_code,
              subtitle: `${item.island_count} island${item.island_count > 1 ? "s" : ""} · Best: ${item.best_island_title || item.best_island_code}`,
              value: item.total_plays || 0,
            }))}
          />
          <AiNarrative text={getNarrative(23)} />
          <div className="border-t border-border my-8" />
        </>
      )}

      {/* Section 24 (Player Capacity Analysis) */}
      {rankings.capacityAnalysis?.length > 0 && (
        <>
          <SectionHeader icon={UsersRound} number={24} title={t("reportSections.s24Title")} description={t("reportSections.s24Desc")} />
          <RankingTable
            title={t("rankings.capacityAnalysis")}
            icon={UsersRound}
            items={(rankings.capacityAnalysis || []).map((item: any) => ({
              name: item.capacity_tier,
              subtitle: `${fmt(item.island_count)} islands · D1: ${pct(item.avg_d1)} · D7: ${pct(item.avg_d7)}`,
              value: Number(item.avg_plays) || 0,
              label: `${fmt(Number(item.avg_plays))} avg plays`,
            }))}
          />
          <AiNarrative text={getNarrative(24)} />
          <div className="border-t border-border my-8" />
        </>
      )}

      {/* Section 25 (UEFN vs FNC) */}
      {rankings.toolSplit?.length > 0 && (
        <>
          <SectionHeader icon={Wrench} number={25} title={t("reportSections.s25Title")} description={t("reportSections.s25Desc")} />
          <div className="grid md:grid-cols-2 gap-4 mb-4">
            {(rankings.toolSplit || []).map((tool: any) => (
              <Card key={tool.tool}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Wrench className="h-4 w-4 text-primary" />
                    {tool.tool}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div><span className="text-muted-foreground">Islands:</span> <strong>{fmt(tool.island_count)}</strong></div>
                    <div><span className="text-muted-foreground">Total Plays:</span> <strong>{fmt(tool.total_plays)}</strong></div>
                    <div><span className="text-muted-foreground">Avg Plays:</span> <strong>{fmt(Number(tool.avg_plays))}</strong></div>
                    <div><span className="text-muted-foreground">Avg CCU:</span> <strong>{fmt(Number(tool.avg_peak_ccu))}</strong></div>
                    <div><span className="text-muted-foreground">Avg D1:</span> <strong>{pct(Number(tool.avg_d1))}</strong></div>
                    <div><span className="text-muted-foreground">Avg D7:</span> <strong>{pct(Number(tool.avg_d7))}</strong></div>
                    <div><span className="text-muted-foreground">Avg Min/Player:</span> <strong>{Number(tool.avg_minutes_per_player).toFixed(1)} min</strong></div>
                    <div><span className="text-muted-foreground">Favorites:</span> <strong>{fmt(tool.total_favorites)}</strong></div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          <AiNarrative text={getNarrative(25)} />
        </>
      )}

      <div className="border-t border-border my-8" />

      {/* Section 26 (Exposure Efficiency) */}
      {(rankings.topExposureEfficiency?.length > 0 || rankings.worstExposureEfficiency?.length > 0) && (
        <>
          <SectionHeader icon={Crosshair} number={26} title={t("reportSections.s26Title")} description={t("reportSections.s26Desc")} />
          {rankings.exposureEfficiencyStats && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
              <KpiCard icon={Crosshair} label={t("rankings.islandsWithExposure")} value={fmt(rankings.exposureEfficiencyStats.total_islands_with_exposure)} />
              <KpiCard icon={Zap} label={t("rankings.avgPlaysPerMin")} value={fmt(rankings.exposureEfficiencyStats.avg_plays_per_min)} />
              <KpiCard icon={Target} label={t("rankings.medianPlaysPerMin")} value={fmt(rankings.exposureEfficiencyStats.median_plays_per_min)} />
            </div>
          )}
          <div className="grid md:grid-cols-2 gap-4 mb-4">
            <RankingTable
              title={t("rankings.topExposureEfficiency")}
              icon={Crosshair}
              showBadges
              showImage
              items={(rankings.topExposureEfficiency || []).map((item: any) => ({
                name: item.title || item.island_code,
                code: item.island_code,
                subtitle: `@${item.creator_code || "?"} · ${fmt(item.total_minutes_exposed)} min exposed · ${item.distinct_panels} panels`,
                value: item.plays_per_min_exposed,
                label: `${fmt(item.plays_per_min_exposed)} plays/min`,
                imageUrl: item.image_url,
              }))}
            />
            <RankingTable
              title={t("rankings.worstExposureEfficiency")}
              icon={AlertTriangle}
              barColor="bg-destructive"
              showImage
              items={(rankings.worstExposureEfficiency || []).map((item: any) => ({
                name: item.title || item.island_code,
                code: item.island_code,
                subtitle: `@${item.creator_code || "?"} · ${fmt(item.total_minutes_exposed)} min exposed · ${item.distinct_panels} panels`,
                value: item.plays_per_min_exposed,
                label: `${fmt(item.plays_per_min_exposed)} plays/min`,
                imageUrl: item.image_url,
              }))}
            />
          </div>
          <AiNarrative text={getNarrative(26)} />
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
  const resolvedCollections = Array.isArray(exposure?.resolvedCollections) ? exposure.resolvedCollections : [];

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
  }, [profileId]);

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
  }, [rankMax, profileId, panelName, weeklyReportId]);

  const topRows = topByPanel
    .filter((r: any) => String(r.targetId) === profileId && String(r.panelName) === panelName)
    .sort((a: any, b: any) => Number(b.minutesExposed || 0) - Number(a.minutesExposed || 0))
    .slice(0, 3);

  const resolvedRows = resolvedCollections
    .filter((r: any) => String(r.targetId || "") === profileId && String(r.panelName || "") === panelName)
    .sort((a: any, b: any) => Number(a.rank || 99999) - Number(b.rank || 99999))
    .slice(0, 8);

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

      {resolvedRows.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Collections Resolvidas (Rail)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {resolvedRows.map((row: any, idx: number) => (
              <div key={`${row.linkCode}:${idx}`} className="rounded-md border p-2 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">
                      #{row.rank ?? "-"} {row.panelDisplayName || row.panelName || ""}
                    </p>
                    <p className="text-sm font-medium truncate">{row.title || row.linkCode}</p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {row.creatorCode ? `@${row.creatorCode}` : "collection"} • {row.linkCode}
                    </p>
                  </div>
                  <div className="text-xs text-muted-foreground whitespace-nowrap">
                    children {Number(row.childrenCount || 0)}
                  </div>
                </div>
                {Array.isArray(row.children) && row.children.length > 0 && (
                  <div className="grid sm:grid-cols-2 gap-2">
                    {row.children.slice(0, 8).map((child: any) => (
                      <div key={child.linkCode} className="rounded border p-2">
                        <p className="text-xs font-medium truncate">{child.title || child.linkCode}</p>
                        <p className="text-[11px] text-muted-foreground truncate">
                          {child.creatorCode ? `@${child.creatorCode}` : child.linkCode}
                        </p>
                        <p className="text-[11px] text-muted-foreground">CCU {fmt(child.ccu)}</p>
                      </div>
                    ))}
                  </div>
                )}
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
