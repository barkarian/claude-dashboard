import { useState, type FormEvent } from 'react';
import api from '../../utils/api.ts';

interface AddScriptModalProps {
  projectId: string;
  onClose: () => void;
  onCreated: () => void;
}

export default function AddScriptModal({ projectId, onClose, onCreated }: AddScriptModalProps) {
  const [label, setLabel] = useState('');
  const [command, setCommand] = useState('');
  const [autostart, setAutostart] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!label.trim() || !command.trim()) return;

    setSaving(true);
    setError('');
    try {
      await api.post(`/api/projects/${projectId}/scripts`, {
        label: label.trim(),
        command: command.trim(),
        autostart,
      });
      onCreated();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="card w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold mb-4">Add Script</h3>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-muted mb-1">Label</label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="input"
              placeholder="Dev Server"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-muted mb-1">Command</label>
            <input
              type="text"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              className="input font-mono text-sm"
              placeholder="npm run dev"
            />
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={autostart}
              onChange={(e) => setAutostart(e.target.checked)}
              className="w-4 h-4 rounded border-border bg-bg text-primary focus:ring-primary"
            />
            <span className="text-sm text-text-muted">Auto-start on server boot</span>
          </label>

          {error && (
            <div className="text-danger text-sm bg-danger/10 px-3 py-2 rounded-lg">{error}</div>
          )}

          <div className="flex gap-2 justify-end">
            <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
            <button
              type="submit"
              disabled={saving || !label.trim() || !command.trim()}
              className="btn-primary disabled:opacity-50"
            >
              {saving ? 'Adding...' : 'Add Script'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
