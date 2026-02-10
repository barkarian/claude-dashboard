import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import { ProjectProvider } from './context/ProjectContext.jsx';
import LoginPage from './pages/LoginPage.jsx';
import ProjectListPage from './pages/ProjectListPage.jsx';
import NewProjectPage from './pages/NewProjectPage.jsx';
import ProjectDashboardPage from './pages/ProjectDashboardPage.jsx';
import Sidebar from './components/layout/Sidebar.jsx';
import MobileNav from './components/layout/MobileNav.jsx';

function ProtectedRoute({ children }) {
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
            <div className="min-h-screen flex flex-col md:flex-row">
              <Sidebar />
              <main className="flex-1 pb-16 md:pb-0 overflow-auto">
                <Routes>
                  <Route path="/" element={<ProjectListPage />} />
                  <Route path="/new" element={<NewProjectPage />} />
                  <Route path="/project/:id/*" element={<ProjectDashboardPage />} />
                </Routes>
              </main>
              <MobileNav />
            </div>
          </ProjectProvider>
        </ProtectedRoute>
      } />
    </Routes>
  );
}
