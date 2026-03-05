import { Outlet } from "react-router-dom";
import { TopBar } from "@/components/navigation/TopBar";
import { Badge } from "@/components/ui/badge";

export default function AdminLayout() {
  return (
    <div className="min-h-screen bg-background">
      <TopBar context="admin" />
      <main className="min-h-[calc(100vh-4rem)]">
        <div className="mx-auto w-full max-w-7xl">
          <div className="px-4 py-3 sm:px-6">
            <Badge variant="outline" className="text-[10px] uppercase tracking-[0.15em] text-primary border-primary/30">
              Admin
            </Badge>
          </div>
          <Outlet />
        </div>
      </main>
    </div>
  );
}
