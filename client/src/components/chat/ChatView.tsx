import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSocket } from '../../context/SocketContext.jsx';
import { useProject } from '../../context/ProjectContext.jsx';
import { useInteractive } from '../../hooks/useInteractive.ts';
import * as terminalStore from '../../lib/terminalStore.ts';
import ClaudeOutput from './ClaudeOutput.jsx';
import PromptInput from './PromptInput.jsx';
import type { SessionStatus } from '../../../../shared/types/interactive.ts';

interface ChatViewProps {
  projectId: string;
}

export default function ChatView({ projectId }: ChatViewProps) {
  const { chatId } = useParams();
  const navigate = useNavigate();
  const { socket } = useSocket();
  const { project, refreshProject } = useProject();
  const [status, setStatus] = useState<SessionStatus | 'disconnected'>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(true);
  const refreshRef = useRef(refreshProject);
  refreshRef.current = refreshProject;
  const { interactiveState, sendKeyPress, sendTextResponse, writeToTerminal } = useInteractive(socket, chatId);

  const isTerminalBound = interactiveState?.type === 'text-input';
  const isOptionMode = interactiveState?.type === 'selection-menu';

  const chat = (project?.chats || []).find((c: any) => c.id === chatId);

  function startSession() {
    if (!socket || !chatId) return;
    setError(null);
    setStatus('starting');
    socket.emit('claude:start', { projectId, chatId });
  }

  function handleRestart() {
    if (!chatId) return;
    terminalStore.dispose(chatId);
    startSession();
  }

  // Auto-start: check for existing session on mount, then attach or start.
  // If a cached terminal exists, show it immediately (no spinner).
  useEffect(() => {
    if (!socket || !chatId) return;

    const hasCached = terminalStore.has(chatId);

    if (hasCached) {
      // Cached terminal — render it instantly, check session in background
      setConnecting(false);
      setStatus('idle'); // temporary until check-session responds
      setError(null);
    } else {
      setConnecting(true);
      setError(null);
    }

    socket.emit('claude:check-session', { chatId }, (result: { exists: boolean; status?: SessionStatus }) => {
      if (hasCached) {
        if (result.exists && result.status) {
          setStatus(result.status);
        } else {
          // Session died while we were away — dispose stale terminal and restart
          terminalStore.dispose(chatId);
          startSession();
        }
      } else {
        setConnecting(false);
        if (result.exists && result.status) {
          setStatus(result.status);
        } else {
          startSession();
        }
      }
    });
  }, [socket, chatId]);

  // Register socket handlers
  useEffect(() => {
    if (!socket || !chatId) return;

    function handleStatus({ chatId: cid, status: s }: { chatId: string; status: SessionStatus }) {
      if (cid !== chatId) return;
      setStatus(s);
    }

    function handleError({ chatId: cid, error: err }: { chatId: string; error: string }) {
      if (cid !== chatId) return;
      setStatus((prev) => {
        if (prev === 'starting' || prev === 'disconnected') {
          setError(err);
          return 'disconnected';
        }
        console.warn('[claude:error]', err);
        return prev;
      });
    }

    function handleResponseComplete({ chatId: cid }: { chatId: string }) {
      if (cid !== chatId) return;
      refreshRef.current();
    }

    function handleChatRenamed({ chatId: cid }: { chatId: string; label: string }) {
      if (cid !== chatId) return;
      refreshRef.current();
    }

    socket.on('claude:status', handleStatus);
    socket.on('claude:error', handleError);
    socket.on('claude:response-complete', handleResponseComplete);
    socket.on('claude:chat-renamed', handleChatRenamed);

    return () => {
      socket.off('claude:status', handleStatus);
      socket.off('claude:error', handleError);
      socket.off('claude:response-complete', handleResponseComplete);
      socket.off('claude:chat-renamed', handleChatRenamed);
    };
  }, [socket, chatId]);

  function handleSend(prompt: string) {
    if (!socket || status === 'thinking') return;
    const promptId = Date.now().toString();
    socket.emit('claude:send', { chatId, prompt, promptId });
  }

  function handleCancel() {
    // Escape interrupts Claude Code CLI thinking (not Ctrl+C)
    sendKeyPress('Escape');
  }

  function handleKillSession() {
    // Double Ctrl+C to force-exit the CLI session
    socket?.emit('claude:kill-session', { chatId });
  }

  // Real-time terminal binding: send character diffs to the pty as the user types
  function handleTextInputChange(newValue: string, oldValue: string) {
    let commonLen = 0;
    while (commonLen < oldValue.length && commonLen < newValue.length && oldValue[commonLen] === newValue[commonLen]) {
      commonLen++;
    }
    const backspaces = oldValue.length - commonLen;
    if (backspaces > 0) writeToTerminal('\x7f'.repeat(backspaces));
    const additions = newValue.slice(commonLen);
    if (additions) writeToTerminal(additions);
  }

  function handleTextInputSend(_text: string) {
    sendTextResponse('');
  }

  // In option mode, "Select" confirms the highlighted option
  function handleSelect() {
    sendKeyPress('Enter');
  }

  const isActive = status !== 'disconnected' && status !== 'exited' && status !== 'starting';

  const headerBtnClass = 'flex items-center justify-center w-8 h-8 rounded-lg bg-bg-surface active:bg-bg-hover hover:bg-bg-hover text-text-muted transition-colors select-none touch-manipulation';

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
          {/* Swap mode (Shift+Tab) — always visible when active */}
          {isActive && (
            <button
              onClick={() => sendKeyPress('ShiftTab')}
              className={headerBtnClass}
              aria-label="Switch mode (Shift+Tab)"
              title="Switch mode (Shift+Tab)"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
              </svg>
            </button>
          )}

          {/* Left/Right arrows — only when option selection is active */}
          {isActive && isOptionMode && (
            <>
              <button
                onClick={() => sendKeyPress('ArrowLeft')}
                className={headerBtnClass}
                aria-label="Arrow Left"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <button
                onClick={() => sendKeyPress('ArrowRight')}
                className={headerBtnClass}
                aria-label="Arrow Right"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </>
          )}

          {/* Kill session */}
          {isActive && (
            <button
              onClick={handleKillSession}
              className={headerBtnClass}
              aria-label="Kill session (double Ctrl+C)"
              title="Kill session"
            >
              <svg className="w-4 h-4 text-danger" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5.636 5.636a9 9 0 1012.728 0M12 3v9" />
              </svg>
            </button>
          )}

          {/* Status indicator */}
          <div className={`w-2 h-2 rounded-full ${
            status === 'idle' || status === 'waiting-input' ? 'bg-success' :
            status === 'thinking' ? 'bg-warning animate-pulse' :
            status === 'starting' ? 'bg-primary animate-pulse' :
            'bg-text-dim'
          }`} />
          <span className="text-xs text-text-muted capitalize">{status === 'waiting-input' ? 'idle' : status}</span>
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
      ) : error ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="text-danger text-sm bg-danger/10 px-4 py-3 rounded-lg inline-block mb-3">
              {error}
            </div>
            <br />
            <button onClick={handleRestart} className="btn-primary mt-2">
              Retry
            </button>
          </div>
        </div>
      ) : status === 'starting' ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
            <p className="text-text-muted text-sm">Starting Claude Code session...</p>
          </div>
        </div>
      ) : (
        <>
          {/* Terminal output */}
          <div className="flex-1 overflow-hidden">
            <ClaudeOutput chatId={chatId} socket={socket} />
          </div>

          {/* Session ended bar */}
          {status === 'exited' && (
            <div className="px-4 py-2 border-t border-border flex items-center justify-between">
              <span className="text-xs text-text-muted">Session ended</span>
              <button onClick={handleRestart} className="text-xs text-primary hover:text-primary-hover font-medium">
                Restart
              </button>
            </div>
          )}

          {/* Text-input prompt label (from buffer analyzer) */}
          {isTerminalBound && interactiveState?.prompt && (
            <div className="px-4 pt-2 border-t border-border">
              <span className="text-xs text-text-muted font-medium">{interactiveState.prompt}</span>
            </div>
          )}

          {/* Prompt input — always visible */}
          <PromptInput
            projectId={projectId}
            onSend={isTerminalBound ? handleTextInputSend : handleSend}
            onCancel={handleCancel}
            onSelect={isOptionMode ? handleSelect : undefined}
            isThinking={status === 'thinking'}
            disabled={!isActive}
            onTextChange={isTerminalBound ? handleTextInputChange : undefined}
            onTerminalKey={isActive ? sendKeyPress : undefined}
          />
        </>
      )}
    </div>
  );
}
