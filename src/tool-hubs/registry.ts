import { Binary, Camera, FileCode2, ImagePlus, Layers3, LucideIcon, Wand2 } from "lucide-react";

export type ToolHubId = "thumbTools" | "widgetKit";

export interface ToolHubToolConfig {
  id: string;
  to: string;
  titleKey: string;
  descriptionKey: string;
  icon: LucideIcon;
}

export interface ToolHubConfig {
  id: ToolHubId;
  titleKey: string;
  subtitleKey: string;
  tools: ToolHubToolConfig[];
}

export const TOOL_HUBS: Record<ToolHubId, ToolHubConfig> = {
  thumbTools: {
    id: "thumbTools",
    titleKey: "nav.thumbTools",
    subtitleKey: "thumbTools.subtitle",
    tools: [
      {
        id: "generate",
        to: "/app/thumb-tools/generate",
        titleKey: "nav.toolsGenerate",
        descriptionKey: "nav.toolsGenerateDesc",
        icon: ImagePlus,
      },
      {
        id: "edit-studio",
        to: "/app/thumb-tools/edit-studio",
        titleKey: "nav.toolsEditStudio",
        descriptionKey: "nav.toolsEditStudioDesc",
        icon: Wand2,
      },
      {
        id: "camera-control",
        to: "/app/thumb-tools/camera-control",
        titleKey: "nav.toolsCameraControl",
        descriptionKey: "nav.toolsCameraControlDesc",
        icon: Camera,
      },
      {
        id: "layer-decomposition",
        to: "/app/thumb-tools/layer-decomposition",
        titleKey: "nav.toolsLayerDecomposition",
        descriptionKey: "nav.toolsLayerDecompositionDesc",
        icon: Layers3,
      },
    ],
  },
  widgetKit: {
    id: "widgetKit",
    titleKey: "nav.widgetKit",
    subtitleKey: "widgetKit.subtitle",
    tools: [
      {
        id: "psd-umg",
        to: "/app/widgetkit/psd-umg",
        titleKey: "nav.widgetKitPsdUmg",
        descriptionKey: "nav.widgetKitPsdUmgDesc",
        icon: Binary,
      },
      {
        id: "umg-verse",
        to: "/app/widgetkit/umg-verse",
        titleKey: "nav.widgetKitUmgVerse",
        descriptionKey: "nav.widgetKitUmgVerseDesc",
        icon: FileCode2,
      },
    ],
  },
};

