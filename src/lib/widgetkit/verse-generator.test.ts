import { describe, expect, it } from "vitest";
import { generateVerseOutput } from "@/lib/widgetkit/verse-generator";
import type { ParsedWidget } from "@/types/widgetkit";

describe("verse-generator", () => {
  it("generates manager/ui core with required sections and names", () => {
    const parsed: ParsedWidget = {
      widgetName: "WDB SpeedShop",
      hasVerseFields: true,
      sourceHasVerseClassFields: true,
      fields: [
        {
          name: "TitleMessage",
          description: "",
          type: "Message",
          ue5Class: "",
          visibility: "<public>",
          writeAccess: "",
          defaultValue: "",
          isArray: false,
          isConst: false,
          isSubscribable: false,
        },
        {
          name: "IsOpen",
          description: "",
          type: "Boolean",
          ue5Class: "",
          visibility: "<public>",
          writeAccess: "",
          defaultValue: "False",
          isArray: false,
          isConst: false,
          isSubscribable: false,
        },
        {
          name: "MainAsset",
          description: "",
          type: "Asset",
          ue5Class: "",
          visibility: "<public>",
          writeAccess: "",
          defaultValue: "",
          isArray: false,
          isConst: false,
          isSubscribable: false,
        },
        {
          name: "OnClose",
          description: "",
          type: "Event",
          ue5Class: "",
          visibility: "<public>",
          writeAccess: "",
          defaultValue: "",
          isArray: false,
          isConst: true,
          isSubscribable: true,
        },
      ],
      fieldsByType: {
        messages: [],
        booleans: [],
        floats: [],
        integers: [],
        assets: [],
        events: [],
      },
    };

    parsed.fieldsByType.messages = [parsed.fields[0]];
    parsed.fieldsByType.booleans = [parsed.fields[1]];
    parsed.fieldsByType.assets = [parsed.fields[2]];
    parsed.fieldsByType.events = [parsed.fields[3]];

    const output = generateVerseOutput(parsed);

    expect(output.managerFileName).toBe("wdb_speed_shop_manager.verse");
    expect(output.managerCode).toContain("wdb_speed_shop_ui<public> := class:");
    expect(output.managerCode).toContain("wdb_speed_shop_manager_device<public> := class(creative_device):");
    expect(output.managerCode).toContain("SetTitleMessage<public>(Value : string)");
    expect(output.managerCode).toContain("SetIsOpen<public>(Value : logic)");
    expect(output.managerCode).toContain("TODO: define a concrete type for asset field MainAsset");
    expect(output.managerCode).toContain("Widget.OnClose.Subscribe(OnOnClose)");
    expect(output.managerCode).toContain("ShowUI<public>(Agent : agent)");
    expect(output.managerCode).toContain("HideUI<public>(Agent : agent)");
    expect(output.managerCode).toContain("GetUI<public>(Agent : agent)");
    expect(output.managerCode).toContain("UpdateTitleMessage<public>(Agent : agent, Value : string)");
    expect(output.uiCoreCode).toContain("event_subscription<public> := class:");
  });
});
