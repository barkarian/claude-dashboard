import { useNavigate } from 'react-router-dom';
import { useSocket } from '../../context/SocketContext.tsx';
import type { RunningProcess } from '../../../../shared/types/models.ts';

interface RunningProcessCardProps {
  process: RunningProcess;
  projectId: string;
  onRefresh: () => void;
}

export default function RunningProcessCard({ process, projectId, onRefresh }: RunningProcessCardProps) {
  const navigate = useNavigate();
  const { socket } = useSocket();

  function handleStop() {
    if (!socket) return;
    socket.emit('terminal:stop', { projectId, scriptId: process.scriptId });
    setTimeout(onRefresh, 300);
  }

  function openPort(port: number) {
    window.open(`http://${window.location.hostname}:${port}`, '_blank');
  }

  const statusColor: Record<string, string> = {
    running: 'bg-success',
    exited: 'bg-danger',
    stopped: 'bg-text-dim',
  };

  const isShell = process.scriptId.startsWith('shell-');
  const displayLabel = isShell ? '> Terminal' : (process.label || process.command);
  const displayCommand = isShell ? 'bash --login' : process.command;
  const ports = process.detectedPorts || [];

  const startTime = new Date(process.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="card hover:border-border-light transition-all">
      <div className="flex items-center gap-3">
        <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${statusColor[process.status] || 'bg-text-dim'} ${process.status === 'running' ? 'animate-pulse' : ''}`} />

        <button
          onClick={() => navigate(`/project/${projectId}/scripts/${process.scriptId}`)}
          className="flex-1 text-left min-w-0"
        >
          <div className="font-medium text-text truncate">{displayLabel}</div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs text-text-dim font-mono truncate">{displayCommand}</span>
            <span className="text-xs text-text-dim flex-shrink-0">{startTime}</span>
          </div>
        </button>

        {ports.length > 0 && (
          <button
            onClick={() => openPort(ports[0])}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-primary bg-primary/10 hover:bg-primary/20 transition-colors flex-shrink-0"
            title={`Open :${ports[0]}`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
            </svg>
            View
          </button>
        )}

        {process.status === 'running' && (
          <button
            onClick={handleStop}
            className="p-2 rounded-lg hover:bg-bg-hover text-danger transition-colors flex-shrink-0"
            title="Stop"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="6" width="12" height="12" rx="1" />
            </svg>
          </button>
        )}
      </div>

      {ports.length > 1 && (
        <div className="flex items-center gap-1.5 mt-2 ml-5.5">
          {ports.map((port) => (
            <button
              key={port}
              onClick={() => openPort(port)}
              className="px-2 py-0.5 text-xs font-mono text-primary bg-primary/10 rounded hover:bg-primary/20 transition-colors"
            >
              :{port}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
