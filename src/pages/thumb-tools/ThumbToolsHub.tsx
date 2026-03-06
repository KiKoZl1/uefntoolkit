import { ToolHubLayout } from "@/components/tool-hub/ToolHubLayout";
import { TOOL_HUBS } from "@/tool-hubs/registry";

export default function ThumbToolsHub() {
  return <ToolHubLayout hub={TOOL_HUBS.thumbTools} />;
}

