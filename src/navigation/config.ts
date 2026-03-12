import { NavAccessState, NavItem, NavSection, ToolCategory, TopBarContext } from "./types";

const navItem = (item: NavItem): NavItem => item;

const navItems = {
  home: navItem({
    id: "home",
    labelKey: "nav.home",
    to: "/",
    match: "exact",
    contexts: ["public", "app", "admin"],
    visibility: ["anon", "authenticated"],
  }),
  discover: navItem({
    id: "discover",
    labelKey: "nav.discover",
    descriptionKey: "nav.discoverDesc",
    to: "/discover",
    match: "exact",
    contexts: ["public", "app", "admin"],
    visibility: ["anon", "authenticated"],
    icon: "discover",
    group: "discover",
  }),
  reports: navItem({
    id: "reports",
    labelKey: "nav.reports",
    descriptionKey: "nav.reportsDesc",
    to: "/reports",
    match: "prefix",
    contexts: ["public", "app", "admin"],
    visibility: ["anon", "authenticated"],
    icon: "reports",
    group: "analyticsTools",
  }),
  analyticsToolsHub: navItem({
    id: "analyticsToolsHub",
    labelKey: "nav.analyticsTools",
    descriptionKey: "nav.analyticsToolsDesc",
    to: "/tools/analytics",
    publicHubTo: "/tools/analytics",
    match: "prefix",
    contexts: ["public", "app"],
    visibility: ["anon", "authenticated"],
    icon: "analyticsTools",
    group: "analyticsTools",
  }),
  workspace: navItem({
    id: "workspace",
    labelKey: "nav.workspace",
    to: "/app",
    match: "exact",
    contexts: ["app", "admin"],
    visibility: ["authenticated", "client", "editor", "admin"],
    icon: "islandAnalytics",
    group: "misc",
  }),
  islandAnalytics: navItem({
    id: "islandAnalytics",
    labelKey: "nav.analyticsIslandAnalytics",
    descriptionKey: "nav.analyticsIslandAnalyticsDesc",
    to: "/app",
    match: "exact",
    contexts: ["public", "app"],
    visibility: ["anon", "authenticated"],
    icon: "islandAnalytics",
    group: "analyticsTools",
    requiresAuthPrompt: true,
  }),
  islandLookup: navItem({
    id: "islandLookup",
    labelKey: "nav.analyticsIslandLookup",
    descriptionKey: "nav.analyticsIslandLookupDesc",
    to: "/app/island-lookup",
    match: "exact",
    contexts: ["public", "app", "admin"],
    visibility: ["anon", "authenticated"],
    icon: "islandLookup",
    group: "analyticsTools",
    requiresAuthPrompt: true,
  }),
  billing: navItem({
    id: "billing",
    labelKey: "nav.billing",
    to: "/app/billing",
    match: "exact",
    contexts: ["app", "admin"],
    visibility: ["authenticated", "client", "editor", "admin"],
    icon: "admin",
    group: "misc",
  }),
  thumbToolsHub: navItem({
    id: "thumbToolsHub",
    labelKey: "nav.thumbTools",
    descriptionKey: "nav.thumbToolsDesc",
    to: "/tools/thumb-tools",
    publicHubTo: "/tools/thumb-tools",
    match: "prefix",
    contexts: ["public", "app"],
    visibility: ["anon", "authenticated"],
    icon: "thumbTools",
    group: "thumbTools",
  }),
  widgetKitHub: navItem({
    id: "widgetKitHub",
    labelKey: "nav.widgetKit",
    descriptionKey: "nav.widgetKitDesc",
    to: "/tools/widgetkit",
    publicHubTo: "/tools/widgetkit",
    match: "prefix",
    contexts: ["public", "app"],
    visibility: ["anon", "authenticated"],
    icon: "widgetKit",
    group: "widgetKit",
  }),
  widgetKitPsdUmg: navItem({
    id: "widgetKitPsdUmg",
    labelKey: "nav.widgetKitPsdUmg",
    descriptionKey: "nav.widgetKitPsdUmgDesc",
    to: "/app/widgetkit/psd-umg",
    match: "exact",
    contexts: ["public", "app", "admin"],
    visibility: ["anon", "authenticated"],
    icon: "widgetKitPsdUmg",
    group: "widgetKit",
    requiresAuthPrompt: true,
  }),
  widgetKitUmgVerse: navItem({
    id: "widgetKitUmgVerse",
    labelKey: "nav.widgetKitUmgVerse",
    descriptionKey: "nav.widgetKitUmgVerseDesc",
    to: "/app/widgetkit/umg-verse",
    match: "exact",
    contexts: ["public", "app", "admin"],
    visibility: ["anon", "authenticated"],
    icon: "widgetKitUmgVerse",
    group: "widgetKit",
    requiresAuthPrompt: true,
  }),
  adminOverview: navItem({
    id: "adminOverview",
    labelKey: "nav.commandCenter",
    to: "/admin",
    match: "exact",
    contexts: ["admin"],
    visibility: ["editor", "admin"],
    icon: "admin",
    group: "admin",
  }),
  adminReports: navItem({
    id: "adminReports",
    labelKey: "nav.reports",
    to: "/admin/reports",
    match: "prefix",
    contexts: ["admin"],
    visibility: ["editor", "admin"],
    icon: "admin",
    group: "admin",
  }),
  adminExposure: navItem({
    id: "adminExposure",
    labelKey: "nav.exposure",
    to: "/admin/exposure",
    match: "exact",
    contexts: ["admin"],
    visibility: ["editor", "admin"],
    icon: "admin",
    group: "admin",
  }),
  adminIntel: navItem({
    id: "adminIntel",
    labelKey: "nav.intel",
    to: "/admin/intel",
    match: "exact",
    contexts: ["admin"],
    visibility: ["editor", "admin"],
    icon: "admin",
    group: "admin",
  }),
  adminPanels: navItem({
    id: "adminPanels",
    labelKey: "nav.panels",
    to: "/admin/panels",
    match: "exact",
    contexts: ["admin"],
    visibility: ["editor", "admin"],
    icon: "admin",
    group: "admin",
  }),
  adminDppi: navItem({
    id: "adminDppi",
    labelKey: "nav.dppi",
    to: "/admin/dppi",
    match: "prefix",
    contexts: ["admin"],
    visibility: ["editor", "admin"],
    icon: "admin",
    group: "admin",
  }),
  adminTgis: navItem({
    id: "adminTgis",
    labelKey: "nav.tgis",
    to: "/admin/tgis",
    match: "prefix",
    contexts: ["admin"],
    visibility: ["editor", "admin"],
    icon: "admin",
    group: "admin",
  }),
  adminCommerce: navItem({
    id: "adminCommerce",
    labelKey: "nav.commerce",
    to: "/admin/commerce",
    match: "exact",
    contexts: ["admin"],
    visibility: ["editor", "admin"],
    icon: "admin",
    group: "admin",
  }),
  toolsGenerate: navItem({
    id: "toolsGenerate",
    labelKey: "nav.toolsGenerate",
    descriptionKey: "nav.toolsGenerateDesc",
    to: "/app/thumb-tools/generate",
    match: "exact",
    contexts: ["public", "app", "admin"],
    visibility: ["anon", "authenticated"],
    icon: "generate",
    group: "thumbTools",
    requiresAuthPrompt: true,
  }),
  toolsEditStudio: navItem({
    id: "toolsEditStudio",
    labelKey: "nav.toolsEditStudio",
    descriptionKey: "nav.toolsEditStudioDesc",
    to: "/app/thumb-tools/edit-studio",
    match: "exact",
    contexts: ["public", "app", "admin"],
    visibility: ["anon", "authenticated"],
    icon: "editStudio",
    group: "thumbTools",
    requiresAuthPrompt: true,
  }),
  toolsCameraControl: navItem({
    id: "toolsCameraControl",
    labelKey: "nav.toolsCameraControl",
    descriptionKey: "nav.toolsCameraControlDesc",
    to: "/app/thumb-tools/camera-control",
    match: "exact",
    contexts: ["public", "app", "admin"],
    visibility: ["anon", "authenticated"],
    icon: "cameraControl",
    group: "thumbTools",
    requiresAuthPrompt: true,
  }),
  toolsLayerDecomposition: navItem({
    id: "toolsLayerDecomposition",
    labelKey: "nav.toolsLayerDecomposition",
    descriptionKey: "nav.toolsLayerDecompositionDesc",
    to: "/app/thumb-tools/layer-decomposition",
    match: "exact",
    contexts: ["public", "app", "admin"],
    visibility: ["anon", "authenticated"],
    icon: "layerDecomposition",
    group: "thumbTools",
    requiresAuthPrompt: true,
  }),
};

const NAV_SECTIONS: NavSection[] = [
  {
    id: "platform",
    labelKey: "nav.sectionPlatform",
    contexts: ["public", "app"],
    visibility: ["anon", "authenticated"],
    items: [navItems.discover, navItems.analyticsToolsHub, navItems.thumbToolsHub, navItems.widgetKitHub],
  },
  {
    id: "analytics",
    labelKey: "nav.sectionAnalyticsTools",
    contexts: ["public", "app", "admin"],
    visibility: ["anon", "authenticated"],
    items: [navItems.islandAnalytics, navItems.islandLookup, navItems.reports],
  },
  {
    id: "app",
    labelKey: "nav.sectionWorkspace",
    contexts: ["app", "admin"],
    visibility: ["authenticated", "client", "editor", "admin"],
    items: [navItems.workspace],
  },
  {
    id: "thumbTools",
    labelKey: "nav.sectionThumbTools",
    contexts: ["public", "app", "admin"],
    visibility: ["anon", "authenticated"],
    items: [navItems.toolsGenerate, navItems.toolsEditStudio, navItems.toolsCameraControl, navItems.toolsLayerDecomposition],
  },
  {
    id: "widgetKitTools",
    labelKey: "nav.sectionWidgetKit",
    contexts: ["public", "app", "admin"],
    visibility: ["anon", "authenticated"],
    items: [navItems.widgetKitPsdUmg, navItems.widgetKitUmgVerse],
  },
  {
    id: "admin",
    labelKey: "nav.sectionAdmin",
    contexts: ["admin"],
    visibility: ["editor", "admin"],
    items: [
      navItems.adminOverview,
      navItems.adminReports,
      navItems.adminExposure,
      navItems.adminIntel,
      navItems.adminPanels,
      navItems.adminDppi,
      navItems.adminTgis,
      navItems.adminCommerce,
    ],
  },
];

const PRIMARY_ITEMS_BY_CONTEXT: Record<TopBarContext, string[]> = {
  public: ["discover", "analyticsToolsHub", "thumbToolsHub", "widgetKitHub"],
  app: ["discover", "analyticsToolsHub", "thumbToolsHub", "widgetKitHub", "reports"],
  admin: ["adminOverview", "adminReports", "adminIntel", "adminExposure", "adminDppi", "adminTgis", "adminCommerce"],
};

const ANALYTICS_SHORTCUT_ITEM_IDS = ["islandAnalytics", "islandLookup", "reports"] as const;

const THUMB_TOOLS_SHORTCUT_ITEM_IDS = [
  "toolsGenerate",
  "toolsEditStudio",
  "toolsCameraControl",
  "toolsLayerDecomposition",
] as const;

const WIDGET_KIT_SHORTCUT_ITEM_IDS = ["widgetKitPsdUmg", "widgetKitUmgVerse"] as const;

const TOOL_CATEGORIES: ToolCategory[] = [
  {
    id: "discover",
    labelKey: "nav.discover",
    descriptionKey: "nav.discoverDesc",
    icon: "discover",
    hubItemId: "discover",
    hubPublicRoute: "/discover",
    subtoolIds: [],
    contexts: ["public", "app"],
    visibility: ["anon", "authenticated"],
  },
  {
    id: "analyticsTools",
    labelKey: "nav.analyticsTools",
    descriptionKey: "nav.analyticsToolsDesc",
    icon: "analyticsTools",
    hubItemId: "analyticsToolsHub",
    hubPublicRoute: "/tools/analytics",
    subtoolIds: [...ANALYTICS_SHORTCUT_ITEM_IDS],
    contexts: ["public", "app"],
    visibility: ["anon", "authenticated"],
  },
  {
    id: "thumbTools",
    labelKey: "nav.thumbTools",
    descriptionKey: "nav.thumbToolsDesc",
    icon: "thumbTools",
    hubItemId: "thumbToolsHub",
    hubPublicRoute: "/tools/thumb-tools",
    subtoolIds: [...THUMB_TOOLS_SHORTCUT_ITEM_IDS],
    contexts: ["public", "app"],
    visibility: ["anon", "authenticated"],
  },
  {
    id: "widgetKit",
    labelKey: "nav.widgetKit",
    descriptionKey: "nav.widgetKitDesc",
    icon: "widgetKit",
    hubItemId: "widgetKitHub",
    hubPublicRoute: "/tools/widgetkit",
    subtoolIds: [...WIDGET_KIT_SHORTCUT_ITEM_IDS],
    contexts: ["public", "app"],
    visibility: ["anon", "authenticated"],
  },
];

export interface ResolvedToolCategory extends ToolCategory {
  hubItem: NavItem;
  items: NavItem[];
}

function hasContext(contexts: TopBarContext[] | undefined, context: TopBarContext) {
  return !contexts || contexts.includes(context);
}

function hasVisibility(
  rules: NavItem["visibility"] | NavSection["visibility"] | ToolCategory["visibility"],
  access: NavAccessState,
) {
  if (!rules || rules.length === 0) return true;

  return rules.some((rule) => {
    if (rule === "anon") return !access.isAuthenticated;
    if (rule === "authenticated") return access.isAuthenticated;
    if (rule === "client") return access.isAuthenticated && !access.isEditor && !access.isAdmin;
    if (rule === "editor") return access.isEditor;
    if (rule === "admin") return access.isAdmin;
    return false;
  });
}

function getItemsByIds(ids: readonly string[]) {
  return ids
    .map((id) => getNavItemById(id))
    .filter((item): item is NavItem => Boolean(item));
}

export function getNavItemById(id: string): NavItem | undefined {
  return Object.values(navItems).find((item) => item.id === id);
}

export function isNavItemVisible(item: NavItem, context: TopBarContext, access: NavAccessState) {
  return hasContext(item.contexts, context) && hasVisibility(item.visibility, access);
}

export function isNavItemProtectedForAccess(item: NavItem, access: NavAccessState) {
  return Boolean(item.requiresAuthPrompt && !access.isAuthenticated);
}

export function getVisibleNavSections(context: TopBarContext, access: NavAccessState): NavSection[] {
  return NAV_SECTIONS
    .filter((section) => hasContext(section.contexts, context) && hasVisibility(section.visibility, access))
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => isNavItemVisible(item, context, access)),
    }))
    .filter((section) => section.items.length > 0);
}

export function getTopBarPrimaryItems(context: TopBarContext, access: NavAccessState): NavItem[] {
  return PRIMARY_ITEMS_BY_CONTEXT[context]
    .map(getNavItemById)
    .filter((item): item is NavItem => Boolean(item))
    .filter((item) => isNavItemVisible(item, context, access));
}

export function getAnalyticsShortcutItems(context: TopBarContext, access: NavAccessState): NavItem[] {
  return getItemsByIds(ANALYTICS_SHORTCUT_ITEM_IDS).filter((item) => isNavItemVisible(item, context, access));
}

export function getThumbToolsShortcutItems(context: TopBarContext, access: NavAccessState): NavItem[] {
  return getItemsByIds(THUMB_TOOLS_SHORTCUT_ITEM_IDS).filter((item) => isNavItemVisible(item, context, access));
}

export function getToolsShortcutItems(context: TopBarContext, access: NavAccessState): NavItem[] {
  return getThumbToolsShortcutItems(context, access);
}

export function getWidgetKitShortcutItems(context: TopBarContext, access: NavAccessState): NavItem[] {
  return getItemsByIds(WIDGET_KIT_SHORTCUT_ITEM_IDS).filter((item) => isNavItemVisible(item, context, access));
}

export function getCategoryShortcutItems(hubItemId: string, context: TopBarContext, access: NavAccessState): NavItem[] {
  if (hubItemId === "analyticsToolsHub") return getAnalyticsShortcutItems(context, access);
  if (hubItemId === "thumbToolsHub") return getThumbToolsShortcutItems(context, access);
  if (hubItemId === "widgetKitHub") return getWidgetKitShortcutItems(context, access);
  return [];
}

export function getVisibleToolCategories(context: TopBarContext, access: NavAccessState): ResolvedToolCategory[] {
  return TOOL_CATEGORIES
    .filter((category) => hasContext(category.contexts, context) && hasVisibility(category.visibility, access))
    .map((category) => {
      const hubItem = getNavItemById(category.hubItemId);
      if (!hubItem) return null;

      const items = getItemsByIds(category.subtoolIds).filter((item) => isNavItemVisible(item, context, access));
      if (!isNavItemVisible(hubItem, context, access)) return null;

      return {
        ...category,
        hubItem,
        items,
      };
    })
    .filter((category): category is ResolvedToolCategory => Boolean(category));
}

export function isNavItemActive(item: NavItem, pathname: string) {
  if (item.match === "exact") return pathname === item.to;
  if (item.to === "/") return pathname === "/";
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}
