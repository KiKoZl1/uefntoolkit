import { Outlet, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Radar } from "lucide-react";

export default function PublicLayout() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <nav className="flex items-center justify-between px-6 py-4 max-w-6xl mx-auto w-full">
        <Link to="/" className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
            <Radar className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="font-display text-lg font-bold">Surprise Radar</span>
        </Link>
        <div className="flex items-center gap-3">
          <Button variant="ghost" asChild>
            <Link to="/reports">Reports</Link>
          </Button>
          <Button variant="ghost" asChild>
            <Link to="/auth">Entrar</Link>
          </Button>
          <Button asChild>
            <Link to="/auth">Começar Grátis</Link>
          </Button>
        </div>
      </nav>
      <main className="flex-1">
        <Outlet />
      </main>
      <footer className="px-6 py-8 border-t text-center text-sm text-muted-foreground">
        © 2026 Surprise Radar. Weekly Discovery Intelligence for Fortnite UGC.
      </footer>
    </div>
  );
}
