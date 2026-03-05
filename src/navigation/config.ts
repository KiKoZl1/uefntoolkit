import { NavAccessState, NavItem, NavSection, TopBarContext } from "./types";

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
    to: "/discover",
    match: "exact",
    contexts: ["public", "app", "admin"],
    visibility: ["anon", "authenticated"],
  }),
  reports: navItem({
    id: "reports",
    labelKey: "nav.reports",
    to: "/reports",
    match: "prefix",
    contexts: ["public", "app", "admin"],
    visibility: ["anon", "authenticated"],
  }),
  workspace: navItem({
    id: "workspace",
    labelKey: "nav.workspace",
    to: "/app",
    match: "exact",
    contexts: ["app", "admin"],
    visibility: ["authenticated", "client", "editor", "admin"],
  }),
  islandLookup: navItem({
    id: "islandLookup",
    labelKey: "nav.islandLookup",
    to: "/app/island-lookup",
    match: "exact",
    contexts: ["app", "admin"],
    visibility: ["authenticated", "client", "editor", "admin"],
  }),
  thumbToolsHub: navItem({
    id: "thumbToolsHub",
    labelKey: "nav.thumbTools",
    to: "/app/thumb-tools",
    match: "prefix",
    contexts: ["app", "admin"],
    visibility: ["authenticated", "client", "editor", "admin"],
  }),
  adminOverview: navItem({
    id: "adminOverview",
    labelKey: "nav.commandCenter",
    to: "/admin",
    match: "exact",
    contexts: ["admin"],
    visibility: ["editor", "admin"],
  }),
  adminReports: navItem({
    id: "adminReports",
    labelKey: "nav.reports",
    to: "/admin/reports",
    match: "prefix",
    contexts: ["admin"],
    visibility: ["editor", "admin"],
  }),
  adminExposure: navItem({
    id: "adminExposure",
    labelKey: "nav.exposure",
    to: "/admin/exposure",
    match: "exact",
    contexts: ["admin"],
    visibility: ["editor", "admin"],
  }),
  adminIntel: navItem({
    id: "adminIntel",
    labelKey: "nav.intel",
    to: "/admin/intel",
    match: "exact",
    contexts: ["admin"],
    visibility: ["editor", "admin"],
  }),
  adminPanels: navItem({
    id: "adminPanels",
    labelKey: "nav.panels",
    to: "/admin/panels",
    match: "exact",
    contexts: ["admin"],
    visibility: ["editor", "admin"],
  }),
  adminDppi: navItem({
    id: "adminDppi",
    labelKey: "nav.dppi",
    to: "/admin/dppi",
    match: "prefix",
    contexts: ["admin"],
    visibility: ["editor", "admin"],
  }),
  adminTgis: navItem({
    id: "adminTgis",
    labelKey: "nav.tgis",
    to: "/admin/tgis",
    match: "prefix",
    contexts: ["admin"],
    visibility: ["editor", "admin"],
  }),
  toolsGenerate: navItem({
    id: "toolsGenerate",
    labelKey: "nav.toolsGenerate",
    descriptionKey: "nav.toolsGenerateDesc",
    to: "/app/thumb-tools/generate",
    match: "exact",
    contexts: ["app", "admin"],
    visibility: ["authenticated", "client", "editor", "admin"],
  }),
  toolsEditStudio: navItem({
    id: "toolsEditStudio",
    labelKey: "nav.toolsEditStudio",
    descriptionKey: "nav.toolsEditStudioDesc",
    to: "/app/thumb-tools/edit-studio",
    match: "exact",
    contexts: ["app", "admin"],
    visibility: ["authenticated", "client", "editor", "admin"],
  }),
  toolsCameraControl: navItem({
    id: "toolsCameraControl",
    labelKey: "nav.toolsCameraControl",
    descriptionKey: "nav.toolsCameraControlDesc",
    to: "/app/thumb-tools/camera-control",
    match: "exact",
    contexts: ["app", "admin"],
    visibility: ["authenticated", "client", "editor", "admin"],
  }),
  toolsLayerDecomposition: navItem({
    id: "toolsLayerDecomposition",
    labelKey: "nav.toolsLayerDecomposition",
    descriptionKey: "nav.toolsLayerDecompositionDesc",
    to: "/app/thumb-tools/layer-decomposition",
    match: "exact",
    contexts: ["app", "admin"],
    visibility: ["authenticated", "client", "editor", "admin"],
  }),
};

const NAV_SECTIONS: NavSection[] = [
  {
    id: "platform",
    labelKey: "nav.sectionPlatform",
    contexts: ["public", "app", "admin"],
    visibility: ["anon", "authenticated"],
    items: [navItems.home, navItems.discover, navItems.reports],
  },
  {
    id: "app",
    labelKey: "nav.sectionWorkspace",
    contexts: ["app", "admin"],
    visibility: ["authenticated", "client", "editor", "admin"],
    items: [navItems.workspace, navItems.islandLookup, navItems.thumbToolsHub],
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
    ],
  },
  {
    id: "tools",
    labelKey: "nav.sectionTools",
    contexts: ["app", "admin"],
    visibility: ["authenticated", "client", "editor", "admin"],
    items: [
      navItems.toolsGenerate,
      navItems.toolsEditStudio,
      navItems.toolsCameraControl,
      navItems.toolsLayerDecomposition,
    ],
  },
];

const PRIMARY_ITEMS_BY_CONTEXT: Record<TopBarContext, string[]> = {
  public: ["discover", "reports"],
  app: ["workspace", "islandLookup", "thumbToolsHub", "discover", "reports"],
  admin: ["adminOverview", "adminReports", "adminIntel", "adminExposure", "adminDppi", "adminTgis"],
};

const TOOL_SHORTCUT_ITEM_IDS = [
  "toolsGenerate",
  "toolsEditStudio",
  "toolsCameraControl",
  "toolsLayerDecomposition",
] as const;

function hasContext(contexts: TopBarContext[] | undefined, context: TopBarContext) {
  return !contexts || contexts.includes(context);
}

function hasVisibility(rules: NavItem["visibility"] | NavSection["visibility"], access: NavAccessState) {
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

function getItemById(id: string): NavItem | undefined {
  return Object.values(navItems).find((item) => item.id === id);
}

function isItemVisible(item: NavItem, context: TopBarContext, access: NavAccessState) {
  return hasContext(item.contexts, context) && hasVisibility(item.visibility, access);
}

export function getVisibleNavSections(context: TopBarContext, access: NavAccessState): NavSection[] {
  return NAV_SECTIONS
    .filter((section) => hasContext(section.contexts, context) && hasVisibility(section.visibility, access))
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => isItemVisible(item, context, access)),
    }))
    .filter((section) => section.items.length > 0);
}

export function getTopBarPrimaryItems(context: TopBarContext, access: NavAccessState): NavItem[] {
  return PRIMARY_ITEMS_BY_CONTEXT[context]
    .map(getItemById)
    .filter((item): item is NavItem => Boolean(item))
    .filter((item) => isItemVisible(item, context, access));
}

export function getToolsShortcutItems(context: TopBarContext, access: NavAccessState): NavItem[] {
  return TOOL_SHORTCUT_ITEM_IDS.map(getItemById)
    .filter((item): item is NavItem => Boolean(item))
    .filter((item) => isItemVisible(item, context, access));
}

export function isNavItemActive(item: NavItem, pathname: string) {
  if (item.match === "exact") return pathname === item.to;
  if (item.to === "/") return pathname === "/";
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}
