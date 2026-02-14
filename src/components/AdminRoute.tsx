import { useAuth } from "@/hooks/useAuth";
import { Navigate } from "react-router-dom";

export function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, isAdmin, isEditor } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) return <Navigate to="/auth" replace />;
  if (!isAdmin && !isEditor) return <Navigate to="/app" replace />;

  return <>{children}</>;
}
