import type { ParsedWidget, VerseField, VerseFieldType } from "@/types/widgetkit";

const UASSET_MAGIC_TAGS = new Set([0x9e2a83c1, 0x9e2a83c2, 0x9e2a83c0]);

function normalizeBool(raw: string): boolean {
  return String(raw || "").toLowerCase() === "true";
}

function mapType(rawType: string): VerseFieldType | null {
  const type = String(rawType || "").trim().toLowerCase();
  if (type === "message") return "Message";
  if (type === "boolean") return "Boolean";
  if (type === "floating") return "Floating";
  if (type === "integer") return "Integer";
  if (type === "asset") return "Asset";
  if (type === "event") return "Event";
  return null;
}

function buildByType(fields: VerseField[]) {
  return {
    messages: fields.filter((field) => field.type === "Message"),
    booleans: fields.filter((field) => field.type === "Boolean"),
    floats: fields.filter((field) => field.type === "Floating"),
    integers: fields.filter((field) => field.type === "Integer"),
    assets: fields.filter((field) => field.type === "Asset"),
    events: fields.filter((field) => field.type === "Event"),
  };
}

function ensureUassetSignature(bytes: Uint8Array) {
  if (bytes.length < 4) throw new Error("error_format");
  const little = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
  if (UASSET_MAGIC_TAGS.has(little)) return;

  // Fallback acceptance for common UE package variants with first three bytes C1 83 2A.
  if (bytes[0] === 0xc1 && bytes[1] === 0x83 && bytes[2] === 0x2a) return;
  throw new Error("error_format");
}

function extract(item: string, pattern: RegExp): string {
  const match = item.match(pattern);
  return match?.[1] || "";
}

function parseFieldItem(item: string): VerseField | null {
  const name = extract(item, /Name="([^"]+)"/);
  const rawType = extract(item, /Type=([A-Za-z]+)/);
  const mappedType = mapType(rawType);
  if (!name || !mappedType) return null;

  return {
    name,
    description: extract(item, /Description="([^"]*)"/),
    type: mappedType,
    ue5Class: extract(item, /TypeUE5Class="([^"]*)"/),
    visibility: extract(item, /VisibilityAccess="([^"]*)"/),
    writeAccess: extract(item, /WriteAccess="([^"]*)"/),
    defaultValue: extract(item, /DefaultValue="([^"]*)"/),
    isArray: normalizeBool(extract(item, /bIsArray=(True|False|true|false)/)),
    isConst: normalizeBool(extract(item, /bIsConst=(True|False|true|false)/)),
    isSubscribable: normalizeBool(extract(item, /bIsSubscribable=(True|False|true|false)/)),
  };
}

function parseVerseFieldsFromText(text: string): VerseField[] {
  const itemRegex = /\(Name="[^"]+"[\s\S]*?bIsOwnedByInterface=(?:True|False|true|false)\)/g;
  const fields: VerseField[] = [];
  const seen = new Set<string>();

  let match = itemRegex.exec(text);
  while (match) {
    const field = parseFieldItem(match[0]);
    if (field) {
      const key = `${field.name}_${field.type}`;
      if (!seen.has(key)) {
        seen.add(key);
        fields.push(field);
      }
    }
    match = itemRegex.exec(text);
  }

  return fields;
}

function parseWidgetName(fileName: string): string {
  return fileName.replace(/\.uasset$/i, "").trim() || "WDB_Widget";
}

async function toArrayBuffer(file: File): Promise<ArrayBuffer> {
  const withArrayBuffer = file as File & { arrayBuffer?: () => Promise<ArrayBuffer> };
  if (typeof withArrayBuffer.arrayBuffer === "function") {
    return withArrayBuffer.arrayBuffer();
  }
  return new Response(file).arrayBuffer();
}

export async function parseUassetFile(file: File): Promise<ParsedWidget> {
  if (!file.name.toLowerCase().endsWith(".uasset")) throw new Error("error_format");

  const buffer = await toArrayBuffer(file);
  const bytes = new Uint8Array(buffer);
  ensureUassetSignature(bytes);

  const text = new TextDecoder("latin1").decode(bytes);
  const hasVerseClassFields = text.includes("VerseClassFields");
  const fields = hasVerseClassFields ? parseVerseFieldsFromText(text) : [];
  const fieldsByType = buildByType(fields);

  return {
    widgetName: parseWidgetName(file.name),
    fields,
    hasVerseFields: fields.length > 0,
    sourceHasVerseClassFields: hasVerseClassFields,
    fieldsByType,
  };
}
