import type { LucideIcon } from "lucide-react";
import {
  Binary,
  Camera,
  Compass,
  FileCode2,
  ImagePlus,
  LayoutDashboard,
  Layers3,
  LifeBuoy,
  LineChart,
  Search,
  Wand2,
} from "lucide-react";
import type { NavItemIcon } from "@/navigation/types";

const NAV_ITEM_ICON_MAP: Record<NavItemIcon, LucideIcon> = {
  discover: Compass,
  analyticsTools: LineChart,
  thumbTools: ImagePlus,
  widgetKit: Binary,
  support: LifeBuoy,
  islandAnalytics: LayoutDashboard,
  islandLookup: Search,
  reports: LineChart,
  generate: ImagePlus,
  editStudio: Wand2,
  cameraControl: Camera,
  layerDecomposition: Layers3,
  widgetKitPsdUmg: Binary,
  widgetKitUmgVerse: FileCode2,
  admin: LineChart,
};

export function resolveNavItemIcon(icon: NavItemIcon | undefined): LucideIcon | null {
  if (!icon) return null;
  return NAV_ITEM_ICON_MAP[icon] ?? null;
}
