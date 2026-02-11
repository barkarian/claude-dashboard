import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSocket } from '../../context/SocketContext.jsx';
import { useProject } from '../../context/ProjectContext.jsx';
import { useSDKMessages } from '../../hooks/useSDKMessages.ts';
import MessageList from './MessageList.tsx';
import SDKPromptInput from './SDKPromptInput.tsx';
import PermissionPrompt from './PermissionPrompt.tsx';
import QuestionPrompt from './QuestionPrompt.tsx';
import CostBadge from './CostBadge.tsx';
import type { SDKSessionStatus } from '../../../../shared/types/sdk.ts';

interface SDKChatViewProps {
  projectId: string;
}

export default function SDKChatView({ projectId }: SDKChatViewProps) {
  const { chatId } = useParams();
  const navigate = useNavigate();
  const { socket } = useSocket();
  const { project, refreshProject } = useProject();
  const refreshRef = useRef(refreshProject);
  refreshRef.current = refreshProject;

  const {
    messages,
    status,
    pendingPermission,
    pendingQuestion,
    lastResult,
    sendPrompt,
    respondToPermission,
    respondToQuestion,
    interrupt,
  } = useSDKMessages(socket, chatId);

  const [connecting, setConnecting] = useState(true);

  const chat = (project?.chats || []).find((c: any) => c.id === chatId);

  // Start or attach to SDK session on mount
  useEffect(() => {
    if (!socket || !chatId) return;

    setConnecting(true);

    socket.emit('sdk:check-session', { chatId }, (result: { exists: boolean; status?: SDKSessionStatus }) => {
      setConnecting(false);
      if (result.exists) {
        // Session already running, attach to get current state
        socket.emit('sdk:attach', { chatId });
      } else {
        // Start new session
        socket.emit('sdk:start', { projectId, chatId });
      }
    });
  }, [socket, chatId, projectId]);

  // Listen for chat rename events
  useEffect(() => {
    if (!socket || !chatId) return;

    function handleChatRenamed({ chatId: cid }: { chatId: string }) {
      if (cid !== chatId) return;
      refreshRef.current();
    }

    socket.on('claude:chat-renamed', handleChatRenamed);
    return () => {
      socket.off('claude:chat-renamed', handleChatRenamed);
    };
  }, [socket, chatId]);

  // Refresh project data when result arrives (history saved)
  useEffect(() => {
    if (lastResult) refreshRef.current();
  }, [lastResult]);

  function handleRestart() {
    if (!socket || !chatId) return;
    socket.emit('sdk:end', { chatId });
    setTimeout(() => {
      socket.emit('sdk:start', { projectId, chatId });
    }, 100);
  }

  const isActive = status !== 'disconnected' && status !== 'exited' && status !== 'error';

  const statusLabel = (() => {
    switch (status) {
      case 'streaming': return 'thinking';
      case 'tool-use': return 'working';
      case 'waiting-permission': return 'permission';
      default: return status;
    }
  })();

  const statusDotClass = (() => {
    switch (status) {
      case 'idle': return 'bg-success';
      case 'streaming':
      case 'tool-use': return 'bg-warning animate-pulse';
      case 'waiting-permission': return 'bg-primary animate-pulse';
      case 'starting': return 'bg-primary animate-pulse';
      default: return 'bg-text-dim';
    }
  })();

  return (
    <div className="flex flex-col h-[calc(100vh-7rem)]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border">
        <button
          onClick={() => navigate(`/project/${projectId}/chats`)}
          className="flex items-center gap-2 text-sm text-text-muted hover:text-text transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          {chat?.label || 'Chat'}
        </button>

        <div className="flex items-center gap-2">
          {/* End session button */}
          {isActive && (
            <button
              onClick={() => socket?.emit('sdk:end', { chatId })}
              className="flex items-center justify-center w-8 h-8 rounded-lg bg-bg-surface active:bg-bg-hover hover:bg-bg-hover text-text-muted transition-colors select-none touch-manipulation"
              aria-label="End session"
              title="End session"
            >
              <svg className="w-4 h-4 text-danger" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5.636 5.636a9 9 0 1012.728 0M12 3v9" />
              </svg>
            </button>
          )}

          {/* Status indicator */}
          <div className={`w-2 h-2 rounded-full ${statusDotClass}`} />
          <span className="text-xs text-text-muted capitalize">{statusLabel}</span>
        </div>
      </div>

      {/* Main content */}
      {connecting ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
            <p className="text-text-muted text-sm">Connecting...</p>
          </div>
        </div>
      ) : (
        <>
          {/* Messages (errors appear inline as chat bubbles) */}
          <MessageList messages={messages} />

          {/* Cost badge */}
          {lastResult && status === 'idle' && <CostBadge result={lastResult} />}

          {/* Permission prompt */}
          {pendingPermission && (
            <PermissionPrompt
              permission={pendingPermission}
              onRespond={respondToPermission}
            />
          )}

          {/* Question prompt (AskUserQuestion) */}
          {pendingQuestion && (
            <QuestionPrompt
              question={pendingQuestion}
              onRespond={respondToQuestion}
            />
          )}

          {/* Session ended / error bar */}
          {(status === 'exited' || status === 'error') && (
            <div className="px-4 py-2 border-t border-border flex items-center justify-between">
              <span className="text-xs text-text-muted">
                {status === 'error' ? 'Session error' : 'Session ended'}
              </span>
              <button onClick={handleRestart} className="text-xs text-primary hover:text-primary-hover font-medium">
                Restart
              </button>
            </div>
          )}

          {/* Input */}
          <SDKPromptInput
            projectId={projectId}
            status={status}
            onSend={sendPrompt}
            onInterrupt={interrupt}
          />
        </>
      )}
    </div>
  );
}
