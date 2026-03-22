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

  const { terminal, status, write, getPromptLine } = useClaudeCode(containerRef, {
    socket,
    projectId,
    chatId: chatId!,
    conversationId,
  });

  // Prompt suggestion: syncs terminal history recall into the textarea
  const [promptSuggestion, setPromptSuggestion] = useState<{ text: string; id: number } | null>(null);
  const suggestionIdRef = useRef(0);

  // Keep refs up to date for the swipe handler
  writeRef.current = write;
  const getPromptLineRef = useRef(getPromptLine);
  getPromptLineRef.current = getPromptLine;

  // Register swipe override: map swipe gestures to arrow keys + scroll to bottom
  useEffect(() => {
    ccSwipeOverride.current = (direction: 'up' | 'down' | 'left' | 'right') => {
      writeRef.current(ARROW_MAP[direction]);
      setTimeout(() => {
        terminal.current?.scrollToBottom();
        // After up/down swipe, extract prompt content into textarea
        if (direction === 'up' || direction === 'down') {
          const content = getPromptLineRef.current();
          suggestionIdRef.current++;
          setPromptSuggestion({ text: content, id: suggestionIdRef.current });
        }
      }, 150);
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
    // Clear the terminal's current line first (Ctrl+U) to avoid sending
    // both the history-recalled text and the new textarea text
    write('\x15' + data);
    terminal.current?.scrollToBottom();
    setPromptSuggestion(null);

    // Auto-title: on first real user message, rename the chat
    if (!firstMessageSentRef.current && chatId) {
      firstMessageSentRef.current = true;

      // Extract the text before the \r, trim whitespace
      const text = data.replace(/\r$/, '').trim();
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
    setTimeout(() => {
      terminal.current?.scrollToBottom();
      // After up/down arrow, extract prompt content into textarea
      if (data === '\x1b[A' || data === '\x1b[B') {
        const content = getPromptLine();
        suggestionIdRef.current++;
        setPromptSuggestion({ text: content, id: suggestionIdRef.current });
      }
    }, 150);
  }, [write, terminal, getPromptLine]);

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
