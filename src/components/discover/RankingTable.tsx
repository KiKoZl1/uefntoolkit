import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LucideIcon, Trophy } from "lucide-react";

interface RankingItem {
  name: string;
  code?: string;
  value: number;
  label?: string;
  subtitle?: string;
  imageUrl?: string;
}

interface RankingTableProps {
  title: string;
  icon: LucideIcon;
  items: RankingItem[];
  valueFormatter?: (v: number) => string;
  barColor?: string;
  showImage?: boolean;
  showBadges?: boolean;
}

const BADGE_STYLES = [
  { emoji: "🥇", bg: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-yellow-500/30" },
  { emoji: "🥈", bg: "bg-gray-400/15 text-gray-500 dark:text-gray-300 border-gray-400/30" },
  { emoji: "🥉", bg: "bg-amber-600/15 text-amber-700 dark:text-amber-400 border-amber-600/30" },
];

function defaultFormatter(v: number): string {
  const n = Number(v);
  if (isNaN(n)) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString("pt-BR");
}

export function RankingTable({
  title,
  icon: Icon,
  items,
  valueFormatter = defaultFormatter,
  barColor = "bg-primary",
  showImage = false,
  showBadges = false,
}: RankingTableProps) {
  if (!items || items.length === 0) return null;
  const maxVal = Math.max(...items.map((i) => i.value), 1);

  return (
    <Card className="backdrop-blur-sm bg-card/80 border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Icon className="h-4 w-4 text-primary" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.slice(0, 10).map((item, idx) => {
          const badge = showBadges && idx < 3 ? BADGE_STYLES[idx] : null;
          return (
            <div key={idx} className="flex items-center gap-3">
              {badge ? (
                <span
                  className={`flex items-center justify-center h-6 w-6 rounded-full border text-xs font-bold shrink-0 ${badge.bg}`}
                >
                  {badge.emoji}
                </span>
              ) : (
                <span className="text-xs font-mono text-muted-foreground w-6 text-center shrink-0">
                  {idx + 1}
                </span>
              )}
              {showImage && item.imageUrl && (
                <img
                  src={item.imageUrl}
                  alt=""
                  className="h-8 w-8 rounded object-cover shrink-0 border border-border/30"
                  loading="lazy"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-0.5">
                  <div className="flex flex-col min-w-0 mr-2">
                    <span className="text-xs font-medium truncate">{item.name}</span>
                    {item.subtitle && (
                      <span className="text-[10px] text-muted-foreground truncate">{item.subtitle}</span>
                    )}
                  </div>
                  <span className="text-xs font-display font-semibold whitespace-nowrap">
                    {item.label || valueFormatter(item.value)}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className={`h-full rounded-full ${barColor} transition-all`}
                    style={{ width: `${(item.value / maxVal) * 100}%` }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
