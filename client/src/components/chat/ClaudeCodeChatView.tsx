import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { useSocket } from '../../context/SocketContext.tsx';
import { useProject } from '../../context/ProjectContext.tsx';
import { useSearch, type SearchHandler } from '../../context/SearchContext.tsx';
import { useSessionStates } from '../../hooks/useSessionStatuses.ts';
import { useClaudeCode } from '../../hooks/useClaudeCode.ts';
import { useDraft } from '../../hooks/useDraft.ts';
import { ccSwipeOverride, type SwipeDirection } from '../../utils/ccSwipeOverride.ts';
import { haptics } from '../../utils/haptics.ts';
import { isCapacitorNative } from '../../utils/platform.ts';
import CCPromptInput from './CCPromptInput.tsx';

// ANSI escape sequences
const ARROW_MAP: Record<string, string> = {
  up: '\x1b[A',
  down: '\x1b[B',
  right: '\x1b[C',
  left: '\x1b[D',
};
const ARROW_UP = '\x1b[A';
const ARROW_DOWN = '\x1b[B';
const ARROW_RIGHT = '\x1b[C';
const ARROW_LEFT = '\x1b[D';

interface ClaudeCodeChatViewProps {
  projectId: string;
}

export default function ClaudeCodeChatView({ projectId }: ClaudeCodeChatViewProps) {
  const { chatId } = useParams();
  const { socket } = useSocket();
  const location = useLocation();
  const { project, setProject, refreshProject } = useProject();
  const { registerHandler, unregisterHandler } = useSearch();
  const containerRef = useRef<HTMLDivElement>(null);
  const writeRef = useRef<(data: string) => void>(() => {});

  // Find chat to get sessionId for resume (unified, falls back to legacy ccConversationId)
  const chat = project?.chats?.find(c => c.id === chatId);
  const conversationId = chat?.sessionId || chat?.ccConversationId;
  const { updateDraft } = useDraft(projectId, chatId, setProject);
  const sessionStates = useSessionStates(projectId);
  const sessionState = chatId ? sessionStates[chatId] : undefined;

  const isNewChat = !!(location.state as { isNewChat?: boolean } | null)?.isNewChat;

  const handleDraftChange = useCallback((text: string) => {
    updateDraft(text);
  }, [updateDraft]);

  const { terminal, status, terminalUIMode, write, searchFindNext, searchFindPrevious, searchClear } = useClaudeCode(containerRef, {
    socket,
    projectId,
    chatId: chatId!,
    conversationId,
  });

  // Keep ref up to date for the swipe handler
  writeRef.current = write;

  // Compute allowed arrow/swipe directions based on terminal UI mode + session state
  const allowedDirections = useMemo<Set<SwipeDirection>>(() => {
    const dirs = new Set<SwipeDirection>();
    const m = terminalUIMode.mode;

    // Terminal UI mode takes priority over JSONL session state
    switch (m) {
      case 'detail-view':
        dirs.add('left');
        return dirs;
      case 'dismiss':
        return dirs; // no arrows, just action button
      case 'multi-choice':
      case 'plan-review':
        dirs.add('up');
        dirs.add('down');
        return dirs;
      case 'multi-choice-tabs':
        dirs.add('up');
        dirs.add('down');
        dirs.add('left');
        dirs.add('right');
        return dirs;
      case 'text-input':
      case 'free-prompt':
        return dirs; // no arrows, user is typing
      case 'none':
        break; // fall through to JSONL-based logic
    }

    // Fallback: use JSONL session state
    const unifiedStatus = sessionState?.status;
    switch (unifiedStatus) {
      case 'question-awaiting':
        dirs.add('up');
        dirs.add('down');
        break;
      case 'questions-awaiting':
        dirs.add('up');
        dirs.add('down');
        dirs.add('left');
        dirs.add('right');
        break;
      case 'plan-awaiting':
      case 'permission-awaiting':
        dirs.add('up');
        dirs.add('down');
        break;
      case 'working':
      case 'idle':
        if (sessionState?.hasBackgroundTasks) {
          dirs.add('down');
          dirs.add('left');
          dirs.add('right');
        }
        break;
    }
    return dirs;
  }, [sessionState?.status, sessionState?.hasBackgroundTasks, terminalUIMode]);

  // Register swipe override: map swipe gestures to arrow keys + scroll to bottom.
  // Also set containerEl so only swipes starting on the terminal trigger arrows.
  useEffect(() => {
    ccSwipeOverride.containerEl = containerRef.current?.parentElement || null;
    ccSwipeOverride.current = (direction: SwipeDirection) => {
      writeRef.current(ARROW_MAP[direction]);
      setTimeout(() => terminal.current?.scrollToBottom(), 50);
    };
    return () => {
      ccSwipeOverride.current = null;
      ccSwipeOverride.containerEl = null;
    };
  }, [terminal]);

  // Sync allowed swipe directions
  useEffect(() => {
    ccSwipeOverride.allowedDirections = allowedDirections;
  }, [allowedDirections]);

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

  const native = isCapacitorNative();
  const [showSwipeInfo, setShowSwipeInfo] = useState(false);

  // Arrow overlay computed values
  const showUp = allowedDirections.has('up');
  const showDown = allowedDirections.has('down');
  const showLeft = allowedDirections.has('left');
  const showRight = allowedDirections.has('right');
  const hasArrows = showUp || showDown || showLeft || showRight;
  const hasOverlayContent = hasArrows || terminalUIMode.mode === 'dismiss' || terminalUIMode.mode === 'detail-view';

  const arrowLabel = terminalUIMode.mode === 'multi-choice' ? 'Select'
    : terminalUIMode.mode === 'multi-choice-tabs' ? 'Navigate'
    : terminalUIMode.mode === 'plan-review' ? 'Plan'
    : sessionState?.status === 'permission-awaiting' ? 'Permission'
    : hasArrows ? 'Tasks'
    : '';

  function overlayBtn(seq: string) {
    if (status !== 'running') return;
    haptics.impactLight();
    handleArrow(seq);
  }

  const overlayBtnBase = 'flex items-center justify-center rounded-lg bg-bg-surface/70 border border-border/50 text-text-muted active:bg-bg-surface/90 transition-colors backdrop-blur-sm disabled:opacity-30';

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Terminal wrapper: flex-1 for correct height, terminal positioned inside */}
      <div className="flex-1 overflow-hidden relative">
        <div ref={containerRef} className="absolute inset-0" />

        {/* Floating arrow overlay — top-left corner of terminal, mobile only */}
        {hasOverlayContent && (
          <div className="absolute top-2 left-2 z-30 flex flex-col items-center gap-1 md:hidden">
            {/* Action buttons for terminal prompts */}
            {terminalUIMode.mode === 'dismiss' && (
              <button
                type="button"
                onClick={() => overlayBtn(' ')}
                disabled={status !== 'running'}
                className="px-3 py-1.5 rounded-lg text-[11px] font-medium text-white bg-primary/80 backdrop-blur-sm active:bg-primary transition-colors disabled:opacity-30"
              >
                Dismiss
              </button>
            )}
            {terminalUIMode.mode === 'detail-view' && (
              <button
                type="button"
                onClick={() => overlayBtn(ARROW_LEFT)}
                disabled={status !== 'running'}
                className="px-3 py-1.5 rounded-lg text-[11px] font-medium text-white bg-primary/80 backdrop-blur-sm active:bg-primary transition-colors disabled:opacity-30 flex items-center gap-1"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                </svg>
                Go Back
              </button>
            )}

            {/* Arrow label */}
            {terminalUIMode.mode !== 'dismiss' && terminalUIMode.mode !== 'detail-view' && hasArrows && (
              <span className="text-[8px] font-semibold text-primary/80 uppercase tracking-wider">
                {arrowLabel}
              </span>
            )}

            {/* Arrow buttons */}
            {terminalUIMode.mode !== 'dismiss' && terminalUIMode.mode !== 'detail-view' && hasArrows && (
              <div className="flex items-center gap-0.5">
                {showLeft && (
                  <button type="button" onClick={() => overlayBtn(ARROW_LEFT)} disabled={status !== 'running'} className={`w-8 h-8 ${overlayBtnBase}`}>
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                    </svg>
                  </button>
                )}
                {(showUp || showDown) && (
                  <div className="flex flex-col gap-0.5">
                    {showUp && (
                      <button type="button" onClick={() => overlayBtn(ARROW_UP)} disabled={status !== 'running'} className={`w-8 h-6 ${overlayBtnBase}`}>
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
                        </svg>
                      </button>
                    )}
                    {showDown && (
                      <button type="button" onClick={() => overlayBtn(ARROW_DOWN)} disabled={status !== 'running'} className={`w-8 h-6 ${overlayBtnBase}`}>
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                        </svg>
                      </button>
                    )}
                  </div>
                )}
                {showRight && (
                  <button type="button" onClick={() => overlayBtn(ARROW_RIGHT)} disabled={status !== 'running'} className={`w-8 h-8 ${overlayBtnBase}`}>
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                    </svg>
                  </button>
                )}
              </div>
            )}

            {/* Swipe info icon — center of overlay */}
            {native && (
              <button
                type="button"
                onClick={() => setShowSwipeInfo(prev => !prev)}
                className="w-6 h-6 flex items-center justify-center rounded-full bg-bg-surface/60 backdrop-blur-sm text-text-dim hover:text-primary transition-colors"
                title="Swipe gesture info"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
                </svg>
              </button>
            )}

            {/* Swipe info tooltip */}
            {native && showSwipeInfo && (
              <div className="bg-bg-surface/90 backdrop-blur-sm border border-border rounded-lg p-2 shadow-lg text-[10px] text-text-muted w-36">
                <div className="space-y-0.5">
                  <div>Swipe up = Arrow Down</div>
                  <div>Swipe down = Arrow Up</div>
                  <div>Swipe left = Arrow Right</div>
                  <div>Swipe right = Arrow Left</div>
                </div>
              </div>
            )}
          </div>
        )}
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
          terminalUIMode={terminalUIMode}
          unifiedStatus={sessionState?.status}
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
