/**
 * Chat-header model picker — chevron popover bound to a single chat's
 * adapter. Only renders models from the chat's *current* adapter; provider
 * switching is intentionally not possible (chats are locked to their
 * adapter at creation).
 *
 * Visible models = the adapter's `favorite_models` setting. When the
 * favorites list is empty, only the `default_model` shows. The footer link
 * "Manage models..." deep-links to the catalog's configure dialog so
 * favorites/defaults are managed in one place.
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Popover, PopoverTrigger, PopoverContent,
} from '../ui/popover.tsx';
import api from '../../utils/api.ts';
import { findProviderByAdapter } from '../../lib/providers.ts';
import type { ModelInfo } from '../../../../shared/types/adapter.ts';

interface ModelPickerProps {
  projectId: string;
  chatId: string;
  adapterId: string;
  /** Adapter-opaque model id stored on the chat (or null = use default) */
  currentModel: string | null;
  /** Called after a successful PATCH so callers can refresh chat state */
  onModelChanged: (newModel: string) => void;
}

export default function ModelPicker({
  projectId, chatId, adapterId, currentModel, onModelChanged,
}: ModelPickerProps) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [defaultModel, setDefaultModel] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Fetch models + settings once when the popover opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      api.get<{ models: ModelInfo[] }>(`/api/adapters/${adapterId}/models`).catch(() => ({ models: [] })),
      api.get<{ defaultModel: string | null }>(`/api/adapter-settings/${adapterId}/default-model`).catch(() => ({ defaultModel: null })),
      api.get<{ favoriteModels: string[] }>(`/api/adapter-settings/${adapterId}/favorite-models`).catch(() => ({ favoriteModels: [] })),
    ]).then(([m, d, f]) => {
      if (cancelled) return;
      setModels(m.models || []);
      setDefaultModel(d.defaultModel);
      setFavorites(f.favoriteModels || []);
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, adapterId]);

  // Visible list = favorites, falling back to just the default when empty.
  const visibleModels = (() => {
    if (favorites.length > 0) {
      return models.filter(m => favorites.includes(m.id));
    }
    if (defaultModel) {
      const m = models.find(x => x.id === defaultModel);
      return m ? [m] : [];
    }
    return [];
  })();

  const effectiveModel = currentModel ?? defaultModel;
  const currentLabel = (() => {
    const m = models.find(x => x.id === effectiveModel);
    if (m) return m.label;
    if (effectiveModel) return effectiveModel;
    return 'Default';
  })();

  const handlePick = useCallback(async (modelId: string) => {
    if (modelId === effectiveModel) {
      setOpen(false);
      return;
    }
    setSaving(true);
    try {
      await api.patch(`/api/projects/${projectId}/chats/${chatId}`, { model: modelId });
      onModelChanged(modelId);
      setOpen(false);
    } catch {
      // toast intentionally omitted — caller surfaces failures
    } finally {
      setSaving(false);
    }
  }, [projectId, chatId, effectiveModel, onModelChanged]);

  const handleManage = useCallback(() => {
    setOpen(false);
    const provider = findProviderByAdapter(adapterId);
    if (provider) {
      navigate(`/catalog?configure=${provider.id}`);
    } else {
      navigate('/catalog');
    }
  }, [adapterId, navigate]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs font-medium text-text-muted hover:text-text px-2 py-1 rounded hover:bg-bg-hover/50 transition-colors"
          aria-label="Switch model"
        >
          <span className="truncate max-w-[140px]">{currentLabel}</span>
          <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-1">
        {loading ? (
          <div className="p-3 text-xs text-text-muted text-center">Loading…</div>
        ) : visibleModels.length === 0 ? (
          <div className="p-3 text-xs text-text-muted text-center space-y-2">
            <div>No favorites yet.</div>
            <button
              onClick={handleManage}
              className="text-primary hover:underline"
            >
              Manage models…
            </button>
          </div>
        ) : (
          <>
            {visibleModels.map(m => (
              <button
                key={m.id}
                onClick={() => handlePick(m.id)}
                disabled={saving}
                className={`w-full text-left px-2 py-1.5 rounded text-xs flex items-start gap-2 hover:bg-bg-hover/50 transition-colors ${
                  m.id === effectiveModel ? 'bg-primary/10' : ''
                }`}
              >
                <span className="flex-shrink-0 w-3.5 h-3.5 mt-0.5">
                  {m.id === effectiveModel && (
                    <svg className="w-3.5 h-3.5 text-primary" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-text">{m.label}</div>
                  {m.description && <div className="text-text-muted text-[11px] truncate">{m.description}</div>}
                </div>
              </button>
            ))}
            <div className="border-t border-border mt-1 pt-1">
              <button
                onClick={handleManage}
                className="w-full text-left px-2 py-1.5 rounded text-xs text-text-muted hover:text-text hover:bg-bg-hover/50 transition-colors"
              >
                Manage models…
              </button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
