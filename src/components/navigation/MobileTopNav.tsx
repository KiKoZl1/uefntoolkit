import { memo, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { LogOut, Menu, Shield, User } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { NavAccessState, NavSection, TopBarContext } from "@/navigation/types";
import { isNavItemActive } from "@/navigation/config";

interface MobileTopNavProps {
  context: TopBarContext;
  sections: NavSection[];
  access: NavAccessState;
  onSignOut: () => void;
}

export const MobileTopNav = memo(function MobileTopNav({ context, sections, access, onSignOut }: MobileTopNavProps) {
  const [open, setOpen] = useState(false);
  const { t, i18n } = useTranslation();
  const location = useLocation();

  const contextLabelKey = useMemo(() => {
    if (context === "admin") return "nav.contextAdmin";
    if (context === "app") return "nav.contextApp";
    return "nav.contextPublic";
  }, [context]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t("nav.openMenu")}>
          <Menu className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-[88vw] border-border/70 bg-background/95 px-0 backdrop-blur-xl sm:max-w-md">
        <SheetHeader className="border-b border-border/60 px-5 pb-4">
          <SheetTitle className="flex items-center justify-between">
            <Link to="/" className="font-display text-lg font-bold tracking-tight" onClick={() => setOpen(false)}>
              Surprise<span className="text-primary">Radar</span>
            </Link>
            <span className="rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-primary">
              {t(contextLabelKey)}
            </span>
          </SheetTitle>
        </SheetHeader>

        <div className="flex h-full flex-col">
          <div className="flex-1 space-y-6 overflow-y-auto px-5 py-6">
            {sections.map((section) => (
              <section key={section.id} className="space-y-2">
                <h3 className="px-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{t(section.labelKey)}</h3>
                <div className="space-y-1">
                  {section.items.map((item) => {
                    const active = isNavItemActive(item, location.pathname);
                    return (
                      <Link
                        key={item.id}
                        to={item.to}
                        onClick={() => setOpen(false)}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "nav-motion-base block rounded-lg border px-3 py-2.5 transition-[background-color,color,border-color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          active
                            ? "border-primary/40 bg-primary/12 text-primary"
                            : "border-transparent text-foreground/85 hover:border-border/80 hover:bg-muted/60",
                        )}
                      >
                        <div className="text-sm font-medium">{t(item.labelKey)}</div>
                        {item.descriptionKey ? <div className="text-xs text-muted-foreground">{t(item.descriptionKey)}</div> : null}
                      </Link>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>

          <div className="border-t border-border/60 px-5 py-4">
            {access.isAuthenticated ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" className="justify-start" asChild>
                    <Link to="/app" onClick={() => setOpen(false)}>
                      <User className="h-4 w-4" />
                      {t("nav.account")}
                    </Link>
                  </Button>
                  {(access.isAdmin || access.isEditor) && (
                    <Button variant="outline" className="justify-start" asChild>
                      <Link to="/admin" onClick={() => setOpen(false)}>
                        <Shield className="h-4 w-4" />
                        {t("common.admin")}
                      </Link>
                    </Button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant={i18n.resolvedLanguage === "pt-BR" ? "default" : "outline"}
                    size="sm"
                    aria-pressed={i18n.resolvedLanguage === "pt-BR"}
                    onClick={() => void i18n.changeLanguage("pt-BR")}
                  >
                    PT-BR
                  </Button>
                  <Button
                    variant={i18n.resolvedLanguage === "en" ? "default" : "outline"}
                    size="sm"
                    aria-pressed={i18n.resolvedLanguage === "en"}
                    onClick={() => void i18n.changeLanguage("en")}
                  >
                    EN
                  </Button>
                </div>

                <Button
                  variant="ghost"
                  className="w-full justify-start text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => {
                    setOpen(false);
                    onSignOut();
                  }}
                >
                  <LogOut className="h-4 w-4" />
                  {t("common.signOut")}
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <Button className="w-full" asChild>
                  <Link to="/auth" onClick={() => setOpen(false)}>
                    {t("nav.getStarted")}
                  </Link>
                </Button>
                <Button variant="ghost" className="w-full" asChild>
                  <Link to="/auth" onClick={() => setOpen(false)}>
                    {t("nav.signIn")}
                  </Link>
                </Button>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant={i18n.resolvedLanguage === "pt-BR" ? "default" : "outline"}
                    size="sm"
                    aria-pressed={i18n.resolvedLanguage === "pt-BR"}
                    onClick={() => void i18n.changeLanguage("pt-BR")}
                  >
                    PT-BR
                  </Button>
                  <Button
                    variant={i18n.resolvedLanguage === "en" ? "default" : "outline"}
                    size="sm"
                    aria-pressed={i18n.resolvedLanguage === "en"}
                    onClick={() => void i18n.changeLanguage("en")}
                  >
                    EN
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
});

MobileTopNav.displayName = "MobileTopNav";
