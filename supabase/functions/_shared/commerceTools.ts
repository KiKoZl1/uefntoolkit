export const COMMERCE_TOOL_CODES = [
  "surprise_gen",
  "edit_studio",
  "camera_control",
  "layer_decomposition",
  "psd_to_umg",
  "umg_to_verse",
] as const;

export type CommerceToolCode = (typeof COMMERCE_TOOL_CODES)[number];

const TOOL_CODE_SET = new Set<string>(COMMERCE_TOOL_CODES);

export function isCommerceToolCode(value: string): value is CommerceToolCode {
  return TOOL_CODE_SET.has(value);
}
