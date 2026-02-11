import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useSocket } from '../../context/SocketContext.tsx';
import { useProject } from '../../context/ProjectContext.tsx';
import { useSDKMessages } from '../../hooks/useSDKMessages.ts';
import api from '../../utils/api.ts';
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
  const { socket } = useSocket();
  const { project, refreshProject, setActiveChatStatus } = useProject();
  const refreshRef = useRef(refreshProject);
  refreshRef.current = refreshProject;
  const hasUserMessageRef = useRef(false);

  const {
    messages,
    status,
    pendingPermission,
    pendingQuestion,
    lastResult,
    sendPrompt,
    respondToPermission,
    respondToQuestion,
    dismissQuestion,
    interrupt,
  } = useSDKMessages(socket, chatId);

  const [connecting, setConnecting] = useState(true);

  // Track whether any user message was sent
  useEffect(() => {
    if (messages.some((m) => m.role === 'user')) {
      hasUserMessageRef.current = true;
    }
  }, [messages]);

  // Reset tracking ref when chatId changes
  useEffect(() => {
    hasUserMessageRef.current = false;
  }, [chatId]);

  // Auto-delete empty chat on unmount
  useEffect(() => {
    const cid = chatId;
    const pid = projectId;
    return () => {
      if (!cid) return;
      if (hasUserMessageRef.current) return;
      // Check if chat label is still "New Chat"
      const chat = project?.chats?.find((c) => c.id === cid);
      if (!chat || chat.label !== 'New Chat') return;
      // Fire-and-forget cleanup
      if (socket) socket.emit('sdk:end', { chatId: cid });
      api.delete(`/api/projects/${pid}/chats/${cid}`).then(() => {
        refreshRef.current();
      }).catch(() => {});
    };
  }, [chatId, projectId, socket, project]);

  // Publish status to ProjectContext for the header
  useEffect(() => {
    setActiveChatStatus(status);
    return () => {
      setActiveChatStatus(null);
    };
  }, [status, setActiveChatStatus]);

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

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
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
              onDismiss={dismissQuestion}
            />
          )}

          {/* Session ended / error bar */}
          {(status === 'exited' || status === 'error') && (
            <div className="flex-shrink-0 px-4 py-2 border-t border-border flex items-center justify-between">
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
