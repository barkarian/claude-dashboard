import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSocket } from '../../context/SocketContext.tsx';
import type { ScriptWithStatus, ProcessStatus } from '../../../../shared/types/models.ts';

interface ScriptCardProps {
  script: ScriptWithStatus;
  projectId: string;
  onDelete: (scriptId: string) => void;
  onRefresh: () => void;
}

export default function ScriptCard({ script, projectId, onDelete, onRefresh }: ScriptCardProps) {
  const navigate = useNavigate();
  const { socket } = useSocket();
  const [status, setStatus] = useState<ProcessStatus>(script.status || 'stopped');

  function handleStart() {
    if (!socket) return;
    socket.emit('terminal:start', { projectId, scriptId: script.id });
    setStatus('running');
    setTimeout(onRefresh, 500);
  }

  function handleStop() {
    if (!socket) return;
    socket.emit('terminal:stop', { projectId, scriptId: script.id });
    setStatus('stopped');
    setTimeout(onRefresh, 500);
  }

  const statusColor: Record<string, string> = {
    running: 'bg-success',
    stopped: 'bg-text-dim',
    exited: 'bg-danger',
  };

  return (
    <div className="card hover:border-border-light transition-all">
      <div className="flex items-center gap-3">
        <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${statusColor[status] || 'bg-text-dim'}`} />

        <button
          onClick={() => navigate(`/project/${projectId}/scripts/${script.id}`)}
          className="flex-1 text-left min-w-0"
        >
          <div className="font-medium text-text truncate">{script.label}</div>
          <div className="text-xs text-text-dim font-mono mt-0.5 truncate">{script.command}</div>
        </button>

        <div className="flex items-center gap-1 flex-shrink-0">
          {status === 'running' ? (
            <button onClick={handleStop} className="p-2 rounded-lg hover:bg-bg-hover text-danger transition-colors" title="Stop">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="1" />
              </svg>
            </button>
          ) : (
            <button onClick={handleStart} className="p-2 rounded-lg hover:bg-bg-hover text-success transition-colors" title="Start">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5.14v14l11-7-11-7z" />
              </svg>
            </button>
          )}

          <button
            onClick={() => onDelete(script.id)}
            className="p-2 rounded-lg hover:bg-bg-hover text-text-dim hover:text-danger transition-colors"
            title="Delete"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
