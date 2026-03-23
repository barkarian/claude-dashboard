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
  isSelectionMode: boolean;
  write: (data: string) => void;
  stop: () => void;
  getPromptLine: () => string;
  onNextOutput: (cb: () => void) => void;
}

export function useClaudeCode(
  containerRef: RefObject<HTMLElement | null>,
  { socket, projectId, chatId, conversationId }: UseClaudeCodeOptions
): UseClaudeCodeReturn {
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [status, setStatus] = useState<'disconnected' | 'running' | 'exited' | 'error'>('disconnected');
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const selectionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const write = useCallback((data: string) => {
    if (socket) {
      socket.emit('cc:input', { chatId, data });
    }
  }, [socket, chatId]);

  const stop = useCallback(() => {
    if (socket) {
      socket.emit('cc:stop', { chatId });
    }
  }, [socket, chatId]);

  // Callback mechanism: wait for actual terminal output before reading the buffer.
  // Avoids stale reads caused by fixed timeouts that fire before PTY responds.
  const outputNotifyRef = useRef<(() => void) | null>(null);
  const outputTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onNextOutput = useCallback((cb: () => void) => {
    outputNotifyRef.current = cb;
    // Clear any existing timer and set a 500ms fallback in case no output arrives
    if (outputTimerRef.current) clearTimeout(outputTimerRef.current);
    outputTimerRef.current = setTimeout(() => {
      if (outputNotifyRef.current) {
        outputNotifyRef.current();
        outputNotifyRef.current = null;
      }
    }, 500);
  }, []);

  // Read the Claude Code prompt content from the terminal buffer.
  // Only extract when the prompt is the simple input form:
  //   ──────────  (separator)
  //   ❯ text      (single line starting with ❯)
  //   ──────────  (separator)
  // Menus, questions, multi-option screens are ignored — they have multiple
  // lines between separators or don't start with ❯.
  const getPromptLine = useCallback((): string => {
    const term = termRef.current;
    if (!term) return '';
    const buffer = term.buffer.active;

    const getLineText = (row: number): string => {
      const line = buffer.getLine(row);
      return line ? line.translateToString(true) : '';
    };

    const isSeparator = (text: string): boolean => {
      const t = text.trim();
      return t.length > 10 && /^[─━]+$/.test(t);
    };

    // Scan from the bottom of the buffer upward for the last two separators
    const end = buffer.length - 1;
    let bottomSep = -1;
    let topSep = -1;
    for (let row = end; row >= Math.max(0, end - 30); row--) {
      if (isSeparator(getLineText(row))) {
        if (bottomSep < 0) {
          bottomSep = row;
        } else {
          topSep = row;
          break;
        }
      }
    }
    if (topSep < 0 || bottomSep < 0 || bottomSep <= topSep + 1) return '';

    // Only extract when the first line after the top separator starts with ❯
    // (the simple input prompt). Menus/questions have other content first.
    const firstLine = getLineText(topSep + 1);
    if (!/^\s*❯/.test(firstLine)) return '';

    // Collect all lines between separators (message may be multi-line)
    const lines: string[] = [];
    for (let row = topSep + 1; row < bottomSep; row++) {
      let text = getLineText(row);
      if (row === topSep + 1) {
        text = text.replace(/^\s*❯\s*/, '');
      }
      lines.push(text);
    }
    return lines.join('\n').trim();
  }, []);

  // Detect whether the terminal is showing a numbered option menu (plan interview).
  // Returns true when ❯ is on a numbered option that isn't "Type something".
  const detectSelectionMode = useCallback((): boolean => {
    const term = termRef.current;
    if (!term) return false;
    const buffer = term.buffer.active;
    const end = buffer.length - 1;

    for (let row = end; row >= Math.max(0, end - 40); row--) {
      const line = buffer.getLine(row);
      if (!line) continue;
      const text = line.translateToString(true);
      // Match: optional spaces, ❯, optional spaces, digit(s), dot, space
      if (/^\s*❯\s*\d+\.\s/.test(text)) {
        // If the highlighted option is "Type something", it's not selection mode
        if (/type\s+something/i.test(text)) return false;
        return true;
      }
    }
    return false;
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
          right: '80px',   // leave scrollbar hit area clear
          zIndex: '40',
        });
        parentEl.appendChild(touchBlocker);

        // --- Always-visible draggable scrollbar ---
        const scrollTrack = document.createElement('div');
        const scrollThumb = document.createElement('div');
        Object.assign(scrollTrack.style, {
          position: 'absolute', top: '0', right: '0', width: '80px',
          height: '100%', zIndex: '50', pointerEvents: 'auto',
        });
        Object.assign(scrollThumb.style, {
          position: 'absolute', right: '4px', width: '12px',
          borderRadius: '6px', background: 'rgba(99, 102, 241, 0.5)',
          minHeight: '40px', opacity: '1',
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
        // If a caller is waiting for output, debounce 80ms to let chunks settle
        if (outputNotifyRef.current) {
          if (outputTimerRef.current) clearTimeout(outputTimerRef.current);
          outputTimerRef.current = setTimeout(() => {
            outputNotifyRef.current?.();
            outputNotifyRef.current = null;
          }, 80);
        }
        // Debounce selection mode detection
        if (selectionTimerRef.current) clearTimeout(selectionTimerRef.current);
        selectionTimerRef.current = setTimeout(() => {
          setIsSelectionMode(detectSelectionMode());
        }, 100);
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
      if (outputTimerRef.current) clearTimeout(outputTimerRef.current);
      if (selectionTimerRef.current) clearTimeout(selectionTimerRef.current);
      outputNotifyRef.current = null;
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

  return { terminal: termRef, status, isSelectionMode, write, stop, getPromptLine, onNextOutput };
}
