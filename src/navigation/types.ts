export type NavVisibilityRule = "anon" | "authenticated" | "client" | "editor" | "admin";

export type TopBarContext = "public" | "app" | "admin";

export type NavMatchMode = "exact" | "prefix";

export interface NavItem {
  id: string;
  labelKey: string;
  to: string;
  descriptionKey?: string;
  match?: NavMatchMode;
  visibility?: NavVisibilityRule[];
  contexts?: TopBarContext[];
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
