export type WidgetKitTool = "psd-umg" | "umg-verse";

export type PsdLayerKind = "group" | "image" | "text";

export interface PsdLayer {
  name: string;
  kind: PsdLayerKind;
  x: number;
  y: number;
  width: number;
  height: number;
  children?: PsdLayer[];
  text?: string;
}

export interface PsdJson {
  file: string;
  width: number;
  height: number;
  layers: PsdLayer[];
}

export interface PsdParseSummary {
  totalLayers: number;
  groupCount: number;
  imageCount: number;
  textCount: number;
  warnings: string[];
}

export interface UmgOutput {
  beginObjectText: string;
  layerCount: number;
  groupCount: number;
  imageCount: number;
  textCount: number;
}

export type VerseFieldType = "Message" | "Boolean" | "Floating" | "Integer" | "Asset" | "Event";

export interface VerseField {
  name: string;
  description: string;
  type: VerseFieldType;
  ue5Class: string;
  visibility: string;
  writeAccess: string;
  defaultValue: string;
  isArray: boolean;
  isConst: boolean;
  isSubscribable: boolean;
}

export interface ParsedWidget {
  widgetName: string;
  fields: VerseField[];
  hasVerseFields: boolean;
  sourceHasVerseClassFields: boolean;
  fieldsByType: {
    messages: VerseField[];
    booleans: VerseField[];
    floats: VerseField[];
    integers: VerseField[];
    assets: VerseField[];
    events: VerseField[];
  };
}

export interface GeneratedOutput {
  managerFileName: string;
  managerCode: string;
  uiCoreCode: string;
}

export interface WidgetKitHistoryItem {
  id: string;
  user_id: string;
  tool: WidgetKitTool;
  name: string;
  data_json: PsdJson | ParsedWidget;
  meta_json: Record<string, unknown>;
  created_at: string;
}
