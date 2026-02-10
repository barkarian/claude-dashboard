import { useEffect, useState } from 'react';
import { useParams, Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { useProject } from '../context/ProjectContext.jsx';
import Header from '../components/layout/Header.jsx';
import ScriptList from '../components/scripts/ScriptList.jsx';
import ScriptTerminal from '../components/scripts/ScriptTerminal.jsx';
import ChatList from '../components/chat/ChatList.jsx';
import ChatView from '../components/chat/ChatView.tsx';
import DiffOverview from '../components/diff/DiffOverview.jsx';

export default function ProjectDashboardPage() {
  const { id } = useParams();
  const { project, loading, loadProject } = useProject();

  useEffect(() => {
    loadProject(id);
  }, [id, loadProject]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="text-center py-20">
        <h3 className="text-lg font-medium text-text mb-1">Project not found</h3>
        <p className="text-text-muted">This project may have been deleted</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Header title={project.name} backTo="/" />

      {/* Tab navigation */}
      <div className="border-b border-border px-4">
        <nav className="flex gap-1 -mb-px">
          <NavLink
            to={`/project/${id}/scripts`}
            className={({ isActive }) =>
              `px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                isActive
                  ? 'border-primary text-primary'
                  : 'border-transparent text-text-muted hover:text-text hover:border-border-light'
              }`
            }
          >
            Scripts
          </NavLink>
          <NavLink
            to={`/project/${id}/chats`}
            className={({ isActive }) =>
              `px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                isActive
                  ? 'border-primary text-primary'
                  : 'border-transparent text-text-muted hover:text-text hover:border-border-light'
              }`
            }
          >
            Chats
          </NavLink>
          <NavLink
            to={`/project/${id}/diff`}
            className={({ isActive }) =>
              `px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                isActive
                  ? 'border-primary text-primary'
                  : 'border-transparent text-text-muted hover:text-text hover:border-border-light'
              }`
            }
          >
            Changes
          </NavLink>
        </nav>
      </div>

      {/* Tab content */}
      <Routes>
        <Route path="/" element={<Navigate to="chats" replace />} />
        <Route path="scripts" element={<ScriptList projectId={id} project={project} />} />
        <Route path="scripts/:scriptId" element={<ScriptTerminal projectId={id} />} />
        <Route path="chats" element={<ChatList projectId={id} project={project} />} />
        <Route path="chats/:chatId" element={<ChatView projectId={id} />} />
        <Route path="diff" element={<DiffOverview projectId={id} />} />
      </Routes>
    </div>
  );
}
