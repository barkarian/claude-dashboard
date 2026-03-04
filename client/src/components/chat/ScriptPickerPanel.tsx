import { useState, useEffect } from 'react';
import api from '../../utils/api.ts';
import { useTerminalRecording } from '../../hooks/useTerminalRecording.ts';
import type { RecordingScript } from '../../context/TerminalRecordingContext.tsx';

interface ScriptProcess {
  scriptId: string;
  label: string;
  command: string;
  status: string;
}

interface ScriptPickerPanelProps {
  projectId: string;
  onClose: () => void;
  onStarted: () => void;
}

export default function ScriptPickerPanel({ projectId, onClose, onStarted }: ScriptPickerPanelProps) {
  const { startRecording } = useTerminalRecording();
  const [processes, setProcesses] = useState<ScriptProcess[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [scriptModes, setScriptModes] = useState<Map<string, 'now' | 'start'>>(new Map());

  useEffect(() => {
    let cancelled = false;
    async function fetchProcesses() {
      try {
        const data = await api.get<{ processes: ScriptProcess[]; runningCount: number }>(`/api/projects/${projectId}/scripts/processes`);
        if (!cancelled) {
          setProcesses(data.processes.filter(p => p.status === 'running'));
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    }
    fetchProcesses();
    return () => { cancelled = true; };
  }, [projectId]);

  function toggleScript(scriptId: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(scriptId)) next.delete(scriptId);
      else next.add(scriptId);
      return next;
    });
  }

  function toggleMode(scriptId: string) {
    setScriptModes(prev => {
      const next = new Map(prev);
      const current = prev.get(scriptId) ?? 'now';
      next.set(scriptId, current === 'now' ? 'start' : 'now');
      return next;
    });
  }

  function handleStart() {
    const scripts: RecordingScript[] = processes
      .filter(p => selected.has(p.scriptId))
      .map(p => ({ scriptId: p.scriptId, label: p.label, command: p.command, fromStart: scriptModes.get(p.scriptId) === 'start' }));

    if (scripts.length === 0) return;
    startRecording(projectId, scripts);
    onStarted();
    onClose();
  }

  return (
    <div className="card shadow-xl max-h-72 overflow-hidden flex flex-col border-border-light">
      <div className="flex items-center justify-between p-3 border-b border-border">
        <span className="text-sm font-medium">Select scripts to record</span>
        <button onClick={onClose} className="text-text-muted hover:text-text transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="overflow-y-auto flex-1">
        {loading ? (
          <div className="p-4 text-sm text-text-muted text-center">Loading processes...</div>
        ) : processes.length === 0 ? (
          <div className="p-4 text-sm text-text-muted text-center">No running scripts found</div>
        ) : (
          processes.map(proc => (
            <label
              key={proc.scriptId}
              className="flex items-center gap-3 px-3 py-2.5 hover:bg-bg-hover transition-colors cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selected.has(proc.scriptId)}
                onChange={() => toggleScript(proc.scriptId)}
                className="w-4 h-4 rounded border-border accent-primary"
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{proc.label}</div>
                <div className="text-xs text-text-muted font-mono truncate">{proc.command}</div>
              </div>
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); toggleMode(proc.scriptId); }}
                className="text-xs px-2 py-0.5 rounded border border-border hover:bg-bg-hover transition-colors whitespace-nowrap text-text-muted"
              >
                {(scriptModes.get(proc.scriptId) ?? 'now') === 'now' ? 'From Now' : 'From Start'}
              </button>
            </label>
          ))
        )}
      </div>

      {processes.length > 0 && (
        <div className="p-3 border-t border-border">
          <button
            onClick={handleStart}
            disabled={selected.size === 0}
            className="btn-primary w-full py-2 text-sm disabled:opacity-50"
          >
            Start Recording{selected.size > 0 ? ` (${selected.size})` : ''}
          </button>
        </div>
      )}
    </div>
  );
}
