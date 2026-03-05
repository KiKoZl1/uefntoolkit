import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AdminRoute } from "@/components/AdminRoute";
import SmartLayout from "./components/SmartLayout";
import AppLayout from "./components/AppLayout";
import AdminLayout from "./components/AdminLayout";

// Public pages
import Home from "./pages/public/Home";
import ReportsList from "./pages/public/ReportsList";
import ReportView from "./pages/public/ReportView";
import DiscoverLive from "./pages/public/DiscoverLive";
import IslandPage from "./pages/public/IslandPage";
import Auth from "./pages/Auth";

// Client pages
import AppDashboard from "./pages/AppDashboard";
import ProjectDetail from "./pages/ProjectDetail";
import ReportDashboard from "./pages/ReportDashboard";
import IslandLookup from "./pages/IslandLookup";
import ThumbToolsShell from "./pages/thumb-tools/ThumbToolsShell";
import ThumbToolsHub from "./pages/thumb-tools/ThumbToolsHub";
import GenerateToolPage from "./pages/thumb-tools/GenerateToolPage";
import EditStudioPage from "./pages/thumb-tools/EditStudioPage";
import CameraControlPage from "./pages/thumb-tools/CameraControlPage";
import LayerDecompositionPage from "./pages/thumb-tools/LayerDecompositionPage";

// Admin pages
import AdminOverview from "./pages/admin/AdminOverview";
import AdminReportsList from "./pages/admin/AdminReportsList";
import AdminReportEditor from "./pages/admin/AdminReportEditor";
import AdminExposureHealth from "./pages/admin/AdminExposureHealth";
import AdminIntel from "./pages/admin/AdminIntel";
import AdminPanelManager from "./pages/admin/AdminPanelManager";
import AdminDppiOverview from "./pages/admin/dppi/AdminDppiOverview";
import AdminDppiModels from "./pages/admin/dppi/AdminDppiModels";
import AdminDppiTraining from "./pages/admin/dppi/AdminDppiTraining";
import AdminDppiInference from "./pages/admin/dppi/AdminDppiInference";
import AdminDppiDrift from "./pages/admin/dppi/AdminDppiDrift";
import AdminDppiCalibration from "./pages/admin/dppi/AdminDppiCalibration";
import AdminDppiReleases from "./pages/admin/dppi/AdminDppiReleases";
import AdminDppiFeedback from "./pages/admin/dppi/AdminDppiFeedback";
import AdminTgisOverview from "./pages/admin/tgis/AdminTgisOverview";
import AdminTgisClusters from "./pages/admin/tgis/AdminTgisClusters";
import AdminTgisDataset from "./pages/admin/tgis/AdminTgisDataset";
import AdminTgisTraining from "./pages/admin/tgis/AdminTgisTraining";
import AdminTgisModels from "./pages/admin/tgis/AdminTgisModels";
import AdminTgisInference from "./pages/admin/tgis/AdminTgisInference";
import AdminTgisCosts from "./pages/admin/tgis/AdminTgisCosts";
import AdminTgisSafety from "./pages/admin/tgis/AdminTgisSafety";
import AdminTgisThumbTools from "./pages/admin/tgis/AdminTgisThumbTools";

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
            {/* Smart layout: sidebar when logged in, public nav when not */}
            <Route element={<SmartLayout />}>
              <Route path="/" element={<Home />} />
              <Route path="/discover" element={<DiscoverLive />} />
              <Route path="/island" element={<IslandPage />} />
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
              <Route path="thumb-generator" element={<Navigate to="/app/thumb-tools/generate" replace />} />
              <Route path="thumb-tools" element={<ThumbToolsShell />}>
                <Route index element={<ThumbToolsHub />} />
                <Route path="generate" element={<GenerateToolPage />} />
                <Route path="edit-studio" element={<EditStudioPage />} />
                <Route path="camera-control" element={<CameraControlPage />} />
                <Route path="layer-decomposition" element={<LayerDecompositionPage />} />
              </Route>
            </Route>

            {/* Admin (admin/editor role required) */}
            <Route path="/admin" element={<AdminRoute><AdminLayout /></AdminRoute>}>
              <Route index element={<AdminOverview />} />
              <Route path="reports" element={<AdminReportsList />} />
              <Route path="reports/:id/edit" element={<AdminReportEditor />} />
              <Route path="exposure" element={<AdminExposureHealth />} />
              <Route path="intel" element={<AdminIntel />} />
              <Route path="panels" element={<AdminPanelManager />} />
              <Route path="dppi" element={<AdminDppiOverview />} />
              <Route path="dppi/models" element={<AdminDppiModels />} />
              <Route path="dppi/training" element={<AdminDppiTraining />} />
              <Route path="dppi/inference" element={<AdminDppiInference />} />
              <Route path="dppi/drift" element={<AdminDppiDrift />} />
              <Route path="dppi/calibration" element={<AdminDppiCalibration />} />
              <Route path="dppi/releases" element={<AdminDppiReleases />} />
              <Route path="dppi/feedback" element={<AdminDppiFeedback />} />
              <Route path="tgis" element={<AdminTgisOverview />} />
              <Route path="tgis/clusters" element={<AdminTgisClusters />} />
              <Route path="tgis/dataset" element={<AdminTgisDataset />} />
              <Route path="tgis/training" element={<AdminTgisTraining />} />
              <Route path="tgis/models" element={<AdminTgisModels />} />
              <Route path="tgis/inference" element={<AdminTgisInference />} />
              <Route path="tgis/thumb-tools" element={<AdminTgisThumbTools />} />
              <Route path="tgis/costs" element={<AdminTgisCosts />} />
              <Route path="tgis/safety" element={<AdminTgisSafety />} />
            </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
