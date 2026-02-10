import { useState, useEffect, useCallback, useRef } from 'react';
import type { Socket } from 'socket.io-client';
import type { InteractiveState, SessionStatus, AllowedKey } from '../../../shared/types/interactive.ts';

const STALENESS_TIMEOUT = 30000; // 30 seconds

interface UseInteractiveReturn {
  interactiveState: InteractiveState | null;
  eventVersion: number;
  sendKeyPress: (key: AllowedKey) => void;
  sendTextResponse: (text: string) => void;
  writeToTerminal: (text: string) => void;
}

export function useInteractive(socket: Socket | null, chatId: string | undefined): UseInteractiveReturn {
  const [interactiveState, setInteractiveState] = useState<InteractiveState | null>(null);
  const [eventVersion, setEventVersion] = useState(0);
  const stalenessTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!socket || !chatId) return;

    function handleInteractive({ chatId: cid, interactive }: { chatId: string; interactive: InteractiveState | null }) {
      if (cid !== chatId) return;
      setInteractiveState(interactive);
      setEventVersion(v => v + 1);

      // Reset staleness timer
      if (stalenessTimer.current) clearTimeout(stalenessTimer.current);
      if (interactive) {
        stalenessTimer.current = setTimeout(() => {
          setInteractiveState(null);
        }, STALENESS_TIMEOUT);
      }
    }

    function handleStatus({ chatId: cid, status }: { chatId: string; status: SessionStatus }) {
      if (cid !== chatId) return;
      if (status === 'thinking' || status === 'exited') {
        setInteractiveState(null);
        if (stalenessTimer.current) clearTimeout(stalenessTimer.current);
      }
    }

    socket.on('claude:interactive', handleInteractive);
    socket.on('claude:status', handleStatus);

    return () => {
      socket.off('claude:interactive', handleInteractive);
      socket.off('claude:status', handleStatus);
      if (stalenessTimer.current) clearTimeout(stalenessTimer.current);
    };
  }, [socket, chatId]);

  const sendKeyPress = useCallback((key: AllowedKey) => {
    if (!socket || !chatId) return;
    socket.emit('claude:key-sequence', { chatId, key });
  }, [socket, chatId]);

  const sendTextResponse = useCallback((text: string) => {
    if (!socket || !chatId) return;
    socket.emit('claude:confirm', { chatId, answer: text });
  }, [socket, chatId]);

  const writeToTerminal = useCallback((text: string) => {
    if (!socket || !chatId) return;
    socket.emit('claude:type', { chatId, text });
  }, [socket, chatId]);

  return {
    interactiveState,
    eventVersion,
    sendKeyPress,
    sendTextResponse,
    writeToTerminal,
  };
}
