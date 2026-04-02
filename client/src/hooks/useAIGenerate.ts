import { useState, useEffect, useCallback, useRef } from 'react';
import { useSocket } from '../context/SocketContext.tsx';

export type AIStatus = 'idle' | 'analyzing' | 'reading' | 'generating';

interface AIStatusPayload {
  sessionId: string;
  status: AIStatus;
  step: string;
}

interface AIPartialPayload {
  sessionId: string;
  text: string;
}

interface AIResultPayload {
  sessionId: string;
  type: 'command' | 'scripts' | 'commit-message';
  result: any;
}

interface AIErrorPayload {
  sessionId: string;
  error: string;
}

interface UseAIGenerateReturn {
  isGenerating: boolean;
  status: AIStatus;
  step: string;
  partialText: string;
  result: any | null;
  error: string | null;
  generateCommand: (projectId: string, description: string) => void;
  generateScripts: (projectId: string, mode: 'auto-detect' | 'describe', description?: string) => void;
  generateCommitMessage: (projectId: string, repoPath?: string) => void;
  cancel: () => void;
  reset: () => void;
}

export function useAIGenerate(): UseAIGenerateReturn {
  const { socket } = useSocket();
  const [isGenerating, setIsGenerating] = useState(false);
  const [status, setStatus] = useState<AIStatus>('idle');
  const [step, setStep] = useState('');
  const [partialText, setPartialText] = useState('');
  const [result, setResult] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (sessionIdRef.current && socket) {
        socket.emit('ai:cancel', { sessionId: sessionIdRef.current });
      }
    };
  }, [socket]);

  // Listen for AI events
  useEffect(() => {
    if (!socket) return;

    function handleStatus({ sessionId, status: s, step: st }: AIStatusPayload) {
      if (sessionId !== sessionIdRef.current) return;
      setStatus(s);
      setStep(st);
    }

    function handlePartial({ sessionId, text }: AIPartialPayload) {
      if (sessionId !== sessionIdRef.current) return;
      setPartialText(text);
    }

    function handleResult({ sessionId, result: r }: AIResultPayload) {
      if (sessionId !== sessionIdRef.current) return;
      setResult(r);
      setIsGenerating(false);
      setStatus('idle');
    }

    function handleError({ sessionId, error: e }: AIErrorPayload) {
      if (sessionId !== sessionIdRef.current) return;
      setError(e);
      setIsGenerating(false);
      setStatus('idle');
    }

    socket.on('ai:status', handleStatus);
    socket.on('ai:partial', handlePartial);
    socket.on('ai:result', handleResult);
    socket.on('ai:error', handleError);

    return () => {
      socket.off('ai:status', handleStatus);
      socket.off('ai:partial', handlePartial);
      socket.off('ai:result', handleResult);
      socket.off('ai:error', handleError);
    };
  }, [socket]);

  const generateCommand = useCallback(
    (projectId: string, description: string) => {
      if (!socket || isGenerating) return;
      const sessionId = `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      sessionIdRef.current = sessionId;
      setIsGenerating(true);
      setStatus('analyzing');
      setStep('Starting...');
      setPartialText('');
      setResult(null);
      setError(null);
      socket.emit('ai:generate-command', { sessionId, projectId, description });
    },
    [socket, isGenerating],
  );

  const generateScripts = useCallback(
    (projectId: string, mode: 'auto-detect' | 'describe', description?: string) => {
      if (!socket || isGenerating) return;
      const sessionId = `scripts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      sessionIdRef.current = sessionId;
      setIsGenerating(true);
      setStatus('analyzing');
      setStep('Starting...');
      setPartialText('');
      setResult(null);
      setError(null);
      socket.emit('ai:generate-scripts', { sessionId, projectId, mode, description });
    },
    [socket, isGenerating],
  );

  const generateCommitMessage = useCallback(
    (projectId: string, repoPath?: string) => {
      if (!socket || isGenerating) return;
      const sessionId = `commit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      sessionIdRef.current = sessionId;
      setIsGenerating(true);
      setStatus('analyzing');
      setStep('Starting...');
      setPartialText('');
      setResult(null);
      setError(null);
      socket.emit('ai:generate-commit-message', { sessionId, projectId, repoPath });
    },
    [socket, isGenerating],
  );

  const cancel = useCallback(() => {
    if (!socket || !sessionIdRef.current) return;
    socket.emit('ai:cancel', { sessionId: sessionIdRef.current });
    sessionIdRef.current = null;
    setIsGenerating(false);
    setStatus('idle');
    setStep('');
    setPartialText('');
  }, [socket]);

  const reset = useCallback(() => {
    if (isGenerating) cancel();
    sessionIdRef.current = null;
    setIsGenerating(false);
    setStatus('idle');
    setStep('');
    setPartialText('');
    setResult(null);
    setError(null);
  }, [isGenerating, cancel]);

  return {
    isGenerating,
    status,
    step,
    partialText,
    result,
    error,
    generateCommand,
    generateScripts,
    generateCommitMessage,
    cancel,
    reset,
  };
}
