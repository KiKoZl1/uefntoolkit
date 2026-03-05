import { describe, expect, it } from "vitest";
import { parseUassetFile } from "@/lib/widgetkit/uasset-parser";

function buildUassetFile(name: string, text: string, extraBytes = 0): File {
  const signature = new Uint8Array([0xc1, 0x83, 0x2a, 0x9e]);
  const payload = new TextEncoder().encode(text);
  const pad = extraBytes > 0 ? new Uint8Array(extraBytes) : new Uint8Array();
  const bytes = new Uint8Array(signature.byteLength + payload.byteLength + pad.byteLength);
  bytes.set(signature, 0);
  bytes.set(payload, signature.byteLength);
  bytes.set(pad, signature.byteLength + payload.byteLength);

  return {
    name,
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  } as unknown as File;
}

const FIELD_MESSAGE =
  '(Name="TimerMessage", Description="", Type=Message, TypeUE5Class="", VisibilityAccess="<public>", WriteAccess="", DefaultValue="", Tooltip="", bDefaultValueSet=False, bIsArray=False, bIsConst=False, bIsSubscribable=False, bIsOwnedByInterface=False)';
const FIELD_EVENT =
  '(Name="OnClose", Description="", Type=Event, TypeUE5Class="", VisibilityAccess="<public>", WriteAccess="", DefaultValue="", Tooltip="", bDefaultValueSet=False, bIsArray=False, bIsConst=True, bIsSubscribable=True, bIsOwnedByInterface=False)';

describe("uasset-parser", () => {
  it("detects VerseClassFields, dedupes and maps types", async () => {
    const text = `Header... VerseClassFields ... ${FIELD_MESSAGE}${FIELD_EVENT}${FIELD_MESSAGE}`;
    const file = buildUassetFile("WDB_SpeedShop.uasset", text);

    const parsed = await parseUassetFile(file);

    expect(parsed.sourceHasVerseClassFields).toBe(true);
    expect(parsed.hasVerseFields).toBe(true);
    expect(parsed.fields.length).toBe(2);
    expect(parsed.widgetName).toBe("WDB_SpeedShop");

    expect(parsed.fieldsByType.messages).toHaveLength(1);
    expect(parsed.fieldsByType.events).toHaveLength(1);
    expect(parsed.fieldsByType.messages[0].type).toBe("Message");
    expect(parsed.fieldsByType.events[0].type).toBe("Event");
  });

  it("returns no_fields state payload when VerseClassFields is absent", async () => {
    const file = buildUassetFile("Widget.uasset", "No verse metadata here");

    const parsed = await parseUassetFile(file);

    expect(parsed.sourceHasVerseClassFields).toBe(false);
    expect(parsed.hasVerseFields).toBe(false);
    expect(parsed.fields).toHaveLength(0);
  });

  it("validates extension and signature", async () => {
    await expect(parseUassetFile(new File(["abc"], "wrong.txt"))).rejects.toThrow("error_format");
    await expect(parseUassetFile(new File(["abc"], "bad.uasset"))).rejects.toThrow("error_format");
  });
});
