import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../utils/api.ts';
import { useNewProjectDrawer } from '../../context/NewProjectDrawerContext.tsx';
import type { ProjectSummary } from '../../../../shared/types/models.ts';

/**
 * CommandPalette — Cmd/Ctrl+K quick switcher.
 *
 * Opens an overlay with a fuzzy search across:
 *   - Workspaces (navigate)
 *   - Catalog (Catalog home + Local Computer)
 *   - Actions (New workspace)
 *
 * Filters by substring match against label + hint. Esc to close.
 */

interface CommandItem {
  id: string;
  group: 'Workspaces' | 'Catalog' | 'Actions';
  label: string;
  hint?: string;
  onSelect: () => void;
}

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [workspaces, setWorkspaces] = useState<ProjectSummary[]>([]);
  const navigate = useNavigate();
  const { openDrawer } = useNewProjectDrawer();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Bind Cmd+K / Ctrl+K. Capture phase so the browser's own shortcut doesn't win.
  useEffect(() => {
    function handler(e: globalThis.KeyboardEvent) {
      const isToggle = (e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K');
      if (isToggle) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(prev => !prev);
        return;
      }
      if (e.key === 'Escape' && open) {
        e.preventDefault();
        setOpen(false);
      }
    }
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [open]);

  // Refresh data + focus input on open.
  useEffect(() => {
    if (!open) {
      setQuery('');
      setSelectedIdx(0);
      return;
    }
    api.get<{ projects: ProjectSummary[]; total: number }>('/api/projects?limit=50&offset=0')
      .then(d => setWorkspaces(d.projects || []))
      .catch(() => {});
    setTimeout(() => inputRef.current?.focus(), 30);
  }, [open]);

  const items = useMemo<CommandItem[]>(() => {
    const list: CommandItem[] = [];
    workspaces.forEach(w => {
      list.push({
        id: `ws:${w.id}`,
        group: 'Workspaces',
        label: w.name,
        hint: w.path,
        onSelect: () => { navigate(`/project/${w.id}`); setOpen(false); },
      });
    });
    list.push(
      { id: 'cat:home', group: 'Catalog', label: 'Open Catalog', onSelect: () => { navigate('/catalog'); setOpen(false); } },
      { id: 'cat:local', group: 'Catalog', label: 'Local Computer', hint: 'Ports & shutdown', onSelect: () => { navigate('/catalog/local-computer'); setOpen(false); } },
    );
    list.push(
      { id: 'act:new', group: 'Actions', label: 'New Workspace', onSelect: () => { setOpen(false); openDrawer(); } },
      { id: 'act:settings', group: 'Actions', label: 'Settings', onSelect: () => { navigate('/settings'); setOpen(false); } },
    );
    return list;
  }, [workspaces, navigate, openDrawer]);

  const filtered = useMemo(() => {
    if (!query.trim()) return items;
    const q = query.toLowerCase();
    return items.filter(i =>
      i.label.toLowerCase().includes(q) || (i.hint?.toLowerCase().includes(q) ?? false),
    );
  }, [items, query]);

  // Group while preserving the flat order so arrow-key navigation remains linear.
  const grouped = useMemo(() => {
    const order: CommandItem['group'][] = ['Workspaces', 'Catalog', 'Actions'];
    const out: Array<{ group: CommandItem['group']; items: CommandItem[] }> = [];
    for (const g of order) {
      const items = filtered.filter(i => i.group === g);
      if (items.length > 0) out.push({ group: g, items });
    }
    return out;
  }, [filtered]);

  // Reset selection when filter changes; clamp on shrink.
  useEffect(() => {
    setSelectedIdx(idx => Math.min(Math.max(idx, 0), Math.max(filtered.length - 1, 0)));
  }, [filtered.length]);

  // Keep the selected row visible as the user arrows through.
  useEffect(() => {
    if (!listRef.current) return;
    const node = listRef.current.querySelector<HTMLElement>(`[data-idx="${selectedIdx}"]`);
    node?.scrollIntoView({ block: 'nearest' });
  }, [selectedIdx]);

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx(i => Math.min(i + 1, Math.max(filtered.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = filtered[selectedIdx];
      if (item) item.onSelect();
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center pt-[15vh] bg-black/40"
      onClick={() => setOpen(false)}
      role="dialog"
      aria-label="Command palette"
    >
      <div
        className="w-full max-w-xl mx-4 bg-bg-surface border border-border rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-3 py-2.5 border-b border-border flex items-center gap-2">
          <svg className="w-4 h-4 text-text-dim flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Jump to a workspace, catalog item, or action…"
            className="flex-1 bg-transparent text-sm text-text placeholder:text-text-dim focus:outline-none"
          />
          <kbd className="text-[10px] px-1.5 py-0.5 rounded border border-border bg-bg text-text-dim">esc</kbd>
        </div>
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto py-1">
          {grouped.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-text-muted">No matches.</div>
          ) : (
            grouped.map(({ group, items }) => (
              <div key={group} className="py-1">
                <div className="px-3 py-1 text-[10px] font-medium text-text-dim uppercase tracking-wider">{group}</div>
                {items.map((item) => {
                  const flatIdx = filtered.indexOf(item);
                  const active = flatIdx === selectedIdx;
                  return (
                    <button
                      key={item.id}
                      data-idx={flatIdx}
                      onClick={item.onSelect}
                      onMouseEnter={() => setSelectedIdx(flatIdx)}
                      className={`w-full flex items-center justify-between gap-3 px-3 py-2 text-sm text-left transition-colors ${
                        active ? 'bg-bg-hover text-text' : 'text-text-muted hover:bg-bg-hover'
                      }`}
                    >
                      <span className="truncate">{item.label}</span>
                      {item.hint && (
                        <span className="text-xs text-text-dim truncate flex-shrink-0 max-w-[45%] font-mono">
                          {item.hint}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
        <div className="px-3 py-1.5 border-t border-border flex items-center justify-between text-[10px] text-text-dim">
          <span>↑↓ navigate · ↵ open</span>
          <span>⌘K to toggle</span>
        </div>
      </div>
    </div>
  );
}
