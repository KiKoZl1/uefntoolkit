import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import UmgToVerseTool from "@/components/widgetkit/UmgToVerseTool";
import { Button } from "@/components/ui/button";

export default function UmgToVersePage() {
  const { t } = useTranslation();

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-6 py-6">
      <header className="space-y-2">
        <Button variant="ghost" asChild className="h-8 w-fit px-2">
          <Link to="/app/widgetkit">
            <ArrowLeft className="mr-1 h-4 w-4" />
            WidgetKit
          </Link>
        </Button>
        <h1 className="font-display text-3xl font-bold tracking-tight">{t("widgetKit.umgVerse.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("widgetKit.umgVerse.subtitle")}</p>
      </header>

      <UmgToVerseTool active />
    </div>
  );
}
