/**
 * useChatSession — unified socket communication hook for chat adapters.
 *
 * This is a thin communication layer. It does NOT dictate UI behavior.
 * Adapter views call this to talk to the backend via unified chat:* events.
 *
 * Each adapter's ChatView uses this hook internally, then handles all
 * rendering, scroll, gestures, etc. with its own code.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { SessionStateContext } from '../../../shared/types/session.ts';

export interface ChatSessionAPI {
  // Lifecycle
  start: (opts?: { sessionId?: string; cols?: number; rows?: number }) => void;
  stop: () => void;
  attach: (opts?: { cols?: number; rows?: number }) => void;
  detach: () => void;
  checkSession: () => Promise<{ exists: boolean; status?: string }>;

  // Communication
  sendInput: (data: string | Record<string, unknown>) => void;
  resize: (cols: number, rows: number) => void;
  resolvePermission: (requestId: string, granted: boolean) => void;
  resolveQuestion: (requestId: string, answers: Record<number, string[]>) => void;
  interrupt: () => void;

  // Custom adapter events
  sendAdapterEvent: (event: string, data: unknown) => void;
  onAdapterEvent: (cb: (event: string, data: unknown) => void) => () => void;

  // State (from socket events)
  sessionState: SessionStateContext | undefined;

  // Event subscriptions (adapters subscribe to what they need)
  onOutput: (cb: (data: string) => void) => () => void;
  onExit: (cb: (code: number) => void) => () => void;
  onError: (cb: (error: string) => void) => () => void;
}

export function useChatSession(
  socket: Socket | null,
  projectId: string,
  chatId: string,
): ChatSessionAPI {
  const [sessionState, setSessionState] = useState<SessionStateContext | undefined>();

  // Store callbacks in refs for stable references
  const outputCallbacksRef = useRef<Set<(data: string) => void>>(new Set());
  const exitCallbacksRef = useRef<Set<(code: number) => void>>(new Set());
  const errorCallbacksRef = useRef<Set<(error: string) => void>>(new Set());
  const adapterEventCallbacksRef = useRef<Set<(event: string, data: unknown) => void>>(new Set());

  // Listen for server events
  useEffect(() => {
    if (!socket) return;

    const handleSessionState = ({ chatId: cid, state }: { chatId: string; state: SessionStateContext }) => {
      if (cid === chatId) setSessionState(state);
    };

    const handleOutput = ({ chatId: cid, data }: { chatId: string; data: string }) => {
      if (cid === chatId) {
        for (const cb of outputCallbacksRef.current) cb(data);
      }
    };

    const handleExit = ({ chatId: cid, exitCode }: { chatId: string; exitCode: number }) => {
      if (cid === chatId) {
        for (const cb of exitCallbacksRef.current) cb(exitCode);
      }
    };

    const handleError = ({ chatId: cid, error }: { chatId: string; error: string }) => {
      if (cid === chatId) {
        for (const cb of errorCallbacksRef.current) cb(error);
      }
    };

    const handleAdapterEvent = ({ chatId: cid, event, data }: { chatId: string; event: string; data: unknown }) => {
      if (cid === chatId) {
        for (const cb of adapterEventCallbacksRef.current) cb(event, data);
      }
    };

    socket.on('claude:session-state', handleSessionState);
    socket.on('cc:output', handleOutput);
    socket.on('cc:exit', handleExit);
    socket.on('chat:error', handleError);
    socket.on('sdk:error', handleError);
    socket.on('chat:adapter-event', handleAdapterEvent);

    return () => {
      socket.off('claude:session-state', handleSessionState);
      socket.off('cc:output', handleOutput);
      socket.off('cc:exit', handleExit);
      socket.off('chat:error', handleError);
      socket.off('sdk:error', handleError);
      socket.off('chat:adapter-event', handleAdapterEvent);
    };
  }, [socket, chatId]);

  // Lifecycle
  const start = useCallback((opts?: { sessionId?: string; cols?: number; rows?: number }) => {
    socket?.emit('chat:start', { projectId, chatId, ...opts });
  }, [socket, projectId, chatId]);

  const stop = useCallback(() => {
    socket?.emit('chat:stop', { chatId });
  }, [socket, chatId]);

  const attach = useCallback((opts?: { cols?: number; rows?: number }) => {
    socket?.emit('chat:attach', { chatId, ...opts });
  }, [socket, chatId]);

  const detach = useCallback(() => {
    socket?.emit('chat:detach', { chatId });
  }, [socket, chatId]);

  const checkSession = useCallback(() => {
    return new Promise<{ exists: boolean; status?: string }>((resolve) => {
      if (!socket) {
        resolve({ exists: false });
        return;
      }
      socket.emit('chat:check-session', { chatId }, resolve);
    });
  }, [socket, chatId]);

  // Communication
  const sendInput = useCallback((data: string | Record<string, unknown>) => {
    socket?.emit('chat:input', { chatId, data });
  }, [socket, chatId]);

  const resize = useCallback((cols: number, rows: number) => {
    socket?.emit('chat:resize', { chatId, cols, rows });
  }, [socket, chatId]);

  const resolvePermission = useCallback((requestId: string, granted: boolean) => {
    socket?.emit('chat:permission-response', { chatId, requestId, granted });
  }, [socket, chatId]);

  const resolveQuestion = useCallback((requestId: string, answers: Record<number, string[]>) => {
    socket?.emit('chat:question-response', { chatId, requestId, answers });
  }, [socket, chatId]);

  const interrupt = useCallback(() => {
    socket?.emit('chat:interrupt', { chatId });
  }, [socket, chatId]);

  // Custom adapter events
  const sendAdapterEvent = useCallback((event: string, data: unknown) => {
    socket?.emit('chat:adapter-event', { chatId, event, data });
  }, [socket, chatId]);

  // Event subscriptions
  const onOutput = useCallback((cb: (data: string) => void) => {
    outputCallbacksRef.current.add(cb);
    return () => { outputCallbacksRef.current.delete(cb); };
  }, []);

  const onExit = useCallback((cb: (code: number) => void) => {
    exitCallbacksRef.current.add(cb);
    return () => { exitCallbacksRef.current.delete(cb); };
  }, []);

  const onError = useCallback((cb: (error: string) => void) => {
    errorCallbacksRef.current.add(cb);
    return () => { errorCallbacksRef.current.delete(cb); };
  }, []);

  const onAdapterEvent = useCallback((cb: (event: string, data: unknown) => void) => {
    adapterEventCallbacksRef.current.add(cb);
    return () => { adapterEventCallbacksRef.current.delete(cb); };
  }, []);

  return {
    start,
    stop,
    attach,
    detach,
    checkSession,
    sendInput,
    resize,
    resolvePermission,
    resolveQuestion,
    interrupt,
    sendAdapterEvent,
    onAdapterEvent,
    sessionState,
    onOutput,
    onExit,
    onError,
  };
}
