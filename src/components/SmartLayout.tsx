import { useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import AppLayout from "./AppLayout";
import PublicLayout from "./PublicLayout";
import { SupportChatWidget } from "@/components/support/SupportChatWidget";

/**
 * Uses the app shell when authenticated and the public shell when anonymous.
 */
export default function SmartLayout() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  const layout = user ? <AppLayout /> : <PublicLayout />;
  const path = location.pathname;
  const showWidget = Boolean(user) && !path.startsWith("/auth") && !path.startsWith("/admin");

  return (
    <>
      {layout}
      {showWidget ? <SupportChatWidget /> : null}
    </>
  );
}
