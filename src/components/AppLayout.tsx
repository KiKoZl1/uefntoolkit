import { Outlet } from "react-router-dom";
import { TopBar } from "@/components/navigation/TopBar";

export default function AppLayout() {
  return (
    <div className="min-h-screen bg-background">
      <TopBar context="app" />
      <main className="min-h-[calc(100vh-4rem)]">
        <div className="mx-auto w-full max-w-7xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
