import { useCallback, useEffect, useId, useMemo, useRef, useState, type MouseEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowLeftRight, ChevronDown, LogOut, Shield, User } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import {
  getCategoryShortcutItems,
  getTopBarPrimaryItems,
  getVisibleNavSections,
  isNavItemActive,
  isNavItemProtectedForAccess,
} from "@/navigation/config";
import { resolveNavItemIcon } from "@/navigation/iconMap";
import { NavAccessState, NavItem, TopBarContext } from "@/navigation/types";
import { Button } from "@/components/ui/button";
import { MobileTopNav } from "@/components/navigation/MobileTopNav";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { PlatformBrand } from "@/components/brand/PlatformBrand";
import { AuthGateDialog } from "@/components/navigation/AuthGateDialog";
import { COMMERCE_CREDITS_UI_EVENT, getCommerceCreditsSummary } from "@/lib/commerce/client";
import { useToolCosts } from "@/hooks/useToolCosts";
import { getToolCodeForNavItem } from "@/lib/commerce/toolCosts";
import { CreditIcon } from "@/components/commerce/CreditIcon";
import {
  applyTopbarCreditsUiEvent,
  type CommerceCreditsUiEventDetail,
  type TopBarCommerceSummary,
} from "@/lib/commerce/topbarCreditsUi";

interface TopBarProps {
  context: TopBarContext;
}

const COMMERCE_SUMMARY_CACHE_PREFIX = "commerce_topbar_summary_v1:";

const FLYOUT_HUB_IDS = new Set(["analyticsToolsHub", "thumbToolsHub", "widgetKitHub"]);

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

function toSafeInt(value: unknown): number {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.floor(raw));
}

function readCachedCommerceSummary(userId: string): TopBarCommerceSummary | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(`${COMMERCE_SUMMARY_CACHE_PREFIX}${userId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TopBarCommerceSummary>;
    const planType = parsed.planType === "pro" ? "pro" : parsed.planType === "free" ? "free" : null;
    if (!planType) return null;

    return {
      planType,
      spendableNow: toSafeInt(parsed.spendableNow),
      weeklyWallet: toSafeInt(parsed.weeklyWallet),
      freeMonthly: toSafeInt(parsed.freeMonthly),
      extraWallet: toSafeInt(parsed.extraWallet),
    };
  } catch {
    return null;
  }
}

function writeCachedCommerceSummary(userId: string, summary: TopBarCommerceSummary) {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(`${COMMERCE_SUMMARY_CACHE_PREFIX}${userId}`, JSON.stringify(summary));
  } catch {
    // best effort only
  }
}

export function TopBar({ context }: TopBarProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const { user, isAdmin, isEditor, signOut } = useAuth();
  const { getCost } = useToolCosts();
  const [openFlyoutMenu, setOpenFlyoutMenu] = useState<string | null>(null);
  const [authGate, setAuthGate] = useState<{ open: boolean; label?: string }>({ open: false });
  const [commerceSummary, setCommerceSummary] = useState<TopBarCommerceSummary | null>(null);
  const [commerceSummaryLoading, setCommerceSummaryLoading] = useState(false);
  const optimisticDebitAppliedRef = useRef(0);
  const closeTimeoutRef = useRef<number | null>(null);
  const analyticsContainerRef = useRef<HTMLDivElement | null>(null);
  const toolsContainerRef = useRef<HTMLDivElement | null>(null);
  const widgetKitContainerRef = useRef<HTMLDivElement | null>(null);
  const firstAnalyticsShortcutRef = useRef<HTMLAnchorElement | null>(null);
  const firstToolsShortcutRef = useRef<HTMLAnchorElement | null>(null);
  const firstWidgetShortcutRef = useRef<HTMLAnchorElement | null>(null);
  const analyticsMenuId = useId();
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
  const mobileSections = useMemo(() => getVisibleNavSections(context, access), [access, context]);
  const displayName = useMemo(() => getUserDisplayName(user), [user]);
  const avatarUrl = useMemo(() => getUserAvatarUrl(user), [user]);
  const isInAdminArea = location.pathname.startsWith("/admin");
  const contextSwitchTo = isInAdminArea ? "/app" : "/admin";
  const contextSwitchLabel = isInAdminArea ? t("common.backToApp") : t("common.admin");
  const ContextSwitchIcon = isInAdminArea ? ArrowLeftRight : Shield;
  const planLabel = commerceSummary?.planType === "pro" ? "Pro" : commerceSummary?.planType === "free" ? "Free" : "...";

  const clearCloseTimeout = useCallback(() => {
    if (closeTimeoutRef.current !== null) {
      window.clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  }, []);

  const scheduleFlyoutClose = useCallback(() => {
    clearCloseTimeout();
    closeTimeoutRef.current = window.setTimeout(() => setOpenFlyoutMenu(null), 120);
  }, [clearCloseTimeout]);

  const getContainerRef = useCallback((id: string) => {
    if (id === "analyticsToolsHub") return analyticsContainerRef;
    if (id === "thumbToolsHub") return toolsContainerRef;
    return widgetKitContainerRef;
  }, []);

  const getMenuId = useCallback((id: string) => {
    if (id === "analyticsToolsHub") return analyticsMenuId;
    if (id === "thumbToolsHub") return toolsMenuId;
    return widgetKitMenuId;
  }, [analyticsMenuId, toolsMenuId, widgetKitMenuId]);

  const getFirstShortcutRef = useCallback((id: string) => {
    if (id === "analyticsToolsHub") return firstAnalyticsShortcutRef;
    if (id === "thumbToolsHub") return firstToolsShortcutRef;
    return firstWidgetShortcutRef;
  }, []);

  const promptAuthForLabel = useCallback((label: string) => {
    setAuthGate({ open: true, label });
  }, []);

  const handleProtectedClick = useCallback(
    (event: MouseEvent, requiresAuthPrompt: boolean, labelKey: string) => {
      if (!requiresAuthPrompt) return;
      event.preventDefault();
      setOpenFlyoutMenu(null);
      promptAuthForLabel(t(labelKey));
    },
    [promptAuthForLabel, t],
  );

  useEffect(() => {
    return () => clearCloseTimeout();
  }, [clearCloseTimeout]);

  useEffect(() => {
    setOpenFlyoutMenu(null);
  }, [location.pathname]);

  useEffect(() => {
    if (!access.isAuthenticated || !user?.id) {
      setCommerceSummary(null);
      setCommerceSummaryLoading(false);
      optimisticDebitAppliedRef.current = 0;
      return;
    }

    let isCancelled = false;
    const cached = readCachedCommerceSummary(user.id);
    if (cached) setCommerceSummary(cached);
    setCommerceSummaryLoading(true);

    const loadCommerceSummary = async () => {
      try {
        const payload = await getCommerceCreditsSummary();
        if (isCancelled) return;

        const summary = payload?.summary || {};
        const weeklyWallet = toSafeInt(summary.weekly_wallet_available);
        const freeMonthly = toSafeInt(summary.free_monthly_available);
        const extraWallet = toSafeInt(summary.extra_wallet_available);
        const spendableNow = toSafeInt(summary.spendable_now || (weeklyWallet + freeMonthly + extraWallet));
        const planType = String(summary.plan_type || "free") === "pro" ? "pro" : "free";

        const nextSummary: TopBarCommerceSummary = {
          planType,
          spendableNow,
          weeklyWallet,
          freeMonthly,
          extraWallet,
        };

        setCommerceSummary(nextSummary);
        writeCachedCommerceSummary(user.id, nextSummary);
        optimisticDebitAppliedRef.current = 0;
        setCommerceSummaryLoading(false);
      } catch {
        if (!isCancelled) setCommerceSummaryLoading(false);
      }
    };

    void loadCommerceSummary();
    const refreshId = window.setInterval(() => {
      void loadCommerceSummary();
    }, 60_000);

    return () => {
      isCancelled = true;
      window.clearInterval(refreshId);
    };
  }, [access.isAuthenticated, user?.id]);

  useEffect(() => {
    if (!access.isAuthenticated || !user?.id) return;

    const handleCreditsUiEvent = (event: Event) => {
      const detail = (event as CustomEvent<CommerceCreditsUiEventDetail>).detail;
      if (!detail || typeof detail !== "object") return;

      setCommerceSummary((prev) => {
        const base: TopBarCommerceSummary = prev || {
          planType: "free",
          spendableNow: 0,
          weeklyWallet: 0,
          freeMonthly: 0,
          extraWallet: 0,
        };
        const optimisticState = { appliedDebit: optimisticDebitAppliedRef.current };
        const next = applyTopbarCreditsUiEvent(base, detail, optimisticState);
        optimisticDebitAppliedRef.current = optimisticState.appliedDebit;
        writeCachedCommerceSummary(user.id, next);
        return next;
      });
    };

    window.addEventListener(COMMERCE_CREDITS_UI_EVENT, handleCreditsUiEvent as EventListener);
    return () => {
      window.removeEventListener(COMMERCE_CREDITS_UI_EVENT, handleCreditsUiEvent as EventListener);
    };
  }, [access.isAuthenticated, user?.id]);

  useEffect(() => {
    if (!openFlyoutMenu) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      const insideAnalytics = analyticsContainerRef.current?.contains(target);
      const insideTools = toolsContainerRef.current?.contains(target);
      const insideWidgetKit = widgetKitContainerRef.current?.contains(target);
      if (!insideAnalytics && !insideTools && !insideWidgetKit) {
        setOpenFlyoutMenu(null);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenFlyoutMenu(null);
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
    (itemId: string, labelKey: string, to: string, active: boolean, protectedForAccess: boolean, iconKey?: NavItem["icon"]) => {
      const Icon = resolveNavItemIcon(iconKey);
      return (
        <Link
          key={itemId}
          to={to}
          onClick={(event) => handleProtectedClick(event, protectedForAccess, labelKey)}
          className={cn(
            "nav-motion-base inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-[background-color,color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            active ? "bg-primary/14 text-primary" : "text-foreground/80 hover:bg-muted/70 hover:text-foreground",
          )}
        >
          {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
          <span>{t(labelKey)}</span>
        </Link>
      );
    },
    [handleProtectedClick, t],
  );

  return (
    <>
      <header className="sticky top-0 z-[90] border-b border-border/60 bg-background/84 backdrop-blur-2xl supports-[backdrop-filter]:bg-background/70">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-3 px-4 sm:px-6">
          <Link to="/" className="group shrink-0">
            <PlatformBrand />
          </Link>

          <nav className="hidden flex-1 items-center justify-center gap-1 lg:flex">
            {primaryItems.map((item) => {
              const active = isNavItemActive(item, location.pathname);
              const shortcutItems = getCategoryShortcutItems(item.id, context, access);
              const hasFlyout = FLYOUT_HUB_IDS.has(item.id) && shortcutItems.length > 0;
              const protectedForAccess = isNavItemProtectedForAccess(item, access);

              if (!hasFlyout) {
                return renderPrimaryLink(item.id, item.labelKey, item.to, active, protectedForAccess, item.icon);
              }

              const isOpen = openFlyoutMenu === item.id;
              const menuId = getMenuId(item.id);
              const containerRef = getContainerRef(item.id);
              const primaryShortcutRef = getFirstShortcutRef(item.id);
              const HubIcon = resolveNavItemIcon(item.icon);

              return (
                <div
                  key={item.id}
                  ref={containerRef}
                  className="relative z-[91]"
                  onMouseEnter={() => {
                    clearCloseTimeout();
                    setOpenFlyoutMenu(item.id);
                  }}
                  onMouseLeave={scheduleFlyoutClose}
                  onFocusCapture={() => {
                    clearCloseTimeout();
                    setOpenFlyoutMenu(item.id);
                  }}
                  onBlurCapture={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                      scheduleFlyoutClose();
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      setOpenFlyoutMenu(null);
                      (event.currentTarget as HTMLElement).blur();
                    }
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      setOpenFlyoutMenu(item.id);
                      window.requestAnimationFrame(() => primaryShortcutRef.current?.focus());
                    }
                  }}
                >
                  <Link
                    to={item.publicHubTo || item.to}
                    onClick={(event) => handleProtectedClick(event, protectedForAccess, item.labelKey)}
                    className={cn(
                      "nav-motion-base inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-[background-color,color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      active ? "bg-primary/14 text-primary" : "text-foreground/80 hover:bg-muted/70 hover:text-foreground",
                    )}
                    aria-haspopup="menu"
                    aria-expanded={isOpen}
                    aria-controls={menuId}
                    aria-label={t(item.labelKey)}
                  >
                    {HubIcon ? <HubIcon className="h-3.5 w-3.5" /> : null}
                    {t(item.labelKey)}
                    <ChevronDown className={cn("nav-motion-base h-3.5 w-3.5 transition-transform", isOpen && "rotate-180")} />
                  </Link>

                  <div
                    id={menuId}
                    className={cn(
                      "absolute left-1/2 top-full z-[99] mt-2 w-[340px] -translate-x-1/2 rounded-xl border border-border/80 bg-background p-2 shadow-[0_20px_60px_rgba(0,0,0,0.55)]",
                      "nav-motion-base transition-[opacity,transform]",
                      isOpen ? "pointer-events-auto translate-y-0 opacity-100" : "pointer-events-none -translate-y-1 opacity-0",
                    )}
                    role="menu"
                    aria-label={t(item.labelKey)}
                  >
                    {shortcutItems.map((shortcut) => {
                      const ShortcutIcon = resolveNavItemIcon(shortcut.icon);
                      const shortcutProtected = isNavItemProtectedForAccess(shortcut, access);
                      const shortcutToolCode = getToolCodeForNavItem(shortcut.id);
                      const shortcutCost = access.isAuthenticated && shortcutToolCode ? getCost(shortcutToolCode) : 0;
                      return (
                        <Link
                          key={shortcut.id}
                          ref={shortcut === shortcutItems[0] ? primaryShortcutRef : null}
                          to={shortcut.to}
                          role="menuitem"
                          onClick={(event) => handleProtectedClick(event, shortcutProtected, shortcut.labelKey)}
                          className="nav-motion-fast block rounded-lg px-3 py-2 transition-[background-color,transform] hover:bg-primary/12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                              {ShortcutIcon ? <ShortcutIcon className="h-3.5 w-3.5 text-primary" /> : null}
                              <span>{t(shortcut.labelKey)}</span>
                            </div>
                            {shortcutCost > 0 ? (
                              <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-primary/35 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-primary">
                                <CreditIcon className="h-3.5 w-3.5" glyphClassName="h-2 w-2" />
                                {shortcutCost}
                              </span>
                            ) : null}
                          </div>
                          {shortcut.descriptionKey ? (
                            <div className="text-xs text-muted-foreground">{t(shortcut.descriptionKey)}</div>
                          ) : null}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </nav>

          <div className="ml-auto hidden items-center gap-2 lg:flex">
            {access.isAuthenticated ? (
              <>
                <Link
                  to="/app/credits"
                  className="inline-flex h-10 items-center gap-2 rounded-full border border-border/60 bg-background px-3 text-xs text-foreground/90 transition-colors hover:bg-muted/60"
                  aria-label="Abrir creditos e plano"
                >
                  <CreditIcon className="h-4 w-4" glyphClassName="h-2.5 w-2.5" />
                  <span className="font-semibold tabular-nums">{commerceSummaryLoading && !commerceSummary ? "..." : (commerceSummary?.spendableNow ?? "...")}</span>
                  <Badge variant={commerceSummary?.planType === "pro" ? "default" : "secondary"} className="h-5 px-2 text-[10px] uppercase tracking-[0.12em]">
                    {planLabel}
                  </Badge>
                </Link>

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
                  <DropdownMenuContent align="end" className="w-52">
                    <DropdownMenuItem asChild>
                      <Link to="/app/billing">
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
              </>
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
            <MobileTopNav
              context={context}
              sections={mobileSections}
              access={access}
              onSignOut={handleSignOut}
            />
          </div>
        </div>
      </header>

      <AuthGateDialog
        open={authGate.open}
        onOpenChange={(open) => setAuthGate((prev) => ({ ...prev, open }))}
        featureLabel={authGate.label}
      />
    </>
  );
}
