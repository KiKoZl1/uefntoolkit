import { Outlet, Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Radar, Menu, X } from "lucide-react";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { cn } from "@/lib/utils";

export default function PublicLayout() {
  const { t } = useTranslation();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const navLinks = [
    { to: "/discover", label: t("nav.discover") },
    { to: "/reports", label: t("nav.reports") },
  ];

  const isActive = (path: string) => location.pathname === path;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <nav className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="flex items-center justify-between px-6 py-3 max-w-7xl mx-auto w-full">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <Radar className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-display text-lg font-bold tracking-tight">
              Surprise<span className="text-primary">Radar</span>
            </span>
          </Link>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-1">
            {navLinks.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className={cn(
                  "px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
                  isActive(link.to)
                    ? "text-primary bg-primary/10"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                )}
              >
                {link.label}
              </Link>
            ))}
          </div>

          <div className="hidden md:flex items-center gap-2">
            <LanguageSwitcher />
            <Button variant="ghost" size="sm" asChild>
              <Link to="/auth">{t("nav.signIn")}</Link>
            </Button>
            <Button size="sm" asChild>
              <Link to="/auth">{t("nav.getStarted")}</Link>
            </Button>
          </div>

          {/* Mobile toggle */}
          <button className="md:hidden p-2" onClick={() => setMobileOpen(!mobileOpen)}>
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {/* Mobile menu */}
        {mobileOpen && (
          <div className="md:hidden border-t border-border px-6 py-4 space-y-2 bg-background">
            {navLinks.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                onClick={() => setMobileOpen(false)}
                className={cn(
                  "block px-3 py-2 text-sm rounded-md",
                  isActive(link.to) ? "text-primary bg-primary/10" : "text-muted-foreground"
                )}
              >
                {link.label}
              </Link>
            ))}
            <div className="pt-2 flex gap-2">
              <Button variant="ghost" size="sm" className="flex-1" asChild>
                <Link to="/auth">{t("nav.signIn")}</Link>
              </Button>
              <Button size="sm" className="flex-1" asChild>
                <Link to="/auth">{t("nav.getStarted")}</Link>
              </Button>
            </div>
          </div>
        )}
      </nav>

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
