import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowUpRight, Wrench } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ToolHubConfig } from "@/tool-hubs/registry";

interface ToolHubLayoutProps {
  hub: ToolHubConfig;
}

export function ToolHubLayout({ hub }: ToolHubLayoutProps) {
  const { t } = useTranslation();

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-6 py-6 md:space-y-8 md:py-8">
      <header className="relative overflow-hidden rounded-2xl border border-border/70 bg-gradient-to-br from-card/80 via-card/50 to-background p-5 md:p-7">
        <div className="absolute -right-16 -top-16 h-40 w-40 rounded-full bg-primary/10 blur-3xl" aria-hidden />
        <div className="relative space-y-3">
          <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-primary">
            <Wrench className="h-3.5 w-3.5" />
            {hub.tools.length} {t("common.tools")}
          </span>
          <div className="space-y-1.5">
            <h1 className="font-display text-3xl font-bold tracking-tight md:text-4xl">{t(hub.titleKey)}</h1>
            <p className="max-w-3xl text-sm text-muted-foreground md:text-base">{t(hub.subtitleKey)}</p>
          </div>
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-2 xl:gap-5">
        {hub.tools.map((tool) => (
          <Link
            key={tool.id}
            to={tool.to}
            className="group nav-motion-base block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`${t("common.openTool")}: ${t(tool.titleKey)}`}
          >
            <Card className="h-full border-border/70 bg-card/35 transition-[transform,border-color,background-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-primary/45 hover:bg-card/60 hover:shadow-[0_0_0_1px_rgba(255,127,0,0.12)]">
              <CardHeader className="flex flex-row items-start gap-3.5 space-y-0 pb-3">
                <div className="rounded-xl border border-primary/35 bg-primary/10 p-2.5 text-primary transition-transform duration-200 group-hover:scale-105">
                  <tool.icon className="h-4 w-4" />
                </div>
                <div className="space-y-1.5">
                  <CardTitle className="text-xl font-semibold tracking-tight">{t(tool.titleKey)}</CardTitle>
                  <CardDescription className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                    {t(tool.descriptionKey)}
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-primary/90 transition-colors group-hover:text-primary">
                  {t("common.openTool")}
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </span>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
