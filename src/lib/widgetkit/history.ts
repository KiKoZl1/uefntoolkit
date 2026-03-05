import { supabase } from "@/integrations/supabase/client";
import type { ParsedWidget, PsdJson, WidgetKitHistoryItem, WidgetKitTool } from "@/types/widgetkit";

type HistoryPayload = PsdJson | ParsedWidget;

export async function listWidgetKitHistory(tool: WidgetKitTool): Promise<WidgetKitHistoryItem[]> {
  const { data, error } = await (supabase as any)
    .from("widgetkit_history")
    .select("id,user_id,tool,name,data_json,meta_json,created_at")
    .eq("tool", tool)
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) throw new Error(error.message);
  return (Array.isArray(data) ? data : []) as WidgetKitHistoryItem[];
}

export async function saveWidgetKitHistory(args: {
  tool: WidgetKitTool;
  name: string;
  data: HistoryPayload;
  meta?: Record<string, unknown>;
}): Promise<WidgetKitHistoryItem> {
  const { data, error } = await (supabase as any)
    .from("widgetkit_history")
    .insert({
      tool: args.tool,
      name: args.name,
      data_json: args.data,
      meta_json: args.meta || {},
    })
    .select("id,user_id,tool,name,data_json,meta_json,created_at")
    .single();

  if (error) throw new Error(error.message);
  return data as WidgetKitHistoryItem;
}

export async function deleteWidgetKitHistory(id: string): Promise<void> {
  const historyId = String(id || "").trim();
  if (!historyId) return;
  const { error } = await (supabase as any).from("widgetkit_history").delete().eq("id", historyId);
  if (error) throw new Error(error.message);
}
