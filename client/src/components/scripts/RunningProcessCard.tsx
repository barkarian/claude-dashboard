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

  const statusColor: Record<string, string> = {
    running: 'bg-success',
    exited: 'bg-danger',
    stopped: 'bg-text-dim',
  };

  const startTime = new Date(process.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="card hover:border-border-light transition-all">
      <div className="flex items-center gap-3">
        <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${statusColor[process.status] || 'bg-text-dim'} ${process.status === 'running' ? 'animate-pulse' : ''}`} />

        <button
          onClick={() => navigate(`/project/${projectId}/scripts/${process.scriptId}`)}
          className="flex-1 text-left min-w-0"
        >
          <div className="font-medium text-text truncate">{process.label || process.command}</div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs text-text-dim font-mono truncate">{process.command}</span>
            <span className="text-xs text-text-dim flex-shrink-0">{startTime}</span>
          </div>
        </button>

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
    </div>
  );
}
