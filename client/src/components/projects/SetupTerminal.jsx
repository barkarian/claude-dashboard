import { useRef, useEffect } from 'react';
import { useTerminal } from '../../hooks/useTerminal.js';
import { useSocket } from '../../context/SocketContext.jsx';

export default function SetupTerminal({ projectId, sessionId }) {
  const containerRef = useRef(null);
  const { socket } = useSocket();

  const { status } = useTerminal(containerRef, {
    socket,
    projectId,
    scriptId: sessionId,
    readOnly: true,
  });

  return (
    <div className="rounded-lg border border-border overflow-hidden bg-bg">
      <div className="flex items-center gap-2 px-3 py-2 bg-bg-surface border-b border-border">
        <div className="flex gap-1.5">
          <div className="w-3 h-3 rounded-full bg-danger/50" />
          <div className="w-3 h-3 rounded-full bg-warning/50" />
          <div className="w-3 h-3 rounded-full bg-success/50" />
        </div>
        <span className="text-xs text-text-muted">Setup</span>
      </div>
      <div ref={containerRef} className="h-64 overflow-hidden" />
    </div>
  );
}
