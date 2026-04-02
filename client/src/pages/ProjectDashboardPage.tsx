import { useEffect, useRef, useState } from 'react';
import { useParams, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { useProject } from '../context/ProjectContext.tsx';
import { useSocket } from '../context/SocketContext.tsx';
import { useSessionStatuses, useSessionStates } from '../hooks/useSessionStatuses.ts';
import { useProcessStatus } from '../hooks/useProcessStatus.ts';
import { useKeyboardVisible } from '../hooks/useKeyboardVisible.ts';
import { Toaster } from '../components/ui/sonner.tsx';
import Header from '../components/layout/Header.tsx';
import MobileNav from '../components/layout/MobileNav.tsx';
import ScriptList from '../components/scripts/ScriptList.tsx';
import ScriptTerminal from '../components/scripts/ScriptTerminal.tsx';
import ChatList from '../components/chat/ChatList.tsx';
import SDKChatView from '../components/chat/SDKChatView.tsx';
import ClaudeCodeChatView from '../components/chat/ClaudeCodeChatView.tsx';
import FilesPage from '../components/files/FilesPage.tsx';
import ProjectSettingsDialog from '../components/projects/ProjectSettingsDialog.tsx';
import ProjectPathError from '../components/projects/ProjectPathError.tsx';
import DesktopRecordingControls from '../components/chat/DesktopRecordingControls.tsx';
import { useRepoChanges } from '../hooks/useRepoChanges.ts';
import api from '../utils/api.ts';
import { haptics } from '../utils/haptics.ts';
import type { Chat } from '../../../shared/types/models.ts';

function ChatViewRouter({ projectId }: { projectId: string }) {
  const { project } = useProject();

  // Route by current project AI mode, not by which mode created the chat.
  // This allows any chat to be opened in either CC or SDK mode.
  const aiMode = project?.defaultAdapter || 'claude-agent-sdk';

  if (aiMode === 'claude-code') {
    return <ClaudeCodeChatView projectId={projectId} />;
  }
  return <SDKChatView projectId={projectId} />;
}

export default function ProjectDashboardPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { project, loading, loadProject, refreshProject, activeChatStatus } = useProject();
  const { socket } = useSocket();
  const sessionStatuses = useSessionStatuses(id);
  const sessionStates = useSessionStates(id);
  const prevStatusesRef = useRef<Record<string, string>>({});
  const { repos, selectedRepo, setSelectedRepo, totalChangeCount, refresh: refreshRepos } = useRepoChanges(id!);
  const { runningCount, processesWithPorts } = useProcessStatus(id);
  const keyboard = useKeyboardVisible();
  const [showProjectSettings, setShowProjectSettings] = useState(false);
  const [dirExists, setDirExists] = useState<boolean | null>(null);
  const [generatingTitle, setGeneratingTitle] = useState(false);

  useEffect(() => {
    loadProject(id!);
    setDirExists(null);
  }, [id, loadProject]);

  // Check if the project directory exists after project loads
  useEffect(() => {
    if (!project || !id) return;
    api.get<{ exists: boolean }>(`/api/projects/${id}/directory-exists`)
      .then((data) => setDirExists(data.exists))
      .catch(() => setDirExists(false));
  }, [project?.id, id]);

  // Derive current tab and active chat from pathname
  const pathAfterProject = location.pathname.split(`/project/${id}/`)[1] || '';
  const currentTab = pathAfterProject.split('/')[0] || 'chats';
  const chatMatch = location.pathname.match(/\/chats\/([^/]+)/);
  const activeChatId = chatMatch ? chatMatch[1] : null;
  const activeChat = activeChatId ? (project?.chats || []).find((c) => c.id === activeChatId) : null;

  // Mark chat as read when the user navigates into it
  useEffect(() => {
    if (activeChatId && id) {
      api.put(`/api/projects/${id}/chats/${activeChatId}/read`).catch(() => {});
    }
  }, [activeChatId, id]);

  // Auto-mark-read when a chat:unread event fires for the chat we're currently viewing
  useEffect(() => {
    if (!socket || !activeChatId || !id) return;
    function handleUnread({ chatId }: { chatId: string }) {
      if (chatId === activeChatId) {
        api.put(`/api/projects/${id}/chats/${chatId}/read`).catch(() => {});
      }
    }
    socket.on('chat:unread', handleUnread);
    return () => { socket.off('chat:unread', handleUnread); };
  }, [socket, activeChatId, id]);

  // Compute status display — prefer unified JSONL state, fall back to SDK activeChatStatus
  const activeSessionState = activeChatId ? sessionStates[activeChatId] : undefined;

  const statusLabel = (() => {
    if (activeSessionState) {
      switch (activeSessionState.status) {
        case 'working': return 'thinking';
        case 'question-awaiting': return 'question';
        case 'questions-awaiting': return 'questions';
        case 'plan-awaiting': return 'plan ready';
        case 'permission-awaiting': return activeSessionState.pendingTool?.toolName || 'permission';
        default: return activeSessionState.status;
      }
    }
    if (!activeChatStatus) return undefined;
    switch (activeChatStatus) {
      case 'streaming': return 'thinking';
      case 'tool-use': return 'working';
      case 'waiting-permission': return 'permission';
      default: return activeChatStatus;
    }
  })();

  const statusDotClass = (() => {
    if (activeSessionState) {
      switch (activeSessionState.status) {
        case 'idle': return 'bg-success';
        case 'working': return 'bg-warning animate-pulse';
        case 'question-awaiting':
        case 'questions-awaiting': return 'bg-primary animate-pulse';
        case 'plan-awaiting': return 'bg-[#a855f7] animate-pulse';
        case 'permission-awaiting': return 'bg-warning animate-pulse';
        case 'starting': return 'bg-primary animate-pulse';
        default: return 'bg-text-dim';
      }
    }
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
        haptics.notificationSuccess();
        toast(`${chatLabel} finished`, {
          action: {
            label: 'Go to chat',
            onClick: () => navigate(`/project/${id}/chats/${chatId}`),
          },
        });
      } else if (status === 'waiting-input' && prevStatus !== 'waiting-input') {
        haptics.notificationWarning();
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
      const data = await api.post<{ chat: Chat }>(`/api/projects/${id}/chats`, { label: 'New Chat', adapter: project?.defaultAdapter });
      navigate(`/project/${id}/chats/${data.chat.id}`, {
        state: { isNewChat: true, adapter: data.chat.adapter },
      });
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

  async function handleDeleteChat() {
    if (!activeChatId) return;
    try {
      if (socket) {
        const chatToDelete = (project?.chats || []).find(c => c.id === activeChatId);
        if (chatToDelete?.adapter === 'claude-code') {
          socket.emit('cc:stop', { chatId: activeChatId });
        } else if (sessionStatuses[activeChatId]) {
          socket.emit('sdk:end', { chatId: activeChatId });
        }
      }
      await api.delete(`/api/projects/${id}/chats/${activeChatId}`);
      await refreshProject();
      navigate(`/project/${id}/chats`);
    } catch (err) {
      console.error('Failed to delete chat:', err);
    }
  }

  async function handleGenerateTitle() {
    if (!activeChatId) return;
    setGeneratingTitle(true);
    toast.loading('Generating title & summary...', { id: 'gen-title' });
    try {
      await api.post<{ title: string; description: string }>(
        `/api/projects/${id}/chats/${activeChatId}/generate-title`
      );
      await refreshProject();
      toast.success('Title & summary generated', { id: 'gen-title' });
    } catch (err) {
      console.error('Failed to generate title:', err);
      toast.error('Failed to generate title', { id: 'gen-title' });
    } finally {
      setGeneratingTitle(false);
    }
  }

  // Use running process count for badge
  const scriptCount = runningCount;

  return (
    <div
      className="flex-1 flex flex-col overflow-hidden transition-[padding-bottom] duration-200"
      style={{ paddingBottom: keyboard.height > 0 ? keyboard.height : undefined }}
    >
      <Toaster />
      <Header
        projectName={project?.name || id || '...'}
        projectPath={project?.path}
        projectId={id}
        chatName={activeChat?.label || (activeChatId ? 'New Chat' : undefined)}
        chatDescription={activeChat?.description}
        chatId={activeChatId || undefined}
        onNewChat={project ? handleNewChat : undefined}
        onEditChatName={activeChatId ? handleEditChatName : undefined}
        onGenerateTitle={activeChatId ? handleGenerateTitle : undefined}
        generatingTitle={generatingTitle}
        onDeleteChat={activeChatId ? handleDeleteChat : undefined}
        statusDot={statusDotClass}
        statusLabel={statusLabel}
        onProjectSettings={() => setShowProjectSettings(true)}
        projectActions={project ? (
          <DesktopRecordingControls projectId={id!} />
        ) : undefined}
      />

      {project && (
        <ProjectSettingsDialog
          open={showProjectSettings}
          onOpenChange={setShowProjectSettings}
          projectId={project.id}
          projectName={project.name}
          projectPath={project.path}
          shellOverride={project.shellOverride}
          defaultAdapter={project.defaultAdapter || 'claude-agent-sdk'}
          aiNamingEnabled={project.aiNamingEnabled || 'none'}
          onShellChanged={refreshProject}
          onAdapterChanged={refreshProject}
          onAiNamingChanged={refreshProject}
        />
      )}

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full" />
        </div>
      ) : !project ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <h3 className="text-lg font-medium text-text mb-1">Project not found</h3>
            <p className="text-text-muted">This project may have been deleted</p>
          </div>
        </div>
      ) : dirExists === false ? (
        <ProjectPathError
          projectId={project.id}
          projectName={project.name}
          projectPath={project.path}
          onPathChanged={() => { loadProject(id!); setDirExists(null); }}
          onDeleted={() => {}}
        />
      ) : (
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
              <ChatList projectId={id!} project={project} sessionStatuses={sessionStatuses} sessionStates={sessionStates} />
            </div>
          } />
          <Route path="chats/:chatId" element={<ChatViewRouter projectId={id!} />} />
          <Route path="files" element={
            <div className="flex-1 flex flex-col overflow-hidden">
              <FilesPage projectId={id!} repos={repos} selectedRepo={selectedRepo} onSelectRepo={setSelectedRepo} onRepoRefresh={refreshRepos} />
            </div>
          } />
        </Routes>
      )}

      {/* Mobile bottom nav — hidden when keyboard is open or directory missing */}
      {!keyboard.visible && dirExists !== false && (
        <MobileNav
          projectId={id}
          currentTab={currentTab}
          scriptCount={scriptCount}
          changeCount={totalChangeCount}
          processesWithPorts={processesWithPorts}
        />
      )}
    </div>
  );
}
