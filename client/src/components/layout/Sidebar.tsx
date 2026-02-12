import { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.tsx';
import { Button } from '../ui/button.tsx';
import api from '../../utils/api.ts';
import type { ProjectSummary } from '../../../../shared/types/models.ts';

interface TunnelAuthStatus {
  connected: boolean;
  tunnelMode: string;
  tunnelServiceUrl: string | null;
  user: {
    username: string;
    email: string;
    userSubdomain: string;
  } | null;
}

export default function Sidebar() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [tunnelStatus, setTunnelStatus] = useState<TunnelAuthStatus | null>(null);

  useEffect(() => {
    loadProjects();
    loadTunnelStatus();
  }, []);

  async function loadProjects() {
    try {
      const data = await api.get<{ projects: ProjectSummary[] }>('/api/projects');
      setProjects(data.projects || []);
    } catch {
      // ignore
    }
  }

  async function loadTunnelStatus() {
    try {
      const data = await api.get<TunnelAuthStatus>('/api/tunnel-auth/status');
      setTunnelStatus(data);
    } catch {
      // ignore
    }
  }

  async function handleTunnelDisconnect() {
    try {
      await api.post('/api/tunnel-auth/disconnect');
      setTunnelStatus((prev) => prev ? { ...prev, connected: false, user: null } : null);
    } catch {
      // ignore
    }
  }

  return (
    <aside className="hidden md:flex flex-col w-64 bg-bg-surface border-r border-border h-screen sticky top-0">
      <div className="p-4 border-b border-border">
        <h1 className="text-lg font-bold text-text flex items-center gap-2">
          <span className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center text-white text-sm font-bold">C</span>
          Claude Dashboard
        </h1>
      </div>

      <nav className="flex-1 overflow-y-auto p-2">
        <NavLink
          to="/"
          end
          className={({ isActive }) =>
            `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
              isActive ? 'bg-primary/10 text-primary' : 'text-text-muted hover:text-text hover:bg-bg-hover'
            }`
          }
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955a1.126 1.126 0 011.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
          </svg>
          All Projects
        </NavLink>

        <div className="mt-4 mb-2 px-3">
          <span className="text-xs font-semibold text-text-dim uppercase tracking-wider">Projects</span>
        </div>

        {projects.map((project) => (
          <NavLink
            key={project.id}
            to={`/project/${project.id}`}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive ? 'bg-primary/10 text-primary' : 'text-text-muted hover:text-text hover:bg-bg-hover'
              }`
            }
          >
            <span className="w-2 h-2 rounded-full bg-border flex-shrink-0" />
            <span className="truncate">{project.name}</span>
          </NavLink>
        ))}

        <Button
          variant="ghost"
          className="w-full justify-start gap-3 mt-1"
          onClick={() => navigate('/new')}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          New Project
        </Button>
      </nav>

      {tunnelStatus?.tunnelMode === 'tunnel-service' && (
        <div className="px-3 py-2 border-t border-border">
          {tunnelStatus.connected && tunnelStatus.user ? (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-success flex-shrink-0" />
                <span className="text-xs font-medium text-text truncate">
                  {tunnelStatus.user.username}
                </span>
              </div>
              <div className="text-[10px] text-text-dim font-mono truncate pl-4">
                *.{tunnelStatus.user.userSubdomain}.tunnels
              </div>
              <button
                onClick={handleTunnelDisconnect}
                className="text-xs text-text-dim hover:text-danger transition-colors pl-4"
              >
                Disconnect
              </button>
            </div>
          ) : (
            <a
              href="/api/tunnel-auth/connect"
              className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-text-muted hover:text-text hover:bg-bg-hover transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-2.54a4.5 4.5 0 00-1.242-7.244l4.5-4.5a4.5 4.5 0 016.364 6.364l-1.757 1.757" />
              </svg>
              Connect Tunnel Service
            </a>
          )}
        </div>
      )}

      <div className="p-3 border-t border-border">
        <Button
          variant="ghost"
          className="w-full justify-start gap-3 text-danger"
          onClick={logout}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
          </svg>
          Logout
        </Button>
      </div>
    </aside>
  );
}
