import { describe, expect, it } from "vitest";
import { isCommerceToolCode } from "../../../supabase/functions/_shared/commerceTools.ts";

describe("commerce tool code validation", () => {
  it("accepts documented tool codes", () => {
    expect(isCommerceToolCode("surprise_gen")).toBe(true);
    expect(isCommerceToolCode("edit_studio")).toBe(true);
    expect(isCommerceToolCode("camera_control")).toBe(true);
    expect(isCommerceToolCode("layer_decomposition")).toBe(true);
    expect(isCommerceToolCode("psd_to_umg")).toBe(true);
    expect(isCommerceToolCode("umg_to_verse")).toBe(true);
  });

  it("rejects unknown tool codes", () => {
    expect(isCommerceToolCode("unknown_tool_code")).toBe(false);
    expect(isCommerceToolCode("")).toBe(false);
  });
});
