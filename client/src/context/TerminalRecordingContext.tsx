import { createContext, useCallback, useRef, useState, useEffect, type ReactNode } from 'react';
import { useSocket } from './SocketContext.tsx';
import { stripAnsi } from '../utils/ansi.ts';
import api from '../utils/api.ts';

export interface RecordingScript {
  scriptId: string;
  label: string;
  command: string;
  fromStart?: boolean;
}

export interface Recording {
  id: string;
  scripts: RecordingScript[];
  lines: string[];       // ANSI-stripped (for prompt expansion)
  rawLines: string[];    // raw (for live preview)
  browserLines: string[];
  startedAt: number;
  stoppedAt: number | null;
}

export interface ActiveRecording {
  id: string;
  scripts: RecordingScript[];
  lines: string[];
  rawLines: string[];
  browserLines: string[];
  browserPorts: number[];
  startedAt: number;
  lineCount: number;
}

export interface TerminalRecordingContextValue {
  activeRecording: ActiveRecording | null;
  recordings: Map<string, Recording>;
  startRecording: (projectId: string, scripts: RecordingScript[], browserPorts?: number[]) => void;
  stopRecording: () => string | null;
  deleteRecording: (id: string) => void;
  getRecordingContent: (id: string) => string | null;
}

export const TerminalRecordingContext = createContext<TerminalRecordingContextValue | null>(null);

const MAX_LINES = 2000;
const THROTTLE_MS = 200;

let nextId = 1;
function generateId(): string {
  return String(nextId++).padStart(4, '0');
}

function formatBrowserLogLevel(level: string): string {
  switch (level) {
    case 'error': return '[ERROR]';
    case 'warn': return '[WARN]';
    case 'info': return '[INFO]';
    case 'debug': return '[DEBUG]';
    default: return '[LOG]';
  }
}

export function TerminalRecordingProvider({ children }: { children: ReactNode }) {
  const { socket } = useSocket();
  const [activeRecording, setActiveRecording] = useState<ActiveRecording | null>(null);
  const [recordings, setRecordings] = useState<Map<string, Recording>>(new Map());

  // Mutable buffer for capturing output without triggering renders on every line
  const bufferRef = useRef<{ lines: string[]; rawLines: string[]; browserLines: string[] }>({ lines: [], rawLines: [], browserLines: [] });
  const activeRef = useRef<{ id: string; projectId: string; scriptIds: Set<string>; scripts: RecordingScript[]; startedAt: number; skipNext: Map<string, boolean>; browserPorts: number[] } | null>(null);
  const throttleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushBuffer = useCallback(() => {
    if (!activeRef.current) return;
    const { lines, rawLines, browserLines } = bufferRef.current;
    setActiveRecording({
      id: activeRef.current.id,
      scripts: activeRef.current.scripts,
      lines: [...lines],
      rawLines: [...rawLines],
      browserLines: [...browserLines],
      browserPorts: activeRef.current.browserPorts,
      startedAt: activeRef.current.startedAt,
      lineCount: lines.length,
    });
  }, []);

  // Socket listener for terminal output
  useEffect(() => {
    if (!socket) return;

    const handleOutput = ({ scriptId, data }: { projectId: string; scriptId: string; data: string }) => {
      if (!activeRef.current || !activeRef.current.scriptIds.has(scriptId)) return;

      // Skip the first event per script (buffer replay) for "From Now" scripts
      if (activeRef.current.skipNext.get(scriptId)) {
        activeRef.current.skipNext.set(scriptId, false);
        return;
      }

      const buf = bufferRef.current;
      // Split incoming data into lines
      const rawChunks = data.split('\n');
      const cleanChunks = stripAnsi(data).split('\n');

      for (const chunk of rawChunks) {
        if (buf.rawLines.length < MAX_LINES) {
          buf.rawLines.push(chunk);
        }
      }
      for (const chunk of cleanChunks) {
        if (buf.lines.length < MAX_LINES) {
          buf.lines.push(chunk);
        }
      }

      // Throttled state update
      if (!throttleTimerRef.current) {
        throttleTimerRef.current = setTimeout(() => {
          throttleTimerRef.current = null;
          flushBuffer();
        }, THROTTLE_MS);
      }
    };

    socket.on('terminal:output', handleOutput);
    return () => {
      socket.off('terminal:output', handleOutput);
    };
  }, [socket, flushBuffer]);

  // Re-attach to terminal rooms when socket reconnects (room membership lost on disconnect)
  useEffect(() => {
    if (!socket) return;
    const handleReconnect = () => {
      if (!activeRef.current) return;
      const { projectId, scripts, browserPorts } = activeRef.current;
      for (const s of scripts) {
        socket.emit('terminal:attach', { projectId, scriptId: s.scriptId });
        // Skip the buffer replay to avoid capturing duplicate output
        activeRef.current.skipNext.set(s.scriptId, true);
      }
      for (const port of browserPorts) {
        socket.emit('browser-monitor:enable', { port });
      }
    };
    socket.io.on('reconnect', handleReconnect);
    return () => { socket.io.off('reconnect', handleReconnect); };
  }, [socket]);

  // Socket listener for browser console logs
  useEffect(() => {
    if (!socket) return;

    const handleBrowserLog = ({ port, level, message }: { port: number; level: string; message: string; timestamp: number }) => {
      if (!activeRef.current || !activeRef.current.browserPorts.includes(port)) return;

      const buf = bufferRef.current;
      const formatted = `${formatBrowserLogLevel(level)} ${message}`;
      if (buf.browserLines.length < MAX_LINES) {
        buf.browserLines.push(formatted);
      }

      // Throttled state update
      if (!throttleTimerRef.current) {
        throttleTimerRef.current = setTimeout(() => {
          throttleTimerRef.current = null;
          flushBuffer();
        }, THROTTLE_MS);
      }
    };

    socket.on('browser:log', handleBrowserLog);
    return () => {
      socket.off('browser:log', handleBrowserLog);
    };
  }, [socket, flushBuffer]);

  const startRecording = useCallback((projectId: string, scripts: RecordingScript[], browserPorts?: number[]) => {
    if (!socket || activeRef.current) return;

    const id = generateId();
    const scriptIds = new Set(scripts.map(s => s.scriptId));
    const skipNext = new Map<string, boolean>();
    const now = Date.now();
    const ports = browserPorts || [];
    for (const s of scripts) {
      // "From Now": skip the first terminal:output event (the buffer replay)
      skipNext.set(s.scriptId, !s.fromStart);
    }

    activeRef.current = { id, projectId, scriptIds, scripts, startedAt: now, skipNext, browserPorts: ports };
    bufferRef.current = { lines: [], rawLines: [], browserLines: [] };

    // Attach to terminal rooms for each script
    for (const s of scripts) {
      socket.emit('terminal:attach', { projectId, scriptId: s.scriptId });
    }

    // Enable browser monitoring for selected ports
    for (const port of ports) {
      socket.emit('browser-monitor:enable', { port });
    }

    setActiveRecording({
      id,
      scripts,
      lines: [],
      rawLines: [],
      browserLines: [],
      browserPorts: ports,
      startedAt: Date.now(),
      lineCount: 0,
    });
  }, [socket]);

  const stopRecording = useCallback((): string | null => {
    if (!activeRef.current || !socket) return null;

    const { id, projectId, scriptIds, scripts, startedAt, browserPorts } = activeRef.current;

    // Detach from terminal rooms
    for (const scriptId of scriptIds) {
      socket.emit('terminal:detach', { projectId, scriptId });
    }

    // Disable browser monitoring
    for (const port of browserPorts) {
      socket.emit('browser-monitor:disable', { port });
    }

    // Clear throttle timer and flush
    if (throttleTimerRef.current) {
      clearTimeout(throttleTimerRef.current);
      throttleTimerRef.current = null;
    }

    const recording: Recording = {
      id,
      scripts,
      lines: [...bufferRef.current.lines],
      rawLines: [...bufferRef.current.rawLines],
      browserLines: [...bufferRef.current.browserLines],
      startedAt,
      stoppedAt: Date.now(),
    };

    setRecordings(prev => {
      const next = new Map(prev);
      next.set(id, recording);
      return next;
    });

    // Persist to database
    api.post(`/api/projects/${projectId}/recordings`, {
      id,
      scripts: scripts.map(s => ({ scriptId: s.scriptId, label: s.label, command: s.command })),
      lines: recording.lines,
      browserLines: recording.browserLines,
      startedAt,
      stoppedAt: recording.stoppedAt,
    }).catch((err) => console.error('Failed to persist recording:', err));

    activeRef.current = null;
    bufferRef.current = { lines: [], rawLines: [], browserLines: [] };
    setActiveRecording(null);

    return id;
  }, [socket]);

  const deleteRecording = useCallback((id: string) => {
    setRecordings(prev => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const getRecordingContent = useCallback((id: string): string | null => {
    const rec = recordings.get(id);
    if (!rec) return null;

    const scriptNames = rec.scripts.map(s => s.label || s.command).join(', ');
    const duration = rec.stoppedAt
      ? `${Math.round((rec.stoppedAt - rec.startedAt) / 1000)}s`
      : 'ongoing';

    const header = `[Terminal Recording: ${scriptNames} | ${rec.lines.length} lines | ${duration}]`;
    const content = rec.lines.join('\n');
    let result = `${header}\n\`\`\`\n${content}\n\`\`\``;

    if (rec.browserLines.length > 0) {
      const browserHeader = `[Browser Console Logs: ${rec.browserLines.length} entries]`;
      const browserContent = rec.browserLines.join('\n');
      result += `\n\n${browserHeader}\n\`\`\`\n${browserContent}\n\`\`\``;
    }

    return result;
  }, [recordings]);

  return (
    <TerminalRecordingContext.Provider
      value={{ activeRecording, recordings, startRecording, stopRecording, deleteRecording, getRecordingContent }}
    >
      {children}
    </TerminalRecordingContext.Provider>
  );
}
