import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import '@xterm/xterm/css/xterm.css';
import type { Socket } from 'socket.io-client';
import { useTheme } from '../context/ThemeContext.tsx';

// Width in px that the container is stretched to before CSS-scaling back down.
// Lower = larger apparent font on mobile. 400 → ~2× the previous 800 value.
const WIDE_WIDTH = 400;

interface UseTerminalOptions {
  socket: Socket | null;
  projectId: string;
  scriptId: string;
  readOnly?: boolean;
  wrapperRef?: RefObject<HTMLElement | null> | null;
}

interface UseTerminalReturn {
  terminal: RefObject<Terminal | null>;
  fitAddon: RefObject<FitAddon | null>;
  status: string;
  searchFindNext: (query: string, incremental?: boolean) => boolean;
  searchFindPrevious: (query: string) => boolean;
  searchClear: () => void;
}

export function useTerminal(
  containerRef: RefObject<HTMLElement | null>,
  { socket, projectId, scriptId, readOnly = false, wrapperRef = null }: UseTerminalOptions
): UseTerminalReturn {
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const [status, setStatus] = useState('disconnected');
  const { terminalTheme } = useTheme();

  useEffect(() => {
    if (!containerRef.current || !socket) return;

    const isMobile = window.matchMedia('(max-width: 767px)').matches;

    const term = new Terminal({
      cursorBlink: !readOnly,
      cursorStyle: 'block',
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      theme: terminalTheme,
      disableStdin: readOnly,
      scrollback: 5000,
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

    function doFit() {
      try {
        fitAddon.fit();
      } catch {}
    }

    // On mobile: stretch container so FitAddon computes wider cols, then scale down.
    // containerRef sits inside an absolutely-positioned wrapper whose parent has flex-1,
    // so parentElement gives us the correct available dimensions.
    const scaleTarget = wrapperRef?.current || containerRef.current!.parentElement;
    let currentScale = 1;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
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

    function fitWhenReady() {
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
    }

    // On mobile app, xterm's built-in touch scroll is broken by CSS scale transform.
    // Take full control of touch scrolling with scale compensation + momentum inertia.
    let touchCleanup: (() => void) | null = null;
    if (isMobile) {
      const viewport = containerRef.current?.querySelector('.xterm-viewport') as HTMLElement;
      if (viewport) {
        const parentEl = scaleTarget || containerRef.current!;

        // Touch blocker overlay — absorbs touches so xterm's JS touch-scroll never fires.
        // Touches still bubble to document for SwipeHandler gesture detection.
        const touchBlocker = document.createElement('div');
        Object.assign(touchBlocker.style, {
          position: 'absolute', top: '0', left: '0', bottom: '0',
          right: '20px', zIndex: '40',
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

    // Attach to existing terminal session
    socket.emit('terminal:attach', { projectId, scriptId });

    // Handle output
    const handleOutput = ({ projectId: pid, scriptId: sid, data }: { projectId: string; scriptId: string; data: string }) => {
      if (pid === projectId && sid === scriptId) {
        term.write(data);
      }
    };

    const handleStatus = ({ projectId: pid, scriptId: sid, status: s }: { projectId: string; scriptId: string; status: string }) => {
      if (pid === projectId && sid === scriptId) {
        setStatus(s);
      }
    };

    const handleExit = ({ projectId: pid, scriptId: sid, exitCode }: { projectId: string; scriptId: string; exitCode: number }) => {
      if (pid === projectId && sid === scriptId) {
        setStatus('exited');
        term.write(`\r\n\x1b[33m[Process exited with code ${exitCode}]\x1b[0m\r\n`);
      }
    };

    socket.on('terminal:output', handleOutput);
    socket.on('terminal:status', handleStatus);
    socket.on('terminal:exit', handleExit);

    // Handle user input
    if (!readOnly) {
      term.onData((data: string) => {
        socket.emit('terminal:input', { projectId, scriptId, data });
      });
    }

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      try {
        fitWhenReady();
        if (!readOnly) {
          socket.emit('terminal:resize', {
            projectId,
            scriptId,
            cols: term.cols,
            rows: term.rows,
          });
        }
      } catch {
        // ignore resize errors
      }
    });

    resizeObserver.observe(scaleTarget || containerRef.current);

    // Re-fit once web fonts are loaded — xterm measures cell dimensions on
    // open() using whatever font is available; if JetBrains Mono hasn't
    // loaded yet the metrics are wrong, producing a misfit layout.
    fitWhenReady();
    const lateTimer = setTimeout(fitWhenReady, 350);
    document.fonts.ready.then(fitWhenReady);

    setStatus('connected');

    return () => {
      if (retryTimer) clearTimeout(retryTimer);
      if (lateTimer) clearTimeout(lateTimer);
      touchCleanup?.();
      socket.off('terminal:output', handleOutput);
      socket.off('terminal:status', handleStatus);
      socket.off('terminal:exit', handleExit);
      socket.emit('terminal:detach', { projectId, scriptId });
      resizeObserver.disconnect();
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
      searchAddonRef.current = null;
    };
  }, [containerRef, socket, projectId, scriptId, readOnly, wrapperRef, terminalTheme]);

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

  return { terminal: termRef, fitAddon: fitAddonRef, status, searchFindNext, searchFindPrevious, searchClear };
}
