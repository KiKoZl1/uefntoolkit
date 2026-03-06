import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AdminRoute } from "@/components/AdminRoute";
import { PageState } from "@/components/ui/page-state";

const SmartLayout = lazy(() => import("./components/SmartLayout"));
const AppLayout = lazy(() => import("./components/AppLayout"));
const AdminLayout = lazy(() => import("./components/AdminLayout"));

// Public pages
const Home = lazy(() => import("./pages/public/Home"));
const ReportsList = lazy(() => import("./pages/public/ReportsList"));
const ReportView = lazy(() => import("./pages/public/ReportView"));
const DiscoverLive = lazy(() => import("./pages/public/DiscoverLive"));
const IslandPage = lazy(() => import("./pages/public/IslandPage"));
const Auth = lazy(() => import("./pages/Auth"));

// Client pages
const AppDashboard = lazy(() => import("./pages/AppDashboard"));
const ProjectDetail = lazy(() => import("./pages/ProjectDetail"));
const ReportDashboard = lazy(() => import("./pages/ReportDashboard"));
const IslandLookup = lazy(() => import("./pages/IslandLookup"));
const ThumbToolsShell = lazy(() => import("./pages/thumb-tools/ThumbToolsShell"));
const ThumbToolsHub = lazy(() => import("./pages/thumb-tools/ThumbToolsHub"));
const GenerateToolPage = lazy(() => import("./pages/thumb-tools/GenerateToolPage"));
const EditStudioPage = lazy(() => import("./pages/thumb-tools/EditStudioPage"));
const CameraControlPage = lazy(() => import("./pages/thumb-tools/CameraControlPage"));
const LayerDecompositionPage = lazy(() => import("./pages/thumb-tools/LayerDecompositionPage"));
const WidgetKit = lazy(() => import("./pages/WidgetKit"));
const WidgetKitShell = lazy(() => import("./pages/widgetkit/WidgetKitShell"));
const PsdToUmgPage = lazy(() => import("./pages/widgetkit/PsdToUmgPage"));
const UmgToVersePage = lazy(() => import("./pages/widgetkit/UmgToVersePage"));

// Admin pages
const AdminOverview = lazy(() => import("./pages/admin/AdminOverview"));
const AdminReportsList = lazy(() => import("./pages/admin/AdminReportsList"));
const AdminReportEditor = lazy(() => import("./pages/admin/AdminReportEditor"));
const AdminExposureHealth = lazy(() => import("./pages/admin/AdminExposureHealth"));
const AdminIntel = lazy(() => import("./pages/admin/AdminIntel"));
const AdminPanelManager = lazy(() => import("./pages/admin/AdminPanelManager"));
const AdminDppiOverview = lazy(() => import("./pages/admin/dppi/AdminDppiOverview"));
const AdminDppiModels = lazy(() => import("./pages/admin/dppi/AdminDppiModels"));
const AdminDppiTraining = lazy(() => import("./pages/admin/dppi/AdminDppiTraining"));
const AdminDppiInference = lazy(() => import("./pages/admin/dppi/AdminDppiInference"));
const AdminDppiDrift = lazy(() => import("./pages/admin/dppi/AdminDppiDrift"));
const AdminDppiCalibration = lazy(() => import("./pages/admin/dppi/AdminDppiCalibration"));
const AdminDppiReleases = lazy(() => import("./pages/admin/dppi/AdminDppiReleases"));
const AdminDppiFeedback = lazy(() => import("./pages/admin/dppi/AdminDppiFeedback"));
const AdminTgisOverview = lazy(() => import("./pages/admin/tgis/AdminTgisOverview"));
const AdminTgisClusters = lazy(() => import("./pages/admin/tgis/AdminTgisClusters"));
const AdminTgisDataset = lazy(() => import("./pages/admin/tgis/AdminTgisDataset"));
const AdminTgisTraining = lazy(() => import("./pages/admin/tgis/AdminTgisTraining"));
const AdminTgisModels = lazy(() => import("./pages/admin/tgis/AdminTgisModels"));
const AdminTgisInference = lazy(() => import("./pages/admin/tgis/AdminTgisInference"));
const AdminTgisCosts = lazy(() => import("./pages/admin/tgis/AdminTgisCosts"));
const AdminTgisSafety = lazy(() => import("./pages/admin/tgis/AdminTgisSafety"));
const AdminTgisThumbTools = lazy(() => import("./pages/admin/tgis/AdminTgisThumbTools"));

const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Suspense
            fallback={(
              <div className="min-h-screen bg-background px-6 py-10">
                <div className="mx-auto max-w-3xl">
                  <PageState variant="section" title="Loading" description="Preparing page resources..." />
                </div>
              </div>
            )}
          >
            <Routes>
              {/* Smart layout: top bar when authenticated and public nav when anonymous */}
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
                <Route path="widgetkit" element={<WidgetKitShell />}>
                  <Route index element={<WidgetKit />} />
                  <Route path="psd-umg" element={<PsdToUmgPage />} />
                  <Route path="umg-verse" element={<UmgToVersePage />} />
                </Route>
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
          </Suspense>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
