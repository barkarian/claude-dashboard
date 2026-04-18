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
      case 'session-search':
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
    ccSwipeOverride.scroll = (deltaY: number) => {
      // Manipulate the xterm viewport scrollTop directly for pixel-smooth scrolling
      // that follows the finger. scrollLines() jumps by whole rows and feels jerky.
      const viewport = terminal.current?.element?.querySelector<HTMLElement>('.xterm-viewport');
      if (viewport) {
        viewport.scrollTop += deltaY;
      } else {
        terminal.current?.scrollLines(Math.round(deltaY / 20));
      }
    };
    return () => {
      ccSwipeOverride.current = null;
      ccSwipeOverride.containerEl = null;
      ccSwipeOverride.scroll = null;
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
  const autoPeekedRef = useRef(false);
  const autoPeekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Arrow overlay computed values
  const showUp = allowedDirections.has('up');
  const showDown = allowedDirections.has('down');
  const showLeft = allowedDirections.has('left');
  const showRight = allowedDirections.has('right');
  const hasArrows = showUp || showDown || showLeft || showRight;
  const hasOverlayContent = hasArrows || terminalUIMode.mode === 'dismiss' || terminalUIMode.mode === 'detail-view';

  // Auto-peek the gesture tooltip the first time the arrow overlay appears in a session.
  // Collapses itself after 3s. Resets per mount so occasional users see it again.
  useEffect(() => {
    if (!native || !hasOverlayContent || autoPeekedRef.current) return;
    autoPeekedRef.current = true;
    setShowSwipeInfo(true);
    autoPeekTimerRef.current = setTimeout(() => {
      setShowSwipeInfo(false);
      autoPeekTimerRef.current = null;
    }, 3000);
    return () => {
      if (autoPeekTimerRef.current) {
        clearTimeout(autoPeekTimerRef.current);
        autoPeekTimerRef.current = null;
      }
    };
  }, [native, hasOverlayContent]);

  // Manual toggle: cancel any pending auto-close so the user's tap isn't overwritten.
  const toggleSwipeInfo = useCallback(() => {
    if (autoPeekTimerRef.current) {
      clearTimeout(autoPeekTimerRef.current);
      autoPeekTimerRef.current = null;
    }
    setShowSwipeInfo(prev => !prev);
  }, []);

  const arrowLabel = terminalUIMode.mode === 'multi-choice' ? 'Select'
    : terminalUIMode.mode === 'multi-choice-tabs' ? 'Navigate'
    : terminalUIMode.mode === 'plan-review' ? 'Plan'
    : terminalUIMode.mode === 'session-search' ? 'Sessions'
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

            {/* Gesture info icon + tooltip — tooltip expands horizontally to the right,
                keeping the arrow buttons above unobstructed and easy to tap. */}
            {native && (
              <div className="flex flex-row items-center gap-1.5 self-start">
                <button
                  type="button"
                  onClick={toggleSwipeInfo}
                  className="w-6 h-6 flex-shrink-0 flex items-center justify-center rounded-full bg-bg-surface/60 backdrop-blur-sm text-text-dim hover:text-primary transition-colors"
                  title="Gesture info"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.05 4.575a1.575 1.575 0 1 0-3.15 0v3m3.15-3v-1.5a1.575 1.575 0 0 1 3.15 0v1.5m-3.15 0 .075 5.925m3.075.75V4.575m0 0a1.575 1.575 0 0 1 3.15 0V15M6.9 7.575a1.575 1.575 0 1 0-3.15 0v8.175a6.75 6.75 0 0 0 6.75 6.75h2.018a5.25 5.25 0 0 0 3.712-1.538l1.732-1.732a5.25 5.25 0 0 0 1.538-3.712l.003-2.024a.668.668 0 0 1 .198-.471 1.575 1.575 0 1 0-2.228-2.228 3.818 3.818 0 0 0-1.12 2.7v.75" />
                  </svg>
                </button>
                {showSwipeInfo && (
                  <div className="bg-bg-surface/95 backdrop-blur-sm border border-border rounded-lg p-2 shadow-lg text-[10px] text-text-muted w-40">
                    <div className="text-[8px] font-semibold text-primary/80 uppercase tracking-wider mb-0.5">
                      Swipe · 1 finger
                    </div>
                    <div className="space-y-0.5">
                      <div>Up = Arrow Down</div>
                      <div>Down = Arrow Up</div>
                      <div>Left = Arrow Right</div>
                      <div>Right = Arrow Left</div>
                    </div>
                    <div className="border-t border-border/60 my-1.5" />
                    <div className="text-[8px] font-semibold text-primary/80 uppercase tracking-wider mb-0.5">
                      Scroll · 2 fingers
                    </div>
                    <div>Swipe up/down to scroll terminal history</div>
                  </div>
                )}
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
