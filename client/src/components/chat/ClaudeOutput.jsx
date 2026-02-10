import { useRef, useEffect } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

export default function ClaudeOutput({ chatId, socket }) {
  const wrapperRef = useRef(null);
  const containerRef = useRef(null);
  const termRef = useRef(null);
  const fitAddonRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || !socket) return;

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      theme: {
        background: '#0f1117',
        foreground: '#e2e8f0',
        cursor: '#e2e8f0',
        cursorAccent: '#0f1117',
        selectionBackground: 'rgba(99, 102, 241, 0.3)',
        black: '#1a1d27',
        red: '#ef4444',
        green: '#22c55e',
        yellow: '#f59e0b',
        blue: '#6366f1',
        magenta: '#a855f7',
        cyan: '#06b6d4',
        white: '#e2e8f0',
        brightBlack: '#64748b',
        brightRed: '#f87171',
        brightGreen: '#4ade80',
        brightYellow: '#fbbf24',
        brightBlue: '#818cf8',
        brightMagenta: '#c084fc',
        brightCyan: '#22d3ee',
        brightWhite: '#f8fafc',
      },
      disableStdin: true,
      scrollback: 10000,
      lineHeight: 1.1,
      convertEol: false,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    function doFit() {
      try {
        fitAddon.fit();
      } catch {}
    }

    // Fit after DOM settles
    requestAnimationFrame(doFit);
    setTimeout(doFit, 100);
    setTimeout(doFit, 300);

    // Attach to get buffer replay + live output
    socket.emit('claude:attach', { chatId });

    function handleOutput({ chatId: cid, data }) {
      if (cid !== chatId) return;
      term.write(data);
    }

    socket.on('claude:output', handleOutput);

    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(doFit);
    });
    if (wrapperRef.current) {
      resizeObserver.observe(wrapperRef.current);
    }

    return () => {
      socket.off('claude:output', handleOutput);
      resizeObserver.disconnect();
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
  }, [socket, chatId]);

  return (
    <div ref={wrapperRef} className="h-full w-full relative">
      <div
        ref={containerRef}
        className="absolute inset-0"
        style={{ padding: '4px' }}
      />
    </div>
  );
}
