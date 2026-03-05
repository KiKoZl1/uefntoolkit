import { Outlet } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import AppLayout from "./AppLayout";
import PublicLayout from "./PublicLayout";

/**
 * Uses the app shell when authenticated and the public shell when anonymous.
 */
export default function SmartLayout() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (user) {
    return <AppLayout />;
  }

  return <PublicLayout />;
}
