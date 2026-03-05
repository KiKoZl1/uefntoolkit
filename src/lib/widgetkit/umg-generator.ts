import type { PsdJson, PsdLayer, UmgOutput } from "@/types/widgetkit";

type GenerateOptions = {
  includeTint?: boolean;
};

const TINT_PALETTE: Array<{ r: number; g: number; b: number }> = [
  { r: 1, g: 0, b: 0 },
  { r: 0, g: 1, b: 0 },
  { r: 0, g: 0, b: 1 },
  { r: 1, g: 1, b: 0 },
  { r: 1, g: 0, b: 1 },
  { r: 0, g: 1, b: 1 },
  { r: 1, g: 0.5, b: 0 },
  { r: 0.5, g: 0.2, b: 1 },
  { r: 0.4, g: 1, b: 0.8 },
  { r: 1, g: 0.4, b: 0.75 },
  { r: 0.7, g: 1, b: 0.2 },
  { r: 0.3, g: 0.75, b: 1 },
];

function escapeForQuotes(input: string): string {
  return String(input || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ");
}

function toFixed3(value: number): string {
  return Number.isFinite(value) ? value.toFixed(3) : "0.000";
}

function toFixed1(value: number): string {
  return Number.isFinite(value) ? value.toFixed(1) : "0.0";
}

function sanitizeName(raw: string): string {
  const compact = String(raw || "")
    .replace(/[^a-zA-Z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const safe = compact || "Layer";
  return /^\d/.test(safe) ? `_${safe}` : safe;
}

function groupBounds(layer: PsdLayer): [number, number, number, number] {
  if (layer.width > 0 && layer.height > 0) return [layer.x, layer.y, layer.width, layer.height];
  const children = (layer.children || []).filter((child) => child.width > 0 && child.height > 0);
  if (!children.length) return [layer.x, layer.y, 1, 1];
  const xMin = Math.min(...children.map((child) => child.x));
  const yMin = Math.min(...children.map((child) => child.y));
  const xMax = Math.max(...children.map((child) => child.x + child.width));
  const yMax = Math.max(...children.map((child) => child.y + child.height));
  return [xMin, yMin, Math.max(1, xMax - xMin), Math.max(1, yMax - yMin)];
}

function slotLayout(relX: number, relY: number, elemW: number, elemH: number, panelW: number, panelH: number): string {
  const left = relX + elemW / 2 - panelW / 2;
  const top = relY + elemH / 2 - panelH / 2;
  return (
    `(Offsets=(Left=${toFixed3(left)},Top=${toFixed3(top)},Right=${toFixed3(elemW)},Bottom=${toFixed3(elemH)}),` +
    "Anchors=(Minimum=(X=0.500000,Y=0.500000),Maximum=(X=0.500000,Y=0.500000))," +
    "Alignment=(X=0.500000,Y=0.500000))"
  );
}

export function generateBeginObject(json: PsdJson, options: GenerateOptions = {}): UmgOutput {
  let idCounter = 0;
  let tintIdx = 0;
  let groupCount = 0;
  let imageCount = 0;
  let textCount = 0;
  const blocks: string[] = [];

  const nextId = () => {
    idCounter += 1;
    return idCounter;
  };

  const nextWidgetName = (raw: string) => `${sanitizeName(raw)}_${nextId()}`;

  const buildCanvas = (
    panelName: string,
    children: PsdLayer[],
    parentX: number,
    parentY: number,
    panelW: number,
    panelH: number,
  ) => {
    const validChildren = children.filter((layer) => !(layer.kind === "group" && !(layer.children || []).length));
    const slotDefs: string[] = [];
    const slotInitBlocks: string[] = [];
    const slotRefs: string[] = [];

    validChildren.forEach((layer, idx) => {
      const isGroup = layer.kind === "group";
      const widgetName = nextWidgetName(layer.name);
      const slotName = `CanvasPanelSlot_${nextId()}`;
      const [elemX, elemY, elemW, elemH] = isGroup ? groupBounds(layer) : [layer.x, layer.y, layer.width, layer.height];

      const contentPath = isGroup
        ? `/Script/UMG.CanvasPanel'${widgetName}'`
        : layer.kind === "text"
          ? `/Script/UMG.TextBlock'${widgetName}'`
          : `/Script/UMG.Image'${widgetName}'`;

      slotDefs.push(`   Begin Object Class=/Script/UMG.CanvasPanelSlot Name="${slotName}"\n   End Object`);
      slotInitBlocks.push(
        `   Begin Object Name="${slotName}"\n` +
          `      LayoutData=${slotLayout(elemX - parentX, elemY - parentY, elemW, elemH, panelW, panelH)}\n` +
          `      ZOrder=${idx + 1}\n` +
          `      Parent="/Script/UMG.CanvasPanel'${panelName}'"\n` +
          `      Content="${contentPath}"\n` +
          "   End Object",
      );
      slotRefs.push(`   Slots(${idx})="/Script/UMG.CanvasPanelSlot'${slotName}'"`);

      if (isGroup) {
        groupCount += 1;
        buildCanvas(widgetName, layer.children || [], elemX, elemY, elemW, elemH);
        return;
      }

      if (layer.kind === "text") {
        textCount += 1;
        const text = escapeForQuotes(layer.text || layer.name);
        blocks.push(
          `Begin Object Class=/Script/UMG.TextBlock Name="${widgetName}"\n` +
            `   Text=NSLOCTEXT("","","${text}")\n` +
            "   Font=(Size=24.000000)\n" +
            `   DisplayLabel="${escapeForQuotes(layer.name)}"\n` +
            "End Object",
        );
        return;
      }

      imageCount += 1;
      const tint = options.includeTint ? TINT_PALETTE[tintIdx++ % TINT_PALETTE.length] : null;
      const tintPrefix = tint
        ? `TintColor=(SpecifiedColor=(R=${tint.r.toFixed(1)},G=${tint.g.toFixed(1)},B=${tint.b.toFixed(1)},A=1.0)),`
        : "";
      blocks.push(
        `Begin Object Class=/Script/UMG.Image Name="${widgetName}"\n` +
          `   Brush=(${tintPrefix}ImageSize=(X=${toFixed1(elemW)},Y=${toFixed1(elemH)}))\n` +
          `   DisplayLabel="${escapeForQuotes(layer.name)}"\n` +
          "End Object",
      );
    });

    blocks.push(
      [
        `Begin Object Class=/Script/UMG.CanvasPanel Name="${panelName}"`,
        ...slotDefs,
        ...slotInitBlocks,
        ...slotRefs,
        "   bExpandedInDesigner=True",
        "End Object",
      ].join("\n"),
    );
  };

  buildCanvas("CanvasPanel_Root", json.layers, 0, 0, json.width, json.height);

  return {
    beginObjectText: blocks.reverse().join("\n\n"),
    layerCount: groupCount + imageCount + textCount,
    groupCount,
    imageCount,
    textCount,
  };
}
