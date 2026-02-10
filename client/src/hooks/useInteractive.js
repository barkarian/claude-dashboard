import { useState, useEffect, useCallback, useRef } from 'react';

const STALENESS_TIMEOUT = 30000; // 30 seconds

export function useInteractive(socket, chatId) {
  const [interactiveState, setInteractiveState] = useState(null);
  const stalenessTimer = useRef(null);

  useEffect(() => {
    if (!socket || !chatId) return;

    function handleInteractive({ chatId: cid, interactive }) {
      if (cid !== chatId) return;
      setInteractiveState(interactive);

      // Reset staleness timer
      clearTimeout(stalenessTimer.current);
      if (interactive) {
        stalenessTimer.current = setTimeout(() => {
          setInteractiveState(null);
        }, STALENESS_TIMEOUT);
      }
    }

    function handleStatus({ chatId: cid, status }) {
      if (cid !== chatId) return;
      // Only clear interactive state when session is definitively done
      // Do NOT clear on 'idle' — the interactive detector will emit null
      // when the interactive UI is actually gone. Clearing on 'idle' causes
      // a race condition where status fires before the interactive event.
      if (status === 'thinking' || status === 'exited') {
        setInteractiveState(null);
        clearTimeout(stalenessTimer.current);
      }
    }

    socket.on('claude:interactive', handleInteractive);
    socket.on('claude:status', handleStatus);

    return () => {
      socket.off('claude:interactive', handleInteractive);
      socket.off('claude:status', handleStatus);
      clearTimeout(stalenessTimer.current);
    };
  }, [socket, chatId]);

  const sendKeyPress = useCallback((key) => {
    if (!socket || !chatId) return;
    socket.emit('claude:key-sequence', { chatId, key });
  }, [socket, chatId]);

  const sendTextResponse = useCallback((text) => {
    if (!socket || !chatId) return;
    socket.emit('claude:confirm', { chatId, answer: text });
  }, [socket, chatId]);

  return {
    interactiveState,
    sendKeyPress,
    sendTextResponse,
  };
}
