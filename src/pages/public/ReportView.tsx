import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { X } from "lucide-react";
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
  Magnet, Grid3X3, Anchor, RefreshCw, Baby, UsersRound, Wrench, Crosshair, Ban
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
import { dataPublicReportBundle } from "@/lib/discoverDataApi";

const PIE_COLORS = [
  "hsl(24, 100%, 50%)", "hsl(210, 100%, 56%)", "hsl(142, 71%, 45%)",
  "hsl(260, 80%, 60%)", "hsl(38, 92%, 50%)", "hsl(0, 84%, 60%)",
  "hsl(180, 70%, 45%)", "hsl(340, 75%, 55%)", "hsl(120, 60%, 45%)",
  "hsl(290, 60%, 55%)",
];

const EPIC_CREATORS = new Set(["epic", "epic labs", "epic games", "fortnite"]);
const REPORT_CACHE_TTL_MS = 5 * 60 * 1000;
function isEpicCreator(creator: string | null | undefined): boolean {
  return EPIC_CREATORS.has((creator || "").toLowerCase().trim());
}

function getItemCreator(item: any): string {
  return String(
    item?.creator ??
    item?.creator_code ??
    item?.support_code ??
    item?.name ??
    "",
  );
}

function nonEpicItems<T = any>(items: T[] | undefined | null): T[] {
  if (!Array.isArray(items)) return [];
  return items.filter((item: any) => !isEpicCreator(getItemCreator(item)));
}

function diversifyLowEngagementItems(items: any[]): any[] {
  const base = nonEpicItems(items)
    .map((item: any) => ({
      ...item,
      imageUrl: item.image_url,
      subtitle: [item.creator ? `@${item.creator}` : null, item.category || null]
        .filter(Boolean)
         .join(" - "),
    }))
    .slice(0, 20);

  if (base.length <= 1) return base;

  const picked: any[] = [];
  const seenValues = new Set<number>();

  for (const item of base) {
    const val = Number(item.value);
    if (!Number.isFinite(val)) continue;
    if (seenValues.has(val)) continue;
    seenValues.add(val);
    picked.push(item);
    if (picked.length >= 10) break;
  }

  // If there are few distinct values, fallback to original order.
  return picked.length >= 6 ? picked : base.slice(0, 10);
}

function hashHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

function fmt(n: number | null | undefined): string {
  if (n == null) return "--";
  const num = Number(n);
  if (isNaN(num)) return "--";
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + "M";
  if (num >= 1_000) return (num / 1_000).toFixed(1) + "K";
  if (Number.isInteger(num)) return num.toLocaleString("en-US");
  return num.toFixed(2);
}

function pct(n: number | null | undefined): string {
  if (n == null) return "--";
  return (Number(n) * 100).toFixed(1) + "%";
}



type ReportCacheEntry = {
  ts: number;
  data: WeeklyReport;
};

function readCachedReport(slug: string): WeeklyReport | null {
  try {
    const raw = sessionStorage.getItem(`report-cache:${slug}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ReportCacheEntry;
    if (!parsed?.data || typeof parsed.ts !== "number") return null;
    if (Date.now() - parsed.ts > REPORT_CACHE_TTL_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function writeCachedReport(slug: string, data: WeeklyReport): void {
  try {
    const entry: ReportCacheEntry = { ts: Date.now(), data };
    sessionStorage.setItem(`report-cache:${slug}`, JSON.stringify(entry));
  } catch {
    // no-op
  }
}
interface WeeklyReport {
  id: string;
  discover_report_id?: string | null;
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

function hasCoreKpis(kpis: any): boolean {
  if (!kpis || typeof kpis !== "object") return false;
  const hasIslands = kpis.totalIslands != null || kpis.activeIslands != null;
  const hasPlayers = kpis.totalUniquePlayers != null;
  const hasPlays = kpis.totalPlays != null;
  return Boolean(hasIslands && hasPlayers && hasPlays);
}

function hasCoreRankings(rankings: any): boolean {
  if (!rankings || typeof rankings !== "object") return false;
  const hasPerformance = Array.isArray(rankings.topPeakCCU) || Array.isArray(rankings.topPeakCCU_UGC);
  const hasCreators = Array.isArray(rankings.topCreatorsByPlays);
  return Boolean(hasPerformance && hasCreators);
}

// Lightbox for thumbnails
function ImageLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <button onClick={onClose} className="absolute top-4 right-4 text-white/80 hover:text-white"><X className="h-6 w-6" /></button>
      <img src={src} alt="" className="max-w-[90vw] max-h-[85vh] rounded-lg shadow-2xl object-contain" onClick={(e) => e.stopPropagation()} />
    </div>
  );
}

export default function ReportView() {
  const { slug } = useParams<{ slug: string }>();
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "pt-BR" ? "pt-BR" : "en-US";
  const [report, setReport] = useState<WeeklyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [showExposureExplorer, setShowExposureExplorer] = useState(false);
  const openLightbox = useCallback((src: string) => setLightboxSrc(src), []);
  const { toast } = useToast();

  const fmtDateTime = useCallback((iso: string): string => {
    try { return new Date(iso).toLocaleString(locale, { hour12: false }); } catch { return iso; }
  }, [locale]);

  useEffect(() => {
    if (!slug) {
      setReport(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const cached = readCachedReport(slug);
    if (cached) {
      setReport(cached);
      setLoading(false);
    } else {
      setLoading(true);
      setReport(null);
    }

    const load = async () => {
      try {
        const hydrated = await dataPublicReportBundle(slug) as WeeklyReport;

        if (!cancelled) {
          setReport(hydrated);
          setLoading(false);
          writeCachedReport(slug, hydrated);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [slug]);

  const kpis = useMemo(() => report?.kpis_json || {}, [report?.kpis_json]);
  const rankings = useMemo(() => report?.rankings_json || {}, [report?.rankings_json]);
  const aiSections = useMemo(() => report?.ai_sections_json || {}, [report?.ai_sections_json]);
  const editorSections = useMemo(() => report?.editor_sections_json || {}, [report?.editor_sections_json]);
  const exposure = useMemo(() => rankings.discoveryExposure || null, [rankings]);

  const narratives = useMemo(() => {
    const out: Record<string, string | null> = {};
    const localeKey = i18n.language.replace("-", "_");
    for (let i = 1; i <= 30; i++) {
      const sectionKey = `section${i}`;
      const edited = editorSections?.[sectionKey];
      if (edited) {
        out[sectionKey] = edited;
        continue;
      }
      const ai = aiSections?.[sectionKey];
      if (!ai) {
        out[sectionKey] = null;
        continue;
      }
      if (localeKey !== "en" && ai[`narrative_${localeKey}`]) {
        out[sectionKey] = ai[`narrative_${localeKey}`];
      } else {
        out[sectionKey] = ai?.narrative || null;
      }
    }
    return out;
  }, [aiSections, editorSections, i18n.language]);

  const getNarrative = useCallback((sectionNum: number): string | null => {
    return narratives[`section${sectionNum}`] || null;
  }, [narratives]);

  const categoryData = useMemo(() => (
    rankings.categoryPopularity
      ? Object.entries(rankings.categoryPopularity).map(([name, value]) => ({
          name: (!name || name === "None") ? "Fortnite UGC" : name,
          value: value as number,
        }))
      : []
  ), [rankings.categoryPopularity]);

  const lowEngagementItems = useMemo(
    () => diversifyLowEngagementItems(rankings.failedIslandsList || []),
    [rankings.failedIslandsList],
  );
  const partnerSignals = useMemo(
    () => (Array.isArray(rankings.partnerSignals) ? rankings.partnerSignals : []),
    [rankings.partnerSignals],
  );
  const qualityComposite = useMemo(
    () => (Array.isArray(rankings.mapQualityCompositeTop) ? rankings.mapQualityCompositeTop : []),
    [rankings.mapQualityCompositeTop],
  );
  const advocacyGapLeaders = useMemo(
    () => (Array.isArray(rankings.advocacyGapLeaders) ? rankings.advocacyGapLeaders : []),
    [rankings.advocacyGapLeaders],
  );
  const advocacyOverIndexedRecs = useMemo(
    () => (Array.isArray(rankings.advocacyOverIndexedRecs) ? rankings.advocacyOverIndexedRecs : []),
    [rankings.advocacyOverIndexedRecs],
  );
  const exposurePanelTop = useMemo(
    () => (Array.isArray(rankings.exposureEfficiencyPanelTop) ? rankings.exposureEfficiencyPanelTop : []),
    [rankings.exposureEfficiencyPanelTop],
  );
  const exposureCreatorTop = useMemo(
    () => (Array.isArray(rankings.exposureEfficiencyCreatorTop) ? rankings.exposureEfficiencyCreatorTop : []),
    [rankings.exposureEfficiencyCreatorTop],
  );
  const exposureCreatorBottom = useMemo(
    () => (Array.isArray(rankings.exposureEfficiencyCreatorBottom) ? rankings.exposureEfficiencyCreatorBottom : []),
    [rankings.exposureEfficiencyCreatorBottom],
  );
  const linkGraphTopParents = useMemo(
    () => (Array.isArray(rankings?.linkGraphHealth?.top_parents) ? rankings.linkGraphHealth.top_parents : []),
    [rankings?.linkGraphHealth?.top_parents],
  );
  const emergingNow = useMemo(
    () => (Array.isArray(rankings.emergingNow) ? rankings.emergingNow : []),
    [rankings.emergingNow],
  );

  const exposureDeepDive = useMemo(() => {
    const topByPanel = Array.isArray(exposure?.topByPanel) ? exposure.topByPanel : [];
    const panelRankTimeline = Array.isArray(exposure?.panelRankTimeline) ? exposure.panelRankTimeline : [];
    const resolvedCollections = Array.isArray(exposure?.resolvedCollections) ? exposure.resolvedCollections : [];

    const panelAgg = new Map<string, { panel: string; minutes: number; items: Set<string>; profiles: Set<string> }>();
    for (const row of topByPanel) {
      const panel = String(row?.panelDisplayName || row?.panelName || "Unknown");
      const profile = String(row?.targetId || row?.region || "unknown");
      const code = String(row?.linkCode || "");
      const cur = panelAgg.get(panel) || { panel, minutes: 0, items: new Set<string>(), profiles: new Set<string>() };
      cur.minutes += Number(row?.minutesExposed || 0);
      if (code) cur.items.add(code);
      if (profile) cur.profiles.add(profile);
      panelAgg.set(panel, cur);
    }
    const panelMixItems = Array.from(panelAgg.values())
      .map((p) => ({
        name: p.panel,
        panel: p.panel,
        value: Number(p.minutes.toFixed(1)),
        label: `${p.items.size} islands`,
        islands: p.items.size,
        profiles: p.profiles.size,
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);

    const byIslandPanel = new Map<string, { code: string; title: string; creator: string | null; ranks: Set<number>; minutes: number; image_url: string | null }>();
    for (const seg of panelRankTimeline) {
      const code = String(seg?.linkCode || "");
      const panel = String(seg?.panelName || "");
      if (!code || !panel) continue;
      const key = `${code}|||${panel}`;
      const cur = byIslandPanel.get(key) || {
        code,
        title: String(seg?.title || code),
        creator: seg?.creatorCode || null,
        ranks: new Set<number>(),
        minutes: 0,
        image_url: seg?.imageUrl || null,
      };
      const rank = Number(seg?.rank || 0);
      if (rank > 0) cur.ranks.add(rank);
      cur.minutes += Number(seg?.durationMinutes || 0);
      if (!cur.image_url && seg?.imageUrl) cur.image_url = seg.imageUrl;
      byIslandPanel.set(key, cur);
    }
    const rankDynamicsItems = Array.from(byIslandPanel.values())
      .map((x) => {
        const ranks = Array.from(x.ranks.values()).sort((a, b) => a - b);
        const rankSpread = ranks.length > 0 ? ranks[ranks.length - 1] - ranks[0] : 0;
        return {
          name: x.title || x.code,
          code: x.code,
          creator: x.creator,
          value: rankSpread,
          rank_spread: rankSpread,
          distinct_ranks: ranks.length,
          minutes: Number(x.minutes.toFixed(1)),
          image_url: x.image_url || null,
          label: `${ranks.length} ranks`,
        };
      })
      .filter((x) => x.distinct_ranks >= 2)
      .sort((a, b) => b.rank_spread - a.rank_spread || b.minutes - a.minutes)
      .slice(0, 10);

    const collectionCodesInExposure = new Set(
      topByPanel
        .filter((r: any) => String(r?.linkCodeType || "") === "collection")
        .map((r: any) => String(r?.linkCode || "")),
    );
    const resolvedCodes = new Set(resolvedCollections.map((r: any) => String(r?.linkCode || "")));
    const unresolvedCount = Array.from(collectionCodesInExposure).filter((c) => c && !resolvedCodes.has(c)).length;
    const totalChildren = resolvedCollections.reduce((s: number, r: any) => s + Number(r?.childrenCount || 0), 0);
    const topCollections = resolvedCollections
      .map((r: any) => ({
        name: r?.title || r?.linkCode,
        code: r?.linkCode,
        creator: r?.creatorCode || null,
        value: Number(r?.childrenCount || 0),
        children_count: Number(r?.childrenCount || 0),
        image_url: r?.imageUrl || null,
        label: `${r?.panelDisplayName || r?.panelName || "panel"}`,
      }))
      .sort((a: any, b: any) => b.value - a.value)
      .slice(0, 10);

    return {
      panelMixItems,
      panelMixStats: {
        total_panels: panelAgg.size,
        total_minutes: Number(panelMixItems.reduce((s, i) => s + Number(i.value || 0), 0).toFixed(1)),
      },
      rankDynamicsItems,
      rankDynamicsStats: {
        segments: panelRankTimeline.length,
        volatile_items: rankDynamicsItems.length,
      },
      collectionEdgesItems: topCollections,
      collectionEdgesStats: {
        collections_in_exposure: collectionCodesInExposure.size,
        collections_resolved: resolvedCollections.length,
        unresolved_collections: unresolvedCount,
        total_children_resolved: totalChildren,
      },
    };
  }, [exposure]);

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

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    toast({ title: t("common.linkCopied") });
  };

  return (
    <div className="px-6 py-8 max-w-6xl mx-auto pb-20">
      {lightboxSrc && <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
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
            {new Date(report.date_from).toLocaleDateString(locale)} - {new Date(report.date_to).toLocaleDateString(locale)}
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
        <RankingTable title={t("rankings.topPeakCCU")} icon={BarChart3} showImage showBadges onImageClick={openLightbox} items={(rankings.topPeakCCU || []).map((i: any) => ({ ...i, imageUrl: i.image_url }))} />
        <RankingTable title={t("rankings.topPeakCCU_UGC")} icon={BarChart3} showImage showBadges onImageClick={openLightbox} items={(rankings.topPeakCCU_UGC || []).map((i: any) => ({ ...i, imageUrl: i.image_url }))} />
      </div>
      <AiNarrative text={getNarrative(4)} />

      {rankings.epicSpotlight?.topPeakCCU?.length > 0 && (
        <>
          <div className="border-t border-border my-8" />
          <SectionHeader icon={Crown} number={4.5} title="Epic Spotlight" description="Epic maps tracked separately so they do not distort UGC sections" />
          <div className="grid md:grid-cols-2 gap-4 mb-4">
            <RankingTable title="Epic Top Peak CCU" icon={BarChart3} showImage showBadges onImageClick={openLightbox} items={(rankings.epicSpotlight.topPeakCCU || []).map((i: any) => ({ ...i, imageUrl: i.image_url }))} />
            <RankingTable title="Epic Top by Plays" icon={Play} showImage onImageClick={openLightbox} items={(rankings.epicSpotlight.topByPlays || []).map((i: any) => ({ ...i, imageUrl: i.image_url }))} />
          </div>
          <div className="grid md:grid-cols-2 gap-4 mb-4">
            <RankingTable title="Epic Top by Unique Players" icon={Users} showImage onImageClick={openLightbox} items={(rankings.epicSpotlight.topByUniquePlayers || []).map((i: any) => ({ ...i, imageUrl: i.image_url }))} />
            <RankingTable title="Epic Movers (WoW)" icon={TrendingUp} showImage onImageClick={openLightbox} items={(rankings.epicSpotlight.risers || []).map((i: any) => ({ ...i, imageUrl: i.image_url }))} />
          </div>
          <AiNarrative text={getNarrative(28)} />
        </>
      )}

      <div className="border-t border-border my-8" />

      {/* Section 5 (New Islands) */}
      <SectionHeader icon={Sparkles} number={5} title={t("reportSections.s5Title")} description={t("reportSections.s5Desc")} />
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <RankingTable title={t("rankings.topNewByPlays")} icon={Play} showImage showBadges onImageClick={openLightbox} items={nonEpicItems((rankings.topNewIslandsByPlaysPublished || rankings.topNewIslandsByPlays || [])).map((i: any) => ({ ...i, imageUrl: i.image_url }))} />
        <RankingTable title={t("rankings.topNewByCCU")} icon={BarChart3} showImage onImageClick={openLightbox} items={nonEpicItems(rankings.topNewIslandsByCCU || []).map((i: any) => ({ ...i, imageUrl: i.image_url }))} />
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
        <RankingTable title={t("rankings.topD1")} icon={TrendingUp} showImage onImageClick={openLightbox} items={nonEpicItems(rankings.topRetentionD1 || []).map((i: any) => ({ ...i, imageUrl: i.image_url }))} valueFormatter={(v) => pct(Number(v))} />
        <RankingTable title={t("rankings.topD7")} icon={TrendingUp} showImage onImageClick={openLightbox} items={nonEpicItems(rankings.topRetentionD7 || []).map((i: any) => ({ ...i, imageUrl: i.image_url }))} valueFormatter={(v) => pct(Number(v))} />
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
        <RankingTable title={t("rankings.topAvgMinutes")} icon={Clock} showImage onImageClick={openLightbox} items={nonEpicItems(rankings.topAvgMinutesPerPlayer || []).map((i: any) => ({ ...i, imageUrl: i.image_url }))} valueFormatter={(v) => Number(v).toFixed(1) + " min"} />
        <RankingTable title={t("rankings.topMinutesPlayed")} icon={Clock} showImage onImageClick={openLightbox} items={nonEpicItems(rankings.topMinutesPlayed || []).map((i: any) => ({ ...i, imageUrl: i.image_url }))} />
      </div>
      {qualityComposite.length > 0 && (
        <div className="grid md:grid-cols-1 gap-4 mb-4">
          <RankingTable
            title="Section 8.1 - Composite Quality (Minutes + Advocacy + D7)"
            icon={Flame}
            showImage
            showBadges
            onImageClick={openLightbox}
            items={qualityComposite.map((i: any) => ({ ...i, imageUrl: i.image_url }))}
            valueFormatter={(v) => `${Number(v).toFixed(1)} Q`}
          />
        </div>
      )}
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
        <RankingTable
          title={t("rankings.lowEngagement")}
          icon={AlertTriangle}
          showImage
          onImageClick={openLightbox}
          items={lowEngagementItems}
          barColor="bg-destructive"
        />
      </div>
      <AiNarrative text={getNarrative(9)} />

      <div className="border-t border-border my-8" />

      {/* Section 10 (Plays per Player) */}
      <SectionHeader icon={Zap} number={10} title={t("reportSections.s10Title")} description={t("reportSections.s10Desc")} />
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <RankingTable title={t("rankings.playsPerPlayer")} icon={Zap} showImage onImageClick={openLightbox} items={nonEpicItems(rankings.topPlaysPerPlayer || []).map((i: any) => ({ ...i, imageUrl: i.image_url }))} valueFormatter={(v) => Number(v).toFixed(2)} />
      </div>
      <AiNarrative text={getNarrative(10)} />

      <div className="border-t border-border my-8" />

      {/* Section 11 (Advocacy) */}
      <SectionHeader icon={Target} number={11} title={t("reportSections.s11Title")} description={t("reportSections.s11Desc")} />
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <RankingTable title={t("rankings.favsPer100")} icon={Star} showImage onImageClick={openLightbox} items={nonEpicItems(rankings.topFavsPer100 || []).map((i: any) => ({ ...i, imageUrl: i.image_url }))} valueFormatter={(v) => Number(v).toFixed(2) + "%"} />
        <RankingTable title={t("rankings.recsPer100")} icon={ThumbsUp} showImage onImageClick={openLightbox} items={nonEpicItems(rankings.topRecPer100 || []).map((i: any) => ({ ...i, imageUrl: i.image_url }))} valueFormatter={(v) => Number(v).toFixed(2) + "%"} />
      </div>
      {(advocacyGapLeaders.length > 0 || advocacyOverIndexedRecs.length > 0) && (
        <div className="grid md:grid-cols-2 gap-4 mb-4">
          <RankingTable
            title="Section 11.1 - Favorite-heavy (Gap Fav - Rec)"
            icon={Star}
            showImage
            onImageClick={openLightbox}
            items={advocacyGapLeaders.map((i: any) => ({ ...i, imageUrl: i.image_url }))}
            valueFormatter={(v) => Number(v).toFixed(2)}
          />
          <RankingTable
            title="Section 11.1 - Recommendation-heavy (Gap Fav - Rec)"
            icon={ThumbsUp}
            showImage
            onImageClick={openLightbox}
            items={advocacyOverIndexedRecs.map((i: any) => ({ ...i, imageUrl: i.image_url }))}
            valueFormatter={(v) => Number(v).toFixed(2)}
            barColor="bg-destructive"
          />
        </div>
      )}
      <AiNarrative text={getNarrative(11)} />

      <div className="border-t border-border my-8" />

      {/* Section 12 (Efficiency) */}
      <SectionHeader icon={Zap} number={12} title={t("reportSections.s12Title")} description={t("reportSections.s12Desc")} />
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <RankingTable title={t("rankings.topFavsPerPlay")} icon={Star} showImage onImageClick={openLightbox} items={nonEpicItems(rankings.topFavsPerPlay || []).map((i: any) => ({ ...i, imageUrl: i.image_url }))} valueFormatter={(v) => Number(v).toFixed(4)} />
        <RankingTable title={t("rankings.topRecsPerPlay")} icon={ThumbsUp} showImage onImageClick={openLightbox} items={nonEpicItems(rankings.topRecsPerPlay || []).map((i: any) => ({ ...i, imageUrl: i.image_url }))} valueFormatter={(v) => Number(v).toFixed(4)} />
      </div>
      <AiNarrative text={getNarrative(12)} />

      <div className="border-t border-border my-8" />

      {/* Section 13 (Stickiness) */}
      <SectionHeader icon={Magnet} number={13} title={t("reportSections.s13Title")} description={t("reportSections.s13Desc")} />
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <RankingTable title={t("rankings.topStickinessD1")} icon={Magnet} showImage onImageClick={openLightbox} items={nonEpicItems(rankings.topStickinessD1 || []).map((i: any) => ({ ...i, imageUrl: i.image_url }))} />
        <RankingTable title={t("rankings.topStickinessD7")} icon={Magnet} showImage onImageClick={openLightbox} items={nonEpicItems(rankings.topStickinessD7 || []).map((i: any) => ({ ...i, imageUrl: i.image_url }))} />
      </div>
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <RankingTable title={t("rankings.topStickinessD1_UGC")} icon={Magnet} showImage onImageClick={openLightbox} items={nonEpicItems(rankings.topStickinessD1_UGC || []).map((i: any) => ({ ...i, imageUrl: i.image_url }))} />
        <RankingTable title={t("rankings.topStickinessD7_UGC")} icon={Magnet} showImage onImageClick={openLightbox} items={nonEpicItems(rankings.topStickinessD7_UGC || []).map((i: any) => ({ ...i, imageUrl: i.image_url }))} />
      </div>
      <AiNarrative text={getNarrative(13)} />

      <div className="border-t border-border my-8" />

      {/* Section 14 (Retention Adj Engagement) */}
      <SectionHeader icon={Target} number={14} title={t("reportSections.s14Title")} description={t("reportSections.s14Desc")} />
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <RankingTable title={t("rankings.topRetentionAdjD1")} icon={Target} showImage onImageClick={openLightbox} items={nonEpicItems(rankings.topRetentionAdjD1 || []).map((i: any) => ({ ...i, imageUrl: i.image_url }))} valueFormatter={(v) => Number(v).toFixed(1)} />
        <RankingTable title={t("rankings.topRetentionAdjD7")} icon={Target} showImage onImageClick={openLightbox} items={nonEpicItems(rankings.topRetentionAdjD7 || []).map((i: any) => ({ ...i, imageUrl: i.image_url }))} valueFormatter={(v) => Number(v).toFixed(1)} />
      </div>
      <AiNarrative text={getNarrative(14)} />

      <div className="border-t border-border my-8" />

      {/* Section 15 (Category) */}
      <SectionHeader icon={Layers} number={15} title={t("reportSections.s15Title")} description={t("reportSections.s15Desc")} />
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
      {partnerSignals.length > 0 && (
        <Card className="mb-4 border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Section 15.5 - Partner Signals</CardTitle>
            <p className="text-xs text-muted-foreground">
              Internal codename tracking for potential partner IP onboarding. Aggregated only; no island names or island codes shown.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {partnerSignals.map((s: any, idx: number) => (
              <div key={`${s.codename || "sig"}:${idx}`} className="flex items-center justify-between gap-3 border rounded-md px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{s.projectName || s.codename || "Partner Signal"}</p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    codename: {s.codename || "n/a"} - islands: {fmt(Number(s.islands || 0))} - players: {fmt(Number(s.players || 0))}
                  </p>
                </div>
                <div className="text-xs text-right whitespace-nowrap">
                  <div className="font-semibold">{fmt(Number(s.plays || 0))} plays</div>
                  <div className="text-muted-foreground">{Number(s.sharePlaysPct || 0).toFixed(2)}%</div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      <AiNarrative text={getNarrative(15)} />

      <div className="border-t border-border my-8" />

      {/* Section 16 (Growth/Breakouts) */}
      <SectionHeader icon={Rocket} number={16} title={t("reportSections.s16Title")} description={t("reportSections.s16Desc")} />
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <RankingTable title={t("rankings.topWeeklyGrowth")} icon={Rocket} showImage onImageClick={openLightbox} items={nonEpicItems(rankings.topWeeklyGrowth || []).map((i: any) => ({ ...i, imageUrl: i.image_url }))} barColor="bg-success" />
      </div>
      <AiNarrative text={getNarrative(16)} />

      <div className="border-t border-border my-8" />

      {/* Section 17 (Risers) */}
      <SectionHeader icon={TrendingUp} number={17} title={t("reportSections.s17Title")} description={t("reportSections.s17Desc")} />
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <RankingTable title={t("rankings.topRisers")} icon={TrendingUp} showImage onImageClick={openLightbox} items={nonEpicItems(rankings.topRisers || []).map((i: any) => ({ ...i, imageUrl: i.image_url }))} barColor="bg-success" />
        <RankingTable title={t("rankings.topDecliners")} icon={TrendingDown} showImage onImageClick={openLightbox} items={nonEpicItems(rankings.topDecliners || []).map((i: any) => ({ ...i, imageUrl: i.image_url }))} barColor="bg-destructive" />
      </div>
      <AiNarrative text={getNarrative(17)} />

      <div className="border-t border-border my-8" />

      {/* Section 18 (Lifecycle) */}
      <SectionHeader icon={HeartPulse} number={18} title={t("reportSections.s18Title")} description={t("reportSections.s18Desc")} />
      <div className="grid grid-cols-2 gap-3 mb-4">
        <KpiCard icon={HeartPulse} label={t("kpis.revived")} value={fmt(kpis.revivedCount)} />
        <KpiCard icon={Skull} label={t("kpis.dead")} value={fmt(kpis.deadCount)} />
      </div>
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <RankingTable title={t("rankings.revivedIslands")} icon={HeartPulse} showImage onImageClick={openLightbox} items={nonEpicItems(rankings.revivedIslands || []).map((i: any) => ({ ...i, imageUrl: i.image_url }))} barColor="bg-success" />
        <RankingTable title={t("rankings.deadIslands")} icon={Skull} showImage onImageClick={openLightbox} items={nonEpicItems(rankings.deadIslands || []).map((i: any) => ({ ...i, imageUrl: i.image_url }))} barColor="bg-destructive" />
      </div>
      <AiNarrative text={getNarrative(18)} />

      <div className="border-t border-border my-8" />

      {/* Section 19 (Exposure) */}
      <TooltipProvider>
        <SectionHeader icon={EyeOff} number={19} title={t("reportSections.s19Title")} description={t("reportSections.s19Desc")} />
        {exposure?.profiles?.length > 0 ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <KpiCard icon={Layers} label="19.1 Panels" value={fmt(exposureDeepDive.panelMixStats.total_panels)} />
              <KpiCard icon={Clock} label="19.1 Min (sample)" value={fmt(exposureDeepDive.panelMixStats.total_minutes)} />
              <KpiCard icon={TrendingUp} label="19.2 Volatile items" value={fmt(exposureDeepDive.rankDynamicsStats.volatile_items)} />
              <KpiCard icon={Grid3X3} label="19.3 Collections resolved" value={fmt(exposureDeepDive.collectionEdgesStats.collections_resolved)} />
            </div>
            <div className="grid md:grid-cols-3 gap-4 mb-4">
              <RankingTable
                title="19.1 Panel Mix (Discovery)"
                icon={Layers}
                items={exposureDeepDive.panelMixItems}
                valueFormatter={(v) => `${fmt(Number(v))} min`}
              />
              <RankingTable
                title="19.2 Rank Dynamics (Spread)"
                icon={TrendingUp}
                showImage
                onImageClick={openLightbox}
                items={exposureDeepDive.rankDynamicsItems.map((i: any) => ({ ...i, imageUrl: i.image_url }))}
              />
              <RankingTable
                title="19.3 Collection Edges (Children)"
                icon={Grid3X3}
                showImage
                onImageClick={openLightbox}
                items={exposureDeepDive.collectionEdgesItems.map((i: any) => ({ ...i, imageUrl: i.image_url }))}
              />
            </div>
            {!showExposureExplorer && (
              <Card className="border-border/50 mb-4">
                <CardContent className="py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm text-muted-foreground">
                    <div>{t("reportSections.s19Desc")}</div>
                    <div>
                      {t("common.panels")}: {Array.isArray(exposure?.panels) ? exposure.panels.length : 0} |{" "}
                      {t("common.profile")}: {Array.isArray(exposure?.profiles) ? exposure.profiles.length : 0}
                    </div>
                  </div>
                  <Button size="sm" onClick={() => setShowExposureExplorer(true)}>
                    Open Explorer
                  </Button>
                </CardContent>
              </Card>
            )}
            {showExposureExplorer && (
              <DiscoveryExposureSection exposure={exposure} weeklyReportId={report.id} t={t} locale={locale} fmtDateTime={fmtDateTime} />
            )}
          </>
        ) : (
          <Card className="border-border/50 mb-4">
            <CardContent className="py-6 text-sm text-muted-foreground">{t("common.noData")}</CardContent>
          </Card>
        )}
        <AiNarrative text={getNarrative(19)} />
      </TooltipProvider>

      <div className="border-t border-border my-8" />

      {/* Section 20 (Multi-Panel Presence) */}
      <SectionHeader icon={Grid3X3} number={20} title={t("reportSections.s20Title")} description={t("reportSections.s20Desc")} />
      {rankings.multiPanelPresence?.length > 0 ? (
        <Card className="backdrop-blur-sm bg-card/80 border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Grid3X3 className="h-4 w-4 text-primary" />
              {t("rankings.multiPanelPresence")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {(rankings.multiPanelPresence || []).slice(0, 10).map((item: any, idx: number) => {
              const badge = idx < 3 ? ["#1", "#2", "#3"][idx] : null;
              const badgeBg = idx < 3 ? [
                "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-yellow-500/30",
                "bg-gray-400/15 text-gray-500 dark:text-gray-300 border-gray-400/30",
                "bg-amber-600/15 text-amber-700 dark:text-amber-400 border-amber-600/30",
              ][idx] : "";
              const breakdown = item.panel_breakdown || [];
              const totalMinutes = breakdown.reduce((s: number, p: any) => s + (p.minutes || 0), 0);
              return (
                <details key={idx} className="group">
                  <summary className="flex items-center gap-3 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                    {badge ? (
                      <span className={`flex items-center justify-center h-6 w-6 rounded-full border text-xs font-bold shrink-0 ${badgeBg}`}>{badge}</span>
                    ) : (
                      <span className="text-xs font-mono text-muted-foreground w-6 text-center shrink-0">{idx + 1}</span>
                    )}
                    {item.image_url && (
                      <img src={item.image_url} alt="" className="h-8 w-8 rounded object-cover shrink-0 border border-border/30 cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all" loading="lazy"
                        onClick={(e) => { e.preventDefault(); openLightbox(item.image_url); }}
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    )}
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-medium truncate block">{item.title || item.link_code}</span>
                      <span className="text-[10px] text-muted-foreground truncate block">
                        @{item.creator_code || "unknown"} | {item.panels_distinct} panels | {fmt(totalMinutes)} min total
                      </span>
                    </div>
                    <span className="text-xs font-display font-semibold whitespace-nowrap">{item.panels_distinct} panels</span>
                    <span className="text-muted-foreground text-xs group-open:rotate-90 transition-transform">{">"}</span>
                  </summary>
                  <div className="mt-2 ml-9 space-y-1">
                    {breakdown.map((p: any, pi: number) => (
                      <div key={pi} className="flex items-center gap-2 text-[11px]">
                        <span className="w-4 text-center text-muted-foreground font-mono">{pi + 1}</span>
                        <span className="flex-1 truncate font-medium">{p.panel}</span>
                        <span className="text-muted-foreground">{fmt(p.minutes)} min</span>
                        <span className="text-muted-foreground">{p.appearances} appearances</span>
                        {p.best_rank && <span className="text-primary text-[10px]">#{p.best_rank}</span>}
                      </div>
                    ))}
                  </div>
                </details>
              );
            })}
          </CardContent>
        </Card>
      ) : (
        <Card className="border-border/50 mb-4">
          <CardContent className="py-6 text-sm text-muted-foreground">{t("common.noData")}</CardContent>
        </Card>
      )}
      <AiNarrative text={getNarrative(20)} />
      <div className="border-t border-border my-8" />

      {/* Section 21 (Panel Loyalty) */}
      <SectionHeader icon={Anchor} number={21} title={t("reportSections.s21Title")} description={t("reportSections.s21Desc")} />
      {rankings.panelLoyalty?.length > 0 ? (
        <RankingTable
          title={t("rankings.panelLoyalty")}
          icon={Anchor}
          showImage
          showBadges
          onImageClick={openLightbox}
          items={(rankings.panelLoyalty || []).map((item: any) => ({
            name: item.title || item.link_code,
            code: item.link_code,
          subtitle: `@${item.creator || item.creator_code || "unknown"} - ${fmt(item.week_plays || 0)} plays`,
            value: item.total_minutes_in_panel,
            label: `${fmt(item.total_minutes_in_panel)} min`,
            imageUrl: item.image_url,
          }))}
        />
      ) : (
        <Card className="border-border/50 mb-4">
          <CardContent className="py-6 text-sm text-muted-foreground">{t("common.noData")}</CardContent>
        </Card>
      )}
      <AiNarrative text={getNarrative(21)} />
      <div className="border-t border-border my-8" />

      {/* Section 22 (Most Updated Islands) */}
      {(rankings.mostUpdatedIslandsThisWeek?.length > 0 || rankings.mostUpdatedIslandsWeekly?.length > 0 || rankings.versionEnrichment) && (() => {
        const allUpdated = (rankings.mostUpdatedIslandsThisWeek || []).map((item: any) => ({
          name: item.name || item.title || item.code || item.island_code,
          code: item.code || item.island_code,
          subtitle: `@${item.creator || item.creator_code || "unknown"} - ${fmt(item.week_plays || 0)} plays - ${fmt(item.weekly_updates || 0)} updates/w`,
          value: Number(item.version || item.value || 0),
          label: item.version ? `v${item.version}` : undefined,
          imageUrl: item.imageUrl || item.image_url,
          _creator: item.creator || item.creator_code || "",
          _version: Number(item.version || 0),
          _weeklyUpdates: Number(item.weekly_updates || 0),
          _weekPlays: Number(item.week_plays || item.value || 0),
        }));
        const allWeeklyUpdated = ((rankings.mostUpdatedIslandsWeekly || rankings.mostUpdatedIslandsThisWeek || []) as any[]).map((item: any) => ({
          name: item.name || item.title || item.code || item.island_code,
          code: item.code || item.island_code,
          subtitle: `@${item.creator || item.creator_code || "unknown"} - v${item.version || 0} - ${fmt(item.week_plays || 0)} plays`,
          value: Number(item.weekly_updates || item.value || 0),
          label: `${fmt(item.weekly_updates || item.value || 0)} upd`,
          imageUrl: item.imageUrl || item.image_url,
          _creator: item.creator || item.creator_code || "",
          _version: Number(item.version || 0),
          _weeklyUpdates: Number(item.weekly_updates || item.value || 0),
          _weekPlays: Number(item.week_plays || 0),
        }));
        const sortedUpdated = [...allUpdated].sort((a: any, b: any) =>
          (b._version || 0) - (a._version || 0) || (b._weekPlays || 0) - (a._weekPlays || 0)
        );
        const sortedWeeklyUpdated = [...allWeeklyUpdated].sort((a: any, b: any) =>
          (b._weeklyUpdates || 0) - (a._weeklyUpdates || 0) || (b._version || 0) - (a._version || 0) || (b._weekPlays || 0) - (a._weekPlays || 0)
        );
        const epicUpdated = sortedUpdated.filter((i: any) => isEpicCreator(i._creator));
        const ugcUpdated = sortedUpdated.filter((i: any) => !isEpicCreator(i._creator));
        const epicWeeklyUpdated = sortedWeeklyUpdated.filter((i: any) => isEpicCreator(i._creator));
        const ugcWeeklyUpdated = sortedWeeklyUpdated.filter((i: any) => !isEpicCreator(i._creator));
        return (
          <>
            <SectionHeader icon={RefreshCw} number={22} title={t("reportSections.s22Title")} description={t("reportSections.s22Desc")} />
            {rankings.versionEnrichment && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
                <KpiCard icon={RefreshCw} label={t("kpis.avgVersion")} value={String(rankings.versionEnrichment.avgVersion || "--")} />
                <KpiCard icon={RefreshCw} label={t("kpis.v5PlusIslands")} value={fmt(rankings.versionEnrichment.islandsWithVersion5Plus)} />
                <KpiCard icon={RefreshCw} label={t("kpis.totalWithVersion")} value={fmt(rankings.versionEnrichment.totalWithVersion)} />
              </div>
            )}
            <div className="grid md:grid-cols-2 gap-4 mb-4">
              {ugcUpdated.length > 0 && (
                <RankingTable title={t("rankings.mostUpdated") + " - Versao Total (UGC)"} icon={RefreshCw} showBadges showImage onImageClick={openLightbox} items={ugcUpdated.slice(0, 10)} />
              )}
              {epicUpdated.length > 0 && (
                <RankingTable title={t("rankings.mostUpdated") + " - Versao Total (Epic)"} icon={RefreshCw} showImage onImageClick={openLightbox} items={epicUpdated.slice(0, 10)} />
              )}
            </div>
            <div className="grid md:grid-cols-2 gap-4 mb-4">
              {ugcWeeklyUpdated.length > 0 && (
                <RankingTable title={t("rankings.mostUpdated") + " - Updates na Semana (UGC)"} icon={RefreshCw} showBadges showImage onImageClick={openLightbox} items={ugcWeeklyUpdated.slice(0, 10)} />
              )}
              {epicWeeklyUpdated.length > 0 && (
                <RankingTable title={t("rankings.mostUpdated") + " - Updates na Semana (Epic)"} icon={RefreshCw} showImage onImageClick={openLightbox} items={epicWeeklyUpdated.slice(0, 10)} />
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
              subtitle: `${item.island_count} island${item.island_count > 1 ? "s" : ""} | Best: ${item.best_island_title || item.best_island_code}`,
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
              subtitle: `${fmt(item.island_count)} islands | D1: ${pct(item.avg_d1)} | D7: ${pct(item.avg_d7)}`,
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
            {[
              { data: rankings.topExposureEfficiency || [], title: t("rankings.topExposureEfficiency"), icon: Crosshair, barColor: "bg-primary" },
              { data: rankings.worstExposureEfficiency || [], title: t("rankings.worstExposureEfficiency"), icon: AlertTriangle, barColor: "bg-destructive" },
            ].map(({ data, title: cardTitle, icon: CardIcon, barColor }) => (
              <Card key={cardTitle} className="backdrop-blur-sm bg-card/80 border-border/50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <CardIcon className="h-4 w-4 text-primary" />
                    {cardTitle}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {data.slice(0, 10).map((item: any, idx: number) => {
                    const badge = barColor !== "bg-destructive" && idx < 3 ? ["#1", "#2", "#3"][idx] : null;
                    const badgeBg = idx < 3 ? [
                      "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-yellow-500/30",
                      "bg-gray-400/15 text-gray-500 dark:text-gray-300 border-gray-400/30",
                      "bg-amber-600/15 text-amber-700 dark:text-amber-400 border-amber-600/30",
                    ][idx] : "";
                    const breakdown = item.panel_breakdown || [];
                    return (
                      <details key={idx} className="group">
                        <summary className="flex items-center gap-3 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                          {badge ? (
                            <span className={`flex items-center justify-center h-6 w-6 rounded-full border text-xs font-bold shrink-0 ${badgeBg}`}>{badge}</span>
                          ) : (
                            <span className="text-xs font-mono text-muted-foreground w-6 text-center shrink-0">{idx + 1}</span>
                          )}
                          {item.image_url && (
                            <img src={item.image_url} alt="" className="h-8 w-8 rounded object-cover shrink-0 border border-border/30 cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all" loading="lazy"
                              onClick={(e) => { e.preventDefault(); openLightbox(item.image_url); }}
                              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                          )}
                          <div className="flex-1 min-w-0">
                            <span className="text-xs font-medium truncate block">{item.title || item.island_code}</span>
                            <span className="text-[10px] text-muted-foreground truncate block">
                              @{item.creator_code || "?"} | {fmt(item.total_minutes_exposed)} min exposed | {item.distinct_panels} panels
                            </span>
                          </div>
                          <span className="text-xs font-display font-semibold whitespace-nowrap">{fmt(item.plays_per_min_exposed)} plays/min</span>
                          <span className="text-muted-foreground text-xs group-open:rotate-90 transition-transform">{">"}</span>
                        </summary>
                        {breakdown.length > 0 && (
                          <div className="mt-2 ml-9 space-y-1">
                            {breakdown.map((p: any, pi: number) => (
                              <div key={pi} className="flex items-center gap-2 text-[11px]">
                                <span className="w-4 text-center text-muted-foreground font-mono">{pi + 1}</span>
                                <span className="flex-1 truncate font-medium">{p.panel}</span>
                                <span className="text-muted-foreground">{fmt(p.minutes)} min</span>
                                <span className="text-muted-foreground">{p.appearances} appearances</span>
                                {p.best_rank && <span className="text-primary text-[10px]">#{p.best_rank}</span>}
                              </div>
                            ))}
                          </div>
                        )}
                      </details>
                    );
                  })}
                </CardContent>
              </Card>
            ))}
          </div>
          {(exposurePanelTop.length > 0 || exposureCreatorTop.length > 0 || exposureCreatorBottom.length > 0) && (
            <>
              <div className="grid md:grid-cols-2 gap-4 mb-4">
                <RankingTable
                  title="26.1 Panel Conversion (Plays / Min)"
                  icon={Layers}
                  items={exposurePanelTop}
                  valueFormatter={(v) => Number(v).toFixed(2)}
                />
                <RankingTable
                  title="26.2 Creator Conversion (Top)"
                  icon={Users}
                  items={exposureCreatorTop}
                  valueFormatter={(v) => Number(v).toFixed(2)}
                />
              </div>
              {exposureCreatorBottom.length > 0 && (
                <div className="grid md:grid-cols-1 gap-4 mb-4">
                  <RankingTable
                    title="26.2 Creator Conversion (Bottom)"
                    icon={AlertTriangle}
                    items={exposureCreatorBottom}
                    valueFormatter={(v) => Number(v).toFixed(2)}
                    barColor="bg-destructive"
                  />
                </div>
              )}
            </>
          )}
          <AiNarrative text={getNarrative(26)} />
        </>
      )}

      <div className="border-t border-border my-8" />

      {/* Section 27 (Discovery Pollution) */}
      {rankings.discoveryPollution?.length > 0 && (
        <>
          <SectionHeader icon={Ban} number={27} title={t("reportSections.s27Title")} description={t("reportSections.s27Desc")} />
          <Card className="backdrop-blur-sm bg-card/80 border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Ban className="h-4 w-4 text-destructive" />
                {t("reportSections.s27Title")} (7d)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(rankings.discoveryPollution || []).map((item: any, idx: number) => {
                const isTop = item.spam_score >= 100;
                return (
                  <details key={idx} className="group">
                    <summary className="flex items-center gap-3 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                      <span className={`text-xs font-mono w-6 text-center shrink-0 ${isTop ? "text-destructive font-bold" : "text-muted-foreground"}`}>
                        {idx + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <span className="text-xs font-medium truncate block">
                          @{item.creator_code}
                        </span>
                        <span className="text-[10px] text-muted-foreground truncate block">
                          clusters: {item.duplicate_clusters_7d} | islands: {item.duplicate_islands_7d} | over min: {item.duplicates_over_min}
                        </span>
                      </div>
                      <span className={`text-xs font-display font-semibold whitespace-nowrap ${isTop ? "text-destructive" : "text-primary"}`}>
                        Score {item.spam_score}
                      </span>
                      <span className="text-muted-foreground text-xs group-open:rotate-90 transition-transform">{">"}</span>
                    </summary>
                    {Array.isArray(item.sample_titles) && item.sample_titles.length > 0 && (
                      <div className="mt-2 ml-9 space-y-1">
                        {item.sample_titles.map((title: string, ti: number) => (
                          <div key={ti} className="text-[11px] text-muted-foreground flex items-center gap-2">
                            <span className="w-4 text-center font-mono">{ti + 1}</span>
                            <span className="truncate">{title}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </details>
                );
              })}
            </CardContent>
          </Card>
          <AiNarrative text={getNarrative(27)} />
        </>
      )}

      {(rankings.linkGraphHealth || linkGraphTopParents.length > 0) && (
        <>
          <div className="border-t border-border my-8" />
          <SectionHeader icon={Layers} number={29} title={t("reportSections.s29Title")} description={t("reportSections.s29Desc")} />
          {rankings.linkGraphHealth && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
              <KpiCard icon={Layers} label="Total edges" value={fmt(rankings.linkGraphHealth.total_edges)} />
              <KpiCard icon={TrendingUp} label="Seen in week" value={fmt(rankings.linkGraphHealth.edges_seen_in_week)} />
              <KpiCard icon={Grid3X3} label="Active parents" value={fmt(rankings.linkGraphHealth.active_parents_in_week)} />
              <KpiCard icon={Users} label="Active children" value={fmt(rankings.linkGraphHealth.active_children_in_week)} />
              <KpiCard icon={Target} label="Freshness %" value={`${Number(rankings.linkGraphHealth.freshness_pct || 0).toFixed(1)}%`} />
            </div>
          )}
          {linkGraphTopParents.length > 0 ? (
            <div className="grid md:grid-cols-1 gap-4 mb-4">
              <RankingTable
                title="Top Parent Collections by Edge Volume"
                icon={Grid3X3}
                showImage
                onImageClick={openLightbox}
                items={linkGraphTopParents.map((i: any) => ({ ...i, imageUrl: i.image_url }))}
              />
            </div>
          ) : (
            <Card className="border-border/50 mb-4">
              <CardContent className="py-6 text-sm text-muted-foreground">{t("common.noData")}</CardContent>
            </Card>
          )}
          <AiNarrative text={getNarrative(29)} />
        </>
      )}

      {(emergingNow.length > 0 || rankings.emergingNowStats) && (
        <>
          <div className="border-t border-border my-8" />
          <SectionHeader icon={Rocket} number={30} title={t("reportSections.s30Title")} description={t("reportSections.s30Desc")} />
          {rankings.emergingNowStats && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
              <KpiCard icon={Sparkles} label="Emerging islands" value={fmt(rankings.emergingNowStats.total_emerging_islands)} />
              <KpiCard icon={TrendingUp} label="Avg score" value={fmt(rankings.emergingNowStats.avg_score)} />
              <KpiCard icon={Target} label="Top score" value={fmt(rankings.emergingNowStats.top_score)} />
            </div>
          )}
          {emergingNow.length > 0 ? (
            <div className="grid md:grid-cols-1 gap-4 mb-4">
              <RankingTable
                title="Emerging Now (Discovery, 24h)"
                icon={Rocket}
                showImage
                showBadges
                onImageClick={openLightbox}
                items={emergingNow.map((i: any) => ({
                  ...i,
                  name: i.title || i.code,
                  code: i.code,
                  creator: i.creator_code,
                  value: i.score,
                  label: `${fmt(i.minutes_24h)} min / ${i.panels_24h} panels`,
                  imageUrl: i.image_url,
                }))}
                valueFormatter={(v) => Number(v).toFixed(2)}
              />
            </div>
          ) : (
            <Card className="border-border/50 mb-4">
              <CardContent className="py-6 text-sm text-muted-foreground">{t("common.noData")}</CardContent>
            </Card>
          )}
          <AiNarrative text={getNarrative(30)} />
        </>
      )}
    </div>
  );
}

function DiscoveryExposureSection({ exposure, weeklyReportId, t, locale, fmtDateTime }: { exposure: any; weeklyReportId: string; t: any; locale: string; fmtDateTime: (iso: string) => string }) {
  const DISCOVERY_SURFACE = "CreativeDiscoverySurface_Frontend";
  const profilesAll = Array.isArray(exposure?.profiles) ? exposure.profiles : [];
  const panelsAll = Array.isArray(exposure?.panels) ? exposure.panels : [];
  const profiles = profilesAll.filter((p: any) => String(p?.surfaceName) === DISCOVERY_SURFACE);
  const profileIdSet = new Set(profiles.map((p: any) => String(p.targetId)));
  const panels = panelsAll.filter(
    (p: any) =>
      profileIdSet.has(String(p?.target_id)) &&
      String(p?.surface_name || DISCOVERY_SURFACE) === DISCOVERY_SURFACE,
  );
  const embeddedTimeline = Array.isArray(exposure?.panelRankTimeline) ? exposure.panelRankTimeline : [];
  const embeddedTimelineTruncated = Boolean(exposure?.meta?.embeddedTimelineTruncated);
  const topByPanel = Array.isArray(exposure?.topByPanel) ? exposure.topByPanel : [];
  const resolvedCollections = Array.isArray(exposure?.resolvedCollections) ? exposure.resolvedCollections : [];

  const weekRangeStart = new Date(exposure?.meta?.rangeStart || "").getTime();
  const weekRangeEnd = new Date(exposure?.meta?.rangeEnd || "").getTime();
  const weekRangeMs = Math.max(1, weekRangeEnd - weekRangeStart);

  const [profileId, setProfileId] = useState<string>(profiles[0]?.targetId || "");
  const panelOptions = useMemo(
    () => panels.filter((p: any) => String(p.target_id) === profileId),
    [panels, profileId],
  );
  const [panelName, setPanelName] = useState<string>(panelOptions[0]?.panelName || "");
  const [rankMax, setRankMax] = useState<number>(10);
  const [timelineScaleMode, setTimelineScaleMode] = useState<"data" | "week">("data");
  const [loadingFull, setLoadingFull] = useState(false);
  const [fullTimeline, setFullTimeline] = useState<any[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const activeTimeline = fullTimeline.length > 0 ? fullTimeline : embeddedTimeline;
  const filteredTimeline = useMemo(
    () =>
      activeTimeline.filter(
        (s: any) =>
          String(s.targetId) === profileId &&
          String(s.panelName) === panelName &&
          String(s.surfaceName || DISCOVERY_SURFACE) === DISCOVERY_SURFACE,
      ),
    [activeTimeline, profileId, panelName],
  );

  const observedStart = useMemo(() => {
    if (filteredTimeline.length === 0) return weekRangeStart;
    let minTs = Number.POSITIVE_INFINITY;
    for (const s of filteredTimeline) {
      const ts = new Date(s.start).getTime();
      if (Number.isFinite(ts)) minTs = Math.min(minTs, ts);
    }
    return Number.isFinite(minTs) ? minTs : weekRangeStart;
  }, [filteredTimeline, weekRangeStart]);

  const observedEnd = useMemo(() => {
    if (filteredTimeline.length === 0) return weekRangeEnd;
    let maxTs = Number.NEGATIVE_INFINITY;
    for (const s of filteredTimeline) {
      const ts = new Date(s.end).getTime();
      if (Number.isFinite(ts)) maxTs = Math.max(maxTs, ts);
    }
    return Number.isFinite(maxTs) ? maxTs : weekRangeEnd;
  }, [filteredTimeline, weekRangeEnd]);

  const scaleStart = timelineScaleMode === "week" ? weekRangeStart : observedStart;
  const scaleEnd = timelineScaleMode === "week" ? weekRangeEnd : observedEnd;
  const scaleMs = Math.max(1, scaleEnd - scaleStart);
  const coveragePct = Math.max(
    0,
    Math.min(100, ((Math.max(0, observedEnd - observedStart)) / weekRangeMs) * 100),
  );

  useEffect(() => {
    if (profiles.length === 0) return;
    if (!profiles.find((p: any) => String(p.targetId) === profileId)) {
      setProfileId(String(profiles[0].targetId));
    }
  }, [profiles, profileId]);

  useEffect(() => {
    const opts = panels.filter((p: any) => String(p.target_id) === profileId);
    if (!opts.find((p: any) => String(p.panelName) === panelName)) {
      setPanelName(opts[0]?.panelName || "");
    }
  }, [panels, profileId, panelName]);

  const segsByRank = useMemo(() => {
    const out = new Map<number, any[]>();
    const sorted = [...filteredTimeline].sort(
      (a: any, b: any) => new Date(a.start).getTime() - new Date(b.start).getTime(),
    );
    for (const s of sorted) {
      const r = Number(s.rank) || 0;
      if (!out.has(r)) out.set(r, []);
      out.get(r)!.push(s);
    }
    return out;
  }, [filteredTimeline]);

  const fetchFull = async (opts?: { append?: boolean }) => {
    if (!weeklyReportId || !profileId || !panelName) return;
    const append = Boolean(opts?.append);
    setLoadingFull(true);
    const off = append ? (nextOffset || 0) : 0;
    const fetchLimit = rankMax > 10 ? 20000 : 8000;
    const { data, error } = await supabase.functions.invoke("discover-exposure-timeline", {
      body: { weeklyReportId, targetId: profileId, panelName, rankMin: 1, rankMax, offset: off, limit: fetchLimit },
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
    setTimelineScaleMode("data");
    const mustFetch = rankMax > 10 || embeddedTimeline.length === 0 || embeddedTimelineTruncated;
    if (!mustFetch) return;
    fetchFull();
  }, [rankMax, profileId, panelName, weeklyReportId, embeddedTimeline.length, embeddedTimelineTruncated]);

  const topRows = useMemo(
    () => topByPanel
      .filter((r: any) => String(r.targetId) === profileId && String(r.panelName) === panelName)
      .filter((r: any) => String(r.surfaceName || DISCOVERY_SURFACE) === DISCOVERY_SURFACE)
      .sort((a: any, b: any) => Number(b.minutesExposed || 0) - Number(a.minutesExposed || 0))
      .slice(0, 3),
    [topByPanel, profileId, panelName],
  );

  const resolvedRows = useMemo(
    () => resolvedCollections
      .filter((r: any) => String(r.targetId || "") === profileId && String(r.panelName || "") === panelName)
      .sort((a: any, b: any) => Number(a.rank || 99999) - Number(b.rank || 99999))
      .slice(0, 8),
    [resolvedCollections, profileId, panelName],
  );

  const rankRows = useMemo(() => Array.from({ length: rankMax }, (_, i) => i + 1), [rankMax]);

  const profileLabel = (p: any) => `${p.region} - Discovery`;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">{t("common.config")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
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
          <div>
            <p className="text-xs text-muted-foreground mb-1">Timeline scale</p>
            <Select value={timelineScaleMode} onValueChange={(v) => setTimelineScaleMode(v as "data" | "week")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="data">Data window (recommended)</SelectItem>
                <SelectItem value="week">Full week</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground mt-2">
              Coverage: {coveragePct.toFixed(1)}% of report week
            </p>
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
                      {row.creatorCode ? `@${row.creatorCode}` : "collection"} - {row.linkCode}
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
            <p className="text-xs text-muted-foreground">
              {timelineScaleMode === "data"
                ? "Scaled to observed data range for better visibility."
                : "Scaled to full report week."}
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {rankRows.map((rank) => {
              const track = segsByRank.get(rank) || [];
              return (
                <div key={rank} className="flex items-center gap-3">
                  <div className="w-10 text-xs font-mono text-muted-foreground text-right">#{rank}</div>
                  <div className="relative h-6 flex-1 rounded-md bg-muted/40 overflow-hidden border">
                    {track.map((s: any, j: number) => {
                      const a = new Date(s.start).getTime();
                      const b = new Date(s.end).getTime();
                      const left = ((a - scaleStart) / scaleMs) * 100;
                      const right = ((b - scaleStart) / scaleMs) * 100;
                      const boundedLeft = Math.max(0, Math.min(100, left));
                      const boundedRight = Math.max(0, Math.min(100, right));
                      const width = Math.max(0.5, boundedRight - boundedLeft);
                      const hue = hashHue(String(s.linkCode || ""));
                      const color = `hsl(${hue}, 75%, 55%)`;
                      return (
                        <UITooltip key={j}>
                          <UITooltipTrigger asChild>
                            <div
                              className="absolute top-0 bottom-0 rounded-sm cursor-pointer"
                              style={{ left: `${boundedLeft}%`, width: `${width}%`, backgroundColor: color, opacity: 0.9 }}
                            />
                          </UITooltipTrigger>
                          <UITooltipContent side="top" className="max-w-xs">
                            <div className="space-y-1">
                              <p className="text-xs font-semibold">{s.title || s.linkCode}</p>
                              <p className="text-[11px] text-muted-foreground">
                                {fmtDateTime(s.start)} - {fmtDateTime(s.end)} ({fmt(Number(s.durationMinutes || 0))} min)
                              </p>
                              <p className="text-[11px] text-muted-foreground">
                                Rank #{rank} - CCU max {s.ccuMax != null ? fmt(Number(s.ccuMax)) : "--"} -{" "}
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
