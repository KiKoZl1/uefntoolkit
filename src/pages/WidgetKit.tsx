import { Link } from "react-router-dom";
import { Binary, FileCode2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const TOOLS = [
  {
    to: "/app/widgetkit/psd-umg",
    titleKey: "widgetKit.tabPsdUmg",
    descriptionKey: "widgetKit.psdUmg.subtitle",
    icon: Binary,
  },
  {
    to: "/app/widgetkit/umg-verse",
    titleKey: "widgetKit.tabUmgVerse",
    descriptionKey: "widgetKit.umgVerse.subtitle",
    icon: FileCode2,
  },
] as const;

export default function WidgetKit() {
  const { t } = useTranslation();

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-6 py-6">
      <header className="space-y-1">
        <h1 className="font-display text-3xl font-bold">WidgetKit</h1>
        <p className="text-sm text-muted-foreground">{t("widgetKit.subtitle")}</p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        {TOOLS.map((tool) => (
          <Link key={tool.to} to={tool.to}>
            <Card className="h-full border-border/60 bg-card/30 transition hover:border-primary/40 hover:bg-card/50">
              <CardHeader className="flex flex-row items-center gap-3 space-y-0">
                <div className="rounded-lg border border-primary/30 bg-primary/10 p-2 text-primary">
                  <tool.icon className="h-4 w-4" />
                </div>
                <div className="space-y-1">
                  <CardTitle className="text-lg">{t(tool.titleKey)}</CardTitle>
                  <CardDescription>{t(tool.descriptionKey)}</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">Abrir ferramenta</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
