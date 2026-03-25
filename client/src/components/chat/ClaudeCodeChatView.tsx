import { useRef, useState, useEffect, useCallback } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { useSocket } from '../../context/SocketContext.tsx';
import { useProject } from '../../context/ProjectContext.tsx';
import { useClaudeCode } from '../../hooks/useClaudeCode.ts';
import { useDraft } from '../../hooks/useDraft.ts';
import { ccSwipeOverride } from '../../utils/ccSwipeOverride.ts';
import api from '../../utils/api.ts';
import CCPromptInput from './CCPromptInput.tsx';

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
  const containerRef = useRef<HTMLDivElement>(null);
  const writeRef = useRef<(data: string) => void>(() => {});
  const firstMessageSentRef = useRef(false);
  const refreshRef = useRef(refreshProject);
  refreshRef.current = refreshProject;

  // Find chat to get conversationId for resume
  const chat = project?.chats?.find(c => c.id === chatId);
  const conversationId = chat?.ccConversationId;
  const { updateDraft } = useDraft(projectId, chatId, setProject);

  const isNewChat = !!(location.state as { isNewChat?: boolean } | null)?.isNewChat;

  // Track whether this chat already has a real title (not "New Chat")
  const hasTitle = chat && chat.label !== 'New Chat';

  // --- Stashed input: preserves prompt text during history navigation ---
  const currentPromptRef = useRef(chat?.draftMessage || '');
  const stashedInputRef = useRef(chat?.stashedInput || '');
  const isNavigatingRef = useRef(false);

  // Sync refs when chat data loads asynchronously (e.g. after context refresh)
  useEffect(() => {
    if (!currentPromptRef.current && chat?.draftMessage) {
      currentPromptRef.current = chat.draftMessage;
    }
  }, [chat?.draftMessage]);

  useEffect(() => {
    if (!stashedInputRef.current && chat?.stashedInput) {
      stashedInputRef.current = chat.stashedInput;
    }
  }, [chat?.stashedInput]);

  // Wrap draft change to also track current prompt text
  const handleDraftChange = useCallback((text: string) => {
    currentPromptRef.current = text;
    // User is typing — exit navigation mode
    isNavigatingRef.current = false;
    updateDraft(text);
  }, [updateDraft]);

  const saveStashedInput = useCallback((text: string) => {
    if (!chatId) return;
    stashedInputRef.current = text;
    api.put(`/api/projects/${projectId}/chats/${chatId}/stashed-input`, { text }).catch(() => {});
    setProject(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        chats: prev.chats.map(c =>
          c.id === chatId ? { ...c, stashedInput: text || null } : c
        ),
      };
    });
  }, [projectId, chatId, setProject]);

  // Auto-title: on first real user message, rename the chat.
  // Shared by both mobile (CCPromptInput handleSend) and desktop (direct xterm input).
  const autoTitle = useCallback((text: string) => {
    if (!firstMessageSentRef.current && chatId) {
      firstMessageSentRef.current = true;
      const trimmed = text.trim();
      if (trimmed) {
        const newLabel = trimmed.slice(0, 50) + (trimmed.length > 50 ? '...' : '');
        api.patch(`/api/projects/${projectId}/chats/${chatId}`, { label: newLabel })
          .then(() => refreshRef.current())
          .catch(() => {});
      }
    }
  }, [chatId, projectId]);

  const { terminal, status, isThinking, isSelectionMode, write, getPromptLine, onNextOutput } = useClaudeCode(containerRef, {
    socket,
    projectId,
    chatId: chatId!,
    conversationId,
    onTerminalSubmit: autoTitle,
  });

  // Prompt suggestion: syncs terminal history recall into the textarea
  const [promptSuggestion, setPromptSuggestion] = useState<{ text: string; id: number } | null>(null);
  const suggestionIdRef = useRef(0);
  // Ref mirrors state so handleSend can read it without a dependency
  const promptSuggestionRef = useRef(promptSuggestion);
  promptSuggestionRef.current = promptSuggestion;

  // Clear stale suggestion when navigating between chats (component is reused by React Router)
  useEffect(() => {
    setPromptSuggestion(null);
  }, [chatId]);

  // Keep refs up to date for the swipe handler
  writeRef.current = write;
  const getPromptLineRef = useRef(getPromptLine);
  getPromptLineRef.current = getPromptLine;
  const onNextOutputRef = useRef(onNextOutput);
  onNextOutputRef.current = onNextOutput;

  // Shared logic: handle terminal output after history navigation
  const handleHistoryOutput = useCallback((content: string) => {
    if (!content && stashedInputRef.current) {
      // Reached end of history — restore stashed input
      const stashed = stashedInputRef.current;
      saveStashedInput('');
      isNavigatingRef.current = false;
      suggestionIdRef.current++;
      setPromptSuggestion({ text: stashed, id: suggestionIdRef.current });
    } else {
      suggestionIdRef.current++;
      setPromptSuggestion({ text: content, id: suggestionIdRef.current });
    }
  }, [saveStashedInput]);

  // Shared logic: stash current prompt on first navigation
  const stashIfNeeded = useCallback(() => {
    if (!isNavigatingRef.current && currentPromptRef.current) {
      saveStashedInput(currentPromptRef.current);
    }
    isNavigatingRef.current = true;
  }, [saveStashedInput]);

  // Register swipe override: map swipe gestures to arrow keys + scroll to bottom.
  // Also set containerEl so only swipes starting on the terminal trigger arrows.
  useEffect(() => {
    // The terminal wrapper is containerRef's parent (div.flex-1.overflow-hidden.relative)
    ccSwipeOverride.containerEl = containerRef.current?.parentElement || null;
    ccSwipeOverride.current = (direction: 'up' | 'down' | 'left' | 'right') => {
      writeRef.current(ARROW_MAP[direction]);
      if (direction === 'up' || direction === 'down') {
        stashIfNeeded();
        onNextOutputRef.current(() => {
          terminal.current?.scrollToBottom();
          const content = getPromptLineRef.current();
          handleHistoryOutput(content);
        });
      } else {
        setTimeout(() => terminal.current?.scrollToBottom(), 50);
      }
    };
    return () => {
      ccSwipeOverride.current = null;
      ccSwipeOverride.containerEl = null;
    };
  }, [terminal, stashIfNeeded, handleHistoryOutput]);

  // Publish status to ProjectContext for the header badge
  useEffect(() => {
    if (status === 'running') {
      setActiveChatStatus(isThinking ? 'streaming' : 'idle');
    } else if (status === 'exited') {
      setActiveChatStatus('exited');
    } else {
      setActiveChatStatus(null);
    }
    return () => {
      setActiveChatStatus(null);
    };
  }, [status, isThinking, setActiveChatStatus]);

  const handleSend = useCallback((data: string) => {
    const userText = data.replace(/\r$/, '');
    const suggestion = promptSuggestionRef.current?.text ?? '';

    if (promptSuggestionRef.current && suggestion) {
      // Double-Escape clears Claude Code's prompt input.
      // Send Escapes separately so the second ESC doesn't combine with
      // the first char of data into an escape sequence (e.g. ESC H).
      write('\x1b\x1b');
      setTimeout(() => {
        write(data);
        terminal.current?.scrollToBottom();
      }, 50);
    } else {
      write(data);
    }

    terminal.current?.scrollToBottom();
    setPromptSuggestion(null);

    // Clear stashed input and navigation state on send
    if (stashedInputRef.current) {
      saveStashedInput('');
    }
    isNavigatingRef.current = false;

    // Auto-title on first message (mobile path — desktop uses onTerminalSubmit)
    autoTitle(userText);
  }, [write, autoTitle, saveStashedInput]);

  // If chat already has a title, mark first message as already sent
  useEffect(() => {
    if (hasTitle) {
      firstMessageSentRef.current = true;
    }
  }, [hasTitle]);

  // On desktop, auto-focus the terminal so keyboard input goes directly to xterm
  useEffect(() => {
    if (status === 'running' && window.innerWidth >= 768) {
      setTimeout(() => terminal.current?.focus(), 200);
    }
  }, [status]);

  const handleArrow = useCallback((data: string) => {
    write(data);
    if (data === '\x1b[A' || data === '\x1b[B') {
      stashIfNeeded();
      // Wait for actual terminal output, then extract prompt content
      onNextOutput(() => {
        terminal.current?.scrollToBottom();
        const content = getPromptLine();
        handleHistoryOutput(content);
      });
    } else {
      setTimeout(() => terminal.current?.scrollToBottom(), 50);
    }
  }, [write, terminal, getPromptLine, onNextOutput, stashIfNeeded, handleHistoryOutput]);

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
          promptSuggestion={promptSuggestion}
          initialDraft={chat?.draftMessage || ''}
          onDraftChange={handleDraftChange}
        />
      </div>
    </div>
  );
}
