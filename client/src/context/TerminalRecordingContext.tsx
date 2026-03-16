import { createContext, useCallback, useRef, useState, useEffect, type ReactNode } from 'react';
import { useSocket } from './SocketContext.tsx';
import { stripAnsi } from '../utils/ansi.ts';
import api from '../utils/api.ts';
import type { AppActivityEventUnion } from '../../../shared/types/appActivity.ts';

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
  activityEvents: AppActivityEventUnion[];
  monitoredPorts: number[];
  startedAt: number;
  stoppedAt: number | null;
}

export interface ActiveRecording {
  id: string;
  scripts: RecordingScript[];
  lines: string[];
  rawLines: string[];
  activityEvents: AppActivityEventUnion[];
  monitoredPorts: number[];
  startedAt: number;
  lineCount: number;
  activityCount: number;
}

export interface TerminalRecordingContextValue {
  activeRecording: ActiveRecording | null;
  recordings: Map<string, Recording>;
  startRecording: (projectId: string, scripts: RecordingScript[]) => void;
  stopRecording: () => string | null;
  deleteRecording: (id: string) => void;
  getRecordingContent: (id: string) => string | null;
}

export const TerminalRecordingContext = createContext<TerminalRecordingContextValue | null>(null);

const MAX_LINES = 2000;
const MAX_ACTIVITY_EVENTS = 2000;
const THROTTLE_MS = 200;

let nextId = 1;
function generateId(): string {
  return String(nextId++).padStart(4, '0');
}

export function TerminalRecordingProvider({ children }: { children: ReactNode }) {
  const { socket } = useSocket();
  const [activeRecording, setActiveRecording] = useState<ActiveRecording | null>(null);
  const [recordings, setRecordings] = useState<Map<string, Recording>>(new Map());

  // Mutable buffer for capturing output without triggering renders on every line
  const bufferRef = useRef<{ lines: string[]; rawLines: string[]; activityEvents: AppActivityEventUnion[] }>({ lines: [], rawLines: [], activityEvents: [] });
  const activeRef = useRef<{ id: string; projectId: string; scriptIds: Set<string>; scripts: RecordingScript[]; startedAt: number; skipNext: Map<string, boolean>; monitoredPorts: number[] } | null>(null);
  const throttleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushBuffer = useCallback(() => {
    if (!activeRef.current) return;
    const { lines, rawLines, activityEvents } = bufferRef.current;
    setActiveRecording({
      id: activeRef.current.id,
      scripts: activeRef.current.scripts,
      lines: [...lines],
      rawLines: [...rawLines],
      activityEvents: [...activityEvents],
      monitoredPorts: activeRef.current.monitoredPorts,
      startedAt: activeRef.current.startedAt,
      lineCount: lines.length,
      activityCount: activityEvents.length,
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

  // Socket listener for app activity events
  useEffect(() => {
    if (!socket) return;

    const handleActivityEvents = ({ events }: { port: number; events: AppActivityEventUnion[] }) => {
      if (!activeRef.current) return;

      const buf = bufferRef.current;
      for (const evt of events) {
        if (buf.activityEvents.length < MAX_ACTIVITY_EVENTS) {
          buf.activityEvents.push(evt);
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

    socket.on('app-activity:events', handleActivityEvents);
    return () => {
      socket.off('app-activity:events', handleActivityEvents);
    };
  }, [socket, flushBuffer]);

  const startRecording = useCallback((projectId: string, scripts: RecordingScript[]) => {
    if (!socket || activeRef.current) return;

    const id = generateId();
    const scriptIds = new Set(scripts.map(s => s.scriptId));
    const skipNext = new Map<string, boolean>();
    const now = Date.now();
    for (const s of scripts) {
      // "From Now": skip the first terminal:output event (the buffer replay)
      skipNext.set(s.scriptId, !s.fromStart);
    }

    activeRef.current = { id, projectId, scriptIds, scripts, startedAt: now, skipNext, monitoredPorts: [] };
    bufferRef.current = { lines: [], rawLines: [], activityEvents: [] };

    // Attach to terminal rooms for each script
    for (const s of scripts) {
      socket.emit('terminal:attach', { projectId, scriptId: s.scriptId });
    }

    // Fetch detected ports for the scripts and subscribe to app activity monitoring
    api.get<{ processes: Array<{ scriptId: string; detectedPorts?: number[] }> }>(`/api/projects/${projectId}/scripts/processes`)
      .then(({ processes }) => {
        const ports: number[] = [];
        for (const proc of processes) {
          if (scriptIds.has(proc.scriptId) && proc.detectedPorts) {
            ports.push(...proc.detectedPorts);
          }
        }
        if (ports.length > 0 && activeRef.current) {
          activeRef.current.monitoredPorts = ports;
          socket.emit('app-activity:subscribe', { ports });
        }
      })
      .catch((err) => {
        console.warn('[recording] Failed to fetch ports for app activity monitoring:', err);
      });

    setActiveRecording({
      id,
      scripts,
      lines: [],
      rawLines: [],
      activityEvents: [],
      monitoredPorts: [],
      startedAt: Date.now(),
      lineCount: 0,
      activityCount: 0,
    });
  }, [socket]);

  const stopRecording = useCallback((): string | null => {
    if (!activeRef.current || !socket) return null;

    const { id, projectId, scriptIds, scripts, startedAt, monitoredPorts } = activeRef.current;

    // Detach from terminal rooms
    for (const scriptId of scriptIds) {
      socket.emit('terminal:detach', { projectId, scriptId });
    }

    // Unsubscribe from app activity monitoring
    if (monitoredPorts.length > 0) {
      socket.emit('app-activity:unsubscribe', { ports: monitoredPorts });
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
      activityEvents: [...bufferRef.current.activityEvents],
      monitoredPorts,
      startedAt,
      stoppedAt: Date.now(),
    };

    setRecordings(prev => {
      const next = new Map(prev);
      next.set(id, recording);
      return next;
    });

    activeRef.current = null;
    bufferRef.current = { lines: [], rawLines: [], activityEvents: [] };
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

    const parts: string[] = [];

    // Terminal output section
    if (rec.lines.length > 0) {
      const header = `[Terminal Recording: ${scriptNames} | ${rec.lines.length} lines | ${duration}]`;
      const content = rec.lines.join('\n');
      parts.push(`${header}\n\`\`\`\n${content}\n\`\`\``);
    }

    // App activity section
    if (rec.activityEvents.length > 0) {
      const activityHeader = `[App Activity: ${rec.monitoredPorts.join(', ')} | ${rec.activityEvents.length} events | ${duration}]`;
      const activityLines = rec.activityEvents.map(evt => {
        const time = new Date(evt.ts).toISOString().slice(11, 23);
        if (evt.type === 'console') {
          return `[${time}] console.${evt.level}: ${evt.args.join(' ')}`;
        }
        if (evt.type === 'network') {
          return `[${time}] ${evt.method} ${evt.url} → ${evt.status} (${evt.durationMs}ms)`;
        }
        if (evt.type === 'error') {
          return `[${time}] ERROR: ${evt.message}${evt.stack ? '\n  ' + evt.stack.split('\n').slice(0, 3).join('\n  ') : ''}`;
        }
        return `[${time}] ${evt.type}`;
      });
      parts.push(`${activityHeader}\n\`\`\`\n${activityLines.join('\n')}\n\`\`\``);
    }

    if (parts.length === 0) return null;
    return parts.join('\n\n');
  }, [recordings]);

  return (
    <TerminalRecordingContext.Provider
      value={{ activeRecording, recordings, startRecording, stopRecording, deleteRecording, getRecordingContent }}
    >
      {children}
    </TerminalRecordingContext.Provider>
  );
}
