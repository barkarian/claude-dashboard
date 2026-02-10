import { useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSocket } from '../../context/SocketContext.jsx';
import { useTerminal } from '../../hooks/useTerminal.js';
import Header from '../layout/Header.jsx';

export default function ScriptTerminal({ projectId }) {
  const { scriptId } = useParams();
  const navigate = useNavigate();
  const { socket } = useSocket();
  const containerRef = useRef(null);

  const { status } = useTerminal(containerRef, {
    socket,
    projectId,
    scriptId,
  });

  return (
    <div className="flex flex-col h-[calc(100vh-7rem)]">
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
          <div className={`w-2 h-2 rounded-full ${status === 'running' || status === 'connected' ? 'bg-success' : 'bg-text-dim'}`} />
          <span className="text-xs text-text-muted capitalize">{status}</span>
        </div>
      </div>

      <div ref={containerRef} className="flex-1 overflow-hidden" />
    </div>
  );
}
