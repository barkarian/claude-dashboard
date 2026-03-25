import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { useSocket } from '../../context/SocketContext.tsx';
import { useProject } from '../../context/ProjectContext.tsx';
import { useSearch, type SearchHandler } from '../../context/SearchContext.tsx';
import { useSDKMessages } from '../../hooks/useSDKMessages.ts';
import { useDraft } from '../../hooks/useDraft.ts';
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
  const location = useLocation();
  const { project, setProject, refreshProject, setActiveChatStatus } = useProject();
  const refreshRef = useRef(refreshProject);
  refreshRef.current = refreshProject;

  const chat = project?.chats?.find(c => c.id === chatId);
  const { updateDraft } = useDraft(projectId, chatId, setProject);
  const { registerHandler, unregisterHandler } = useSearch();
  const messageListRef = useRef<HTMLDivElement>(null);

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

  // Determine autoFocus from navigation state (only set when explicitly creating a new chat)
  const isNewChat = !!(location.state as { isNewChat?: boolean } | null)?.isNewChat;

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

  // DOM-based search for SDK chat messages
  const marksRef = useRef<HTMLElement[]>([]);
  const currentIndexRef = useRef(-1);
  const lastQueryRef = useRef('');

  const clearMarks = useCallback(() => {
    marksRef.current.forEach(mark => {
      const parent = mark.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(mark.textContent || ''), mark);
        parent.normalize();
      }
    });
    marksRef.current = [];
    currentIndexRef.current = -1;
    lastQueryRef.current = '';
  }, []);

  const highlightMatches = useCallback((query: string) => {
    clearMarks();
    const container = messageListRef.current;
    if (!query || !container) return;

    const lowerQuery = query.toLowerCase();
    const textNodes: Text[] = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if ((node.textContent || '').toLowerCase().includes(lowerQuery)) {
        textNodes.push(node as Text);
      }
    }

    const newMarks: HTMLElement[] = [];
    textNodes.forEach(textNode => {
      const text = textNode.textContent || '';
      const lowerText = text.toLowerCase();
      const parent = textNode.parentNode;
      if (!parent) return;

      const frag = document.createDocumentFragment();
      let lastIndex = 0;
      let idx = 0;
      while ((idx = lowerText.indexOf(lowerQuery, lastIndex)) !== -1) {
        if (idx > lastIndex) {
          frag.appendChild(document.createTextNode(text.slice(lastIndex, idx)));
        }
        const mark = document.createElement('mark');
        mark.style.cssText = 'background: rgba(234, 179, 8, 0.3); border-radius: 2px; color: inherit;';
        mark.textContent = text.slice(idx, idx + query.length);
        frag.appendChild(mark);
        newMarks.push(mark);
        lastIndex = idx + query.length;
      }
      if (lastIndex < text.length) {
        frag.appendChild(document.createTextNode(text.slice(lastIndex)));
      }
      parent.replaceChild(frag, textNode);
    });

    marksRef.current = newMarks;
    lastQueryRef.current = query;
  }, [clearMarks]);

  const scrollToMark = useCallback((index: number) => {
    const marks = marksRef.current;
    if (index < 0 || index >= marks.length) return;
    marks.forEach(m => m.style.background = 'rgba(234, 179, 8, 0.3)');
    marks[index].style.background = 'rgba(234, 179, 8, 0.7)';
    marks[index].scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  const searchHandler = useMemo<SearchHandler>(() => ({
    findNext(query: string, incremental?: boolean) {
      if (query.toLowerCase() !== lastQueryRef.current.toLowerCase() || incremental || !marksRef.current.some(m => m.isConnected)) {
        highlightMatches(query);
      }
      if (marksRef.current.length === 0) return false;
      currentIndexRef.current = (currentIndexRef.current + 1) % marksRef.current.length;
      scrollToMark(currentIndexRef.current);
      return true;
    },
    findPrevious(query: string) {
      if (query.toLowerCase() !== lastQueryRef.current.toLowerCase() || !marksRef.current.some(m => m.isConnected)) {
        highlightMatches(query);
      }
      if (marksRef.current.length === 0) return false;
      currentIndexRef.current = currentIndexRef.current <= 0 ? marksRef.current.length - 1 : currentIndexRef.current - 1;
      scrollToMark(currentIndexRef.current);
      return true;
    },
    clearSearch: clearMarks,
  }), [highlightMatches, scrollToMark, clearMarks]);

  useEffect(() => {
    registerHandler(searchHandler);
    return () => {
      clearMarks();
      unregisterHandler(searchHandler);
    };
  }, [searchHandler, registerHandler, unregisterHandler, clearMarks]);

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
          <MessageList ref={messageListRef} messages={messages} />

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
            key={chatId}
            projectId={projectId}
            status={status}
            onSend={sendPrompt}
            onInterrupt={interrupt}
            autoFocus={isNewChat}
            initialDraft={chat?.draftMessage || ''}
            onDraftChange={updateDraft}
          />
        </>
      )}
    </div>
  );
}
