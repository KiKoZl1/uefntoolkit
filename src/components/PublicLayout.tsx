import { Outlet, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Radar } from "lucide-react";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useTranslation } from "react-i18next";

export default function PublicLayout() {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <nav className="flex items-center justify-between px-6 py-4 max-w-6xl mx-auto w-full">
        <Link to="/" className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
            <Radar className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="font-display text-lg font-bold">Surprise Radar</span>
        </Link>
        <div className="flex items-center gap-3">
          <Button variant="ghost" asChild>
            <Link to="/discover">{t("nav.discover")}</Link>
          </Button>
          <Button variant="ghost" asChild>
            <Link to="/reports">{t("nav.reports")}</Link>
          </Button>
          <Button variant="ghost" asChild>
            <Link to="/auth">{t("nav.signIn")}</Link>
          </Button>
          <Button asChild>
            <Link to="/auth">{t("nav.getStarted")}</Link>
          </Button>
          <LanguageSwitcher />
        </div>
      </nav>
      <main className="flex-1">
        <Outlet />
      </main>
      <footer className="px-6 py-8 border-t text-center text-sm text-muted-foreground">
        {t("footer.copyright")}
      </footer>
    </div>
  );
}
