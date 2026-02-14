import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KpiCard } from "@/components/discover/KpiCard";
import { RankingTable } from "@/components/discover/RankingTable";
import { SectionHeader } from "@/components/discover/SectionHeader";
import { AiNarrative } from "@/components/discover/AiNarrative";
import {
  ArrowLeft, Activity, Users, Play, Clock, TrendingUp, TrendingDown, Star, ThumbsUp,
  BarChart3, Crown, Map, Layers, Zap, Target, PieChart, Tags, Sparkles,
  AlertTriangle, Flame, UserPlus, Loader2, HeartPulse, Skull, Rocket,
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { ReportPageSkeleton } from "@/components/discover/ReportSkeleton";
import {
  PieChart as RPieChart, Pie, Cell, Legend, Tooltip, ResponsiveContainer,
} from "recharts";

const PIE_COLORS = [
  "hsl(252, 85%, 60%)", "hsl(168, 70%, 45%)", "hsl(38, 92%, 50%)",
  "hsl(0, 72%, 51%)", "hsl(280, 70%, 55%)", "hsl(200, 80%, 50%)",
  "hsl(120, 60%, 45%)", "hsl(340, 75%, 55%)", "hsl(60, 80%, 45%)",
  "hsl(20, 85%, 55%)",
];

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
  const num = Number(n);
  if (isNaN(num)) return "—";
  return (num * 100).toFixed(1) + "%";
}

interface Report {
  id: string;
  week_start: string;
  week_end: string;
  week_number: number;
  year: number;
  status: string;
  phase: string | null;
  island_count: number | null;
  platform_kpis: any;
  computed_rankings: any;
  ai_narratives: any;
  progress_pct: number | null;
  catalog_discovered_count: number | null;
  queue_total: number | null;
  metrics_done_count: number | null;
  reported_count: number | null;
  suppressed_count: number | null;
  error_count: number | null;
}

export default function DiscoverTrendsReport() {
  const { reportId } = useParams<{ reportId: string }>();
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchReport = () => {
    if (!reportId) return;
    supabase
      .from("discover_reports")
      .select("*")
      .eq("id", reportId)
      .single()
      .then(({ data }) => {
        if (data) setReport(data as Report);
        setLoading(false);
      });
  };

  useEffect(() => { fetchReport(); }, [reportId]);

  // Poll while report is in progress
  useEffect(() => {
    if (!report || report.status === "completed" || report.phase === "done") return;
    const interval = setInterval(fetchReport, 5000);
    return () => clearInterval(interval);
  }, [report?.status, report?.phase, reportId]);

  if (loading) return <ReportPageSkeleton />;

  if (!report) {
    return (
      <div className="p-6 text-center">
        <p className="text-muted-foreground">Relatório não encontrado</p>
        <Button variant="outline" className="mt-4" asChild>
          <Link to="/app/discover-trends"><ArrowLeft className="h-4 w-4 mr-2" /> Voltar</Link>
        </Button>
      </div>
    );
  }

  const kpis = report.platform_kpis || {};
  const rankings = report.computed_rankings || {};
  const ai = report.ai_narratives || {};

  const getNarrative = (sectionNum: number): string | null => {
    const section = ai[`section${sectionNum}`];
    return section?.narrative || null;
  };

  const categoryData = rankings.categoryPopularity
    ? Object.entries(rankings.categoryPopularity).map(([name, value]) => ({
        name: (!name || name === "None") ? "Fortnite UGC" : name,
        value: value as number,
      }))
    : [];

  return (
    <div className="p-6 max-w-6xl mx-auto pb-20">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/app/discover-trends"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div>
          <h1 className="font-display text-2xl font-bold">
            Semana {report.week_number}/{report.year}
          </h1>
          <p className="text-sm text-muted-foreground">
            {new Date(report.week_start).toLocaleDateString("pt-BR")} — {new Date(report.week_end).toLocaleDateString("pt-BR")}
            {" · "}{report.island_count} ilhas analisadas
          </p>
        </div>
        <Badge variant={report.status === "completed" ? "default" : "secondary"} className="ml-auto">
          {report.status === "completed" ? "Completo" : report.status}
        </Badge>
      </div>

      {/* In-progress banner */}
      {report.status !== "completed" && report.phase !== "done" && (
        <Card className="mb-6 border-primary/30">
          <CardContent className="pt-4 pb-4 space-y-3">
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <span className="text-sm font-medium">
                {report.phase === "catalog" && "Indexando ilhas..."}
                {report.phase === "metrics" && "Coletando métricas..."}
                {report.phase === "finalize" && "Calculando rankings..."}
                {report.phase === "ai" && "Gerando narrativas com IA..."}
                {!report.phase && "Processando..."}
              </span>
              <span className="text-xs text-muted-foreground font-mono ml-auto">{report.progress_pct || 0}%</span>
            </div>
            <Progress value={report.progress_pct || 0} className="h-3" />
            <div className="grid grid-cols-4 gap-3 text-center text-xs">
              <div>
                <p className="text-muted-foreground">Catalogadas</p>
                <p className="font-bold text-sm">{fmt(report.catalog_discovered_count)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Processadas</p>
                <p className="font-bold text-sm">{fmt(report.metrics_done_count)}/{fmt(report.queue_total)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Com Dados</p>
                <p className="font-bold text-sm text-primary">{fmt(report.reported_count)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Suprimidas</p>
                <p className="font-bold text-sm">{fmt(report.suppressed_count)}</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground text-center">
              O relatório está sendo gerado. Esta página atualiza automaticamente a cada 5 segundos.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Section 1: Core Activity */}
      <SectionHeader icon={Activity} number={1} title="Core Activity Metrics" description="Visão geral da atividade do ecossistema Discovery" />
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-4">
        <KpiCard icon={Map} label="Total de Ilhas" value={fmt(report.island_count)} />
        <KpiCard icon={Users} label="Criadores Únicos" value={fmt(kpis.totalCreators)} />
        <KpiCard icon={Map} label="Ilhas Ativas" value={fmt(kpis.activeIslands)} change={kpis.wowActiveIslands} />
        <KpiCard icon={Map} label="Avg Maps/Creator" value={fmt(kpis.avgMapsPerCreator)} />
        <KpiCard icon={Sparkles} label="Novos Mapas" value={fmt(kpis.newMapsThisWeek)} />
        <KpiCard icon={UserPlus} label="Novos Criadores" value={fmt(kpis.newCreatorsThisWeek)} />
        <KpiCard icon={HeartPulse} label="Revividas" value={fmt(kpis.revivedCount)} />
        <KpiCard icon={Skull} label="Morreram" value={fmt(kpis.deadCount)} />
      </div>
      <AiNarrative text={getNarrative(1)} />

      <div className="border-t border-border my-8" />

      {/* Section 2: Trending Topics */}
      <SectionHeader icon={Flame} number={2} title="Trending Topics" description="Tendências emergentes detectadas por palavras-chave nos títulos" />
      {rankings.trendingTopics?.length > 0 && (
        <div className="grid md:grid-cols-2 gap-4 mb-4">
          <RankingTable title="Trends por Plays" icon={Flame} items={rankings.trendingTopics || []} />
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Flame className="h-4 w-4 text-primary" /> Detalhes dos Trends
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {(rankings.trendingTopics || []).slice(0, 8).map((t: any, idx: number) => (
                <div key={idx} className="flex items-center justify-between text-xs border-b border-border pb-1">
                  <span className="font-medium">{t.name}</span>
                  <div className="flex gap-3 text-muted-foreground">
                    <span>{t.islands} ilhas</span>
                    <span>{fmt(t.totalPlayers)} jogadores</span>
                    <span>CCU: {fmt(t.peakCCU)}</span>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}
      <AiNarrative text={getNarrative(2)} />

      <div className="border-t border-border my-8" />

      {/* Section 3: Player Engagement */}
      <SectionHeader icon={Play} number={3} title="Player Engagement Metrics" description="Engajamento dos jogadores no ecossistema" />
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
        <KpiCard icon={Play} label="Total Plays" value={fmt(kpis.totalPlays)} change={kpis.wowTotalPlays} />
        <KpiCard icon={BarChart3} label="Avg CCU/Map" value={fmt(kpis.avgCCUPerMap)} />
        <KpiCard icon={Clock} label="Avg Duração" value={fmt(kpis.avgPlayDuration)} suffix=" min" />
        <KpiCard icon={Clock} label="Total Minutos" value={fmt(kpis.totalMinutesPlayed)} change={kpis.wowTotalMinutes} />
        <KpiCard icon={Users} label="Total Players" value={fmt(kpis.totalUniquePlayers)} change={kpis.wowTotalPlayers} />
      </div>
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <RankingTable title="Top 10 Peak CCU (Global)" icon={BarChart3} items={rankings.topPeakCCU || []} />
        <RankingTable title="Top 10 Unique Players" icon={Users} items={rankings.topUniquePlayers || []} />
      </div>
      <AiNarrative text={getNarrative(3)} />

      <div className="border-t border-border my-8" />

      {/* Section 4: New Islands This Week */}
      <SectionHeader icon={Sparkles} number={4} title="Novas Ilhas da Semana" description="Ilhas que apareceram pela primeira vez nesta coleta" />
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
        <KpiCard icon={Sparkles} label="Novos Mapas" value={fmt(kpis.newMapsThisWeek)} />
        <KpiCard icon={UserPlus} label="Novos Criadores" value={fmt(kpis.newCreatorsThisWeek)} />
        <KpiCard icon={Map} label="Avg Mapas/Criador" value={fmt(kpis.avgMapsPerCreatorThisWeek)} />
      </div>
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <RankingTable title="Top Novas Ilhas por Plays" icon={Play} items={rankings.topNewIslandsByPlays || []} />
        <RankingTable title="Top Novas Ilhas por Players" icon={Users} items={rankings.topNewIslandsByPlayers || []} />
        <RankingTable title="Top Novas Ilhas por CCU" icon={BarChart3} items={rankings.topNewIslandsByCCU || []} />
      </div>
      <AiNarrative text={getNarrative(4)} />

      <div className="border-t border-border my-8" />

      {/* Section 5: Retention & Loyalty */}
      <SectionHeader icon={TrendingUp} number={5} title="Retention & Loyalty Metrics" description="Retenção D1/D7 e métricas de fidelidade" />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <KpiCard icon={TrendingUp} label="Avg D1" value={pct(kpis.avgRetentionD1)} />
        <KpiCard icon={TrendingUp} label="Avg D7" value={pct(kpis.avgRetentionD7)} />
        <KpiCard icon={Star} label="Fav-to-Play" value={pct(kpis.favToPlayRatio)} />
        <KpiCard icon={ThumbsUp} label="Rec-to-Play" value={pct(kpis.recToPlayRatio)} />
      </div>
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <RankingTable title="Top 10 D1 Retention" icon={TrendingUp} items={rankings.topRetentionD1 || []} valueFormatter={(v) => pct(Number(v))} />
        <RankingTable title="Top 10 D7 Retention" icon={TrendingUp} items={rankings.topRetentionD7 || []} valueFormatter={(v) => pct(Number(v))} />
      </div>
      <AiNarrative text={getNarrative(5)} />

      <div className="border-t border-border my-8" />

      {/* Section 6: Creator Performance */}
      <SectionHeader icon={Crown} number={6} title="Creator Performance Metrics" description="Ranking dos melhores criadores por métricas agregadas" />
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <RankingTable title="Top Creators por Plays" icon={Play} items={rankings.topCreatorsByPlays || []} />
        <RankingTable title="Top Creators por Minutes" icon={Clock} items={rankings.topCreatorsByMinutes || []} />
      </div>
      <AiNarrative text={getNarrative(6)} />

      <div className="border-t border-border my-8" />

      {/* Section 7: Map-Level Quality */}
      <SectionHeader icon={Map} number={7} title="Map-Level Quality Metrics" description="Qualidade individual das ilhas — tempo, favoritos e recomendações" />
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <RankingTable title="Top Avg Minutes/Player" icon={Clock} items={rankings.topAvgMinutesPerPlayer || []} valueFormatter={(v) => Number(v).toFixed(1) + " min"} />
        <RankingTable title="Top Favoritos" icon={Star} items={rankings.topFavorites || []} />
        <RankingTable title="Top Recomendações" icon={ThumbsUp} items={rankings.topRecommendations || []} />
        <RankingTable title="Top Minutes Played" icon={Clock} items={rankings.topMinutesPlayed || []} />
      </div>
      <AiNarrative text={getNarrative(7)} />

      <div className="border-t border-border my-8" />

      {/* Section 8: Low Performance Islands */}
      <SectionHeader icon={AlertTriangle} number={8} title="Ilhas com Baixa Performance" description="Ilhas com menos de 500 jogadores únicos esta semana" />
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
        <KpiCard icon={AlertTriangle} label="Ilhas c/ Baixa Perf." value={fmt(kpis.failedIslands)} />
      </div>
      {rankings.failedIslandsList?.length > 0 && (
        <div className="grid md:grid-cols-1 gap-4 mb-4">
          <RankingTable title="Ilhas com Menor Engajamento" icon={AlertTriangle} items={rankings.failedIslandsList || []} barColor="bg-destructive" />
        </div>
      )}
      <AiNarrative text={getNarrative(8)} />

      <div className="border-t border-border my-8" />

      {/* Section 9: Ratios & Derived */}
      <SectionHeader icon={Target} number={9} title="Ratios & Derived Metrics" description="Métricas derivadas e indicadores de eficiência" />
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <RankingTable title="Plays / Unique Player" icon={Zap} items={rankings.topPlaysPerPlayer || []} valueFormatter={(v) => Number(v).toFixed(2)} />
        <RankingTable title="Favorites / 100 Players" icon={Star} items={rankings.topFavsPer100 || []} valueFormatter={(v) => Number(v).toFixed(2)} />
      </div>
      <AiNarrative text={getNarrative(9)} />

      <div className="border-t border-border my-8" />

      {/* Section 10: Category & Tag Analytics */}
      <SectionHeader icon={Layers} number={10} title="Category & Tag Analytics" description="Popularidade por categoria e tags trending" />
      {categoryData.length > 0 && (
        <Card className="mb-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <PieChart className="h-4 w-4 text-primary" /> Category Popularity Share
            </CardTitle>
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>
      )}
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <RankingTable title="Top Categories por Plays" icon={Tags} items={rankings.topCategoriesByPlays || []} />
        <RankingTable title="Top Tags" icon={Tags} items={rankings.topTags || []} />
      </div>
      <AiNarrative text={getNarrative(10)} />

      <div className="border-t border-border my-8" />

      {/* Section 11: Efficiency */}
      <SectionHeader icon={Zap} number={11} title="Efficiency / Conversion Metrics" description="Métricas de conversão e eficiência das ilhas" />
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <RankingTable title="Top Favorites/Play" icon={Star} items={rankings.topFavsPerPlay || []} valueFormatter={(v) => Number(v).toFixed(4)} />
        <RankingTable title="Top Recommends/Play" icon={ThumbsUp} items={rankings.topRecsPerPlay || []} valueFormatter={(v) => Number(v).toFixed(4)} />
      </div>
      <AiNarrative text={getNarrative(11)} />

      <div className="border-t border-border my-8" />

      {/* Section 12: Risers & Decliners */}
      <SectionHeader icon={Rocket} number={12} title="Risers & Decliners" description="Maiores variações Week-over-Week em plays" />
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <RankingTable title="🚀 Top Risers (mais crescimento)" icon={TrendingUp} items={rankings.topRisers || []} barColor="bg-green-500" />
        <RankingTable title="📉 Top Decliners (maior queda)" icon={TrendingDown} items={rankings.topDecliners || []} barColor="bg-destructive" />
      </div>
      {rankings.breakouts?.length > 0 && (
        <RankingTable title="💥 Breakouts (suppressed → top)" icon={Rocket} items={rankings.breakouts || []} barColor="bg-amber-500" />
      )}
      <AiNarrative text={getNarrative(12)} />

      <div className="border-t border-border my-8" />

      {/* Section 13: Island Lifecycle */}
      <SectionHeader icon={HeartPulse} number={13} title="Island Lifecycle" description="Ilhas revividas, mortas e mudanças no ecossistema" />
      <div className="grid grid-cols-2 gap-3 mb-4">
        <KpiCard icon={HeartPulse} label="Ilhas Revividas" value={fmt(kpis.revivedCount)} />
        <KpiCard icon={Skull} label="Ilhas que Morreram" value={fmt(kpis.deadCount)} />
      </div>
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <RankingTable title="🔄 Ilhas Revividas" icon={HeartPulse} items={rankings.revivedIslands || []} barColor="bg-green-500" />
        <RankingTable title="💀 Ilhas que Morreram" icon={Skull} items={rankings.deadIslands || []} barColor="bg-destructive" />
      </div>
      <AiNarrative text={getNarrative(13)} />
    </div>
  );
}
