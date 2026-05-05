/**
 * Per-provider configure dialog. Walks the user through:
 *   1. Authentication (shared across the provider's adapters when sharedAuth: true)
 *   2. For each adapter: install (if needed), default model, favorites, enable toggle
 *
 * Sections collapse once green, expand for any incomplete step. The user can
 * always re-open a green section to review or change settings.
 *
 * This dialog is the only UI that mutates default_model and favorite_models.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from '../ui/drawer.tsx';
import { Button } from '../ui/button.tsx';
import { Checkbox } from '../ui/checkbox.tsx';
import { useAdapterSettings, type AdapterInfo } from '../../hooks/useAdapterSettings.ts';
import { useSocket } from '../../context/SocketContext.tsx';
import api from '../../utils/api.ts';
import type { Provider } from '../../lib/providers.ts';
import type { ModelInfo } from '../../../../shared/types/adapter.ts';

interface ConfigureProviderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: Provider;
}

type SectionStatus = 'green' | 'amber' | 'grey';

function StatusDot({ status }: { status: SectionStatus }) {
  const cls =
    status === 'green' ? 'bg-success' :
    status === 'amber' ? 'bg-warning' :
    'bg-text-dim';
  return <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cls}`} />;
}

function SectionShell({
  title, status, expanded, onToggle, children, action, meta,
}: {
  title: string;
  status: SectionStatus;
  expanded: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
  action?: React.ReactNode;
  /** Dim hint shown next to the title when collapsed (e.g. current default model). */
  meta?: string;
}) {
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-3 p-3 hover:bg-bg-hover/50 transition-colors text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          <StatusDot status={status} />
          <span className="text-sm font-medium text-text truncate">{title}</span>
          {!expanded && meta && (
            <span className="text-xs text-text-muted truncate">· {meta}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {action}
          <svg
            className={`w-4 h-4 text-text-muted transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </div>
      </button>
      {expanded && children && (
        <div className="border-t border-border bg-bg px-4 py-3 space-y-3">
          {children}
        </div>
      )}
    </div>
  );
}

// ── Auth section ────────────────────────────────────────────────────

function AuthSection({
  authAdapter, authNote, onChanged,
}: {
  authAdapter: AdapterInfo;
  authNote?: string;
  onChanged: () => void;
}) {
  const { settings, authStatus } = authAdapter;
  const isAuthenticated = !!authStatus?.authenticated;
  const status: SectionStatus = isAuthenticated ? 'green' : 'amber';
  const [expanded, setExpanded] = useState(!isAuthenticated);
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { setExpanded(!isAuthenticated); }, [isAuthenticated]);

  const handleSave = useCallback(async () => {
    if (!apiKey.trim()) return;
    setSaving(true);
    try {
      const provider = settings.api_provider || 'anthropic';
      const keyField = provider === 'openrouter' ? 'openrouter_api_key' : 'anthropic_api_key';
      await api.put(`/api/adapter-settings/${authAdapter.metadata.id}`, { [keyField]: apiKey.trim() });
      setApiKey('');
      toast.success('API key saved');
      onChanged();
    } catch {
      toast.error('Failed to save API key');
    } finally {
      setSaving(false);
    }
  }, [apiKey, settings.api_provider, authAdapter.metadata.id, onChanged]);

  const handleDisconnect = useCallback(async () => {
    try {
      const provider = settings.api_provider || 'anthropic';
      const keyField = provider === 'openrouter' ? 'openrouter_api_key' : 'anthropic_api_key';
      await api.put(`/api/adapter-settings/${authAdapter.metadata.id}`, { [keyField]: null });
      onChanged();
    } catch {
      toast.error('Failed to disconnect');
    }
  }, [settings.api_provider, authAdapter.metadata.id, onChanged]);

  return (
    <SectionShell
      title="Authentication"
      status={status}
      expanded={expanded}
      onToggle={() => setExpanded(e => !e)}
    >
      {authNote && <p className="text-xs text-text-muted">{authNote}</p>}
      {isAuthenticated ? (
        <div className="flex items-center justify-between">
          <div className="text-xs text-success">
            Connected
            {authStatus?.source === 'oauth' && ' (OAuth)'}
            {authStatus?.source === 'env' && ' (Environment variable)'}
            {authStatus?.source === 'api_key' && ' (API Key)'}
          </div>
          {authStatus?.source === 'api_key' && (
            <Button variant="ghost" size="sm" onClick={handleDisconnect}>Disconnect</Button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-text-muted">
            Run <code className="bg-bg-surface px-1 py-0.5 rounded font-mono">claude /login</code> in a terminal to authenticate via OAuth, or paste an API key below.
          </p>
          <div className="flex gap-2">
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Anthropic API Key (sk-ant-...)"
              className="flex-1 text-xs bg-bg-surface border border-border rounded px-2 py-1.5 text-text placeholder:text-text-dim focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <Button size="sm" onClick={handleSave} disabled={saving || !apiKey.trim()}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </div>
          <Button size="sm" variant="outline" onClick={onChanged} className="w-full">
            Re-check authentication
          </Button>
        </div>
      )}
    </SectionShell>
  );
}

// ── Per-adapter section ─────────────────────────────────────────────

function AdapterSection({
  adapter, label, description, optional, onChanged, defaultExpanded = false,
}: {
  adapter: AdapterInfo;
  label: string;
  description: string;
  optional: boolean;
  onChanged: () => void;
  defaultExpanded?: boolean;
}) {
  const { metadata, prerequisites, enabled } = adapter;
  const { socket } = useSocket();
  const prereqOk = !metadata.capabilities.prerequisites || prerequisites?.satisfied;

  // Section is "green" when prereq is met AND (it's enabled OR optional)
  const status: SectionStatus =
    !prereqOk ? 'grey' :
    enabled ? 'green' :
    (optional ? 'green' : 'amber');

  // Expand if anything is incomplete, OR the dialog asked us to (e.g. provider
  // has only one adapter and no auth section, so leaving everything collapsed
  // would render an empty-looking drawer).
  const [expanded, setExpanded] = useState(defaultExpanded || !prereqOk || (!enabled && !optional));
  const [installing, setInstalling] = useState(false);
  const [installOutput, setInstallOutput] = useState('');
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [defaultModel, setDefaultModel] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [savingDefault, setSavingDefault] = useState(false);
  const [modelSearch, setModelSearch] = useState('');

  // Load models + defaults on mount. Used to be lazy-on-expand, but the
  // collapsed header now shows a "Default: …" hint that needs the models
  // list to map an id to a friendly label.
  useEffect(() => {
    let cancelled = false;
    api.get<{ models: ModelInfo[] }>(`/api/adapters/${metadata.id}/models`)
      .then(d => { if (!cancelled) setModels(d.models || []); })
      .catch(() => { if (!cancelled) setModels([]); });
    api.get<{ defaultModel: string | null }>(`/api/adapter-settings/${metadata.id}/default-model`)
      .then(d => { if (!cancelled) setDefaultModel(d.defaultModel); })
      .catch(() => {});
    api.get<{ favoriteModels: string[] }>(`/api/adapter-settings/${metadata.id}/favorite-models`)
      .then(d => { if (!cancelled) setFavorites(d.favoriteModels || []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [metadata.id]);

  // Friendly hint for the collapsed header: "Default: <label> · N favorites"
  const collapsedMeta = (() => {
    if (!defaultModel && favorites.length === 0) return undefined;
    const parts: string[] = [];
    if (defaultModel) {
      const found = models?.find(m => m.id === defaultModel);
      parts.push(`Default: ${found?.label ?? defaultModel}`);
    }
    if (favorites.length > 0) {
      parts.push(`${favorites.length} favorite${favorites.length === 1 ? '' : 's'}`);
    }
    return parts.join(' · ');
  })();

  const hasModels = models !== null && models.length > 0;

  // Toggle enable. Disabling without confirmation here — the catalog
  // toggle owns the destructive confirmation.
  const handleToggle = useCallback(async (next: boolean) => {
    try {
      await api.put(`/api/adapter-settings/${metadata.id}`, { enabled: next ? 'true' : 'false' });
      onChanged();
    } catch {
      toast.error('Failed to update');
    }
  }, [metadata.id, onChanged]);

  const handleInstall = useCallback(() => {
    if (!socket) return;
    setInstalling(true);
    setInstallOutput('');
    socket.emit('tools:install', { toolId: metadata.id });

    const onOutput = ({ toolId, data }: { toolId: string; data: string }) => {
      if (toolId === metadata.id) setInstallOutput(prev => prev + data);
    };
    const onComplete = ({ toolId, success }: { toolId: string; success: boolean }) => {
      if (toolId === metadata.id) {
        setInstalling(false);
        socket.off('tools:install-output', onOutput);
        socket.off('tools:install-complete', onComplete);
        if (success) {
          toast.success(`${metadata.displayName} installed`);
          onChanged();
        } else {
          toast.error(`${metadata.displayName} install failed`);
        }
      }
    };

    socket.on('tools:install-output', onOutput);
    socket.on('tools:install-complete', onComplete);
  }, [socket, metadata.id, metadata.displayName, onChanged]);

  const handleSaveDefault = useCallback(async (modelId: string) => {
    setSavingDefault(true);
    try {
      await api.put(`/api/adapter-settings/${metadata.id}/default-model`, { defaultModel: modelId });
      setDefaultModel(modelId);
      toast.success('Default model saved');
    } catch {
      toast.error('Failed to save default model');
    } finally {
      setSavingDefault(false);
    }
  }, [metadata.id]);

  const handleToggleFavorite = useCallback(async (modelId: string) => {
    const next = favorites.includes(modelId)
      ? favorites.filter(m => m !== modelId)
      : [...favorites, modelId];
    try {
      await api.put(`/api/adapter-settings/${metadata.id}/favorite-models`, { favoriteModels: next });
      setFavorites(next);
    } catch {
      toast.error('Failed to update favorites');
    }
  }, [favorites, metadata.id]);

  // The on/off toggle inside the header — separate from the chevron click.
  const action = (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); handleToggle(!enabled); }}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
        enabled ? 'bg-primary' : 'bg-bg-hover'
      }`}
      aria-label={enabled ? `Disable ${label}` : `Enable ${label}`}
    >
      <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
        enabled ? 'translate-x-5' : 'translate-x-0.5'
      }`} />
    </button>
  );

  return (
    <SectionShell
      title={`${label}${optional ? ' (optional)' : ''}`}
      status={status}
      expanded={expanded}
      onToggle={() => setExpanded(e => !e)}
      action={action}
      meta={collapsedMeta}
    >
      <p className="text-xs text-text-muted">{description}</p>

      {/* Install / setup step (when this adapter has prerequisites).
          Two failure modes are surfaced separately:
            • Binary missing  → "Run install" auto-runs the npm command.
            • Binary present but auth/setup missing → show the installHint
              (e.g. `opencode auth login`) for the user to run themselves,
              with a "Re-check" button to re-probe afterwards. */}
      {metadata.capabilities.prerequisites && (
        <div>
          <div className="text-xs font-medium text-text-dim uppercase tracking-wider mb-1">Setup</div>
          {prereqOk ? (
            <div className="text-xs text-success">Ready</div>
          ) : (
            <div className="space-y-2">
              <div className="text-xs text-text-muted">
                {prerequisites?.message || 'Not installed.'}
              </div>
              {prerequisites?.installHint && (
                <pre className="text-xs font-mono text-text bg-bg-surface rounded p-2 whitespace-pre-wrap select-all">
                  {prerequisites.installHint}
                </pre>
              )}
              <div className="flex flex-wrap gap-2">
                {/* Auto-install button only when the message looks like
                    "binary missing" (matches Claude Code + OpenCode CLI). */}
                {!installing && /not installed/i.test(prerequisites?.message || '') && (
                  <Button size="sm" onClick={handleInstall}>Run install</Button>
                )}
                {installing && (
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    <span className="text-xs text-text-muted">Installing...</span>
                  </div>
                )}
                <Button size="sm" variant="outline" onClick={onChanged}>Re-check</Button>
              </div>
              {installOutput && (
                <pre className="text-xs font-mono text-text-muted bg-bg-surface rounded p-2 max-h-24 overflow-y-auto whitespace-pre-wrap">
                  {installOutput}
                </pre>
              )}
            </div>
          )}
        </div>
      )}

      {/* Default model — only adapters that expose listModels() */}
      {hasModels && models && (
        <div>
          <div className="text-xs font-medium text-text-dim uppercase tracking-wider mb-1">Default model</div>
          <select
            value={defaultModel ?? ''}
            disabled={savingDefault}
            onChange={(e) => handleSaveDefault(e.target.value)}
            className="w-full text-xs bg-bg-surface border border-border rounded px-2 py-1.5 text-text focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="" disabled>Pick a model…</option>
            {models.map(m => (
              <option key={m.id} value={m.id}>
                {m.label}{m.family ? ` (${m.family})` : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Favorites — only adapters with models */}
      {hasModels && models && (() => {
        const q = modelSearch.trim().toLowerCase();
        const matched = q
          ? models.filter(m =>
              m.id.toLowerCase().includes(q)
              || m.label.toLowerCase().includes(q)
              || (m.family ?? '').toLowerCase().includes(q),
            )
          : models;
        // Pin currently-favorited models to the top so the user can see
        // their selections at a glance — stable within each group.
        const favSet = new Set(favorites);
        const filtered = [
          ...matched.filter(m => favSet.has(m.id)),
          ...matched.filter(m => !favSet.has(m.id)),
        ];
        return (
          <div>
            <div className="text-xs font-medium text-text-dim uppercase tracking-wider mb-1">
              Favorites <span className="text-text-muted normal-case">({favorites.length})</span>
            </div>
            <p className="text-xs text-text-muted mb-2">
              Models that appear in the chat-header picker. Empty = only the default is shown.
            </p>
            <div className="relative mb-2">
              <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-dim pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
              </svg>
              <input
                type="text"
                value={modelSearch}
                onChange={(e) => setModelSearch(e.target.value)}
                placeholder="Search models…"
                className="w-full pl-8 pr-7 py-1.5 text-xs bg-bg-surface border border-border rounded text-text placeholder:text-text-dim focus:outline-none focus:ring-1 focus:ring-primary"
              />
              {modelSearch && (
                <button
                  type="button"
                  onClick={() => setModelSearch('')}
                  aria-label="Clear search"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded-full text-text-dim hover:text-text"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
            {filtered.length === 0 ? (
              <p className="text-xs text-text-muted text-center py-2">No models match "{modelSearch}"</p>
            ) : (
              <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                {filtered.map(m => (
                  <label key={m.id} className="flex items-start gap-2 cursor-pointer text-xs">
                    <Checkbox
                      checked={favorites.includes(m.id)}
                      onCheckedChange={() => handleToggleFavorite(m.id)}
                      className="mt-0.5"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-text">{m.label}{m.family ? <span className="text-text-dim ml-1">· {m.family}</span> : null}</div>
                      {m.description && <div className="text-text-muted">{m.description}</div>}
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>
        );
      })()}
    </SectionShell>
  );
}

// ── Dialog root ─────────────────────────────────────────────────────

export default function ConfigureProviderDialog({ open, onOpenChange, provider }: ConfigureProviderDialogProps) {
  const { adapters: adapterInfos, refresh } = useAdapterSettings();

  // Map provider's adapters to AdapterInfo, preserving order. Adapters that
  // aren't in the registry yet (e.g. opencode before slice c lands) get
  // skipped — the dialog still opens for the registered ones.
  const sections = useMemo(() => {
    return provider.adapters
      .map(pa => {
        const info = adapterInfos.find(a => a.metadata.id === pa.id);
        return info ? { providerAdapter: pa, info } : null;
      })
      .filter((x): x is { providerAdapter: typeof provider.adapters[number]; info: AdapterInfo } => x !== null);
  }, [provider.adapters, adapterInfos]);

  // Auth section — when sharedAuth, we use the FIRST adapter as the
  // canonical auth surface (its api_key / OAuth covers all of them per
  // server-side adapter-settings.ts logic). When !sharedAuth, this
  // component currently doesn't render an auth section at all (each
  // adapter handles its own auth — used by future OpenCode/Cursor).
  const authAdapter = provider.sharedAuth ? sections[0]?.info ?? null : null;

  // If the dialog would otherwise render a single collapsed adapter row
  // (single adapter + no auth section), force-expand it. Otherwise the
  // user opens "Configure OpenCode" and sees what looks like an empty
  // drawer with just a chevron.
  const expandSingleSection = !authAdapter && sections.length === 1;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[90vh]">
        <DrawerHeader className="px-4 pb-2 pt-1">
          <DrawerTitle className="text-base">Configure {provider.name}</DrawerTitle>
          <DrawerDescription className="text-xs text-text-muted">
            {provider.description}
          </DrawerDescription>
        </DrawerHeader>

        <div className="overflow-y-auto overscroll-contain px-4 pb-6 space-y-3" style={{ maxHeight: 'calc(90vh - 88px)' }}>
          {sections.length === 0 ? (
            <p className="text-sm text-text-muted text-center py-6">
              No adapters registered for this provider yet.
            </p>
          ) : (
            <>
              {authAdapter && (
                <AuthSection
                  authAdapter={authAdapter}
                  authNote={provider.authNote}
                  onChanged={refresh}
                />
              )}
              {sections.map(({ providerAdapter, info }) => (
                <AdapterSection
                  key={info.metadata.id}
                  adapter={info}
                  label={providerAdapter.label}
                  description={providerAdapter.description}
                  optional={!!providerAdapter.optional}
                  onChanged={refresh}
                  defaultExpanded={expandSingleSection}
                />
              ))}
            </>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
