import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export const DPPI_ADMIN_LINKS = [
  { to: "/admin/dppi", label: "Overview", end: true },
  { to: "/admin/dppi/models", label: "Models" },
  { to: "/admin/dppi/training", label: "Training" },
  { to: "/admin/dppi/inference", label: "Inference" },
  { to: "/admin/dppi/drift", label: "Drift" },
  { to: "/admin/dppi/calibration", label: "Calibration" },
  { to: "/admin/dppi/releases", label: "Releases" },
  { to: "/admin/dppi/feedback", label: "Feedback" },
] as const;

export function fmtCompact(n: number | null | undefined): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return "-";
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return Math.round(v).toLocaleString("en-US");
}

export function fmtDate(value: string | null | undefined, locale = "pt-BR"): string {
  if (!value) return "-";
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return "-";
  return new Date(ts).toLocaleString(locale);
}

export function fmtPct(n: number | null | undefined): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return "-";
  return `${v.toFixed(2)}%`;
}

export function DppiAdminHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  const location = useLocation();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">{title}</h1>
          {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
        </div>
        {right}
      </div>

      <div className="flex flex-wrap gap-2">
        {DPPI_ADMIN_LINKS.map((item) => {
          const active = item.end ? location.pathname === item.to : location.pathname.startsWith(item.to);
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                active ? "border-primary/60 bg-primary/15 text-primary" : "border-border/60 bg-card/40 text-zinc-300 hover:bg-card/70",
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

