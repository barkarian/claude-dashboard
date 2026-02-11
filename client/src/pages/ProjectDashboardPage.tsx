import { useEffect, useRef, useState } from 'react';
import { useParams, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { useProject } from '../context/ProjectContext.tsx';
import { useSessionStatuses } from '../hooks/useSessionStatuses.ts';
import { useSocket } from '../context/SocketContext.tsx';
import { Toaster } from '../components/ui/sonner.tsx';
import Header from '../components/layout/Header.tsx';
import MobileNav from '../components/layout/MobileNav.tsx';
import ScriptList from '../components/scripts/ScriptList.tsx';
import ScriptTerminal from '../components/scripts/ScriptTerminal.tsx';
import ChatList from '../components/chat/ChatList.tsx';
import SDKChatView from '../components/chat/SDKChatView.tsx';
import DiffOverview from '../components/diff/DiffOverview.tsx';
import api from '../utils/api.ts';
import type { Chat } from '../../../shared/types/models.ts';

export default function ProjectDashboardPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { project, loading, loadProject, refreshProject, activeChatStatus } = useProject();
  const { socket } = useSocket();
  const sessionStatuses = useSessionStatuses(id);
  const prevStatusesRef = useRef<Record<string, string>>({});
  const [diffCount, setDiffCount] = useState(0);
  const [runningCount, setRunningCount] = useState(0);

  useEffect(() => {
    loadProject(id!);
  }, [id, loadProject]);

  // Fetch diff count for badge
  useEffect(() => {
    if (!id) return;
    api.get<{ files?: any[] }>(`/api/projects/${id}/diff`)
      .then((data) => setDiffCount(data.files?.length || 0))
      .catch(() => setDiffCount(0));
  }, [id]);

  // Poll running process count for badge
  useEffect(() => {
    if (!id) return;
    function fetchRunningCount() {
      api.get<{ runningCount: number }>(`/api/projects/${id}/scripts/processes`)
        .then((data) => setRunningCount(data.runningCount || 0))
        .catch(() => setRunningCount(0));
    }
    fetchRunningCount();
    const interval = setInterval(fetchRunningCount, 5000);
    return () => clearInterval(interval);
  }, [id]);

  // Derive current tab and active chat from pathname
  const pathAfterProject = location.pathname.split(`/project/${id}/`)[1] || '';
  const currentTab = pathAfterProject.split('/')[0] || 'chats';
  const chatMatch = location.pathname.match(/\/chats\/([^/]+)/);
  const activeChatId = chatMatch ? chatMatch[1] : null;
  const activeChat = activeChatId ? (project?.chats || []).find((c) => c.id === activeChatId) : null;

  // Compute status display from activeChatStatus context
  const statusLabel = (() => {
    if (!activeChatStatus) return undefined;
    switch (activeChatStatus) {
      case 'streaming': return 'thinking';
      case 'tool-use': return 'working';
      case 'waiting-permission': return 'permission';
      default: return activeChatStatus;
    }
  })();

  const statusDotClass = (() => {
    if (!activeChatStatus) return undefined;
    switch (activeChatStatus) {
      case 'idle': return 'bg-success';
      case 'streaming':
      case 'tool-use': return 'bg-warning animate-pulse';
      case 'waiting-permission': return 'bg-primary animate-pulse';
      case 'starting': return 'bg-primary animate-pulse';
      default: return 'bg-text-dim';
    }
  })();

  const isActive = activeChatStatus && activeChatStatus !== 'disconnected' && activeChatStatus !== 'exited' && activeChatStatus !== 'error';

  // Toast notifications for background session changes
  useEffect(() => {
    const prev = prevStatusesRef.current;
    const chats = project?.chats || [];
    const viewedChatId = activeChatId;

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
  }, [sessionStatuses, project, activeChatId, id, navigate]);

  async function handleNewChat() {
    try {
      const data = await api.post<{ chat: Chat }>(`/api/projects/${id}/chats`, { label: 'New Chat' });
      navigate(`/project/${id}/chats/${data.chat.id}`);
    } catch (err) {
      console.error('Failed to create chat:', err);
    }
  }

  async function handleEditChatName(newName: string) {
    if (!activeChatId) return;
    try {
      await api.patch(`/api/projects/${id}/chats/${activeChatId}`, { label: newName });
      await refreshProject();
    } catch (err) {
      console.error('Failed to rename chat:', err);
    }
  }

  function handlePowerOff() {
    if (socket && activeChatId) {
      socket.emit('sdk:end', { chatId: activeChatId });
    }
  }

  // Use running process count for badge
  const scriptCount = runningCount;

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
    <div className="flex-1 flex flex-col overflow-hidden">
      <Toaster />
      <Header
        projectName={project.name}
        projectId={id}
        chatName={activeChat?.label}
        chatId={activeChatId || undefined}
        onNewChat={handleNewChat}
        onEditChatName={activeChatId ? handleEditChatName : undefined}
        onPowerOff={activeChatId ? handlePowerOff : undefined}
        showPowerOff={!!isActive}
        statusDot={statusDotClass}
        statusLabel={statusLabel}
      />

      {/* Tab content */}
      <Routes>
        <Route path="/" element={<Navigate to="chats" replace />} />
        <Route path="scripts" element={
          <div className="flex-1 overflow-y-auto">
            <ScriptList projectId={id!} project={project} />
          </div>
        } />
        <Route path="scripts/:scriptId" element={<ScriptTerminal projectId={id!} />} />
        <Route path="chats" element={
          <div className="flex-1 overflow-y-auto">
            <ChatList projectId={id!} project={project} sessionStatuses={sessionStatuses} />
          </div>
        } />
        <Route path="chats/:chatId" element={<SDKChatView projectId={id!} />} />
        <Route path="diff" element={<DiffOverview projectId={id!} />} />
      </Routes>

      {/* Mobile bottom nav */}
      <MobileNav
        projectId={id}
        currentTab={currentTab}
        scriptCount={scriptCount}
        changeCount={diffCount}
      />
    </div>
  );
}
