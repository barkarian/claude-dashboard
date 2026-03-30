import { useRef, useEffect, useCallback, useMemo } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { useSocket } from '../../context/SocketContext.tsx';
import { useProject } from '../../context/ProjectContext.tsx';
import { useSearch, type SearchHandler } from '../../context/SearchContext.tsx';
import { useSessionStates } from '../../hooks/useSessionStatuses.ts';
import { useClaudeCode } from '../../hooks/useClaudeCode.ts';
import { useDraft } from '../../hooks/useDraft.ts';
import { ccSwipeOverride } from '../../utils/ccSwipeOverride.ts';
import CCPromptInput from './CCPromptInput.tsx';
import QuestionArrowOverlay from './QuestionArrowOverlay.tsx';

// ANSI escape sequences
const ARROW_MAP: Record<string, string> = {
  up: '\x1b[A',
  down: '\x1b[B',
  right: '\x1b[C',
  left: '\x1b[D',
};

interface ClaudeCodeChatViewProps {
  projectId: string;
}

export default function ClaudeCodeChatView({ projectId }: ClaudeCodeChatViewProps) {
  const { chatId } = useParams();
  const { socket } = useSocket();
  const location = useLocation();
  const { project, setProject, setActiveChatStatus, refreshProject } = useProject();
  const { registerHandler, unregisterHandler } = useSearch();
  const containerRef = useRef<HTMLDivElement>(null);
  const writeRef = useRef<(data: string) => void>(() => {});

  // Find chat to get sessionId for resume (unified, falls back to legacy ccConversationId)
  const chat = project?.chats?.find(c => c.id === chatId);
  const conversationId = chat?.sessionId || chat?.ccConversationId;
  const { updateDraft } = useDraft(projectId, chatId, setProject);
  const sessionStates = useSessionStates(projectId);
  const sessionState = chatId ? sessionStates[chatId] : undefined;
  const questionStatus = sessionState?.status === 'question-awaiting'
    ? 'single' as const
    : sessionState?.status === 'questions-awaiting'
      ? 'multiple' as const
      : null;

  const isNewChat = !!(location.state as { isNewChat?: boolean } | null)?.isNewChat;

  const handleDraftChange = useCallback((text: string) => {
    updateDraft(text);
  }, [updateDraft]);

  const { terminal, status, isSelectionMode, write, searchFindNext, searchFindPrevious, searchClear } = useClaudeCode(containerRef, {
    socket,
    projectId,
    chatId: chatId!,
    conversationId,
  });

  // Keep ref up to date for the swipe handler
  writeRef.current = write;

  // Register swipe override: map swipe gestures to arrow keys + scroll to bottom.
  // Also set containerEl so only swipes starting on the terminal trigger arrows.
  useEffect(() => {
    ccSwipeOverride.containerEl = containerRef.current?.parentElement || null;
    ccSwipeOverride.current = (direction: 'up' | 'down' | 'left' | 'right') => {
      writeRef.current(ARROW_MAP[direction]);
      setTimeout(() => terminal.current?.scrollToBottom(), 50);
    };
    return () => {
      ccSwipeOverride.current = null;
      ccSwipeOverride.containerEl = null;
    };
  }, [terminal]);

  // Register search handler for Ctrl+F
  const searchHandler = useMemo<SearchHandler>(() => ({
    findNext: (q, inc) => searchFindNext(q, inc),
    findPrevious: (q) => searchFindPrevious(q),
    clearSearch: () => searchClear(),
  }), [searchFindNext, searchFindPrevious, searchClear]);

  useEffect(() => {
    registerHandler(searchHandler);
    return () => unregisterHandler(searchHandler);
  }, [searchHandler, registerHandler, unregisterHandler]);

  // Publish status to ProjectContext for the header badge
  // JSONL watcher now handles detailed status; CC just reports running/exited
  useEffect(() => {
    if (status === 'running') {
      setActiveChatStatus('idle');
    } else if (status === 'exited') {
      setActiveChatStatus('exited');
    } else {
      setActiveChatStatus(null);
    }
    return () => {
      setActiveChatStatus(null);
    };
  }, [status, setActiveChatStatus]);

  const handleSend = useCallback((data: string) => {
    write(data);
    terminal.current?.scrollToBottom();
  }, [write]);

  // On desktop, auto-focus the terminal so keyboard input goes directly to xterm
  useEffect(() => {
    if (status === 'running' && window.innerWidth >= 768) {
      setTimeout(() => terminal.current?.focus(), 200);
    }
  }, [status]);

  const handleArrow = useCallback((data: string) => {
    write(data);
    setTimeout(() => terminal.current?.scrollToBottom(), 50);
  }, [write]);

  const handleInterrupt = useCallback(() => {
    write('\x03');
  }, [write]);

  function handleRestart() {
    if (!socket || !chatId) return;
    socket.emit('cc:stop', { chatId });
    setTimeout(() => {
      socket.emit('cc:start', {
        projectId,
        chatId,
        conversationId: conversationId || undefined,
        cols: terminal.current?.cols,
        rows: terminal.current?.rows,
      });
    }, 200);
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Conditional arrow overlay above terminal — mobile only, shown when question(s) awaiting */}
      {questionStatus && (
        <QuestionArrowOverlay
          multiple={questionStatus === 'multiple'}
          onArrow={handleArrow}
          disabled={status !== 'running'}
        />
      )}

      {/* Terminal wrapper: flex-1 for correct height, terminal positioned inside */}
      <div className="flex-1 overflow-hidden relative">
        <div ref={containerRef} className="absolute inset-0" />
      </div>

      {/* Status bar when exited */}
      {status === 'exited' && (
        <div className="flex-shrink-0 px-4 py-2 border-t border-border flex items-center justify-between">
          <span className="text-xs text-text-muted">Claude Code session ended</span>
          <button onClick={handleRestart} className="text-xs text-primary hover:text-primary-hover font-medium">
            Restart
          </button>
        </div>
      )}

      {status === 'error' && (
        <div className="flex-shrink-0 px-4 py-2 border-t border-border flex items-center justify-between">
          <span className="text-xs text-danger">Failed to start Claude Code. Make sure `claude` CLI is installed and on PATH.</span>
          <button onClick={handleRestart} className="text-xs text-primary hover:text-primary-hover font-medium">
            Retry
          </button>
        </div>
      )}

      {/* Prompt input with navigation controls — mobile only, hidden on desktop via CSS */}
      <div className="flex-shrink-0 md:hidden">
        <CCPromptInput
          key={chatId}
          projectId={projectId}
          status={status}
          isSelectionMode={isSelectionMode}
          onSend={handleSend}
          onArrow={handleArrow}
          onInterrupt={handleInterrupt}
          autoFocus={isNewChat}
          initialDraft={chat?.draftMessage || ''}
          onDraftChange={handleDraftChange}
        />
      </div>
    </div>
  );
}
