import { useState, useCallback, type ReactNode } from 'react';
import { Routes, Route } from 'react-router-dom';
import { useAuth } from './context/AuthContext.tsx';
import { ProjectProvider } from './context/ProjectContext.tsx';
import { SidebarContext } from './context/SidebarContext.tsx';
import ProjectListPage from './pages/ProjectListPage.tsx';
import NewProjectPage from './pages/NewProjectPage.tsx';
import ProjectDashboardPage from './pages/ProjectDashboardPage.tsx';
import SettingsPage from './pages/SettingsPage.tsx';
import BillingSuccessPage from './pages/BillingSuccessPage.tsx';
import BillingCancelPage from './pages/BillingCancelPage.tsx';
import MigrationPage from './pages/MigrationPage.tsx';
import Sidebar from './components/layout/Sidebar.tsx';

interface ProtectedRouteProps {
  children: ReactNode;
}

function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isAuthenticated, loading, oauthUrl } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg">
        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!isAuthenticated) {
    if (oauthUrl) {
      window.location.href = oauthUrl;
    }
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-text-muted">Redirecting to login...</p>
        </div>
      </div>
    );
  }

  return children;
}

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const openSidebar = useCallback(() => setSidebarOpen(true), []);

  return (
    <Routes>
      <Route path="/*" element={
        <ProtectedRoute>
          <ProjectProvider>
            <SidebarContext.Provider value={{ openSidebar }}>
              <div className="h-[100dvh] flex flex-col md:flex-row overflow-hidden">
                <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
                <main className="flex-1 flex flex-col overflow-hidden">
                  <Routes>
                    <Route path="/" element={<ProjectListPage />} />
                    <Route path="/new" element={<NewProjectPage />} />
                    <Route path="/settings" element={<SettingsPage />} />
                    <Route path="/billing/success" element={<BillingSuccessPage />} />
                    <Route path="/billing/cancel" element={<BillingCancelPage />} />
                    <Route path="/migrate" element={<MigrationPage />} />
                    <Route path="/project/:id/*" element={<ProjectDashboardPage />} />
                  </Routes>
                </main>
              </div>
            </SidebarContext.Provider>
          </ProjectProvider>
        </ProtectedRoute>
      } />
    </Routes>
  );
}
