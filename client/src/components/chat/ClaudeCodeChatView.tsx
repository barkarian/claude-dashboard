import { useRef, useState, useEffect, useCallback } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { useSocket } from '../../context/SocketContext.tsx';
import { useProject } from '../../context/ProjectContext.tsx';
import { useClaudeCode } from '../../hooks/useClaudeCode.ts';
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
  const { project, setActiveChatStatus, refreshProject } = useProject();
  const containerRef = useRef<HTMLDivElement>(null);
  const writeRef = useRef<(data: string) => void>(() => {});
  const firstMessageSentRef = useRef(false);
  const refreshRef = useRef(refreshProject);
  refreshRef.current = refreshProject;

  // Find chat to get conversationId for resume
  const chat = project?.chats?.find(c => c.id === chatId);
  const conversationId = chat?.ccConversationId;

  const isNewChat = !!(location.state as { isNewChat?: boolean } | null)?.isNewChat;

  // Track whether this chat already has a real title (not "New Chat")
  const hasTitle = chat && chat.label !== 'New Chat';

  const { terminal, status, write, getPromptLine, onNextOutput } = useClaudeCode(containerRef, {
    socket,
    projectId,
    chatId: chatId!,
    conversationId,
  });

  // Prompt suggestion: syncs terminal history recall into the textarea
  const [promptSuggestion, setPromptSuggestion] = useState<{ text: string; id: number } | null>(null);
  const suggestionIdRef = useRef(0);
  // Ref mirrors state so handleSend can read it without a dependency
  const promptSuggestionRef = useRef(promptSuggestion);
  promptSuggestionRef.current = promptSuggestion;

  // Keep refs up to date for the swipe handler
  writeRef.current = write;
  const getPromptLineRef = useRef(getPromptLine);
  getPromptLineRef.current = getPromptLine;
  const onNextOutputRef = useRef(onNextOutput);
  onNextOutputRef.current = onNextOutput;

  // Register swipe override: map swipe gestures to arrow keys + scroll to bottom
  useEffect(() => {
    ccSwipeOverride.current = (direction: 'up' | 'down' | 'left' | 'right') => {
      writeRef.current(ARROW_MAP[direction]);
      if (direction === 'up' || direction === 'down') {
        // Wait for actual terminal output, then extract prompt content
        onNextOutputRef.current(() => {
          terminal.current?.scrollToBottom();
          const content = getPromptLineRef.current();
          suggestionIdRef.current++;
          setPromptSuggestion({ text: content, id: suggestionIdRef.current });
        });
      } else {
        setTimeout(() => terminal.current?.scrollToBottom(), 50);
      }
    };
    return () => {
      ccSwipeOverride.current = null;
    };
  }, [terminal]);

  // Publish status to ProjectContext for the header badge
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
    const userText = data.replace(/\r$/, '');
    const suggestion = promptSuggestionRef.current?.text ?? '';

    if (promptSuggestionRef.current && userText === suggestion) {
      // Text unchanged from history recall — it's already in the terminal,
      // just press Enter instead of re-typing it
      write('\r');
    } else if (promptSuggestionRef.current && suggestion) {
      // User edited the recalled text — delete the original with backspaces,
      // then type the new text
      write('\x7f'.repeat(suggestion.length) + data);
    } else {
      // No active suggestion — fresh input, write normally
      write(data);
    }

    terminal.current?.scrollToBottom();
    setPromptSuggestion(null);

    // Auto-title: on first real user message, rename the chat
    if (!firstMessageSentRef.current && chatId) {
      firstMessageSentRef.current = true;

      const text = userText.trim();
      if (text && text.length > 0) {
        const newLabel = text.slice(0, 50) + (text.length > 50 ? '...' : '');
        api.patch(`/api/projects/${projectId}/chats/${chatId}`, { label: newLabel })
          .then(() => refreshRef.current())
          .catch(() => {});
      }
    }
  }, [write, chatId, projectId]);

  // If chat already has a title, mark first message as already sent
  useEffect(() => {
    if (hasTitle) {
      firstMessageSentRef.current = true;
    }
  }, [hasTitle]);

  const handleArrow = useCallback((data: string) => {
    write(data);
    if (data === '\x1b[A' || data === '\x1b[B') {
      // Wait for actual terminal output, then extract prompt content
      onNextOutput(() => {
        terminal.current?.scrollToBottom();
        const content = getPromptLine();
        suggestionIdRef.current++;
        setPromptSuggestion({ text: content, id: suggestionIdRef.current });
      });
    } else {
      setTimeout(() => terminal.current?.scrollToBottom(), 50);
    }
  }, [write, terminal, getPromptLine, onNextOutput]);

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

      {/* Prompt input with navigation controls */}
      <CCPromptInput
        projectId={projectId}
        status={status}
        onSend={handleSend}
        onArrow={handleArrow}
        onInterrupt={handleInterrupt}
        autoFocus={isNewChat}
        promptSuggestion={promptSuggestion}
      />
    </div>
  );
}
