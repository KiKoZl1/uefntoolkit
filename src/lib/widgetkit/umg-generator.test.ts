import { describe, expect, it } from "vitest";
import { generateBeginObject } from "@/lib/widgetkit/umg-generator";
import type { PsdJson } from "@/types/widgetkit";

describe("umg-generator", () => {
  it("computes offsets with group_bounds and local z-order", () => {
    const json: PsdJson = {
      file: "sample.psd",
      width: 100,
      height: 100,
      layers: [
        {
          name: "Background",
          kind: "image",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
        },
        {
          name: "Group A",
          kind: "group",
          x: 0,
          y: 0,
          width: 0,
          height: 0,
          children: [
            {
              name: "Inner",
              kind: "image",
              x: 20,
              y: 30,
              width: 10,
              height: 10,
            },
          ],
        },
      ],
    };

    const out = generateBeginObject(json, { includeTint: false }).beginObjectText;

    expect(out.startsWith('Begin Object Class=/Script/UMG.CanvasPanel Name="CanvasPanel_Root"')).toBe(true);

    expect(out).toContain("LayoutData=(Offsets=(Left=0.000,Top=0.000,Right=100.000,Bottom=100.000)");
    expect(out).toContain("LayoutData=(Offsets=(Left=-25.000,Top=-15.000,Right=10.000,Bottom=10.000)");

    expect(out).toContain("ZOrder=1");
    expect(out).toContain("ZOrder=2");

    expect(out).toContain("Begin Object Class=/Script/UMG.CanvasPanel Name=\"Group_A_");
    expect(out).toContain("LayoutData=(Offsets=(Left=0.000,Top=0.000,Right=10.000,Bottom=10.000)");
  });

  it("generates unique sanitized names", () => {
    const json: PsdJson = {
      file: "dup.psd",
      width: 200,
      height: 120,
      layers: [
        { name: "Layer 1", kind: "image", x: 0, y: 0, width: 20, height: 20 },
        { name: "Layer 1", kind: "image", x: 30, y: 0, width: 20, height: 20 },
      ],
    };

    const out = generateBeginObject(json).beginObjectText;
    const matches = out.match(/Begin Object Class=\/Script\/UMG\.Image Name="Layer_1_\d+"/g) || [];

    expect(matches.length).toBe(2);
    expect(new Set(matches).size).toBe(2);
  });
});
