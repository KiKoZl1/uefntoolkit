import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LucideIcon, TrendingUp, TrendingDown } from "lucide-react";

interface MoverItem {
  name?: string;
  creator?: string;
  cat?: string;
  plays?: number;
  prevPlays?: number;
  deltaPlays?: number;
  pctChange?: number | null;
  rankCurr?: number;
  rankPrev?: number;
  rankChange?: number;
  islandCount?: number;
  prevIslandCount?: number;
  players?: number;
  prevPlayers?: number;
}

interface MoversTableProps {
  title: string;
  icon: LucideIcon;
  items: MoverItem[];
  type: "riser" | "decliner";
  showRank?: boolean;
}

function fmtNum(n: number | null | undefined): string {
  if (n == null) return "—";
  const num = Number(n);
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + "M";
  if (num >= 1_000) return (num / 1_000).toFixed(1) + "K";
  return num.toLocaleString("en-US");
}

export function MoversTable({ title, icon: Icon, items, type, showRank }: MoversTableProps) {
  if (!items || items.length === 0) return null;

  const isRiser = type === "riser";

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Icon className={`h-4 w-4 ${isRiser ? "text-success" : "text-destructive"}`} />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {items.slice(0, 10).map((item, idx) => (
          <div key={idx} className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-secondary/50 transition-colors">
            <span className="text-[11px] font-mono text-muted-foreground w-5 text-center shrink-0">
              {idx + 1}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <div className="min-w-0 mr-2">
                  <span className="text-xs font-medium truncate block">
                    {item.name || item.creator || item.cat || "—"}
                  </span>
                  {item.creator && item.name && (
                    <span className="text-[10px] text-muted-foreground">{item.creator}</span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {showRank && item.rankChange != null && (
                    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                      item.rankChange > 0 ? "bg-success/10 text-success" : item.rankChange < 0 ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"
                    }`}>
                      {item.rankChange > 0 ? "▲" : item.rankChange < 0 ? "▼" : "—"}{Math.abs(item.rankChange)}
                    </span>
                  )}
                  <div className="text-right">
                    <div className={`text-xs font-semibold flex items-center gap-1 ${isRiser ? "text-success" : "text-destructive"}`}>
                      {isRiser ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                      {item.deltaPlays != null ? (
                        <span>{isRiser ? "+" : ""}{fmtNum(item.deltaPlays)}</span>
                      ) : null}
                    </div>
                    {item.pctChange != null && (
                      <span className="text-[10px] text-muted-foreground">
                        ({item.pctChange > 0 ? "+" : ""}{item.pctChange.toFixed(1)}%)
                      </span>
                    )}
                  </div>
                </div>
              </div>
              {/* Mini comparison bar */}
              <div className="flex items-center gap-1 mt-1">
                <span className="text-[9px] text-muted-foreground w-12 text-right">{fmtNum(item.prevPlays)}</span>
                <div className="flex-1 h-1 rounded-full bg-secondary overflow-hidden">
                  <div className={`h-full rounded-full ${isRiser ? "bg-success" : "bg-destructive"}`}
                    style={{ width: `${Math.min(100, Math.abs(item.pctChange || 0))}%`, opacity: 0.6 }} />
                </div>
                <span className="text-[9px] font-semibold w-12">{fmtNum(item.plays)}</span>
              </div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
