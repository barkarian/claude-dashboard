import { useEffect, useRef } from 'react';
import { useParams, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { useProject } from '../context/ProjectContext.tsx';
import { useSessionStatuses } from '../hooks/useSessionStatuses.ts';
import { Toaster } from '../components/ui/sonner.tsx';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs.tsx';
import Header from '../components/layout/Header.tsx';
import ScriptList from '../components/scripts/ScriptList.tsx';
import ScriptTerminal from '../components/scripts/ScriptTerminal.tsx';
import ChatList from '../components/chat/ChatList.tsx';
import SDKChatView from '../components/chat/SDKChatView.tsx';
import DiffOverview from '../components/diff/DiffOverview.tsx';

export default function ProjectDashboardPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { project, loading, loadProject } = useProject();
  const sessionStatuses = useSessionStatuses(id);
  const prevStatusesRef = useRef<Record<string, string>>({});

  useEffect(() => {
    loadProject(id!);
  }, [id, loadProject]);

  // Derive current tab from pathname
  const pathAfterProject = location.pathname.split(`/project/${id}/`)[1] || '';
  const currentTab = pathAfterProject.split('/')[0] || 'chats';

  // Toast notifications for background session changes
  useEffect(() => {
    const prev = prevStatusesRef.current;
    const chats = project?.chats || [];

    // Determine which chatId is currently viewed
    const chatMatch = location.pathname.match(/\/chats\/([^/]+)/);
    const viewedChatId = chatMatch ? chatMatch[1] : null;

    for (const [chatId, status] of Object.entries(sessionStatuses)) {
      if (chatId === viewedChatId) continue;

      const prevStatus = prev[chatId];
      if (!prevStatus) continue;

      const chatLabel = chats.find((c) => c.id === chatId)?.label || 'Chat';

      if (prevStatus === 'thinking' && status === 'idle') {
        toast(`${chatLabel} finished`, {
          action: {
            label: 'Go to chat',
            onClick: () => navigate(`/project/${id}/chats/${chatId}`),
          },
        });
      } else if (status === 'waiting-input' && prevStatus !== 'waiting-input') {
        toast(`${chatLabel} needs input`, {
          action: {
            label: 'Go to chat',
            onClick: () => navigate(`/project/${id}/chats/${chatId}`),
          },
        });
      }
    }

    prevStatusesRef.current = { ...sessionStatuses };
  }, [sessionStatuses, project, location.pathname, id, navigate]);

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
      <Toaster />
      <Header title={project.name} backTo="/" />

      {/* Tab navigation */}
      <div className="border-b border-border px-4">
        <Tabs value={currentTab} onValueChange={(val) => navigate(`/project/${id}/${val}`)}>
          <TabsList>
            <TabsTrigger value="scripts">Scripts</TabsTrigger>
            <TabsTrigger value="chats">Chats</TabsTrigger>
            <TabsTrigger value="diff">Changes</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Tab content */}
      <Routes>
        <Route path="/" element={<Navigate to="chats" replace />} />
        <Route path="scripts" element={<ScriptList projectId={id!} project={project} />} />
        <Route path="scripts/:scriptId" element={<ScriptTerminal projectId={id!} />} />
        <Route path="chats" element={<ChatList projectId={id!} project={project} sessionStatuses={sessionStatuses} />} />
        <Route path="chats/:chatId" element={<SDKChatView projectId={id!} />} />
        <Route path="diff" element={<DiffOverview projectId={id!} />} />
      </Routes>
    </div>
  );
}
