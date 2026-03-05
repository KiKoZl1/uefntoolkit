import { Outlet } from "react-router-dom";
import { ThumbToolsProvider } from "@/features/tgis-thumb-tools/ThumbToolsProvider";

export default function ThumbToolsShell() {
  return (
    <ThumbToolsProvider>
      <Outlet />
    </ThumbToolsProvider>
  );
}
