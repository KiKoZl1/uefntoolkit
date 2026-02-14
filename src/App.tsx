import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AdminRoute } from "@/components/AdminRoute";
import PublicLayout from "./components/PublicLayout";
import AppLayout from "./components/AppLayout";
import AdminLayout from "./components/AdminLayout";

// Public pages
import Home from "./pages/public/Home";
import ReportsList from "./pages/public/ReportsList";
import ReportView from "./pages/public/ReportView";
import Auth from "./pages/Auth";

// Client pages
import AppDashboard from "./pages/AppDashboard";
import ProjectDetail from "./pages/ProjectDetail";
import ReportDashboard from "./pages/ReportDashboard";
import IslandLookup from "./pages/IslandLookup";

// Admin pages
import AdminOverview from "./pages/admin/AdminOverview";
import AdminReportsList from "./pages/admin/AdminReportsList";
import AdminReportEditor from "./pages/admin/AdminReportEditor";

import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            {/* Public */}
            <Route element={<PublicLayout />}>
              <Route path="/" element={<Home />} />
              <Route path="/reports" element={<ReportsList />} />
              <Route path="/reports/:slug" element={<ReportView />} />
            </Route>
            <Route path="/auth" element={<Auth />} />

            {/* Client (auth required) */}
            <Route path="/app" element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
              <Route index element={<AppDashboard />} />
              <Route path="projects/:id" element={<ProjectDetail />} />
              <Route path="projects/:id/reports/:reportId" element={<ReportDashboard />} />
              <Route path="island-lookup" element={<IslandLookup />} />
            </Route>

            {/* Admin (admin/editor role required) */}
            <Route path="/admin" element={<AdminRoute><AdminLayout /></AdminRoute>}>
              <Route index element={<AdminOverview />} />
              <Route path="reports" element={<AdminReportsList />} />
              <Route path="reports/:id/edit" element={<AdminReportEditor />} />
            </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
