import { useState, type FormEvent } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog.tsx';
import { Input } from '../ui/input.tsx';
import { Label } from '../ui/label.tsx';
import { Button } from '../ui/button.tsx';
import { Alert } from '../ui/alert.tsx';
import api from '../../utils/api.ts';
import type { ScriptWithStatus } from '../../../../shared/types/models.ts';

interface EditScriptModalProps {
  projectId: string;
  script: ScriptWithStatus;
  onClose: () => void;
  onUpdated: () => void;
}

export default function EditScriptModal({ projectId, script, onClose, onUpdated }: EditScriptModalProps) {
  const [label, setLabel] = useState(script.label);
  const [command, setCommand] = useState(script.command);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!label.trim() || !command.trim()) return;

    setSaving(true);
    setError('');
    try {
      await api.patch(`/api/projects/${projectId}/scripts/${script.id}`, {
        label: label.trim(),
        command: command.trim(),
      });
      onUpdated();
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
          <DialogTitle>Edit Script</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="edit-script-label">Label</Label>
            <Input
              id="edit-script-label"
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Dev Server"
              autoFocus
            />
          </div>

          <div>
            <Label htmlFor="edit-script-command">Command</Label>
            <Input
              id="edit-script-command"
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
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
