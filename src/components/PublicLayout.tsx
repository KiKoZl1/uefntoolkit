import { Outlet, Link } from "react-router-dom";
import { Radar } from "lucide-react";
import { useTranslation } from "react-i18next";
import { TopBar } from "@/components/navigation/TopBar";

export default function PublicLayout() {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <TopBar context="public" />

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="px-6 py-8 border-t border-border/50">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Radar className="h-4 w-4 text-primary" />
            <span className="text-sm font-display font-semibold">SurpriseRadar</span>
          </div>
          <p className="text-xs text-muted-foreground">{t("footer.copyright")}</p>
          <div className="flex gap-4 text-xs text-muted-foreground">
            <Link to="/reports" className="hover:text-foreground transition-colors">{t("nav.reports")}</Link>
            <Link to="/discover" className="hover:text-foreground transition-colors">{t("nav.discover")}</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
