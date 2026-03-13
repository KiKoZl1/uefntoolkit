export type NavVisibilityRule = "anon" | "authenticated" | "client" | "editor" | "admin";

export type TopBarContext = "public" | "app" | "admin";

export type NavMatchMode = "exact" | "prefix";

export type NavItemGroup = "discover" | "analyticsTools" | "thumbTools" | "widgetKit" | "admin" | "misc";

export type NavItemIcon =
  | "discover"
  | "analyticsTools"
  | "thumbTools"
  | "widgetKit"
  | "support"
  | "islandAnalytics"
  | "islandLookup"
  | "reports"
  | "generate"
  | "editStudio"
  | "cameraControl"
  | "layerDecomposition"
  | "widgetKitPsdUmg"
  | "widgetKitUmgVerse"
  | "admin";

export interface NavItem {
  id: string;
  labelKey: string;
  to: string;
  publicHubTo?: string;
  descriptionKey?: string;
  match?: NavMatchMode;
  visibility?: NavVisibilityRule[];
  contexts?: TopBarContext[];
  icon?: NavItemIcon;
  group?: NavItemGroup;
  requiresAuthPrompt?: boolean;
}

export interface NavSection {
  id: string;
  labelKey: string;
  items: NavItem[];
  visibility?: NavVisibilityRule[];
  contexts?: TopBarContext[];
}

export interface NavAccessState {
  isAuthenticated: boolean;
  isAdmin: boolean;
  isEditor: boolean;
}

export interface ToolCategory {
  id: string;
  labelKey: string;
  descriptionKey?: string;
  icon?: NavItemIcon;
  hubItemId: string;
  hubPublicRoute: string;
  subtoolIds: string[];
  contexts?: TopBarContext[];
  visibility?: NavVisibilityRule[];
}
