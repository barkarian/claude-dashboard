import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { Socket } from 'socket.io-client';

// Width in px that fits ~58 cols at fontSize 14 (mobile-friendly, keeps Claude Code UI readable)
const WIDE_WIDTH = 800;

interface UseClaudeCodeOptions {
  socket: Socket | null;
  projectId: string;
  chatId: string;
  conversationId?: string | null;
}

interface UseClaudeCodeReturn {
  terminal: RefObject<Terminal | null>;
  status: 'disconnected' | 'running' | 'exited' | 'error';
  write: (data: string) => void;
  stop: () => void;
  getPromptLine: () => string;
}

export function useClaudeCode(
  containerRef: RefObject<HTMLElement | null>,
  { socket, projectId, chatId, conversationId }: UseClaudeCodeOptions
): UseClaudeCodeReturn {
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [status, setStatus] = useState<'disconnected' | 'running' | 'exited' | 'error'>('disconnected');

  function write(data: string) {
    if (socket) {
      socket.emit('cc:input', { chatId, data });
    }
  }

  function stop() {
    if (socket) {
      socket.emit('cc:stop', { chatId });
    }
  }

  // Read the current terminal line and extract text after the prompt symbol.
  // Used to sync history recall (arrow up/down) into the textarea input.
  const getPromptLine = useCallback((): string => {
    const term = termRef.current;
    if (!term) return '';
    const buffer = term.buffer.active;
    const lineIndex = buffer.baseY + buffer.cursorY;
    const line = buffer.getLine(lineIndex);
    if (!line) return '';
    const raw = line.translateToString(true);
    // Strip prompt prefix: common prompt symbols (❯ > › $ % #) followed by space
    const match = raw.match(/^\s*[❯>›$%#]\s+(.*)/);
    return match ? match[1].trim() : '';
  }, []);

  useEffect(() => {
    if (!containerRef.current || !socket) return;

    const isMobile = window.matchMedia('(max-width: 767px)').matches;

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
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
      scrollback: 10000,
      scrollSensitivity: isMobile ? 5 : 1,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // On mobile, prevent tapping the terminal from opening the keyboard
    // (user sends input via CCPromptInput instead)
    if (isMobile) {
      const textarea = containerRef.current?.querySelector('textarea');
      if (textarea) {
        textarea.setAttribute('inputmode', 'none');
        textarea.readOnly = true;
      }
    }

    function doFit() {
      try {
        fitAddon.fit();
      } catch {}
    }

    // On mobile: stretch container so FitAddon computes wider cols, then scale down.
    // containerRef sits inside an absolutely-positioned wrapper whose parent has flex-1,
    // so parentElement gives us the correct available dimensions.
    const scaleTarget = containerRef.current!.parentElement;
    let currentScale = 1;
    function applyMobileScale() {
      const container = containerRef.current;
      if (!container || !scaleTarget) return;

      const parentW = (scaleTarget as HTMLElement).offsetWidth;
      const parentH = (scaleTarget as HTMLElement).offsetHeight;
      if (parentH === 0) return;
      const scale = Math.min(1, parentW / WIDE_WIDTH);
      currentScale = scale;

      container.style.width = `${WIDE_WIDTH}px`;
      container.style.height = `${parentH / scale}px`;
      container.style.transform = `scale(${scale})`;
      container.style.transformOrigin = 'top left';

      doFit();
    }

    // On mobile app, xterm's built-in touch scroll is broken by CSS scale transform.
    // Take full control of touch scrolling with scale compensation + momentum inertia.
    let touchCleanup: (() => void) | null = null;
    if (isMobile) {
      requestAnimationFrame(applyMobileScale);
      setTimeout(applyMobileScale, 100);

      const viewport = containerRef.current?.querySelector('.xterm-viewport') as HTMLElement;
      if (viewport) {
        const parentEl = scaleTarget || containerRef.current!;

        // --- Touch blocker overlay ---
        // Sits on top of xterm so its JS touch-scroll handler never fires.
        // Touches still bubble to document for SwipeHandler gesture detection.
        // Scrollbar track (z-index 50) sits above this so it stays interactive.
        const touchBlocker = document.createElement('div');
        Object.assign(touchBlocker.style, {
          position: 'absolute', top: '0', left: '0', bottom: '0',
          right: '20px',   // leave scrollbar hit area clear
          zIndex: '40',
        });
        parentEl.appendChild(touchBlocker);

        // --- Always-visible draggable scrollbar ---
        const scrollTrack = document.createElement('div');
        const scrollThumb = document.createElement('div');
        Object.assign(scrollTrack.style, {
          position: 'absolute', top: '0', right: '0', width: '20px',
          height: '100%', zIndex: '50', pointerEvents: 'auto',
        });
        Object.assign(scrollThumb.style, {
          position: 'absolute', right: '2px', width: '6px',
          borderRadius: '3px', background: 'rgba(99, 102, 241, 0.5)',
          minHeight: '30px', opacity: '1',
        });
        scrollTrack.appendChild(scrollThumb);
        parentEl.appendChild(scrollTrack);

        function updateScrollbar() {
          const { scrollTop, scrollHeight, clientHeight } = viewport;
          if (scrollHeight <= clientHeight) {
            scrollThumb.style.opacity = '0.15';
            return;
          }
          scrollThumb.style.opacity = '1';
          const trackH = (parentEl as HTMLElement).offsetHeight;
          const ratio = clientHeight / scrollHeight;
          const thumbH = Math.max(30, trackH * ratio);
          const maxTop = trackH - thumbH;
          const thumbTop = (scrollTop / (scrollHeight - clientHeight)) * maxTop;
          scrollThumb.style.height = `${thumbH}px`;
          scrollThumb.style.top = `${thumbTop}px`;
        }
        requestAnimationFrame(updateScrollbar);

        // --- Thumb drag (stopPropagation prevents SwipeHandler conflict) ---
        let dragging = false;
        let dragStartY = 0;
        let dragStartScrollTop = 0;

        function onThumbTouchStart(e: TouchEvent) {
          e.stopPropagation();
          dragging = true;
          dragStartY = e.touches[0].clientY;
          dragStartScrollTop = viewport.scrollTop;
          scrollThumb.style.background = 'rgba(99, 102, 241, 0.8)';
        }
        function onDragMove(e: TouchEvent) {
          if (!dragging) return;
          e.preventDefault();
          const dy = e.touches[0].clientY - dragStartY;
          const trackH = (parentEl as HTMLElement).offsetHeight;
          const { scrollHeight, clientHeight } = viewport;
          const scrollRange = scrollHeight - clientHeight;
          const ratio = clientHeight / scrollHeight;
          const thumbH = Math.max(30, trackH * ratio);
          const trackRange = trackH - thumbH;
          if (trackRange <= 0) return;
          viewport.scrollTop = dragStartScrollTop + (dy / trackRange) * scrollRange;
          updateScrollbar();
        }
        function onDragEnd() {
          if (!dragging) return;
          dragging = false;
          scrollThumb.style.background = 'rgba(99, 102, 241, 0.5)';
        }

        // Tap on track: jump scroll position
        function onTrackTap(e: TouchEvent) {
          if (e.target === scrollThumb) return;
          e.stopPropagation();
          const trackRect = scrollTrack.getBoundingClientRect();
          const tapY = e.touches[0].clientY - trackRect.top;
          const { scrollHeight, clientHeight } = viewport;
          viewport.scrollTop = (tapY / trackRect.height) * (scrollHeight - clientHeight);
          updateScrollbar();
        }

        scrollThumb.addEventListener('touchstart', onThumbTouchStart, { passive: false });
        scrollTrack.addEventListener('touchstart', onTrackTap, { passive: false });
        document.addEventListener('touchmove', onDragMove, { passive: false });
        document.addEventListener('touchend', onDragEnd, { passive: true });
        document.addEventListener('touchcancel', onDragEnd, { passive: true });

        // Keep scrollbar in sync when terminal content changes
        viewport.addEventListener('scroll', updateScrollbar, { passive: true });
        const contentObserver = new MutationObserver(updateScrollbar);
        contentObserver.observe(viewport, { childList: true, subtree: true, characterData: true });

        touchCleanup = () => {
          touchBlocker.remove();
          scrollTrack.remove();
          contentObserver.disconnect();
          viewport.removeEventListener('scroll', updateScrollbar);
          scrollThumb.removeEventListener('touchstart', onThumbTouchStart);
          scrollTrack.removeEventListener('touchstart', onTrackTap);
          document.removeEventListener('touchmove', onDragMove);
          document.removeEventListener('touchend', onDragEnd);
          document.removeEventListener('touchcancel', onDragEnd);
        };
      }
    } else {
      doFit();
    }

    // Check if there's an existing session to attach to, otherwise start new
    socket.emit('cc:check-session', { chatId }, (result: { exists: boolean; status?: string }) => {
      if (result.exists) {
        socket.emit('cc:attach', { chatId });
        setStatus(result.status === 'running' ? 'running' : 'exited');
      } else {
        socket.emit('cc:start', {
          projectId,
          chatId,
          conversationId: conversationId || undefined,
        });
      }
    });

    // Handle output
    const handleOutput = ({ chatId: cid, data }: { chatId: string; data: string }) => {
      if (cid === chatId) {
        term.write(data);
      }
    };

    const handleStatus = ({ chatId: cid, status: s }: { chatId: string; status: string }) => {
      if (cid === chatId) {
        setStatus(s as 'running' | 'exited' | 'error');
      }
    };

    const handleExit = ({ chatId: cid, exitCode }: { chatId: string; exitCode: number }) => {
      if (cid === chatId) {
        setStatus('exited');
        term.write(`\r\n\x1b[33m[Claude Code exited with code ${exitCode}]\x1b[0m\r\n`);
      }
    };

    const handleError = ({ chatId: cid, error }: { chatId: string; error: string }) => {
      if (cid === chatId) {
        setStatus('error');
        term.write(`\r\n\x1b[31m[Error: ${error}]\x1b[0m\r\n`);
      }
    };

    socket.on('cc:output', handleOutput);
    socket.on('cc:status', handleStatus);
    socket.on('cc:exit', handleExit);
    socket.on('cc:error', handleError);

    // Forward terminal keyboard input to the PTY
    term.onData((data: string) => {
      socket.emit('cc:input', { chatId, data });
    });

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      try {
        if (isMobile) {
          applyMobileScale();
        } else {
          fitAddon.fit();
        }
        socket.emit('cc:resize', {
          chatId,
          cols: term.cols,
          rows: term.rows,
        });
      } catch {
        // ignore resize errors
      }
    });

    resizeObserver.observe(scaleTarget || containerRef.current);

    return () => {
      touchCleanup?.();
      socket.off('cc:output', handleOutput);
      socket.off('cc:status', handleStatus);
      socket.off('cc:exit', handleExit);
      socket.off('cc:error', handleError);
      socket.emit('cc:detach', { chatId });
      resizeObserver.disconnect();
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
  }, [containerRef, socket, projectId, chatId]);

  return { terminal: termRef, status, write, stop, getPromptLine };
}
