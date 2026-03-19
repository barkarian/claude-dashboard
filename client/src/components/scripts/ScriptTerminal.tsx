import { useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSocket } from '../../context/SocketContext.tsx';
import { useAuth } from '../../context/AuthContext.tsx';
import { useTerminal } from '../../hooks/useTerminal.ts';
import { useProcessStatus } from '../../hooks/useProcessStatus.ts';
import TerminalInputBar from './TerminalInputBar.tsx';
import api from '../../utils/api.ts';

interface ScriptTerminalProps {
  projectId: string;
}

export default function ScriptTerminal({ projectId }: ScriptTerminalProps) {
  const { scriptId } = useParams<{ scriptId: string }>();
  const navigate = useNavigate();
  const { socket } = useSocket();
  const { isDesktop } = useAuth();
  const containerRef = useRef<HTMLDivElement>(null);
  const { processes } = useProcessStatus(projectId);

  const { status } = useTerminal(containerRef, {
    socket,
    projectId,
    scriptId: scriptId!,
  });

  const isShell = scriptId?.startsWith('shell-') ?? false;
  const isRunning = status === 'running' || status === 'connected';

  // Get port info from process status push
  const currentProcess = processes.find(p => p.scriptId === scriptId);
  const detectedPorts = currentProcess?.detectedPorts || [];
  const tunnelUrls = currentProcess?.tunnelUrls || {};

  const handleInputSend = useCallback((data: string) => {
    if (socket && scriptId) {
      socket.emit('terminal:input', { projectId, scriptId, data });
    }
  }, [socket, projectId, scriptId]);

  function openPort(port: number) {
    const url = tunnelUrls[port] || `http://${window.location.hostname}:${port}`;
    if (isDesktop) {
      api.post('/api/open-external', { url }).catch(() => {});
    } else {
      window.open(url, '_blank');
    }
  }

  const statusLabel = isShell ? 'Terminal' : status;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border">
        <button
          onClick={() => navigate(`/project/${projectId}/scripts`)}
          className="flex items-center gap-2 text-sm text-text-muted hover:text-text transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          Back to Scripts
        </button>
        <div className="flex items-center gap-2">
          {detectedPorts.map((port) => (
            <button
              key={port}
              onClick={() => openPort(port)}
              className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium text-primary bg-primary/10 rounded-full hover:bg-primary/20 transition-colors"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
              </svg>
              :{port}
            </button>
          ))}
          <div className={`w-2 h-2 rounded-full ${isRunning ? 'bg-success' : 'bg-text-dim'}`} />
          <span className="text-xs text-text-muted capitalize">{statusLabel}</span>
        </div>
      </div>

      <div ref={containerRef} className="flex-1 overflow-hidden" />

      <TerminalInputBar onSend={handleInputSend} disabled={!isRunning} projectId={projectId} />
    </div>
  );
}
