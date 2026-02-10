import { useRef, useEffect } from 'react';
import * as terminalStore from '../../lib/terminalStore.ts';
import '@xterm/xterm/css/xterm.css';

export default function ClaudeOutput({ chatId, socket }) {
  const wrapperRef = useRef(null);

  useEffect(() => {
    if (!wrapperRef.current || !socket) return;

    const isNew = !terminalStore.has(chatId);
    const entry = terminalStore.getOrCreate(chatId);

    // Move the terminal's DOM element into our wrapper
    wrapperRef.current.appendChild(entry.containerEl);

    // Bind socket output listener (persistent — survives unmount).
    // Returns true when this is a fresh binding (new terminal or socket changed).
    const newlyBound = terminalStore.bindSocket(chatId, socket);

    if (newlyBound) {
      if (!isNew) {
        // Socket reconnected on an existing terminal — clear stale content
        // before the buffer replay arrives
        entry.term.reset();
      }
      // Join the chat room + replay the server-side buffer
      socket.emit('claude:attach', { chatId });
    }

    // Fit to container (with mobile scaling)
    const wrapper = wrapperRef.current;
    function doFit() {
      terminalStore.fit(chatId, wrapper);
    }
    requestAnimationFrame(doFit);
    setTimeout(doFit, 100);
    setTimeout(doFit, 300);

    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(doFit);
    });
    resizeObserver.observe(wrapper);

    return () => {
      resizeObserver.disconnect();
      // Detach from DOM but keep terminal + socket listener alive in the store
      entry.containerEl.remove();
    };
  }, [socket, chatId]);

  return (
    <div ref={wrapperRef} className="h-full w-full relative overflow-hidden" />
  );
}
