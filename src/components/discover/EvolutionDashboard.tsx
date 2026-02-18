import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface MetricRow {
  label: string;
  current: number | string | null;
  previous: number | string | null;
  pctChange: number | null;
  format?: "number" | "pct" | "duration";
  suffix?: string;
}

interface EvolutionDashboardProps {
  kpis: any;
  prevWeekLabel?: string;
  currWeekLabel?: string;
}

function fmtNum(n: number | null | undefined): string {
  if (n == null) return "—";
  const num = Number(n);
  if (isNaN(num)) return "—";
  if (num >= 1_000_000_000) return (num / 1_000_000_000).toFixed(1) + "B";
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + "M";
  if (num >= 1_000) return (num / 1_000).toFixed(1) + "K";
  if (Number.isInteger(num)) return num.toLocaleString("en-US");
  return num.toFixed(2);
}

function fmtPct(n: number | null | undefined): string {
  if (n == null) return "—";
  return (Number(n) * 100).toFixed(1) + "%";
}

function formatValue(val: number | string | null, format?: string, suffix?: string): string {
  if (val == null) return "—";
  const n = Number(val);
  if (isNaN(n)) return String(val);
  if (format === "pct") return fmtPct(n);
  if (format === "duration") return n.toFixed(1) + (suffix || " min");
  return fmtNum(n) + (suffix || "");
}

export function EvolutionDashboard({ kpis, prevWeekLabel = "Prev", currWeekLabel = "Current" }: EvolutionDashboardProps) {
  if (!kpis?.baselineAvailable) return null;

  const metrics: MetricRow[] = [
    { label: "Active Islands", current: kpis.activeIslands, previous: kpis.prevActiveIslands, pctChange: kpis.wowActiveIslands },
    { label: "Total Creators", current: kpis.totalCreators, previous: kpis.prevTotalCreators, pctChange: kpis.wowTotalCreators },
    { label: "Total Plays", current: kpis.totalPlays, previous: kpis.prevTotalPlays, pctChange: kpis.wowTotalPlays },
    { label: "Unique Players", current: kpis.totalUniquePlayers, previous: kpis.prevTotalPlayers, pctChange: kpis.wowTotalPlayers },
    { label: "Total Minutes", current: kpis.totalMinutesPlayed, previous: kpis.prevTotalMinutes, pctChange: kpis.wowTotalMinutes },
    { label: "Avg Play Duration", current: kpis.avgPlayDuration, previous: kpis.prevAvgPlayDuration, pctChange: kpis.wowAvgPlayDuration, format: "duration" },
    { label: "Avg CCU/Map", current: kpis.avgCCUPerMap, previous: kpis.prevAvgCCUPerMap, pctChange: kpis.wowAvgCCUPerMap },
    { label: "Avg D1 Retention", current: kpis.avgRetentionD1, previous: kpis.prevAvgRetentionD1, pctChange: kpis.wowAvgRetentionD1, format: "pct" },
    { label: "Avg D7 Retention", current: kpis.avgRetentionD7, previous: kpis.prevAvgRetentionD7, pctChange: kpis.wowAvgRetentionD7, format: "pct" },
    { label: "New Maps", current: kpis.newMapsThisWeek, previous: kpis.prevNewMapsThisWeek, pctChange: null },
    { label: "New Creators", current: kpis.newCreatorsThisWeek, previous: kpis.prevNewCreatorsThisWeek, pctChange: null },
    { label: "Revived Islands", current: kpis.revivedCount, previous: kpis.prevRevivedCount, pctChange: null },
    { label: "Dead Islands", current: kpis.deadCount, previous: kpis.prevDeadCount, pctChange: null },
    { label: "Low Performance", current: kpis.failedIslands, previous: kpis.prevFailedIslands, pctChange: null },
  ];

  return (
    <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
      <CardContent className="p-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50">
                <th className="text-left py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Metric</th>
                <th className="text-right py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">{prevWeekLabel}</th>
                <th className="text-right py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">{currWeekLabel}</th>
                <th className="text-right py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Change</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map((m, i) => {
                const curr = Number(m.current);
                const prev = Number(m.previous);
                const delta = !isNaN(curr) && !isNaN(prev) ? curr - prev : null;
                const pct = m.pctChange;
                const isUp = pct != null ? pct > 0 : delta != null ? delta > 0 : null;
                const isNeutral = (pct != null && pct === 0) || (delta != null && delta === 0);

                return (
                  <tr key={i} className="border-b border-border/20 hover:bg-secondary/30 transition-colors">
                    <td className="py-2 font-medium text-foreground/90">{m.label}</td>
                    <td className="py-2 text-right text-muted-foreground font-mono text-xs">
                      {m.previous != null ? formatValue(m.previous, m.format, m.suffix) : "—"}
                    </td>
                    <td className="py-2 text-right font-mono text-xs font-semibold">
                      {formatValue(m.current, m.format, m.suffix)}
                    </td>
                    <td className="py-2 text-right">
                      {pct != null ? (
                        <span className={`inline-flex items-center gap-1 text-xs font-semibold ${
                          isNeutral ? "text-muted-foreground" : isUp ? "text-success" : "text-destructive"
                        }`}>
                          {isNeutral ? <Minus className="h-3 w-3" /> : isUp ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                          {isUp ? "+" : ""}{pct.toFixed(1)}%
                        </span>
                      ) : delta != null ? (
                        <span className={`text-xs font-semibold ${
                          delta === 0 ? "text-muted-foreground" : delta > 0 ? "text-success" : "text-destructive"
                        }`}>
                          {delta > 0 ? "+" : ""}{fmtNum(delta)}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
