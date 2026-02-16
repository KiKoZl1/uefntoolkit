import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LucideIcon } from "lucide-react";

interface RankingItem {
  name: string;
  code?: string;
  value: number;
  label?: string;
  subtitle?: string;
}

interface RankingTableProps {
  title: string;
  icon: LucideIcon;
  items: RankingItem[];
  valueFormatter?: (v: number) => string;
  barColor?: string;
}

function defaultFormatter(v: number): string {
  const n = Number(v);
  if (isNaN(n)) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString("pt-BR");
}

export function RankingTable({ title, icon: Icon, items, valueFormatter = defaultFormatter, barColor = "bg-primary" }: RankingTableProps) {
  if (!items || items.length === 0) return null;
  const maxVal = Math.max(...items.map((i) => i.value), 1);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Icon className="h-4 w-4 text-primary" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.slice(0, 10).map((item, idx) => (
          <div key={idx} className="flex items-center gap-3">
            <span className="text-xs font-mono text-muted-foreground w-5 text-right">
              {idx + 1}
            </span>
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
        ))}
      </CardContent>
    </Card>
  );
}
