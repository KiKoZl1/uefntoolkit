import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  ChevronDown,
  LogOut,
  Radar,
  Shield,
  User,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import {
  getTopBarPrimaryItems,
  getToolsShortcutItems,
  getWidgetKitShortcutItems,
  getVisibleNavSections,
  isNavItemActive,
} from "@/navigation/config";
import { NavAccessState, TopBarContext } from "@/navigation/types";
import { Button } from "@/components/ui/button";
import { MobileTopNav } from "@/components/navigation/MobileTopNav";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

interface TopBarProps {
  context: TopBarContext;
}

function getUserDisplayName(user: { email?: string | null; user_metadata?: Record<string, unknown> } | null) {
  const fromMetadata = user?.user_metadata;
  const candidate =
    (typeof fromMetadata?.display_name === "string" && fromMetadata.display_name) ||
    (typeof fromMetadata?.full_name === "string" && fromMetadata.full_name) ||
    (typeof fromMetadata?.name === "string" && fromMetadata.name);

  if (candidate && candidate.trim().length > 0) return candidate.trim();
  if (user?.email) return user.email.split("@")[0];
  return "User";
}

function getUserAvatarUrl(user: { user_metadata?: Record<string, unknown> } | null) {
  const fromMetadata = user?.user_metadata;
  const candidate =
    (typeof fromMetadata?.avatar_url === "string" && fromMetadata.avatar_url) ||
    (typeof fromMetadata?.picture === "string" && fromMetadata.picture);

  return candidate || undefined;
}

function getUserInitials(name: string) {
  const [first, second] = name.split(/[.\-_\s]/);
  return `${(first?.[0] || "U").toUpperCase()}${(second?.[0] || "").toUpperCase()}`;
}

export function TopBar({ context }: TopBarProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const { user, isAdmin, isEditor, signOut } = useAuth();
  const [openFlyoutMenu, setOpenFlyoutMenu] = useState<"thumbToolsHub" | "widgetKitHub" | null>(null);
  const closeTimeoutRef = useRef<number | null>(null);
  const toolsContainerRef = useRef<HTMLDivElement | null>(null);
  const widgetKitContainerRef = useRef<HTMLDivElement | null>(null);
  const firstShortcutRef = useRef<HTMLAnchorElement | null>(null);
  const firstWidgetShortcutRef = useRef<HTMLAnchorElement | null>(null);
  const toolsMenuId = useId();
  const widgetKitMenuId = useId();

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
  const widgetKitShortcuts = useMemo(() => getWidgetKitShortcutItems(context, access), [access, context]);
  const mobileSections = useMemo(() => getVisibleNavSections(context, access), [access, context]);
  const displayName = useMemo(() => getUserDisplayName(user), [user]);
  const avatarUrl = useMemo(() => getUserAvatarUrl(user), [user]);
  const isInAdminArea = location.pathname.startsWith("/admin");
  const contextSwitchTo = isInAdminArea ? "/app" : "/admin";
  const contextSwitchLabel = isInAdminArea ? t("common.backToApp") : t("common.admin");
  const ContextSwitchIcon = isInAdminArea ? Radar : Shield;

  const clearCloseTimeout = useCallback(() => {
    if (closeTimeoutRef.current !== null) {
      window.clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  }, []);

  const scheduleToolsClose = useCallback(() => {
    clearCloseTimeout();
    closeTimeoutRef.current = window.setTimeout(() => setOpenFlyoutMenu(null), 120);
  }, [clearCloseTimeout]);

  useEffect(() => {
    return () => clearCloseTimeout();
  }, [clearCloseTimeout]);

  useEffect(() => {
    setOpenFlyoutMenu(null);
  }, [location.pathname]);

  useEffect(() => {
    if (!openFlyoutMenu) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      const insideTools = toolsContainerRef.current?.contains(target);
      const insideWidgetKit = widgetKitContainerRef.current?.contains(target);
      if (!insideTools && !insideWidgetKit) {
        setOpenFlyoutMenu(null);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenFlyoutMenu(null);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [openFlyoutMenu]);

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
    <header className="sticky top-0 z-[90] border-b border-border/60 bg-background/84 backdrop-blur-2xl supports-[backdrop-filter]:bg-background/70">
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
            const isToolsHub = item.id === "thumbToolsHub";
            const isWidgetKitHub = item.id === "widgetKitHub";
            const shortcutItems = isToolsHub ? toolsShortcuts : isWidgetKitHub ? widgetKitShortcuts : [];
            const hasFlyout = shortcutItems.length > 0 && (isToolsHub || isWidgetKitHub);

            if (!hasFlyout) {
              return renderPrimaryLink(item.id, item.labelKey, item.to, active);
            }

            const flyoutId = isToolsHub ? "thumbToolsHub" : "widgetKitHub";
            const isOpen = openFlyoutMenu === flyoutId;
            const menuId = isToolsHub ? toolsMenuId : widgetKitMenuId;
            const containerRef = isToolsHub ? toolsContainerRef : widgetKitContainerRef;
            const primaryShortcutRef = isToolsHub ? firstShortcutRef : firstWidgetShortcutRef;
            const menuAriaLabel = isToolsHub ? "nav.sectionTools" : "nav.sectionWidgetKit";

            return (
              <div
                key={item.id}
                ref={containerRef}
                className="relative z-[91]"
                onMouseEnter={() => {
                  clearCloseTimeout();
                  setOpenFlyoutMenu(flyoutId);
                }}
                onMouseLeave={scheduleToolsClose}
                onFocusCapture={() => {
                  clearCloseTimeout();
                  setOpenFlyoutMenu(flyoutId);
                }}
                onBlurCapture={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    scheduleToolsClose();
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setOpenFlyoutMenu(null);
                    (event.currentTarget as HTMLElement).blur();
                  }
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setOpenFlyoutMenu(flyoutId);
                    window.requestAnimationFrame(() => primaryShortcutRef.current?.focus());
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
                  aria-expanded={isOpen}
                  aria-controls={menuId}
                  aria-label={t(item.labelKey)}
                  onClick={() => setOpenFlyoutMenu(null)}
                >
                  {t(item.labelKey)}
                  <ChevronDown className={cn("nav-motion-base h-3.5 w-3.5 transition-transform", isOpen && "rotate-180")} />
                </Link>

                <div
                  id={menuId}
                  className={cn(
                    "absolute left-1/2 top-full z-[99] mt-2 w-[320px] -translate-x-1/2 rounded-xl border border-border/80 bg-background p-2 shadow-[0_20px_60px_rgba(0,0,0,0.55)]",
                    "nav-motion-base transition-[opacity,transform]",
                    isOpen ? "pointer-events-auto translate-y-0 opacity-100" : "pointer-events-none -translate-y-1 opacity-0",
                  )}
                  role="menu"
                  aria-label={t(menuAriaLabel)}
                >
                  {shortcutItems.map((shortcut) => (
                    <Link
                      key={shortcut.id}
                      ref={shortcut === shortcutItems[0] ? primaryShortcutRef : null}
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
          {access.isAuthenticated ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-10 gap-2 rounded-full border border-border/60 pl-2.5 pr-3" aria-label={t("nav.profileMenu")}>
                  <Avatar className="h-6 w-6 border border-border/70">
                    {avatarUrl ? <AvatarImage src={avatarUrl} alt={displayName} /> : null}
                    <AvatarFallback className="bg-muted text-[11px] font-semibold text-foreground">
                      {getUserInitials(displayName)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="max-w-36 truncate text-xs text-muted-foreground">{displayName}</span>
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
                    <Link to={contextSwitchTo}>
                      <ContextSwitchIcon className="h-4 w-4" />
                      {contextSwitchLabel}
                    </Link>
                  </DropdownMenuItem>
                )}
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
              <Button variant="ghost" size="sm" asChild>
                <Link to="/auth">{t("nav.signIn")}</Link>
              </Button>
              <Button size="sm" asChild>
                <Link to="/auth">{t("nav.getStarted")}</Link>
              </Button>
            </>
          )}
          <LanguageSwitcher />
        </div>

        <div className="ml-auto lg:hidden">
          <MobileTopNav context={context} sections={mobileSections} access={access} onSignOut={handleSignOut} />
        </div>
      </div>
    </header>
  );
}
