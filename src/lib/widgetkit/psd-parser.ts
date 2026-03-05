import type { PsdJson, PsdLayer, PsdParseSummary } from "@/types/widgetkit";

export const PSD_MAX_DIMENSION = 8192;
export const PSD_MAX_LAYERS = 500;
export const PSD_WARNING_LAYERS = 200;

type ParsePsdResult = {
  json: PsdJson;
  summary: PsdParseSummary;
};

type ExportedPsdNode = {
  name?: string;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  type?: string;
  text?: {
    value?: string;
    text?: string;
  };
  children?: ExportedPsdNode[];
};

const PSD_SIGNATURE = [0x38, 0x42, 0x50, 0x53];

function ensurePsdSignature(bytes: Uint8Array) {
  const ok = PSD_SIGNATURE.every((value, idx) => bytes[idx] === value);
  if (!ok) throw new Error("error_format");
}

function parseLayerKind(node: ExportedPsdNode): PsdLayer["kind"] {
  const type = String(node.type || "").toLowerCase();
  if (Array.isArray(node.children) && node.children.length > 0) return "group";
  if (type.includes("group")) return "group";
  if (type.includes("text")) return "text";
  if (type.includes("shape")) return "image";
  if (type.includes("smart")) return "image";
  return "image";
}

function normalizeNode(node: ExportedPsdNode): PsdLayer {
  const kind = parseLayerKind(node);
  const normalized: PsdLayer = {
    name: String(node.name || "Layer"),
    kind,
    x: Number(node.left || 0),
    y: Number(node.top || 0),
    width: Math.max(0, Number(node.width || 0)),
    height: Math.max(0, Number(node.height || 0)),
  };

  if (kind === "text") {
    const textRaw = node.text?.value ?? node.text?.text ?? node.name ?? "";
    normalized.text = String(textRaw);
  }

  if (Array.isArray(node.children) && node.children.length > 0) {
    normalized.children = [...node.children].reverse().map(normalizeNode);
  }

  return normalized;
}

function summarizeLayers(layers: PsdLayer[]): Omit<PsdParseSummary, "warnings"> {
  const summary = {
    totalLayers: 0,
    groupCount: 0,
    imageCount: 0,
    textCount: 0,
  };

  const visit = (layer: PsdLayer) => {
    summary.totalLayers += 1;
    if (layer.kind === "group") summary.groupCount += 1;
    if (layer.kind === "image") summary.imageCount += 1;
    if (layer.kind === "text") summary.textCount += 1;
    for (const child of layer.children || []) visit(child);
  };

  for (const layer of layers) visit(layer);
  return summary;
}

function validatePsdFile(file: File) {
  if (!file.name.toLowerCase().endsWith(".psd")) throw new Error("error_format");
}

async function toArrayBuffer(file: File): Promise<ArrayBuffer> {
  const withArrayBuffer = file as File & { arrayBuffer?: () => Promise<ArrayBuffer> };
  if (typeof withArrayBuffer.arrayBuffer === "function") {
    return withArrayBuffer.arrayBuffer();
  }
  return new Response(file).arrayBuffer();
}

export async function parsePsdFile(file: File): Promise<ParsePsdResult> {
  validatePsdFile(file);
  const buffer = await toArrayBuffer(file);
  const bytes = new Uint8Array(buffer);
  ensurePsdSignature(bytes);

  const module = await import("psd.js");
  const PSD = (module as any).default ?? module;
  const psd = new PSD(bytes);
  await Promise.resolve(psd.parse?.());

  const tree = psd.tree?.();
  const exportedRoot = (tree?.export?.() || {}) as ExportedPsdNode;
  const headerWidth = Number(psd.header?.width ?? psd.header?.cols ?? 0);
  const headerHeight = Number(psd.header?.height ?? psd.header?.rows ?? 0);
  const width = headerWidth || Math.max(1, Number(exportedRoot.width || 0));
  const height = headerHeight || Math.max(1, Number(exportedRoot.height || 0));

  if (width <= 0 || height <= 0) throw new Error("error_empty");
  if (width > PSD_MAX_DIMENSION || height > PSD_MAX_DIMENSION) throw new Error("error_dimensions");

  const rootChildren = Array.isArray(exportedRoot.children) ? exportedRoot.children : [];
  const layers = [...rootChildren].reverse().map(normalizeNode);
  const stats = summarizeLayers(layers);
  if (stats.totalLayers === 0) throw new Error("error_empty");
  if (stats.totalLayers > PSD_MAX_LAYERS) throw new Error("error_too_many_layers");

  const warnings: string[] = [];
  if (stats.totalLayers > PSD_WARNING_LAYERS) warnings.push("warning_many_layers");

  return {
    json: {
      file: file.name,
      width,
      height,
      layers,
    },
    summary: {
      ...stats,
      warnings,
    },
  };
}

export function summarizePsdJson(json: PsdJson): PsdParseSummary {
  const stats = summarizeLayers(json.layers);
  const warnings: string[] = [];
  if (stats.totalLayers > PSD_WARNING_LAYERS) warnings.push("warning_many_layers");
  return { ...stats, warnings };
}
