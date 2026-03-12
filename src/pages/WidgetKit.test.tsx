import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import WidgetKit from "@/pages/WidgetKit";
import UmgToVersePage from "@/pages/widgetkit/UmgToVersePage";

const historyMocks = vi.hoisted(() => ({
  listWidgetKitHistory: vi.fn(async () => []),
  saveWidgetKitHistory: vi.fn(async ({ tool, name, data, meta }: any) => ({
    id: `id-${Date.now()}`,
    user_id: "user-1",
    tool,
    name,
    data_json: data,
    meta_json: meta || {},
    created_at: new Date().toISOString(),
  })),
  deleteWidgetKitHistory: vi.fn(async () => undefined),
}));

const parserMocks = vi.hoisted(() => ({
  parseUassetFile: vi.fn(async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".uasset")) throw new Error("error_format");
    return {
      widgetName: file.name.replace(/\.uasset$/i, "") || "WDB_Widget",
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
      hasVerseFields: true,
      sourceHasVerseClassFields: true,
      fieldsByType: {
        messages: [
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
        ],
        booleans: [],
        floats: [],
        integers: [],
        assets: [],
        events: [
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
      },
    };
  }),
}));

const commerceMocks = vi.hoisted(() => ({
  executeCommerceTool: vi.fn(async () => ({
    operation_id: "op-test-1",
    tool_code: "umg_to_verse",
    credit_cost: 4,
    debit_source: "weekly_wallet",
    remaining_weekly_available: 96,
    remaining_extra_wallet: 0,
    status: "allowed",
  })),
  reverseCommerceOperation: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/lib/widgetkit/history", () => ({
  listWidgetKitHistory: historyMocks.listWidgetKitHistory,
  saveWidgetKitHistory: historyMocks.saveWidgetKitHistory,
  deleteWidgetKitHistory: historyMocks.deleteWidgetKitHistory,
}));

vi.mock("@/lib/widgetkit/uasset-parser", () => ({
  parseUassetFile: parserMocks.parseUassetFile,
}));

vi.mock("@/lib/commerce/client", () => ({
  executeCommerceTool: commerceMocks.executeCommerceTool,
  reverseCommerceOperation: commerceMocks.reverseCommerceOperation,
}));

describe("WidgetKit UI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem("i18nextLng", "en");
  });

  it("renders hub cards for each tool", () => {
    render(
      <MemoryRouter>
        <WidgetKit />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "WidgetKit" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /PSD -> UMG/i })).toHaveAttribute("href", "/app/widgetkit/psd-umg");
    expect(screen.getByRole("link", { name: /UMG -> VerseFields/i })).toHaveAttribute("href", "/app/widgetkit/umg-verse");
  });

  it("validates files and supports save/reopen history on dedicated page", async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(
      <MemoryRouter>
        <UmgToVersePage />
      </MemoryRouter>,
    );

    const getUassetInput = () => document.querySelector('input[accept=".uasset"]') as HTMLInputElement;
    expect(getUassetInput()).toBeTruthy();

    await user.upload(getUassetInput(), new File(["x"], "bad.txt", { type: "text/plain" }));
    expect(await screen.findByText("Invalid format. Upload a valid .uasset file.")).toBeInTheDocument();

    const valid = new File(["dummy"], "WDB_Test.uasset", { type: "application/octet-stream" });
    await user.upload(getUassetInput(), valid);
    expect(await screen.findByText("2 fields found")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Generate Verse" }));
    expect(await screen.findByText("wdb_test_manager.verse")).toBeInTheDocument();
    expect(commerceMocks.executeCommerceTool).toHaveBeenCalledTimes(1);
    expect(historyMocks.saveWidgetKitHistory).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "New upload" }));
    expect(screen.getByText("Drop your .uasset here or click to select")).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "View" })[0]);
    expect(await screen.findByText("wdb_test_manager.verse")).toBeInTheDocument();
  });
});
