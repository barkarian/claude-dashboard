import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSocket } from '../../context/SocketContext.jsx';
import { useProject } from '../../context/ProjectContext.jsx';
import ClaudeOutput from './ClaudeOutput.jsx';
import PromptInput from './PromptInput.jsx';

export default function ChatView({ projectId }) {
  const { chatId } = useParams();
  const navigate = useNavigate();
  const { socket } = useSocket();
  const { project, refreshProject } = useProject();
  const [status, setStatus] = useState('disconnected');
  const [error, setError] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const refreshRef = useRef(refreshProject);
  refreshRef.current = refreshProject;

  const chat = (project?.chats || []).find(c => c.id === chatId);

  // Register socket handlers
  useEffect(() => {
    if (!socket || !chatId) return;

    function handleStatus({ chatId: cid, status: s }) {
      if (cid !== chatId) return;
      setStatus(s);
    }

    function handleError({ chatId: cid, error: err }) {
      if (cid !== chatId) return;
      setError(err);
      setStatus('disconnected');
    }

    function handleResponseComplete({ chatId: cid }) {
      if (cid !== chatId) return;
      refreshRef.current();
    }

    function handleConfirmation({ chatId: cid, question }) {
      if (cid !== chatId) return;
      setConfirmation(question);
    }

    socket.on('claude:status', handleStatus);
    socket.on('claude:error', handleError);
    socket.on('claude:response-complete', handleResponseComplete);
    socket.on('claude:confirmation-needed', handleConfirmation);

    return () => {
      socket.off('claude:status', handleStatus);
      socket.off('claude:error', handleError);
      socket.off('claude:response-complete', handleResponseComplete);
      socket.off('claude:confirmation-needed', handleConfirmation);
    };
  }, [socket, chatId]);

  function handleStartSession() {
    if (!socket) return;
    setError(null);
    setStatus('starting');
    socket.emit('claude:start', { projectId, chatId });
  }

  function handleSend(prompt) {
    if (!socket || status === 'thinking') return;
    const promptId = Date.now().toString();
    socket.emit('claude:send', { chatId, prompt, promptId });
  }

  function handleCancel() {
    socket?.emit('claude:cancel', { chatId });
  }

  function handleConfirm(answer) {
    socket?.emit('claude:confirm', { chatId, answer });
    setConfirmation(null);
  }

  const isActive = status !== 'disconnected' && status !== 'exited' && status !== 'starting';

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
            status === 'idle' ? 'bg-success' :
            status === 'thinking' ? 'bg-warning animate-pulse' :
            status === 'starting' ? 'bg-primary animate-pulse' :
            'bg-text-dim'
          }`} />
          <span className="text-xs text-text-muted capitalize">{status}</span>
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
          {/* Terminal output — this is the main view */}
          <div className="flex-1 overflow-hidden">
            <ClaudeOutput chatId={chatId} socket={socket} />
          </div>

          {/* Confirmation bar */}
          {confirmation && (
            <div className="px-4 py-3 bg-warning/10 border-t border-warning/20">
              <p className="text-sm text-warning mb-2">{confirmation}</p>
              <div className="flex gap-2">
                <button onClick={() => handleConfirm('y')} className="btn-primary text-sm py-1">Yes</button>
                <button onClick={() => handleConfirm('n')} className="btn-ghost text-sm py-1">No</button>
              </div>
            </div>
          )}

          {/* Prompt input */}
          <PromptInput
            projectId={projectId}
            onSend={handleSend}
            onCancel={handleCancel}
            isThinking={status === 'thinking'}
            disabled={!isActive}
          />
        </>
      )}
    </div>
  );
}
