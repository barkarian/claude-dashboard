import { useEffect, useRef, useState, type RefObject } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { Socket } from 'socket.io-client';

// Width in px that fits ~58 cols at fontSize 14 (mobile-friendly, keeps Claude Code UI readable)
const WIDE_WIDTH = 800;

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
}

export function useTerminal(
  containerRef: RefObject<HTMLElement | null>,
  { socket, projectId, scriptId, readOnly = false, wrapperRef = null }: UseTerminalOptions
): UseTerminalReturn {
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [status, setStatus] = useState('disconnected');

  useEffect(() => {
    if (!containerRef.current || !socket) return;

    const isMobile = window.matchMedia('(max-width: 767px)').matches;

    const term = new Terminal({
      cursorBlink: !readOnly,
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
      disableStdin: readOnly,
      scrollback: 5000,
      scrollSensitivity: isMobile ? 5 : 1,
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

    // On mobile: stretch container so FitAddon computes wider cols, then scale down.
    // containerRef sits inside an absolutely-positioned wrapper whose parent has flex-1,
    // so parentElement gives us the correct available dimensions.
    const scaleTarget = wrapperRef?.current || containerRef.current!.parentElement;
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
        // --- Custom scroll indicator (iOS ignores ::-webkit-scrollbar) ---
        const scrollTrack = document.createElement('div');
        const scrollThumb = document.createElement('div');
        Object.assign(scrollTrack.style, {
          position: 'absolute', top: '0', right: '0', width: '5px',
          height: '100%', zIndex: '50', pointerEvents: 'none',
        });
        Object.assign(scrollThumb.style, {
          position: 'absolute', right: '0', width: '5px',
          borderRadius: '3px', background: 'rgba(99, 102, 241, 0.5)',
          minHeight: '30px', transition: 'opacity 0.3s',
          opacity: '0',
        });
        scrollTrack.appendChild(scrollThumb);
        (scaleTarget || containerRef.current!).appendChild(scrollTrack);

        let hideTimer = 0;
        function updateScrollIndicator() {
          const { scrollTop, scrollHeight, clientHeight } = viewport;
          if (scrollHeight <= clientHeight) {
            scrollThumb.style.opacity = '0';
            return;
          }
          const trackH = (scaleTarget as HTMLElement).offsetHeight;
          const ratio = clientHeight / scrollHeight;
          const thumbH = Math.max(30, trackH * ratio);
          const maxTop = trackH - thumbH;
          const thumbTop = (scrollTop / (scrollHeight - clientHeight)) * maxTop;
          scrollThumb.style.height = `${thumbH}px`;
          scrollThumb.style.top = `${thumbTop}px`;
          scrollThumb.style.opacity = '1';
          clearTimeout(hideTimer);
          hideTimer = window.setTimeout(() => { scrollThumb.style.opacity = '0'; }, 1200);
        }

        let lastTouchY = 0;
        let lastMoveTime = 0;
        let velocity = 0;          // px per ms (in viewport-space)
        let momentumRaf = 0;

        const onTouchStart = (e: TouchEvent) => {
          // Stop any ongoing momentum animation
          if (momentumRaf) {
            cancelAnimationFrame(momentumRaf);
            momentumRaf = 0;
          }
          lastTouchY = e.touches[0].clientY;
          lastMoveTime = performance.now();
          velocity = 0;
        };

        const onTouchMove = (e: TouchEvent) => {
          const currentY = e.touches[0].clientY;
          const now = performance.now();
          const delta = lastTouchY - currentY;          // positive = scroll down
          const dt = now - lastMoveTime;

          // Track velocity with exponential smoothing to avoid jitter
          if (dt > 0) {
            const instantV = delta / dt;                // px/ms in screen-space
            velocity = velocity * 0.4 + instantV * 0.6;
          }

          lastTouchY = currentY;
          lastMoveTime = now;

          // Compensate for CSS scale + speed boost so scrolling feels native-fast
          viewport.scrollTop += (delta / currentScale) * 1.8;
          updateScrollIndicator();
          e.preventDefault();
        };

        const onTouchEnd = () => {
          // Kick off momentum / inertia scrolling
          const FRICTION = 0.965;       // per-frame decay (higher = longer coast)
          const MIN_V   = 0.02;         // px/ms threshold to stop
          const FRAME   = 16;           // ~60 fps frame budget in ms

          const coast = () => {
            if (Math.abs(velocity) < MIN_V) {
              velocity = 0;
              momentumRaf = 0;
              updateScrollIndicator();
              return;
            }
            viewport.scrollTop += (velocity * FRAME) / currentScale;
            velocity *= FRICTION;
            updateScrollIndicator();
            momentumRaf = requestAnimationFrame(coast);
          };

          if (Math.abs(velocity) >= MIN_V) {
            momentumRaf = requestAnimationFrame(coast);
          }
        };

        viewport.addEventListener('touchstart', onTouchStart, { passive: true });
        viewport.addEventListener('touchmove', onTouchMove, { passive: false });
        viewport.addEventListener('touchend', onTouchEnd, { passive: true });
        viewport.addEventListener('touchcancel', onTouchEnd, { passive: true });
        touchCleanup = () => {
          if (momentumRaf) cancelAnimationFrame(momentumRaf);
          clearTimeout(hideTimer);
          scrollTrack.remove();
          viewport.removeEventListener('touchstart', onTouchStart);
          viewport.removeEventListener('touchmove', onTouchMove);
          viewport.removeEventListener('touchend', onTouchEnd);
          viewport.removeEventListener('touchcancel', onTouchEnd);
        };
      }
    } else {
      doFit();
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
        if (isMobile) {
          applyMobileScale();
        } else {
          fitAddon.fit();
        }
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

    setStatus('connected');

    return () => {
      touchCleanup?.();
      socket.off('terminal:output', handleOutput);
      socket.off('terminal:status', handleStatus);
      socket.off('terminal:exit', handleExit);
      socket.emit('terminal:detach', { projectId, scriptId });
      resizeObserver.disconnect();
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
  }, [containerRef, socket, projectId, scriptId, readOnly, wrapperRef]);

  return { terminal: termRef, fitAddon: fitAddonRef, status };
}
