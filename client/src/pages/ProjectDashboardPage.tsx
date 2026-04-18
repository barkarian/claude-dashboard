import { useEffect, useRef, useState } from 'react';
import { useParams, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { useProject } from '../context/ProjectContext.tsx';
import { useSocket } from '../context/SocketContext.tsx';
import { useSessionStates } from '../hooks/useSessionStatuses.ts';
import type { SessionStateContext } from '../../../shared/types/session.ts';
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
import ChatViewShell from '../components/chat/ChatViewShell.tsx';
import { getClientAdapter } from '../adapters/registry.ts';
import FilesPage from '../components/files/FilesPage.tsx';
import ProjectSettingsDialog from '../components/projects/ProjectSettingsDialog.tsx';
import ProjectPathError from '../components/projects/ProjectPathError.tsx';
import DesktopRecordingControls from '../components/chat/DesktopRecordingControls.tsx';
import { useRepoChanges } from '../hooks/useRepoChanges.ts';
import api from '../utils/api.ts';
import { haptics } from '../utils/haptics.ts';
import { setProjectNavState, clearProjectNavState } from '../utils/projectNavState.ts';
import type { Chat } from '../../../shared/types/models.ts';

function ChatViewRouter({ projectId }: { projectId: string }) {
  const { project } = useProject();
  const adapterId = project?.defaultAdapter || 'claude-agent-sdk';

  // Use adapter registry if the adapter is registered (new plugin system)
  if (getClientAdapter(adapterId)) {
    return <ChatViewShell projectId={projectId} />;
  }

  // Legacy fallback for unregistered adapters
  if (adapterId === 'claude-code') {
    return <ClaudeCodeChatView projectId={projectId} />;
  }
  return <SDKChatView projectId={projectId} />;
}

export default function ProjectDashboardPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { project, loading, loadProject, refreshProject, setProject } = useProject();
  const { socket } = useSocket();
  const sessionStates = useSessionStates(id);
  const prevStatesRef = useRef<Record<string, SessionStateContext>>({});
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
  const scriptMatch = location.pathname.match(/\/scripts\/([^/]+)/);
  const activeScriptId = scriptMatch ? scriptMatch[1] : null;
  const activeChat = activeChatId ? (project?.chats || []).find((c) => c.id === activeChatId) : null;

  // Persist last-visited deep route per project so tab switches restore the previous selection.
  useEffect(() => {
    if (id && activeChatId) setProjectNavState(id, { lastChatId: activeChatId });
  }, [id, activeChatId]);
  useEffect(() => {
    if (id && activeScriptId) setProjectNavState(id, { lastScriptId: activeScriptId });
  }, [id, activeScriptId]);

  // Clear nav state for the project when we leave it (project change or page unmount).
  useEffect(() => {
    return () => {
      if (id) clearProjectNavState(id);
    };
  }, [id]);

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

  // Refresh project data when any chat in this project is renamed (title generated)
  useEffect(() => {
    if (!socket) return;
    function handleChatRenamed() {
      refreshProject();
    }
    socket.on('claude:chat-renamed', handleChatRenamed);
    return () => { socket.off('claude:chat-renamed', handleChatRenamed); };
  }, [socket, refreshProject]);

  // Compute status display from unified session state
  const activeSessionState = activeChatId ? sessionStates[activeChatId] : undefined;

  const statusLabel = (() => {
    if (!activeSessionState) return undefined;
    switch (activeSessionState.status) {
      case 'working': return 'thinking';
      case 'question-awaiting': return 'question';
      case 'questions-awaiting': return 'questions';
      case 'plan-awaiting': return 'plan ready';
      case 'permission-awaiting': return activeSessionState.pendingTool?.toolName || 'permission';
      default: return activeSessionState.status;
    }
  })();

  const statusDotClass = (() => {
    if (!activeSessionState) return undefined;
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
  })();

  // Toast notifications for background session changes (unified source)
  const isAwaitingInput = (s: SessionStateContext['status']) =>
    s === 'question-awaiting' || s === 'questions-awaiting' ||
    s === 'plan-awaiting' || s === 'permission-awaiting';

  useEffect(() => {
    const prev = prevStatesRef.current;
    const chats = project?.chats || [];
    const viewedChatId = activeChatId;

    for (const [chatId, state] of Object.entries(sessionStates)) {
      if (chatId === viewedChatId) continue;

      const prevState = prev[chatId];
      if (!prevState) continue;

      const chatLabel = chats.find((c) => c.id === chatId)?.label || 'Chat';

      if (prevState.status === 'working' && state.status === 'idle') {
        haptics.notificationSuccess();
        toast(`${chatLabel} finished`, {
          action: {
            label: 'Go to chat',
            onClick: () => navigate(`/project/${id}/chats/${chatId}`),
          },
        });
      } else if (isAwaitingInput(state.status) && !isAwaitingInput(prevState.status)) {
        haptics.notificationWarning();
        toast(`${chatLabel} needs input`, {
          action: {
            label: 'Go to chat',
            onClick: () => navigate(`/project/${id}/chats/${chatId}`),
          },
        });
      }
    }

    prevStatesRef.current = { ...sessionStates };
  }, [sessionStates, project, activeChatId, id, navigate]);

  async function handleNewChat() {
    try {
      const data = await api.post<{ chat: Chat }>(`/api/projects/${id}/chats`, { label: 'New Chat', adapter: project?.defaultAdapter });
      const created = data.chat;
      setProject(prev => {
        if (!prev || prev.id !== id) return prev;
        const rest = prev.chats.filter(c => c.id !== created.id);
        return { ...prev, chats: [created, ...rest] };
      });
      navigate(`/project/${id}/chats/${created.id}`, {
        state: { isNewChat: true, adapter: created.adapter },
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
        } else if (sessionStates[activeChatId]) {
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
        contextUsage={activeSessionState?.contextUsage}
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
              <ChatList projectId={id!} project={project} sessionStates={sessionStates} />
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
