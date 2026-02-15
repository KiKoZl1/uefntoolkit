import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
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

function fmtDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("pt-BR", { hour12: false });
  } catch {
    return iso;
  }
}

function fmt(n: number | null | undefined): string {
  if (n == null) return "—";
  const num = Number(n);
  if (isNaN(num)) return "—";
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + "M";
  if (num >= 1_000) return (num / 1_000).toFixed(1) + "K";
  if (Number.isInteger(num)) return num.toLocaleString("pt-BR");
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
  const [report, setReport] = useState<WeeklyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

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
        <p className="text-muted-foreground mb-4">Report não encontrado</p>
        <Button variant="outline" asChild>
          <Link to="/reports"><ArrowLeft className="h-4 w-4 mr-2" /> Ver todos</Link>
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
    toast({ title: "Link copiado!" });
  };

  const categoryData = rankings.categoryPopularity
    ? Object.entries(rankings.categoryPopularity).map(([name, value]) => ({
        name: (!name || name === "None") ? "Fortnite UGC" : name,
        value: value as number,
      }))
    : [];

  return (
    <div className="px-6 py-8 max-w-6xl mx-auto pb-20">
      {/* Cover Image */}
      {(report as any).cover_image_url && (
        <div className="rounded-xl overflow-hidden mb-6 max-h-64">
          <img src={(report as any).cover_image_url} alt="Report cover" className="w-full h-64 object-cover" />
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <Button variant="ghost" size="sm" className="mb-2" asChild>
            <Link to="/reports"><ArrowLeft className="h-4 w-4 mr-1" /> Todos os reports</Link>
          </Button>
          <h1 className="font-display text-3xl font-bold">{report.title_public || report.week_key}</h1>
          {report.subtitle_public && <p className="text-muted-foreground mt-1">{report.subtitle_public}</p>}
          <p className="text-sm text-muted-foreground mt-1">
            {new Date(report.date_from).toLocaleDateString("pt-BR")} — {new Date(report.date_to).toLocaleDateString("pt-BR")}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleCopyLink}>
            <Copy className="h-4 w-4 mr-1" /> Copiar link
          </Button>
        </div>
      </div>

      {/* Editor Note */}
      {report.editor_note && (
        <div className="rounded-xl border border-accent/30 bg-accent/5 p-6 mb-8">
          <p className="text-xs font-semibold text-accent uppercase tracking-wider mb-2">Nota Editorial</p>
          <div className="prose prose-sm max-w-none text-foreground/80">
            <ReactMarkdown>{report.editor_note}</ReactMarkdown>
          </div>
        </div>
      )}

      {/* Section 1: Core Activity */}
      <SectionHeader icon={Activity} number={1} title="Core Activity Metrics" description="Visão geral da atividade do ecossistema Discovery" />
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-4">
        <KpiCard icon={MapIcon} label="Ilhas Ativas" value={fmt(kpis.activeIslands)} change={kpis.wowActiveIslands} />
        <KpiCard icon={Users} label="Criadores" value={fmt(kpis.totalCreators)} />
        <KpiCard icon={Sparkles} label="Novos Mapas" value={fmt(kpis.newMapsThisWeek)} />
        <KpiCard icon={UserPlus} label="Novos Criadores" value={fmt(kpis.newCreatorsThisWeek)} />
        <KpiCard icon={HeartPulse} label="Revividas" value={fmt(kpis.revivedCount)} />
        <KpiCard icon={Skull} label="Morreram" value={fmt(kpis.deadCount)} />
      </div>
      <AiNarrative text={getNarrative(1)} />

      <div className="border-t border-border my-8" />

      {/* Section 2: Trending Topics */}
      <SectionHeader icon={Flame} number={2} title="Trending Topics" description="Tendências emergentes detectadas por palavras-chave" />
      {rankings.trendingTopics?.length > 0 && (
        <div className="grid md:grid-cols-2 gap-4 mb-4">
          <RankingTable title="Trends por Plays" icon={Flame} items={rankings.trendingTopics || []} />
        </div>
      )}
      <AiNarrative text={getNarrative(2)} />

      <div className="border-t border-border my-8" />

      {/* Section 3: Engagement */}
      <SectionHeader icon={Play} number={3} title="Player Engagement" description="Engajamento dos jogadores" />
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
        <KpiCard icon={Play} label="Total Plays" value={fmt(kpis.totalPlays)} change={kpis.wowTotalPlays} />
        <KpiCard icon={Clock} label="Total Minutos" value={fmt(kpis.totalMinutesPlayed)} change={kpis.wowTotalMinutes} />
        <KpiCard icon={Users} label="Total Players" value={fmt(kpis.totalUniquePlayers)} change={kpis.wowTotalPlayers} />
        <KpiCard icon={BarChart3} label="Avg CCU/Map" value={fmt(kpis.avgCCUPerMap)} />
        <KpiCard icon={Clock} label="Avg Duração" value={fmt(kpis.avgPlayDuration)} suffix=" min" />
      </div>
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <RankingTable title="Top 10 Peak CCU" icon={BarChart3} items={rankings.topPeakCCU || []} />
        <RankingTable title="Top 10 Unique Players" icon={Users} items={rankings.topUniquePlayers || []} />
      </div>
      <AiNarrative text={getNarrative(3)} />

      <div className="border-t border-border my-8" />

      {/* Section 4: New Islands */}
      <SectionHeader icon={Sparkles} number={4} title="Novas Ilhas da Semana" description="Ilhas que apareceram pela primeira vez" />
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <RankingTable title="Top Novas por Plays" icon={Play} items={rankings.topNewIslandsByPlays || []} />
        <RankingTable title="Top Novas por Players" icon={Users} items={rankings.topNewIslandsByPlayers || []} />
      </div>
      <AiNarrative text={getNarrative(4)} />

      <div className="border-t border-border my-8" />

      {/* Section 5: Retention */}
      <SectionHeader icon={TrendingUp} number={5} title="Retention & Loyalty" description="Retenção D1/D7 e fidelidade" />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <KpiCard icon={TrendingUp} label="Avg D1" value={pct(kpis.avgRetentionD1)} />
        <KpiCard icon={TrendingUp} label="Avg D7" value={pct(kpis.avgRetentionD7)} />
        <KpiCard icon={Star} label="Fav-to-Play" value={pct(kpis.favToPlayRatio)} />
        <KpiCard icon={ThumbsUp} label="Rec-to-Play" value={pct(kpis.recToPlayRatio)} />
      </div>
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <RankingTable title="Top D1 Retention" icon={TrendingUp} items={rankings.topRetentionD1 || []} valueFormatter={(v) => pct(Number(v))} />
        <RankingTable title="Top D7 Retention" icon={TrendingUp} items={rankings.topRetentionD7 || []} valueFormatter={(v) => pct(Number(v))} />
      </div>
      <AiNarrative text={getNarrative(5)} />

      <div className="border-t border-border my-8" />

      {/* Section 6: Creator Performance */}
      <SectionHeader icon={Crown} number={6} title="Creator Performance" description="Ranking dos melhores criadores" />
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <RankingTable title="Top Creators por Plays" icon={Play} items={rankings.topCreatorsByPlays || []} />
        <RankingTable title="Top Creators por Minutes" icon={Clock} items={rankings.topCreatorsByMinutes || []} />
      </div>
      <AiNarrative text={getNarrative(6)} />

      <div className="border-t border-border my-8" />

      {/* Section 7: Map Quality */}
      <SectionHeader icon={MapIcon} number={7} title="Map-Level Quality" description="Qualidade individual das ilhas" />
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <RankingTable title="Top Avg Minutes/Player" icon={Clock} items={rankings.topAvgMinutesPerPlayer || []} valueFormatter={(v) => Number(v).toFixed(1) + " min"} />
        <RankingTable title="Top Favoritos" icon={Star} items={rankings.topFavorites || []} />
      </div>
      <AiNarrative text={getNarrative(7)} />

      <div className="border-t border-border my-8" />

      {/* Section 8: Low Performance */}
      <SectionHeader icon={AlertTriangle} number={8} title="Ilhas com Baixa Performance" description="Ilhas com menos de 500 jogadores" />
      <KpiCard icon={AlertTriangle} label="Ilhas c/ Baixa Perf." value={fmt(kpis.failedIslands)} />
      <AiNarrative text={getNarrative(8)} />

      <div className="border-t border-border my-8" />

      {/* Section 9: Ratios */}
      <SectionHeader icon={Target} number={9} title="Ratios & Derived" description="Métricas derivadas" />
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <RankingTable title="Plays / Unique Player" icon={Zap} items={rankings.topPlaysPerPlayer || []} valueFormatter={(v) => Number(v).toFixed(2)} />
        <RankingTable title="Favorites / 100 Players" icon={Star} items={rankings.topFavsPer100 || []} valueFormatter={(v) => Number(v).toFixed(2)} />
      </div>
      <AiNarrative text={getNarrative(9)} />

      <div className="border-t border-border my-8" />

      {/* Section 10: Categories */}
      <SectionHeader icon={Layers} number={10} title="Category & Tag Analytics" description="Popularidade por categoria" />
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
        <RankingTable title="Top Categories" icon={Tags} items={rankings.topCategoriesByPlays || []} />
        <RankingTable title="Top Tags" icon={Tags} items={rankings.topTags || []} />
      </div>
      <AiNarrative text={getNarrative(10)} />

      <div className="border-t border-border my-8" />

      {/* Section 11: Efficiency */}
      <SectionHeader icon={Zap} number={11} title="Efficiency Metrics" description="Conversão e eficiência" />
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <RankingTable title="Top Favorites/Play" icon={Star} items={rankings.topFavsPerPlay || []} valueFormatter={(v) => Number(v).toFixed(4)} />
        <RankingTable title="Top Recommends/Play" icon={ThumbsUp} items={rankings.topRecsPerPlay || []} valueFormatter={(v) => Number(v).toFixed(4)} />
      </div>
      <AiNarrative text={getNarrative(11)} />

      <div className="border-t border-border my-8" />

      {/* Section 12: Risers & Decliners */}
      <SectionHeader icon={Rocket} number={12} title="Risers & Decliners" description="Maiores variações WoW" />
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <RankingTable title="🚀 Top Risers" icon={TrendingUp} items={rankings.topRisers || []} barColor="bg-success" />
        <RankingTable title="📉 Top Decliners" icon={TrendingDown} items={rankings.topDecliners || []} barColor="bg-destructive" />
      </div>
      <AiNarrative text={getNarrative(12)} />

      <div className="border-t border-border my-8" />

      {/* Section 13: Lifecycle */}
      <SectionHeader icon={HeartPulse} number={13} title="Island Lifecycle" description="Ilhas revividas e mortas" />
      <div className="grid grid-cols-2 gap-3 mb-4">
        <KpiCard icon={HeartPulse} label="Revividas" value={fmt(kpis.revivedCount)} />
        <KpiCard icon={Skull} label="Morreram" value={fmt(kpis.deadCount)} />
      </div>
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <RankingTable title="🔄 Revividas" icon={HeartPulse} items={rankings.revivedIslands || []} barColor="bg-success" />
        <RankingTable title="💀 Mortas" icon={Skull} items={rankings.deadIslands || []} barColor="bg-destructive" />
      </div>
      <AiNarrative text={getNarrative(13)} />

      {exposure?.profiles?.length > 0 && (
        <>
          <div className="border-t border-border my-8" />
          <TooltipProvider>
              <SectionHeader
                icon={EyeOff}
                number={14}
                title="Discovery Exposure"
                description="Timeline por panel (rank #1..#10) a partir do Discovery 24/7"
              />
            <DiscoveryExposureSection exposure={exposure} />
            <AiNarrative text={getNarrative(14)} />
          </TooltipProvider>
        </>
      )}
    </div>
  );
}

function DiscoveryExposureSection({ exposure }: { exposure: any }) {
  const profiles = Array.isArray(exposure?.profiles) ? exposure.profiles : [];
  const panels = Array.isArray(exposure?.panels) ? exposure.panels : [];
  const timeline = Array.isArray(exposure?.panelRankTimeline) ? exposure.panelRankTimeline : [];
  const topByPanel = Array.isArray(exposure?.topByPanel) ? exposure.topByPanel : [];

  const rangeStart = new Date(exposure?.meta?.rangeStart || "").getTime();
  const rangeEnd = new Date(exposure?.meta?.rangeEnd || "").getTime();
  const rangeMs = Math.max(1, rangeEnd - rangeStart);

  const [profileId, setProfileId] = useState<string>(profiles[0]?.targetId || "");
  const panelOptions = panels.filter((p: any) => String(p.target_id) === profileId);
  const [panelName, setPanelName] = useState<string>(panelOptions[0]?.panelName || "");

  useEffect(() => {
    const opts = panels.filter((p: any) => String(p.target_id) === profileId);
    if (!opts.find((p: any) => String(p.panelName) === panelName)) {
      setPanelName(opts[0]?.panelName || "");
    }
  }, [profileId]); // eslint-disable-line react-hooks/exhaustive-deps

  const segs = timeline.filter((s: any) => String(s.targetId) === profileId && String(s.panelName) === panelName);
  const segsByRank = new Map<number, any[]>();
  for (const s of segs) {
    const r = Number(s.rank) || 0;
    if (!segsByRank.has(r)) segsByRank.set(r, []);
    segsByRank.get(r)!.push(s);
  }

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
          <CardTitle className="text-sm font-medium">Config</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div>
            <p className="text-xs text-muted-foreground mb-1">Perfil</p>
            <Select value={profileId} onValueChange={setProfileId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione um perfil" />
              </SelectTrigger>
              <SelectContent>
                {profiles.map((p: any) => (
                  <SelectItem key={p.targetId} value={p.targetId}>
                    {profileLabel(p)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Panel</p>
            <Select value={panelName} onValueChange={setPanelName}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione um panel" />
              </SelectTrigger>
              <SelectContent>
                {panelOptions.map((p: any) => (
                  <SelectItem key={p.panelName} value={p.panelName}>
                    {p.panelDisplayName || p.panelName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {topRows.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Top 3 (minutos expostos)</CardTitle>
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
            <CardTitle className="text-sm font-medium">Rank Timeline (#1..#10)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {Array.from({ length: 10 }).map((_, i) => {
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
                              style={{
                                left: `${Math.max(0, left)}%`,
                                width: `${Math.min(100, width)}%`,
                                backgroundColor: color,
                                opacity: 0.9,
                              }}
                            />
                          </UITooltipTrigger>
                          <UITooltipContent side="top" className="max-w-xs">
                            <div className="space-y-1">
                              <p className="text-xs font-semibold">{s.title || s.linkCode}</p>
                              <p className="text-[11px] text-muted-foreground">
                                {fmtDateTime(s.start)} â†’ {fmtDateTime(s.end)} ({fmt(Number(s.durationMinutes || 0))} min)
                              </p>
                              <p className="text-[11px] text-muted-foreground">
                                Rank #{rank} â€¢ CCU max {s.ccuMax != null ? fmt(Number(s.ccuMax)) : "â€”"} â€¢{" "}
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
