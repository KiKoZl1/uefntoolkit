import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  ChevronDown,
  LogOut,
  Radar,
  Shield,
  Sparkles,
  User,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import {
  getTopBarPrimaryItems,
  getToolsShortcutItems,
  getVisibleNavSections,
  isNavItemActive,
} from "@/navigation/config";
import { NavAccessState, TopBarContext } from "@/navigation/types";
import { Button } from "@/components/ui/button";
import { MobileTopNav } from "@/components/navigation/MobileTopNav";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

interface TopBarProps {
  context: TopBarContext;
}

function getUserInitials(email?: string | null) {
  if (!email) return "U";
  const [first, second] = email.split("@")[0].split(/[.\-_]/);
  return `${(first?.[0] || "U").toUpperCase()}${(second?.[0] || "").toUpperCase()}`;
}

export function TopBar({ context }: TopBarProps) {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const { user, isAdmin, isEditor, signOut } = useAuth();
  const [toolsOpen, setToolsOpen] = useState(false);
  const closeTimeoutRef = useRef<number | null>(null);
  const toolsContainerRef = useRef<HTMLDivElement | null>(null);
  const firstShortcutRef = useRef<HTMLAnchorElement | null>(null);
  const toolsMenuId = useId();

  const access = useMemo<NavAccessState>(
    () => ({
      isAuthenticated: Boolean(user),
      isAdmin,
      isEditor,
    }),
    [isAdmin, isEditor, user],
  );

  const primaryItems = useMemo(() => getTopBarPrimaryItems(context, access), [access, context]);
  const toolsShortcuts = useMemo(() => getToolsShortcutItems(context, access), [access, context]);
  const mobileSections = useMemo(() => getVisibleNavSections(context, access), [access, context]);

  const contextLabelKey = useMemo(() => {
    if (context === "admin") return "nav.contextAdmin";
    if (context === "app") return "nav.contextApp";
    return "nav.contextPublic";
  }, [context]);

  const clearCloseTimeout = useCallback(() => {
    if (closeTimeoutRef.current !== null) {
      window.clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  }, []);

  const scheduleToolsClose = useCallback(() => {
    clearCloseTimeout();
    closeTimeoutRef.current = window.setTimeout(() => setToolsOpen(false), 120);
  }, [clearCloseTimeout]);

  useEffect(() => {
    return () => clearCloseTimeout();
  }, [clearCloseTimeout]);

  useEffect(() => {
    setToolsOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!toolsOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!toolsContainerRef.current?.contains(event.target as Node)) {
        setToolsOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setToolsOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [toolsOpen]);

  const handleSignOut = useCallback(() => {
    void signOut();
  }, [signOut]);

  const renderPrimaryLink = useCallback(
    (itemId: string, labelKey: string, to: string, active: boolean) => {
      return (
        <Link
          key={itemId}
          to={to}
          className={cn(
            "nav-motion-base rounded-md px-3 py-2 text-sm font-medium transition-[background-color,color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            active
              ? "bg-primary/14 text-primary"
              : "text-foreground/80 hover:bg-muted/70 hover:text-foreground",
          )}
        >
          {t(labelKey)}
        </Link>
      );
    },
    [t],
  );

  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/84 backdrop-blur-2xl supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-3 px-4 sm:px-6">
        <Link to="/" className="group flex items-center gap-2.5 shrink-0">
          <div className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-primary/30 bg-primary/90 text-primary-foreground shadow-[0_0_0_1px_rgba(255,127,0,0.2)]">
            <Radar className="nav-motion-base h-4 w-4 transition-transform group-hover:rotate-12" />
          </div>
          <span className="font-display text-base font-bold tracking-tight sm:text-lg">
            Surprise<span className="text-primary">Radar</span>
          </span>
        </Link>

        <nav className="hidden flex-1 items-center justify-center gap-1 lg:flex">
          {primaryItems.map((item) => {
            const active = isNavItemActive(item, location.pathname);
            const isToolsHub = item.id === "thumbToolsHub" && toolsShortcuts.length > 0;

            if (!isToolsHub) {
              return renderPrimaryLink(item.id, item.labelKey, item.to, active);
            }

            return (
              <div
                key={item.id}
                ref={toolsContainerRef}
                className="relative"
                onMouseEnter={() => {
                  clearCloseTimeout();
                  setToolsOpen(true);
                }}
                onMouseLeave={scheduleToolsClose}
                onFocusCapture={() => {
                  clearCloseTimeout();
                  setToolsOpen(true);
                }}
                onBlurCapture={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    scheduleToolsClose();
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setToolsOpen(false);
                    (event.currentTarget as HTMLElement).blur();
                  }
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setToolsOpen(true);
                    window.requestAnimationFrame(() => firstShortcutRef.current?.focus());
                  }
                }}
              >
                <Link
                  to={item.to}
                  className={cn(
                    "nav-motion-base inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium transition-[background-color,color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active
                      ? "bg-primary/14 text-primary"
                      : "text-foreground/80 hover:bg-muted/70 hover:text-foreground",
                  )}
                  aria-haspopup="menu"
                  aria-expanded={toolsOpen}
                  aria-controls={toolsMenuId}
                  aria-label={t("nav.thumbTools")}
                  onClick={() => setToolsOpen(false)}
                >
                  {t(item.labelKey)}
                  <ChevronDown className={cn("nav-motion-base h-3.5 w-3.5 transition-transform", toolsOpen && "rotate-180")} />
                </Link>

                <div
                  id={toolsMenuId}
                  className={cn(
                    "absolute left-1/2 top-full mt-2 w-[320px] -translate-x-1/2 rounded-xl border border-border/70 bg-card/96 p-2 shadow-2xl backdrop-blur-sm",
                    "nav-motion-base transition-[opacity,transform]",
                    toolsOpen ? "pointer-events-auto translate-y-0 opacity-100" : "pointer-events-none -translate-y-1 opacity-0",
                  )}
                  role="menu"
                  aria-label={t("nav.sectionTools")}
                >
                  {toolsShortcuts.map((shortcut) => (
                    <Link
                      key={shortcut.id}
                      ref={shortcut === toolsShortcuts[0] ? firstShortcutRef : null}
                      to={shortcut.to}
                      role="menuitem"
                      className="nav-motion-fast block rounded-lg px-3 py-2 transition-[background-color,transform] hover:bg-primary/12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <div className="text-sm font-medium text-foreground">{t(shortcut.labelKey)}</div>
                      {shortcut.descriptionKey ? (
                        <div className="text-xs text-muted-foreground">{t(shortcut.descriptionKey)}</div>
                      ) : null}
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>

        <div className="ml-auto hidden items-center gap-2 lg:flex">
          <span className="rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-primary">
            {t(contextLabelKey)}
          </span>

          {access.isAuthenticated ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-10 gap-2 rounded-full border border-border/60 pl-2.5 pr-3" aria-label={t("nav.profileMenu")}>
                  <Avatar className="h-6 w-6 border border-border/70">
                    <AvatarFallback className="bg-muted text-[11px] font-semibold text-foreground">
                      {getUserInitials(user?.email)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="max-w-36 truncate text-xs text-muted-foreground">{user?.email}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuItem asChild>
                  <Link to="/app">
                    <User className="h-4 w-4" />
                    {t("nav.account")}
                  </Link>
                </DropdownMenuItem>
                {(isAdmin || isEditor) && (
                  <DropdownMenuItem asChild>
                    <Link to="/admin">
                      <Shield className="h-4 w-4" />
                      {t("common.admin")}
                    </Link>
                  </DropdownMenuItem>
                )}
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Sparkles className="h-4 w-4" />
                    {t("nav.language")}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuRadioGroup value={i18n.resolvedLanguage} onValueChange={(value) => void i18n.changeLanguage(value)}>
                      <DropdownMenuRadioItem value="pt-BR">Português (Brasil)</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="en">English</DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={(event) => {
                    event.preventDefault();
                    handleSignOut();
                  }}
                >
                  <LogOut className="h-4 w-4" />
                  {t("common.signOut")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <>
              <LanguageSwitcher />
              <Button variant="ghost" size="sm" asChild>
                <Link to="/auth">{t("nav.signIn")}</Link>
              </Button>
              <Button size="sm" asChild>
                <Link to="/auth">{t("nav.getStarted")}</Link>
              </Button>
            </>
          )}
        </div>

        <div className="ml-auto lg:hidden">
          <MobileTopNav context={context} sections={mobileSections} access={access} onSignOut={handleSignOut} />
        </div>
      </div>
    </header>
  );
}
