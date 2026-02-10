import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSocket } from '../../context/SocketContext.jsx';
import { useProject } from '../../context/ProjectContext.jsx';
import { useInteractive } from '../../hooks/useInteractive.ts';
import ClaudeOutput from './ClaudeOutput.jsx';
import PromptInput from './PromptInput.jsx';
import InteractiveControls from './InteractiveControls.tsx';
import type { SessionStatus, InteractiveState } from '../../../../shared/types/interactive.ts';

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
  const [showArrowPad, setShowArrowPad] = useState(false);
  const refreshRef = useRef(refreshProject);
  refreshRef.current = refreshProject;
  const { interactiveState, eventVersion, sendKeyPress, sendTextResponse } = useInteractive(socket, chatId);

  const chat = (project?.chats || []).find((c: any) => c.id === chatId);

  // Every interactive event resets manual overrides — fixes the bug where
  // navigating out and back in wouldn't return to prompt mode
  useEffect(() => {
    setShowArrowPad(false);
  }, [eventVersion]);

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

    socket.on('claude:status', handleStatus);
    socket.on('claude:error', handleError);
    socket.on('claude:response-complete', handleResponseComplete);

    return () => {
      socket.off('claude:status', handleStatus);
      socket.off('claude:error', handleError);
      socket.off('claude:response-complete', handleResponseComplete);
    };
  }, [socket, chatId]);

  function handleStartSession() {
    if (!socket) return;
    setError(null);
    setStatus('starting');
    socket.emit('claude:start', { projectId, chatId });
  }

  function handleSend(prompt: string) {
    if (!socket || status === 'thinking') return;
    const promptId = Date.now().toString();
    socket.emit('claude:send', { chatId, prompt, promptId });
  }

  function handleCancel() {
    socket?.emit('claude:cancel', { chatId });
  }

  const isActive = status !== 'disconnected' && status !== 'exited' && status !== 'starting';

  const manualPadState: InteractiveState = { type: 'manual', options: [], selectedIndex: -1, navigation: 'manual' };

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
      {status === 'disconnected' && !error ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="w-16 h-16 bg-bg-surface rounded-2xl flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-text-dim" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-text mb-1">Claude Code</h3>
            <p className="text-text-muted text-sm mb-4">Start a session to interact with Claude Code in this project</p>
            <button onClick={handleStartSession} className="btn-primary">
              Start Session
            </button>
          </div>
        </div>
      ) : error ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="text-danger text-sm bg-danger/10 px-4 py-3 rounded-lg inline-block mb-3">
              {error}
            </div>
            <br />
            <button onClick={handleStartSession} className="btn-primary mt-2">
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

          {/* Interactive controls (auto-detected) or manual arrow pad */}
          {interactiveState ? (
            <InteractiveControls
              interactiveState={interactiveState}
              onKeyPress={sendKeyPress}
              onTextResponse={sendTextResponse}
            />
          ) : showArrowPad ? (
            <InteractiveControls
              interactiveState={manualPadState}
              onKeyPress={sendKeyPress}
              onTextResponse={sendTextResponse}
            />
          ) : null}

          {/* Show/Hide controls toggle */}
          {!interactiveState && isActive && (
            <div className="flex justify-center border-t border-border">
              <button
                onClick={() => setShowArrowPad(prev => !prev)}
                className="px-3 py-1 text-xs text-text-muted hover:text-text transition-colors select-none"
              >
                {showArrowPad ? 'Hide controls' : 'Show controls'}
              </button>
            </div>
          )}

          {/* Prompt input — hidden via CSS when controls are active (preserves text) */}
          <div className={(interactiveState || showArrowPad) ? 'hidden' : ''}>
            <div className="flex items-end">
              {/* Swap mode button (Shift+Tab) */}
              {isActive && (
                <button
                  onClick={() => sendKeyPress('ShiftTab')}
                  className="flex items-center justify-center w-9 h-9 mb-4 ml-1.5 rounded-lg bg-bg-surface active:bg-bg-hover text-text-muted transition-colors select-none touch-manipulation flex-shrink-0"
                  aria-label="Switch mode"
                  title="Switch mode (Shift+Tab)"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
                  </svg>
                </button>
              )}

              {/* Prompt input */}
              <div className="flex-1 min-w-0">
                <PromptInput
                  projectId={projectId}
                  onSend={handleSend}
                  onCancel={handleCancel}
                  isThinking={status === 'thinking'}
                  disabled={!isActive}
                />
              </div>

              {/* Up/Down arrows — also switch to full arrow pad mode */}
              {isActive && (
                <div className="flex flex-col gap-0.5 mb-3 mr-1.5 flex-shrink-0">
                  <button
                    onClick={() => { sendKeyPress('ArrowUp'); setShowArrowPad(true); }}
                    className="flex items-center justify-center w-9 h-9 rounded-lg bg-bg-surface active:bg-bg-hover text-text-muted transition-colors select-none touch-manipulation"
                    aria-label="Arrow Up"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                    </svg>
                  </button>
                  <button
                    onClick={() => { sendKeyPress('ArrowDown'); setShowArrowPad(true); }}
                    className="flex items-center justify-center w-9 h-9 rounded-lg bg-bg-surface active:bg-bg-hover text-text-muted transition-colors select-none touch-manipulation"
                    aria-label="Arrow Down"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
