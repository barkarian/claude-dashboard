import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../ui/dialog.tsx';
import { Button } from '../ui/button.tsx';
import { Input } from '../ui/input.tsx';
import api from '../../utils/api.ts';
import { toast } from 'sonner';
import type { ChatCategory } from '../../../../shared/types/models.ts';

interface CategoryManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  categories: ChatCategory[];
  onChange: (categories: ChatCategory[]) => void;
}

const QUICK_EMOJI = ['⭐', '🔥', '🐛', '💡', '🚀', '📌', '🧪', '✅', '⚠️', '📝', '🎯', '💬', '🛠️', '❤️'];

export default function CategoryManager({ open, onOpenChange, projectId, categories, onChange }: CategoryManagerProps) {
  const [newName, setNewName] = useState('');
  const [newEmoji, setNewEmoji] = useState('🔥');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmoji, setEditEmoji] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setNewName('');
      setNewEmoji('🔥');
      setEditingId(null);
    }
  }, [open]);

  async function handleCreate() {
    const name = newName.trim();
    const emoji = newEmoji.trim();
    if (!name) { toast.error('Name required'); return; }
    if (!emoji) { toast.error('Emoji required'); return; }
    setBusy(true);
    try {
      const data = await api.post<{ category: ChatCategory }>(`/api/projects/${projectId}/categories`, { name, emoji });
      onChange([...categories, data.category]);
      setNewName('');
      setNewEmoji('🔥');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to create category');
    } finally {
      setBusy(false);
    }
  }

  function startEdit(cat: ChatCategory) {
    setEditingId(cat.id);
    setEditName(cat.name);
    setEditEmoji(cat.emoji);
  }

  async function saveEdit() {
    if (!editingId) return;
    const name = editName.trim();
    const emoji = editEmoji.trim();
    if (!name || !emoji) { toast.error('Name and emoji required'); return; }
    setBusy(true);
    try {
      const data = await api.patch<{ category: ChatCategory }>(`/api/projects/${projectId}/categories/${editingId}`, { name, emoji });
      onChange(categories.map(c => c.id === editingId ? data.category : c));
      setEditingId(null);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update category');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(cat: ChatCategory) {
    if (cat.isDefault) return;
    if (!confirm(`Delete category "${cat.name}"? Chats in it will become uncategorised.`)) return;
    setBusy(true);
    try {
      await api.delete(`/api/projects/${projectId}/categories/${cat.id}`);
      onChange(categories.filter(c => c.id !== cat.id));
    } catch (err: any) {
      toast.error(err?.message || 'Failed to delete category');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Manage categories</DialogTitle>
          <DialogDescription>
            Categories are project-scoped labels. Each chat can belong to one. The Favorites category is built-in and cannot be deleted.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2 max-h-[40vh] overflow-y-auto">
          {categories.map(cat => (
            <div key={cat.id} className="flex items-center gap-2 border border-border rounded-lg p-2">
              {editingId === cat.id ? (
                <>
                  <Input
                    value={editEmoji}
                    onChange={(e) => setEditEmoji(e.target.value)}
                    className="w-14 text-center"
                    maxLength={4}
                  />
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="flex-1"
                    placeholder="Category name"
                  />
                  <Button size="sm" onClick={saveEdit} disabled={busy}>Save</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingId(null)} disabled={busy}>Cancel</Button>
                </>
              ) : (
                <>
                  <span className="text-xl w-8 text-center" aria-hidden>{cat.emoji}</span>
                  <span className="flex-1 text-sm text-text">
                    {cat.name}
                    {cat.isDefault && <span className="ml-2 text-[10px] uppercase tracking-wider text-text-dim">built-in</span>}
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => startEdit(cat)} disabled={busy}>Edit</Button>
                  {!cat.isDefault && (
                    <Button size="sm" variant="ghost" onClick={() => handleDelete(cat)} disabled={busy} className="text-danger hover:text-danger">
                      Delete
                    </Button>
                  )}
                </>
              )}
            </div>
          ))}
        </div>

        <div className="border-t border-border pt-4 space-y-2">
          <div className="text-xs font-medium text-text-dim uppercase tracking-wider">Add new</div>
          <div className="flex items-center gap-2">
            <Input
              value={newEmoji}
              onChange={(e) => setNewEmoji(e.target.value)}
              className="w-14 text-center"
              maxLength={4}
              placeholder="🔥"
            />
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              className="flex-1"
              placeholder="Category name"
            />
            <Button size="sm" onClick={handleCreate} disabled={busy || !newName.trim()}>Add</Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_EMOJI.map(e => (
              <button
                key={e}
                onClick={() => setNewEmoji(e)}
                className={`w-7 h-7 rounded text-base flex items-center justify-center transition-colors ${
                  newEmoji === e ? 'bg-primary/15 ring-1 ring-primary' : 'hover:bg-bg-hover'
                }`}
                aria-label={`Use ${e}`}
              >
                {e}
              </button>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
