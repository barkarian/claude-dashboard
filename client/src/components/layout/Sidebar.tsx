import { useEffect, useState } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.tsx';
import { Button } from '../ui/button.tsx';
import api from '../../utils/api.ts';
import type { ProjectSummary } from '../../../../shared/types/models.ts';
import EnvironmentToggle from './EnvironmentToggle.tsx';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function Sidebar({ isOpen, onClose }: SidebarProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);

  useEffect(() => {
    loadProjects();
  }, []);

  // Auto-close drawer on navigation
  useEffect(() => {
    onClose();
  }, [location.pathname]);

  async function loadProjects() {
    try {
      const data = await api.get<{ projects: ProjectSummary[] }>('/api/projects');
      setProjects(data.projects || []);
    } catch {
      // ignore
    }
  }

  const sidebarContent = (
    <>
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-text flex items-center gap-2">
            <span className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center text-white text-sm font-bold">C</span>
            Claude Dashboard
          </h1>
          <EnvironmentToggle />
        </div>
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

        <div className="mt-4 mb-2 px-3">
          <span className="text-xs font-semibold text-text-dim uppercase tracking-wider">Settings</span>
        </div>

        <a
          href="/settings"
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors text-text-muted hover:text-text hover:bg-bg-hover"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Account Settings
        </a>

        {!!window.__TAURI__ && (
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive ? 'bg-primary/10 text-primary' : 'text-text-muted hover:text-text hover:bg-bg-hover'
              }`
            }
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M2.985 19.644l3.181-3.182" />
            </svg>
            Updates
          </NavLink>
        )}
      </nav>

      {user && (
        <div className="px-3 py-2 border-t border-border">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-success flex-shrink-0" />
            <span className="text-xs font-medium text-text truncate">
              {user.username}
            </span>
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
              user.plan === 'pro'
                ? 'bg-primary/15 text-primary'
                : 'bg-border text-text-dim'
            }`}>
              {user.plan === 'pro' ? 'PRO' : 'FREE'}
            </span>
          </div>
          {user.plan !== 'pro' && (
            <a
              href="/settings"
              className="text-[11px] text-primary hover:underline mt-1 ml-4 block"
            >
              Upgrade to Pro &rarr;
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
    </>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-64 bg-bg-surface border-r border-border h-screen sticky top-0">
        {sidebarContent}
      </aside>

      {/* Mobile drawer */}
      <div
        className={`md:hidden fixed inset-0 z-50 transition-opacity duration-300 ${
          isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Backdrop */}
        <div className="absolute inset-0 bg-black/50" onClick={onClose} />
        {/* Drawer panel */}
        <aside
          className={`absolute inset-y-0 left-0 w-72 bg-bg-surface flex flex-col shadow-xl transition-transform duration-300 ${
            isOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          {sidebarContent}
        </aside>
      </div>
    </>
  );
}
