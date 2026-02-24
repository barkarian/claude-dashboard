import { useRef, useState, useEffect } from 'react';
import { useTerminal } from '../../hooks/useTerminal.ts';
import { useSocket } from '../../context/SocketContext.tsx';

interface SettingsTerminalProps {
  onClose: () => void;
}

export default function SettingsTerminal({ onClose }: SettingsTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { socket } = useSocket();
  const [scriptId, setScriptId] = useState<string | null>(null);
  const [spawning, setSpawning] = useState(true);

  // Spawn a settings shell on mount
  useEffect(() => {
    if (!socket) return;

    function handleShellSpawned({ projectId, scriptId: sid }: { projectId: string; scriptId: string }) {
      if (projectId === '__settings__') {
        setScriptId(sid);
        setSpawning(false);
      }
    }

    socket.on('terminal:shell-spawned', handleShellSpawned);
    socket.emit('terminal:spawn-settings-shell');

    return () => {
      socket.off('terminal:shell-spawned', handleShellSpawned);
    };
  }, [socket]);

  // Kill the shell on unmount
  useEffect(() => {
    return () => {
      if (socket && scriptId) {
        socket.emit('terminal:stop', { projectId: '__settings__', scriptId });
      }
    };
  }, [socket, scriptId]);

  const { status } = useTerminal(containerRef, {
    socket,
    projectId: '__settings__',
    scriptId: scriptId || '',
  });

  const isConnected = status === 'connected' || status === 'running';

  return (
    <div className="rounded-lg border border-border overflow-hidden bg-bg">
      <div className="flex items-center justify-between px-3 py-2 bg-bg-surface border-b border-border">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-danger/50" />
            <div className="w-3 h-3 rounded-full bg-warning/50" />
            <div className="w-3 h-3 rounded-full bg-success/50" />
          </div>
          <span className="text-xs text-text-muted">Terminal</span>
          <div className={`w-2 h-2 rounded-full ${spawning ? 'bg-warning animate-pulse' : isConnected ? 'bg-success' : 'bg-text-dim'}`} />
        </div>
        <button
          onClick={onClose}
          className="text-text-muted hover:text-text transition-colors p-1"
          title="Close terminal"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div ref={containerRef} className="h-64 overflow-hidden" />
    </div>
  );
}
