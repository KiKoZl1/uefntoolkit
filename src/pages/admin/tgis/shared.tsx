import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

export const TGIS_ADMIN_LINKS = [
  { to: "/admin/tgis", labelKey: "adminTgis.overview", end: true },
  { to: "/admin/tgis/clusters", labelKey: "adminTgis.clusters" },
  { to: "/admin/tgis/dataset", labelKey: "adminTgis.dataset" },
  { to: "/admin/tgis/training", labelKey: "adminTgis.training" },
  { to: "/admin/tgis/models", labelKey: "adminTgis.models" },
  { to: "/admin/tgis/inference", labelKey: "adminTgis.inference" },
  { to: "/admin/tgis/thumb-tools", labelKey: "adminTgis.thumbTools" },
  { to: "/admin/tgis/costs", labelKey: "adminTgis.costs" },
  { to: "/admin/tgis/safety", labelKey: "adminTgis.safety" },
] as const;

export function fmtDate(v: string | null | undefined, locale = "pt-BR"): string {
  if (!v) return "-";
  const ts = Date.parse(v);
  if (!Number.isFinite(ts)) return "-";
  return new Date(ts).toLocaleString(locale);
}

export function fmtCompact(n: number | null | undefined): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return "-";
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return Math.round(v).toLocaleString("en-US");
}

export function TgisAdminHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  const location = useLocation();
  const { t } = useTranslation();

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
        {TGIS_ADMIN_LINKS.map((item) => {
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
              {t(item.labelKey)}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
