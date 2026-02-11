import { type ReactNode } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext.tsx';
import { ProjectProvider } from './context/ProjectContext.tsx';
import LoginPage from './pages/LoginPage.tsx';
import ProjectListPage from './pages/ProjectListPage.tsx';
import NewProjectPage from './pages/NewProjectPage.tsx';
import ProjectDashboardPage from './pages/ProjectDashboardPage.tsx';
import Sidebar from './components/layout/Sidebar.tsx';

interface ProtectedRouteProps {
  children: ReactNode;
}

function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg">
        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

export default function App() {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg">
        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={
        isAuthenticated ? <Navigate to="/" replace /> : <LoginPage />
      } />
      <Route path="/*" element={
        <ProtectedRoute>
          <ProjectProvider>
            <div className="h-[100dvh] flex flex-col md:flex-row overflow-hidden">
              <Sidebar />
              <main className="flex-1 flex flex-col overflow-hidden">
                <Routes>
                  <Route path="/" element={<ProjectListPage />} />
                  <Route path="/new" element={<NewProjectPage />} />
                  <Route path="/project/:id/*" element={<ProjectDashboardPage />} />
                </Routes>
              </main>
            </div>
          </ProjectProvider>
        </ProtectedRoute>
      } />
    </Routes>
  );
}
