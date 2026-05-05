import { useState, useEffect, useCallback } from 'react';
import type { Socket } from 'socket.io-client';
import type {
  SDKSessionStatus,
  SDKChatMessage,
  SDKMessagePayload,
  SDKPartialUpdatePayload,
  SDKStatusPayload,
  SDKActivityPayload,
  SDKPermissionRequestPayload,
  SDKQuestionRequestPayload,
  SDKResultPayload,
  SDKErrorPayload,
  SDKHistoryPayload,
  ContentBlock,
  Question,
} from '../../../shared/types/sdk.ts';

export interface SDKResult {
  costUSD: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  sessionId?: string;
}

export interface PendingPermission {
  requestId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  description?: string;
}

export interface PendingQuestion {
  requestId: string;
  questions: Question[];
}

interface UseSDKMessagesReturn {
  messages: SDKChatMessage[];
  status: SDKSessionStatus | 'disconnected';
  /** Live "what is the agent doing right now" hint, or null when idle. */
  activity: string | null;
  pendingPermission: PendingPermission | null;
  pendingQuestion: PendingQuestion | null;
  lastResult: SDKResult | null;
  lastError: string | null;
  sendPrompt: (prompt: string) => void;
  respondToPermission: (requestId: string, granted: boolean) => void;
  respondToQuestion: (requestId: string, answers: Record<number, string[]>) => void;
  dismissQuestion: (requestId: string) => void;
  interrupt: () => void;
}

export function useSDKMessages(
  socket: Socket | null,
  chatId: string | undefined,
): UseSDKMessagesReturn {
  const [messages, setMessages] = useState<SDKChatMessage[]>([]);
  const [status, setStatus] = useState<SDKSessionStatus | 'disconnected'>('disconnected');
  const [activity, setActivity] = useState<string | null>(null);
  const [pendingPermission, setPendingPermission] = useState<PendingPermission | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState<PendingQuestion | null>(null);
  const [lastResult, setLastResult] = useState<SDKResult | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  // Reset all state when chatId changes (prevents stale history from previous chat)
  useEffect(() => {
    setMessages([]);
    setStatus('disconnected');
    setActivity(null);
    setPendingPermission(null);
    setPendingQuestion(null);
    setLastResult(null);
    setLastError(null);
  }, [chatId]);

  useEffect(() => {
    if (!socket || !chatId) return;

    function handleHistory({ chatId: cid, messages: msgs }: SDKHistoryPayload) {
      if (cid !== chatId) return;
      setMessages(msgs);
    }

    function handleMessage({ chatId: cid, message }: SDKMessagePayload) {
      if (cid !== chatId) return;
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === message.id);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = message;
          return updated;
        }
        return [...prev, message];
      });
    }

    function handlePartialUpdate({ chatId: cid, messageId, content }: SDKPartialUpdatePayload) {
      if (cid !== chatId) return;
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === messageId);
        if (idx < 0) return prev;
        const updated = [...prev];
        updated[idx] = { ...updated[idx], content, isPartial: true };
        return updated;
      });
    }

    function handleStatus({ chatId: cid, status: s }: SDKStatusPayload) {
      if (cid !== chatId) return;
      setStatus(s);
      // Clear pending permission/question when status changes away from waiting-permission
      if (s !== 'waiting-permission') {
        setPendingPermission(null);
        setPendingQuestion(null);
      }
      // Status hitting a terminal value — drop any stale activity hint.
      if (s === 'idle' || s === 'exited' || s === 'error') {
        setActivity(null);
      }
    }

    function handleActivity({ chatId: cid, label }: SDKActivityPayload) {
      if (cid !== chatId) return;
      setActivity(label);
    }

    function handlePermissionRequest({
      chatId: cid,
      requestId,
      toolName,
      toolInput,
      description,
    }: SDKPermissionRequestPayload) {
      if (cid !== chatId) return;
      setPendingPermission({ requestId, toolName, toolInput, description });
    }

    function handleQuestionRequest({
      chatId: cid,
      requestId,
      questions,
    }: SDKQuestionRequestPayload) {
      if (cid !== chatId) return;
      setPendingQuestion({ requestId, questions });
    }

    function handleResult({ chatId: cid, ...result }: SDKResultPayload) {
      if (cid !== chatId) return;
      setLastResult(result);
    }

    function handleError({ chatId: cid, error }: SDKErrorPayload) {
      if (cid !== chatId) return;
      setLastError(error);
      // Inject error as a visible message in the chat so it persists
      const errorMessage: SDKChatMessage = {
        id: `error-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role: 'assistant',
        content: [{ type: 'text', text: `**Error:** ${error}` }],
        isError: true,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    }

    socket.on('sdk:history', handleHistory);
    socket.on('sdk:message', handleMessage);
    socket.on('sdk:partial-update', handlePartialUpdate);
    socket.on('sdk:status', handleStatus);
    socket.on('sdk:activity', handleActivity);
    socket.on('sdk:permission-request', handlePermissionRequest);
    socket.on('sdk:question-request', handleQuestionRequest);
    socket.on('sdk:result', handleResult);
    socket.on('sdk:error', handleError);

    return () => {
      socket.off('sdk:history', handleHistory);
      socket.off('sdk:message', handleMessage);
      socket.off('sdk:partial-update', handlePartialUpdate);
      socket.off('sdk:status', handleStatus);
      socket.off('sdk:activity', handleActivity);
      socket.off('sdk:permission-request', handlePermissionRequest);
      socket.off('sdk:question-request', handleQuestionRequest);
      socket.off('sdk:result', handleResult);
      socket.off('sdk:error', handleError);
    };
  }, [socket, chatId]);

  const sendPrompt = useCallback(
    (prompt: string) => {
      if (!socket || !chatId) return;
      setLastError(null);
      socket.emit('sdk:send', { chatId, prompt });
    },
    [socket, chatId],
  );

  const respondToPermission = useCallback(
    (requestId: string, granted: boolean) => {
      if (!socket || !chatId) return;
      socket.emit('sdk:permission-response', { chatId, requestId, granted });
      setPendingPermission(null);
    },
    [socket, chatId],
  );

  const respondToQuestion = useCallback(
    (requestId: string, answers: Record<number, string[]>) => {
      if (!socket || !chatId) return;
      socket.emit('sdk:question-response', { chatId, requestId, answers });
      setPendingQuestion(null);
    },
    [socket, chatId],
  );

  const dismissQuestion = useCallback(
    (requestId: string) => {
      if (!socket || !chatId) return;
      // Send empty answers — server interprets as "chat about these instead"
      socket.emit('sdk:question-response', { chatId, requestId, answers: {} });
      setPendingQuestion(null);
    },
    [socket, chatId],
  );

  const interrupt = useCallback(() => {
    if (!socket || !chatId) return;
    socket.emit('sdk:interrupt', { chatId });
  }, [socket, chatId]);

  return {
    messages,
    status,
    activity,
    pendingPermission,
    pendingQuestion,
    lastResult,
    lastError,
    sendPrompt,
    respondToPermission,
    respondToQuestion,
    dismissQuestion,
    interrupt,
  };
}
