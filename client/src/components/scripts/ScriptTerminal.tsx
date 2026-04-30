import { useRef, useCallback, useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSocket } from '../../context/SocketContext.tsx';
import { useAuth } from '../../context/AuthContext.tsx';
import { useSearch, type SearchHandler } from '../../context/SearchContext.tsx';
import { useTerminal } from '../../hooks/useTerminal.ts';
import { useProcessStatus } from '../../hooks/useProcessStatus.ts';
import TerminalInputBar from './TerminalInputBar.tsx';
import SendToChatDialog from './SendToChatDialog.tsx';
import api from '../../utils/api.ts';
import { stripAnsi } from '../../utils/ansi.ts';
import { haptics } from '../../utils/haptics.ts';

interface ScriptTerminalProps {
  projectId: string;
}

export default function ScriptTerminal({ projectId }: ScriptTerminalProps) {
  const { scriptId } = useParams<{ scriptId: string }>();
  const navigate = useNavigate();
  const { socket } = useSocket();
  const { isDesktop } = useAuth();
  const { registerHandler, unregisterHandler } = useSearch();
  const containerRef = useRef<HTMLDivElement>(null);
  const { processes } = useProcessStatus(projectId);

  const { status, searchFindNext, searchFindPrevious, searchClear, searchOnResultsChange } = useTerminal(containerRef, {
    socket,
    projectId,
    scriptId: scriptId!,
  });

  // Register search handler for Ctrl+F
  const searchHandler = useMemo<SearchHandler>(() => ({
    findNext: (q, inc) => searchFindNext(q, inc),
    findPrevious: (q) => searchFindPrevious(q),
    clearSearch: () => searchClear(),
    onResultsChange: searchOnResultsChange,
  }), [searchFindNext, searchFindPrevious, searchClear, searchOnResultsChange]);

  useEffect(() => {
    registerHandler(searchHandler);
    return () => unregisterHandler(searchHandler);
  }, [searchHandler, registerHandler, unregisterHandler]);

  const [showSendDialog, setShowSendDialog] = useState(false);
  const [sendContent, setSendContent] = useState('');

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

  async function handleSendToChat() {
    try {
      const data = await api.get<{ buffer: string }>(`/api/projects/${projectId}/scripts/processes/${scriptId}/buffer`);
      setSendContent(stripAnsi(data.buffer));
      setShowSendDialog(true);
    } catch (err) {
      console.error('Failed to fetch buffer:', err);
    }
  }

  function handleStop() {
    if (!socket) return;
    haptics.impactMedium();
    socket.emit('terminal:stop', { projectId, scriptId });
  }

  const displayLabel = isShell ? 'Terminal' : (currentProcess?.label || currentProcess?.command || scriptId || '');
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
          {isRunning && (
            <button
              onClick={handleStop}
              className="p-1.5 rounded-lg hover:bg-bg-hover text-danger transition-colors"
              title="Stop"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="1" />
              </svg>
            </button>
          )}
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
          <button
            onClick={handleSendToChat}
            className="p-1.5 rounded-lg hover:bg-bg-hover text-text-dim hover:text-text transition-colors"
            title="Send to Chat"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
            </svg>
          </button>
          <div className={`w-2 h-2 rounded-full ${isRunning ? 'bg-success' : 'bg-text-dim'}`} />
          <span className="text-xs text-text-muted capitalize">{statusLabel}</span>
        </div>
      </div>

      <div className="flex-1 overflow-hidden relative">
        <div ref={containerRef} className="absolute inset-0" />
      </div>

      <TerminalInputBar onSend={handleInputSend} disabled={!isRunning} projectId={projectId} />

      {showSendDialog && (
        <SendToChatDialog
          projectId={projectId}
          content={sendContent}
          contentLabel={displayLabel}
          onClose={() => setShowSendDialog(false)}
        />
      )}
    </div>
  );
}
