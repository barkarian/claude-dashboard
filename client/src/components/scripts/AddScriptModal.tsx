import { useState, type FormEvent } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog.tsx';
import { Input } from '../ui/input.tsx';
import { Label } from '../ui/label.tsx';
import { Button } from '../ui/button.tsx';
import { Alert } from '../ui/alert.tsx';
import api from '../../utils/api.ts';

interface AddScriptModalProps {
  projectId: string;
  onClose: () => void;
  onCreated: () => void;
}

export default function AddScriptModal({ projectId, onClose, onCreated }: AddScriptModalProps) {
  const [label, setLabel] = useState('');
  const [command, setCommand] = useState('');
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
      });
      onCreated();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Script</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="script-label">Label</Label>
            <Input
              id="script-label"
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Dev Server"
              autoFocus
            />
          </div>

          <div>
            <Label htmlFor="script-command">Command</Label>
            <Input
              id="script-command"
              type="text"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              className="font-mono text-sm"
              placeholder="npm run dev"
            />
          </div>

          {error && (
            <Alert variant="danger">{error}</Alert>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button
              type="submit"
              disabled={saving || !label.trim() || !command.trim()}
            >
              {saving ? 'Adding...' : 'Add Script'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
