import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import '@xterm/xterm/css/xterm.css';
import type { Socket } from 'socket.io-client';
import { useTheme } from '../context/ThemeContext.tsx';

// Width in px that the container is stretched to before CSS-scaling back down.
// Lower = larger apparent font on mobile. Higher = smaller text, more content visible.
const WIDE_WIDTH = 500;

interface UseClaudeCodeOptions {
  socket: Socket | null;
  projectId: string;
  chatId: string;
  conversationId?: string | null;
}

export type TerminalPromptMode = null | { type: 'dismiss' } | { type: 'detail-view' };

interface UseClaudeCodeReturn {
  terminal: RefObject<Terminal | null>;
  status: 'disconnected' | 'running' | 'exited' | 'error';
  isSelectionMode: boolean;
  terminalPromptMode: TerminalPromptMode;
  write: (data: string) => void;
  stop: () => void;
  searchFindNext: (query: string, incremental?: boolean) => boolean;
  searchFindPrevious: (query: string) => boolean;
  searchClear: () => void;
}

export function useClaudeCode(
  containerRef: RefObject<HTMLElement | null>,
  { socket, projectId, chatId, conversationId }: UseClaudeCodeOptions
): UseClaudeCodeReturn {
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const [status, setStatus] = useState<'disconnected' | 'running' | 'exited' | 'error'>('disconnected');
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [terminalPromptMode, setTerminalPromptMode] = useState<TerminalPromptMode>(null);
  const selectionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { terminalTheme } = useTheme();

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

  // Detect whether the terminal is showing a numbered option menu (plan interview).
  // Returns true when ❯ is on a numbered option that isn't "Type something".
  const detectSelectionMode = useCallback((): boolean => {
    const term = termRef.current;
    if (!term) return false;
    const buffer = term.buffer.active;
    const cursorRow = buffer.baseY + buffer.cursorY;
    const scanStart = Math.min(buffer.length - 1, cursorRow + 5);

    for (let row = scanStart; row >= Math.max(0, scanStart - 40); row--) {
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

  // Detect interactive prompts at the bottom of the terminal:
  // - "Press Space, Enter, or Escape to dismiss"
  // - "← to go back · Esc/Enter/Space to close · x to stop"
  const detectTerminalPrompt = useCallback((): TerminalPromptMode => {
    const term = termRef.current;
    if (!term) return null;
    const buffer = term.buffer.active;
    const cursorRow = buffer.baseY + buffer.cursorY;
    const scanStart = Math.min(buffer.length - 1, cursorRow + 5);

    for (let row = scanStart; row >= Math.max(0, scanStart - 20); row--) {
      const line = buffer.getLine(row);
      if (!line) continue;
      const text = line.translateToString(true);
      // "← to go back · Esc/Enter/Space to close · x to stop"
      if (/go\s*back/i.test(text) && /close/i.test(text)) {
        return { type: 'detail-view' };
      }
      // "Press Space, Enter, or Escape to dismiss"
      if (/Space.*Enter.*Escape.*dismiss/i.test(text) || /press.*to\s+dismiss/i.test(text)) {
        return { type: 'dismiss' };
      }
    }
    return null;
  }, []);

  useEffect(() => {
    if (!containerRef.current || !socket) return;

    const isMobile = window.matchMedia('(max-width: 767px)').matches;

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      theme: terminalTheme,
      scrollback: 10000,
      scrollSensitivity: isMobile ? 5 : 1,
    });

    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(searchAddon);
    term.open(containerRef.current);

    termRef.current = term;
    fitAddonRef.current = fitAddon;
    searchAddonRef.current = searchAddon;

    // On mobile, prevent tapping the terminal from opening the keyboard
    // (user sends input via CCPromptInput instead)
    if (isMobile) {
      const textarea = containerRef.current?.querySelector('textarea');
      if (textarea) {
        textarea.setAttribute('inputmode', 'none');
        textarea.readOnly = true;
      }
    }

    // --- Scroll position guard ---
    // xterm.js can erroneously reset viewport.scrollTop during buffer
    // management (scrollback trimming, resize reflow) on very large buffers.
    // We track the last known good position and correct sudden jumps.
    const xviewport = containerRef.current?.querySelector('.xterm-viewport') as HTMLElement | null;
    let lastGoodScrollTop = 0;
    let lastGoodWasAtBottom = true;
    let scrollGuardRafId = 0;

    function captureScrollState() {
      if (!xviewport) return;
      lastGoodScrollTop = xviewport.scrollTop;
      lastGoodWasAtBottom = xviewport.scrollTop + xviewport.clientHeight >= xviewport.scrollHeight - 10;
    }

    // Schedule a post-frame check: if the viewport jumped to near-top
    // when it shouldn't have, correct it. Uses double-rAF to run after
    // xterm's own async rendering pipeline.
    function scheduleScrollCorrection() {
      if (scrollGuardRafId || !xviewport) return;
      const savedTop = lastGoodScrollTop;
      const wasBottom = lastGoodWasAtBottom;
      scrollGuardRafId = requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          scrollGuardRafId = 0;
          if (!xviewport) return;
          const { scrollTop, scrollHeight, clientHeight } = xviewport;
          const maxScroll = scrollHeight - clientHeight;
          if (maxScroll <= 0) return;
          const ratio = scrollTop / maxScroll;

          if (wasBottom && ratio < 0.5) {
            // Was at bottom but jumped away — snap back to bottom
            xviewport.scrollTop = scrollHeight;
          } else if (!wasBottom) {
            // User was reading earlier content (not at bottom).
            // Restore if the viewport drifted significantly — catches jumps
            // to BOTH top (desktop) and bottom (mobile/xterm cursor-follow).
            const drift = Math.abs(scrollTop - savedTop);
            if (drift > clientHeight * 0.25) {
              xviewport.scrollTop = Math.min(savedTop, maxScroll);
            }
          }
        });
      });
    }

    function doFit() {
      try {
        captureScrollState();
        fitAddon.fit();
        // Sync restore (immediate, prevents flicker in common case)
        if (xviewport) {
          if (lastGoodWasAtBottom) {
            xviewport.scrollTop = xviewport.scrollHeight;
          } else {
            xviewport.scrollTop = lastGoodScrollTop;
          }
        }
        // Async restore (catches xterm's deferred rendering overrides)
        scheduleScrollCorrection();
      } catch {}
    }

    // On mobile: stretch container so FitAddon computes wider cols, then scale down.
    // containerRef sits inside an absolutely-positioned wrapper whose parent has flex-1,
    // so parentElement gives us the correct available dimensions.
    const scaleTarget = containerRef.current!.parentElement;
    let currentScale = 1;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let lateTimer: ReturnType<typeof setTimeout> | null = null;

    function applyMobileScale() {
      const container = containerRef.current;
      if (!container || !scaleTarget) return;

      const parentW = (scaleTarget as HTMLElement).offsetWidth;
      const parentH = (scaleTarget as HTMLElement).offsetHeight;
      if (parentH === 0) {
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = setTimeout(applyMobileScale, 50);
        return;
      }
      const scale = Math.min(1, parentW / WIDE_WIDTH);
      currentScale = scale;

      container.style.width = `${WIDE_WIDTH}px`;
      container.style.height = `${parentH / scale}px`;
      container.style.transform = `scale(${scale})`;
      container.style.transformOrigin = 'top left';

      doFit();
    }

    // Fit or scale that tolerates zero-height containers during route transitions.
    // Also notifies the server so the PTY dimensions stay in sync.
    function fitWhenReady() {
      const prevCols = term.cols;
      const prevRows = term.rows;
      if (isMobile) {
        applyMobileScale();
      } else {
        const el = containerRef.current;
        if (el && el.offsetHeight === 0) {
          if (retryTimer) clearTimeout(retryTimer);
          retryTimer = setTimeout(fitWhenReady, 50);
          return;
        }
        doFit();
      }
      // Notify server when dimensions actually changed
      if (socket && (term.cols !== prevCols || term.rows !== prevRows)) {
        socket.emit('cc:resize', { chatId, cols: term.cols, rows: term.rows });
      }
    }

    // On mobile app, xterm's built-in touch scroll is broken by CSS scale transform.
    // Take full control of touch scrolling with scale compensation + momentum inertia.
    let touchCleanup: (() => void) | null = null;
    if (isMobile) {
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
      fitWhenReady();
    }

    // --- Scroll jump watchdog (desktop only) ---
    // Last line of defense: listens to viewport scroll events and corrects
    // sudden jumps from deep in the buffer to near-top. This catches jumps
    // from any source (term.write, resize, xterm internals) that wasn't
    // caught by the targeted guards above.
    let watchdogCleanup: (() => void) | null = null;
    if (!isMobile && xviewport) {
      let wdLastTop = 0;
      let wdLastRatio = 1; // start at bottom
      let wdCorrecting = false;

      const onViewportScroll = () => {
        if (wdCorrecting) return;
        const { scrollTop, scrollHeight, clientHeight } = xviewport;
        const maxScroll = scrollHeight - clientHeight;
        if (maxScroll <= 0) {
          wdLastTop = 0;
          wdLastRatio = 1;
          return;
        }
        const ratio = scrollTop / maxScroll;

        // Erroneous jump: was deep in buffer (>20%), now near top (<10%),
        // and buffer is large enough for this to be meaningful.
        const jumpedToTop = wdLastRatio > 0.2 && ratio < 0.10 && maxScroll > clientHeight * 2;
        // Erroneous jump: was NOT near bottom (<85%), now snapped to bottom (>98%).
        const jumpedToBottom = wdLastRatio < 0.85 && ratio > 0.98 && maxScroll > clientHeight * 2;
        if (jumpedToTop || jumpedToBottom) {
          wdCorrecting = true;
          const target = (jumpedToTop && wdLastRatio >= 0.95) ? scrollHeight : wdLastTop;
          xviewport.scrollTop = target;
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              xviewport.scrollTop = target;
              wdCorrecting = false;
              const ms = xviewport.scrollHeight - xviewport.clientHeight;
              wdLastTop = xviewport.scrollTop;
              wdLastRatio = ms > 0 ? xviewport.scrollTop / ms : 1;
            });
          });
          return;
        }

        wdLastTop = scrollTop;
        wdLastRatio = ratio;
      };

      xviewport.addEventListener('scroll', onViewportScroll, { passive: true });
      watchdogCleanup = () => xviewport.removeEventListener('scroll', onViewportScroll);
    }

    // Check if there's an existing session to attach to, otherwise start new.
    // Send current terminal dimensions so the PTY is created / resized to match.
    socket.emit('cc:check-session', { chatId }, (result: { exists: boolean; status?: string }) => {
      if (result.exists) {
        socket.emit('cc:attach', { chatId, cols: term.cols, rows: term.rows });
        setStatus(result.status === 'running' ? 'running' : 'exited');
      } else {
        socket.emit('cc:start', {
          projectId,
          chatId,
          conversationId: conversationId || undefined,
          cols: term.cols,
          rows: term.rows,
        });
      }
    });

    // Handle output
    const handleOutput = ({ chatId: cid, data }: { chatId: string; data: string }) => {
      if (cid === chatId) {
        captureScrollState();
        term.write(data);
        scheduleScrollCorrection();
        // Debounce selection mode + terminal prompt detection
        if (selectionTimerRef.current) clearTimeout(selectionTimerRef.current);
        selectionTimerRef.current = setTimeout(() => {
          setIsSelectionMode(detectSelectionMode());
          setTerminalPromptMode(detectTerminalPrompt());
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

    // Re-attach when socket reconnects — server loses room membership on disconnect,
    // so without this the terminal freezes (no cc:output received) and status goes stale.
    const handleReconnect = () => {
      socket.emit('cc:check-session', { chatId }, (result: { exists: boolean; status?: string }) => {
        if (result.exists) {
          socket.emit('cc:attach', { chatId, cols: term.cols, rows: term.rows });
          setStatus(result.status === 'running' ? 'running' : 'exited');
        } else {
          setStatus('exited');
        }
      });
      fitWhenReady();
    };
    socket.io.on('reconnect', handleReconnect);

    // Forward terminal keyboard input to the PTY.
    term.onData((data: string) => {
      socket.emit('cc:input', { chatId, data });
    });

    // Handle resize — single source of truth for both mobile and desktop.
    // Debounced to avoid rapid-fire fit() calls from subtle layout shifts
    // (e.g. scrollbar appearing/disappearing, CSS transitions) which cause
    // the viewport scroll position to jump.
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const resizeObserver = new ResizeObserver(() => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        try {
          fitWhenReady();
        } catch {
          // ignore resize errors
        }
      }, 100);
    });

    const observeTarget = scaleTarget || containerRef.current;
    resizeObserver.observe(observeTarget);

    // Explicit initial fit after observer setup, plus a safety-net timeout
    // to catch late layout changes (CSS transitions, route animations, etc.)
    fitWhenReady();
    lateTimer = setTimeout(fitWhenReady, 350);

    // Re-fit once web fonts are loaded — xterm measures cell dimensions on
    // open() using whatever font is available; if the custom font (JetBrains
    // Mono) hasn't loaded yet the metrics are wrong, producing a layout that
    // looks "slightly too big". This single line fixes both desktop & mobile.
    document.fonts.ready.then(fitWhenReady);

    return () => {
      if (selectionTimerRef.current) clearTimeout(selectionTimerRef.current);
      if (retryTimer) clearTimeout(retryTimer);
      if (lateTimer) clearTimeout(lateTimer);
      if (resizeTimer) clearTimeout(resizeTimer);
      if (scrollGuardRafId) cancelAnimationFrame(scrollGuardRafId);
      watchdogCleanup?.();
      touchCleanup?.();
      socket.off('cc:output', handleOutput);
      socket.off('cc:status', handleStatus);
      socket.off('cc:exit', handleExit);
      socket.off('cc:error', handleError);
      socket.io.off('reconnect', handleReconnect);
      socket.emit('cc:detach', { chatId });
      resizeObserver.disconnect();
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
      searchAddonRef.current = null;
    };
  }, [containerRef, socket, projectId, chatId, terminalTheme]);

  const searchFindNext = useCallback((query: string, incremental?: boolean): boolean => {
    return searchAddonRef.current?.findNext(query, {
      incremental,
      decorations: {
        matchBackground: '#5c4a0a',
        activeMatchBackground: '#8a6f0f',
        matchBorder: '#eab308',
        activeMatchBorder: '#facc15',
        matchOverviewRuler: '#eab308',
        activeMatchColorOverviewRuler: '#facc15',
      },
    }) ?? false;
  }, []);

  const searchFindPrevious = useCallback((query: string): boolean => {
    return searchAddonRef.current?.findPrevious(query, {
      decorations: {
        matchBackground: '#5c4a0a',
        activeMatchBackground: '#8a6f0f',
        matchBorder: '#eab308',
        activeMatchBorder: '#facc15',
        matchOverviewRuler: '#eab308',
        activeMatchColorOverviewRuler: '#facc15',
      },
    }) ?? false;
  }, []);

  const searchClear = useCallback(() => {
    searchAddonRef.current?.clearDecorations();
  }, []);

  return { terminal: termRef, status, isSelectionMode, terminalPromptMode, write, stop, searchFindNext, searchFindPrevious, searchClear };
}
