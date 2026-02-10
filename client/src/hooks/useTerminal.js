import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

export function useTerminal(containerRef, { socket, projectId, scriptId, readOnly = false }) {
  const termRef = useRef(null);
  const fitAddonRef = useRef(null);
  const [status, setStatus] = useState('disconnected');

  useEffect(() => {
    if (!containerRef.current || !socket) return;

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
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);

    try {
      fitAddon.fit();
    } catch {
      // Container might not be visible yet
    }

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // Attach to existing terminal session
    socket.emit('terminal:attach', { projectId, scriptId });

    // Handle output
    const handleOutput = ({ projectId: pid, scriptId: sid, data }) => {
      if (pid === projectId && sid === scriptId) {
        term.write(data);
      }
    };

    const handleStatus = ({ projectId: pid, scriptId: sid, status: s }) => {
      if (pid === projectId && sid === scriptId) {
        setStatus(s);
      }
    };

    const handleExit = ({ projectId: pid, scriptId: sid, exitCode }) => {
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
      term.onData((data) => {
        socket.emit('terminal:input', { projectId, scriptId, data });
      });
    }

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit();
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

    resizeObserver.observe(containerRef.current);

    setStatus('connected');

    return () => {
      socket.off('terminal:output', handleOutput);
      socket.off('terminal:status', handleStatus);
      socket.off('terminal:exit', handleExit);
      socket.emit('terminal:detach', { projectId, scriptId });
      resizeObserver.disconnect();
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
  }, [containerRef, socket, projectId, scriptId, readOnly]);

  return { terminal: termRef, fitAddon: fitAddonRef, status };
}
