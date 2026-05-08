/**
 * ToolInstallBanner — transient banner above the input shown when a tool is
 * being armed for the first time and needs to install (e.g. browser's first
 * Chromium download). Listens to `chat:tool-install-progress` and renders
 * itself only while a matching event stream is active.
 */

import { useEffect, useState } from 'react';
import { useSocket } from '../../context/SocketContext.tsx';

interface InstallState {
  toolId: string;
  percent: number | null;
  status: 'starting' | 'downloading' | 'installing' | 'ready' | 'failed';
  message?: string;
}

interface ToolInstallBannerProps {
  chatId: string;
}

const TOOL_LABEL: Record<string, string> = {
  browser: 'Browser',
};

export default function ToolInstallBanner({ chatId }: ToolInstallBannerProps) {
  const { socket } = useSocket();
  const [state, setState] = useState<InstallState | null>(null);

  useEffect(() => {
    if (!socket) return;
    function handle(p: InstallState & { chatId: string }) {
      if (p.chatId !== chatId) return;
      setState({ toolId: p.toolId, percent: p.percent, status: p.status, message: p.message });
      // Auto-clear on terminal states.
      if (p.status === 'ready') {
        setTimeout(() => setState((s) => s?.status === 'ready' ? null : s), 1800);
      }
    }
    socket.on('chat:tool-install-progress', handle);
    return () => { socket.off('chat:tool-install-progress', handle); };
  }, [socket, chatId]);

  if (!state) return null;
  const label = TOOL_LABEL[state.toolId] || state.toolId;
  const isFailed = state.status === 'failed';
  const isReady = state.status === 'ready';

  return (
    <div className={`mx-3 mb-2 rounded-md border px-3 py-2 text-xs flex items-center gap-2 ${
      isFailed ? 'border-danger/40 bg-danger/10 text-danger'
      : isReady ? 'border-green-500/40 bg-green-500/10 text-text'
      : 'border-border bg-bg-surface text-text-dim'
    }`}>
      <span aria-hidden>{isFailed ? '✕' : isReady ? '✓' : '⏳'}</span>
      <span className="flex-1">
        {isFailed
          ? `${label}: install failed${state.message ? ` — ${state.message}` : ''}`
          : isReady
            ? `${label} ready`
            : state.message || `Setting up ${label}…`}
      </span>
      {state.percent !== null && !isFailed && !isReady && (
        <span className="font-mono">{state.percent}%</span>
      )}
      {(isFailed || isReady) && (
        <button
          type="button"
          onClick={() => setState(null)}
          className="text-text-dim hover:text-text"
          aria-label="Dismiss"
        >
          ×
        </button>
      )}
    </div>
  );
}
