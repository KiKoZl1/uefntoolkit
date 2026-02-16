import { LucideIcon, TrendingUp, TrendingDown } from "lucide-react";

interface KpiCardProps {
  icon: LucideIcon;
  label: string;
  value: string | number;
  change?: number | null;
  suffix?: string;
}

export function KpiCard({ icon: Icon, label, value, change, suffix }: KpiCardProps) {
  return (
    <div className="rounded-lg border border-border/50 bg-card p-4">
      <div className="flex items-center gap-2 mb-2">
        <div className="flex h-6 w-6 items-center justify-center rounded bg-primary/10">
          <Icon className="h-3.5 w-3.5 text-primary" />
        </div>
        <span className="text-[11px] text-muted-foreground uppercase tracking-wider">{label}</span>
      </div>
      <p className="font-display font-bold text-2xl tracking-tight">
        {value}{suffix}
      </p>
      {change != null && change !== 0 && (
        <div className={`flex items-center gap-1 text-xs mt-1.5 ${change > 0 ? "text-success" : "text-destructive"}`}>
          {change > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          <span className="font-medium">{change > 0 ? "+" : ""}{change.toFixed(1)}% vs last week</span>
        </div>
      )}
    </div>
  );
}
