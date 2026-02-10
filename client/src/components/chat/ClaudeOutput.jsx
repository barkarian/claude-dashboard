import { useRef, useEffect } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

// Width in px that comfortably fits ~120 cols at fontSize 14
const WIDE_WIDTH = 1024;

export default function ClaudeOutput({ chatId, socket }) {
  const wrapperRef = useRef(null);
  const containerRef = useRef(null);
  const termRef = useRef(null);
  const fitAddonRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || !socket) return;

    const isMobile = window.matchMedia('(max-width: 767px)').matches;

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

    // On mobile: stretch the container to WIDE_WIDTH so FitAddon computes ~120 cols,
    // then CSS-scale it back down to fit the visible wrapper.
    function applyMobileScale() {
      const wrapper = wrapperRef.current;
      const container = containerRef.current;
      if (!wrapper || !container) return;

      const wrapperW = wrapper.offsetWidth;
      const wrapperH = wrapper.offsetHeight;
      const scale = Math.min(1, wrapperW / WIDE_WIDTH);

      container.style.width = `${WIDE_WIDTH}px`;
      container.style.height = `${wrapperH / scale}px`;
      container.style.transform = `scale(${scale})`;
      container.style.transformOrigin = 'top left';

      // FitAddon now sees the large un-scaled container → ~120 cols
      doFit();
    }

    if (isMobile) {
      requestAnimationFrame(applyMobileScale);
      setTimeout(applyMobileScale, 100);
      setTimeout(applyMobileScale, 300);
    } else {
      requestAnimationFrame(doFit);
      setTimeout(doFit, 100);
      setTimeout(doFit, 300);
    }

    // Attach to get buffer replay + live output
    socket.emit('claude:attach', { chatId });

    function handleOutput({ chatId: cid, data }) {
      if (cid !== chatId) return;
      term.write(data);
    }

    socket.on('claude:output', handleOutput);

    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(isMobile ? applyMobileScale : doFit);
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
    <div ref={wrapperRef} className="h-full w-full relative overflow-hidden">
      <div
        ref={containerRef}
        className="absolute top-0 left-0 right-0 bottom-0"
        style={{ padding: '4px' }}
      />
    </div>
  );
}
