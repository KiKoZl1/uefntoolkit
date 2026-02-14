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
  ArrowLeft, Loader2, Activity, Users, Play, Clock, TrendingUp, Star, ThumbsUp,
  BarChart3, Crown, Map, Layers, Zap, Target, PieChart, Tags,
} from "lucide-react";
import { ReportPageSkeleton } from "@/components/discover/ReportSkeleton";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart as RPieChart, Pie, Cell, Legend,
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
  island_count: number | null;
  platform_kpis: any;
  computed_rankings: any;
  ai_narratives: any;
}

export default function DiscoverTrendsReport() {
  const { reportId } = useParams<{ reportId: string }>();
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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
  }, [reportId]);

  if (loading) {
    return <ReportPageSkeleton />;
  }

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

  // AI narratives come as section1..section8 with { title, narrative }
  const getNarrative = (sectionNum: number): string | null => {
    const section = ai[`section${sectionNum}`];
    return section?.narrative || null;
  };

  // Prepare category pie data
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

      {/* Section 1: Core Activity */}
      <SectionHeader
        icon={Activity}
        number={1}
        title="Core Activity Metrics"
        description="Visão geral da atividade do ecossistema Discovery"
      />
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-4">
        <KpiCard icon={Map} label="Total de Ilhas" value={fmt(report.island_count)} />
        <KpiCard icon={Users} label="Criadores Únicos" value={fmt(kpis.totalCreators)} />
        <KpiCard icon={Map} label="Ilhas Ativas" value={fmt(kpis.activeIslands)} />
        <KpiCard icon={Map} label="Avg Maps/Creator" value={fmt(kpis.avgMapsPerCreator)} />
      </div>
      <AiNarrative text={getNarrative(1)} />

      <div className="border-t border-border my-8" />

      {/* Section 2: Player Engagement */}
      <SectionHeader
        icon={Play}
        number={2}
        title="Player Engagement Metrics"
        description="Engajamento dos jogadores no ecossistema"
      />
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
        <KpiCard icon={Users} label="Avg Players/Day" value={fmt(kpis.avgPlayersPerDay)} />
        <KpiCard icon={Play} label="Total Plays" value={fmt(kpis.totalPlays)} />
        <KpiCard icon={BarChart3} label="Avg CCU/Map" value={fmt(kpis.avgCCUPerMap)} />
        <KpiCard icon={Clock} label="Avg Duração" value={fmt(kpis.avgPlayDuration)} suffix=" min" />
        <KpiCard icon={Clock} label="Total Minutos" value={fmt(kpis.totalMinutesPlayed)} />
      </div>
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <RankingTable title="Top 10 Peak CCU" icon={BarChart3} items={rankings.topPeakCCU || []} />
        <RankingTable title="Top 10 Unique Players" icon={Users} items={rankings.topUniquePlayers || []} />
      </div>
      <AiNarrative text={getNarrative(2)} />

      <div className="border-t border-border my-8" />

      {/* Section 3: Retention & Loyalty */}
      <SectionHeader
        icon={TrendingUp}
        number={3}
        title="Retention & Loyalty Metrics"
        description="Retenção D1/D7 e métricas de fidelidade"
      />
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
      <AiNarrative text={getNarrative(3)} />

      <div className="border-t border-border my-8" />

      {/* Section 4: Creator Performance */}
      <SectionHeader
        icon={Crown}
        number={4}
        title="Creator Performance Metrics"
        description="Ranking dos melhores criadores por métricas agregadas"
      />
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <RankingTable title="Top Creators por Plays" icon={Play} items={rankings.topCreatorsByPlays || []} />
        <RankingTable title="Top Creators por Minutes" icon={Clock} items={rankings.topCreatorsByMinutes || []} />
      </div>
      <AiNarrative text={getNarrative(4)} />

      <div className="border-t border-border my-8" />

      {/* Section 5: Map-Level Quality */}
      <SectionHeader
        icon={Map}
        number={5}
        title="Map-Level Quality Metrics"
        description="Qualidade individual das ilhas — tempo, favoritos e recomendações"
      />
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <RankingTable title="Top Avg Minutes/Player" icon={Clock} items={rankings.topAvgMinutesPerPlayer || []} valueFormatter={(v) => Number(v).toFixed(1) + " min"} />
        <RankingTable title="Top Favoritos" icon={Star} items={rankings.topFavorites || []} />
        <RankingTable title="Top Recomendações" icon={ThumbsUp} items={rankings.topRecommendations || []} />
        <RankingTable title="Top Minutes Played" icon={Clock} items={rankings.topMinutesPlayed || []} />
      </div>
      <AiNarrative text={getNarrative(5)} />

      <div className="border-t border-border my-8" />

      {/* Section 6: Ratios & Derived */}
      <SectionHeader
        icon={Target}
        number={6}
        title="Ratios & Derived Metrics"
        description="Métricas derivadas e indicadores de eficiência"
      />
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <RankingTable title="Plays / Unique Player" icon={Zap} items={rankings.topPlaysPerPlayer || []} valueFormatter={(v) => Number(v).toFixed(2)} />
        <RankingTable title="Favorites / 100 Players" icon={Star} items={rankings.topFavsPer100 || []} valueFormatter={(v) => Number(v).toFixed(2)} />
      </div>
      <AiNarrative text={getNarrative(6)} />

      <div className="border-t border-border my-8" />

      {/* Section 7: Category & Tag Analytics */}
      <SectionHeader
        icon={Layers}
        number={7}
        title="Category & Tag Analytics"
        description="Popularidade por categoria e tags trending"
      />
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
                <Pie
                  data={categoryData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                >
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
      <AiNarrative text={getNarrative(7)} />

      <div className="border-t border-border my-8" />

      {/* Section 8: Efficiency */}
      <SectionHeader
        icon={Zap}
        number={8}
        title="Efficiency / Conversion Metrics"
        description="Métricas de conversão e eficiência das ilhas"
      />
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <RankingTable title="Top Favorites/Play" icon={Star} items={rankings.topFavsPerPlay || []} valueFormatter={(v) => Number(v).toFixed(4)} />
        <RankingTable title="Top Recommends/Play" icon={ThumbsUp} items={rankings.topRecsPerPlay || []} valueFormatter={(v) => Number(v).toFixed(4)} />
      </div>
      <AiNarrative text={getNarrative(8)} />
    </div>
  );
}
