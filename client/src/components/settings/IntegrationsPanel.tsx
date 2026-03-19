import { useState, useEffect, useRef } from 'react';
import { Button } from '../ui/button.tsx';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs.tsx';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel } from '../ui/alert-dialog.tsx';
import { useAuth } from '../../context/AuthContext.tsx';
import api from '../../utils/api.ts';
import SettingsTerminal from './SettingsTerminal.tsx';

type CredentialEnvironment = 'local' | 'vps';

interface CredentialStatus {
  connected: boolean;
  metadata?: {
    keyPrefix?: string;
    tokenPrefix?: string;
    opusModel?: string;
    sonnetModel?: string;
    haikuModel?: string;
  };
}

interface EnvCredentialState {
  anthropicStatus: CredentialStatus;
  openrouterStatus: CredentialStatus;
}

interface ToastState {
  message: string;
  type: 'success' | 'error';
}

interface OpenRouterModel {
  id: string;
  name: string;
}

interface PendingSave {
  provider: 'anthropic' | 'openrouter';
  environment: CredentialEnvironment;
  competingProvider: string;
  execute: () => Promise<void>;
}

// Cache fetched models across re-renders
let modelsCache: OpenRouterModel[] | null = null;

function ModelSearchSelect({ value, onChange, models, loadingModels }: {
  value: string;
  onChange: (id: string) => void;
  models: OpenRouterModel[];
  loadingModels: boolean;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const filtered = query
    ? models.filter(m =>
        m.id.toLowerCase().includes(query.toLowerCase()) ||
        m.name.toLowerCase().includes(query.toLowerCase())
      ).slice(0, 50)
    : models.slice(0, 50);

  const selectedModel = models.find(m => m.id === value);
  const displayValue = selectedModel ? selectedModel.name : value;

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => { setOpen(!open); setQuery(''); }}
        className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text text-left truncate focus:outline-none focus:ring-2 focus:ring-primary"
        title={value}
      >
        {loadingModels ? 'Loading models...' : displayValue || 'Select a model'}
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-bg-surface border border-border rounded-lg shadow-lg max-h-60 flex flex-col">
          <div className="p-2 border-b border-border">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search models..."
              className="w-full px-2 py-1.5 bg-bg border border-border rounded text-sm text-text placeholder:text-text-dim focus:outline-none focus:ring-1 focus:ring-primary"
              autoFocus
            />
          </div>
          <div className="overflow-y-auto flex-1">
            {loadingModels ? (
              <div className="px-3 py-4 text-xs text-text-muted text-center">Loading models from OpenRouter...</div>
            ) : filtered.length === 0 ? (
              <div className="px-3 py-4 text-xs text-text-muted text-center">No models found</div>
            ) : (
              filtered.map(m => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => { onChange(m.id); setOpen(false); setQuery(''); }}
                  className={`w-full px-3 py-2 text-left text-sm hover:bg-primary/10 transition-colors ${m.id === value ? 'bg-primary/5 text-primary font-medium' : 'text-text'}`}
                >
                  <span className="block truncate">{m.name}</span>
                  <span className="block text-xs text-text-muted truncate font-mono">{m.id}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const defaultEnvState: EnvCredentialState = {
  anthropicStatus: { connected: false },
  openrouterStatus: { connected: false },
};

export default function IntegrationsPanel() {
  const { user, dashboardEnv } = useAuth();
  const [localState, setLocalState] = useState<EnvCredentialState>({ ...defaultEnvState });
  const [vpsState, setVpsState] = useState<EnvCredentialState>({ ...defaultEnvState });
  const [githubStatus, setGithubStatus] = useState<CredentialStatus>({ connected: false });
  const [claudeOauthDetected, setClaudeOauthDetected] = useState(false);
  const [loading, setLoading] = useState(true);

  const [showAnthropicForm, setShowAnthropicForm] = useState(false);
  const [anthropicKey, setAnthropicKey] = useState('');
  const [savingAnthropic, setSavingAnthropic] = useState(false);

  const [showGithubForm, setShowGithubForm] = useState(false);
  const [githubToken, setGithubToken] = useState('');
  const [savingGithub, setSavingGithub] = useState(false);

  const [showOpenrouterForm, setShowOpenrouterForm] = useState(false);
  const [openrouterKey, setOpenrouterKey] = useState('');
  const [opusModel, setOpusModel] = useState('anthropic/claude-opus-4');
  const [sonnetModel, setSonnetModel] = useState('anthropic/claude-sonnet-4');
  const [haikuModel, setHaikuModel] = useState('anthropic/claude-haiku-4');
  const [savingOpenrouter, setSavingOpenrouter] = useState(false);
  const [openrouterModels, setOpenrouterModels] = useState<OpenRouterModel[]>(modelsCache || []);
  const [loadingModels, setLoadingModels] = useState(false);

  const [editingModels, setEditingModels] = useState<CredentialEnvironment | null>(null);
  const [editOpusModel, setEditOpusModel] = useState('');
  const [editSonnetModel, setEditSonnetModel] = useState('');
  const [editHaikuModel, setEditHaikuModel] = useState('');
  const [savingModels, setSavingModels] = useState(false);

  const [showTerminal, setShowTerminal] = useState(false);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [pendingSave, setPendingSave] = useState<PendingSave | null>(null);
  const [activeTab, setActiveTab] = useState<string>(dashboardEnv);

  useEffect(() => {
    loadStatuses();
  }, []);

  // Fetch OpenRouter models when form is opened or any openrouter is connected
  const anyOpenrouterConnected = localState.openrouterStatus.connected || vpsState.openrouterStatus.connected;
  useEffect(() => {
    if ((showOpenrouterForm || anyOpenrouterConnected) && openrouterModels.length === 0 && !loadingModels) {
      fetchOpenRouterModels();
    }
  }, [showOpenrouterForm, anyOpenrouterConnected]);

  async function fetchOpenRouterModels() {
    if (modelsCache) {
      setOpenrouterModels(modelsCache);
      return;
    }
    setLoadingModels(true);
    try {
      const res = await fetch('https://openrouter.ai/api/v1/models');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const models: OpenRouterModel[] = (data.data || []).map((m: any) => ({
        id: m.id,
        name: m.name || m.id,
      }));
      models.sort((a, b) => a.name.localeCompare(b.name));
      modelsCache = models;
      setOpenrouterModels(models);
    } catch (err) {
      console.error('Failed to fetch OpenRouter models:', err);
    } finally {
      setLoadingModels(false);
    }
  }

  function getEnvState(env: CredentialEnvironment): EnvCredentialState {
    return env === 'local' ? localState : vpsState;
  }

  function setEnvState(env: CredentialEnvironment, state: EnvCredentialState) {
    if (env === 'local') setLocalState(state);
    else setVpsState(state);
  }

  async function loadStatuses() {
    setLoading(true);
    try {
      const [localAnthro, localOr, vpsAnthro, vpsOr, gh, claudeLogin] = await Promise.all([
        api.get<CredentialStatus>('/api/credentials/anthropic/status?environment=local'),
        api.get<CredentialStatus>('/api/credentials/openrouter/status?environment=local'),
        api.get<CredentialStatus>('/api/credentials/anthropic/status?environment=vps'),
        api.get<CredentialStatus>('/api/credentials/openrouter/status?environment=vps'),
        api.get<CredentialStatus>('/api/credentials/github/status'),
        api.get<{ detected: boolean }>('/api/credentials/claude-login-status').catch(() => ({ detected: false })),
      ]);

      setLocalState({ anthropicStatus: localAnthro, openrouterStatus: localOr });
      setVpsState({ anthropicStatus: vpsAnthro, openrouterStatus: vpsOr });
      setGithubStatus(gh);
      setClaudeOauthDetected(claudeLogin.detected);

      // Populate model dropdowns from stored metadata (prefer current env)
      const orStatus = (dashboardEnv === 'local' ? localOr : vpsOr);
      if (orStatus.connected && orStatus.metadata) {
        if (orStatus.metadata.opusModel) setOpusModel(orStatus.metadata.opusModel);
        if (orStatus.metadata.sonnetModel) setSonnetModel(orStatus.metadata.sonnetModel);
        if (orStatus.metadata.haikuModel) setHaikuModel(orStatus.metadata.haikuModel);
      }

      // Auto-detect for current dashboard env
      const currentEnv = dashboardEnv === 'local' ? localAnthro : vpsAnthro;
      const currentOr = dashboardEnv === 'local' ? localOr : vpsOr;
      if (!currentEnv.connected || !gh.connected || !currentOr.connected) {
        try {
          const { detected } = await api.post<{ detected: { provider: string; saved: boolean }[] }>('/api/credentials/auto-detect', {});
          if (detected.length > 0) {
            // Re-fetch statuses for current env
            const env = dashboardEnv;
            const [anthro2, or2, gh2] = await Promise.all([
              api.get<CredentialStatus>(`/api/credentials/anthropic/status?environment=${env}`),
              api.get<CredentialStatus>(`/api/credentials/openrouter/status?environment=${env}`),
              api.get<CredentialStatus>('/api/credentials/github/status'),
            ]);
            setEnvState(env, { anthropicStatus: anthro2, openrouterStatus: or2 });
            setGithubStatus(gh2);
            if (or2.connected && or2.metadata) {
              if (or2.metadata.opusModel) setOpusModel(or2.metadata.opusModel);
              if (or2.metadata.sonnetModel) setSonnetModel(or2.metadata.sonnetModel);
              if (or2.metadata.haikuModel) setHaikuModel(or2.metadata.haikuModel);
            }
          }
        } catch {
          // Auto-detect is best-effort
        }
      }
    } catch (err) {
      console.error('Failed to load credential statuses:', err);
    } finally {
      setLoading(false);
    }
  }

  function showSuccessToast(msg: string) {
    setToast({ message: msg, type: 'success' });
    setTimeout(() => setToast(null), 3000);
  }

  function showErrorToast(msg: string) {
    setToast({ message: msg, type: 'error' });
    setTimeout(() => setToast(null), 5000);
  }

  async function handleSaveAnthropic(e: React.FormEvent, environment: CredentialEnvironment) {
    e.preventDefault();
    if (!anthropicKey.trim()) return;

    const envState = getEnvState(environment);
    if (envState.openrouterStatus.connected) {
      setPendingSave({
        provider: 'anthropic',
        environment,
        competingProvider: 'OpenRouter',
        execute: async () => {
          await doSaveAnthropic(environment);
        },
      });
      return;
    }

    await doSaveAnthropic(environment);
  }

  async function doSaveAnthropic(environment: CredentialEnvironment) {
    setSavingAnthropic(true);
    try {
      const result = await api.put<CredentialStatus>('/api/credentials/anthropic', {
        apiKey: anthropicKey.trim(),
        environment,
      });
      const envState = getEnvState(environment);
      setEnvState(environment, { ...envState, anthropicStatus: result, openrouterStatus: { connected: false } });
      setAnthropicKey('');
      setShowAnthropicForm(false);
      showSuccessToast('Anthropic API key saved');
    } catch (err: any) {
      showErrorToast(err.message || 'Failed to save Anthropic key');
    } finally {
      setSavingAnthropic(false);
    }
  }

  async function handleSaveGithub(e: React.FormEvent) {
    e.preventDefault();
    if (!githubToken.trim()) return;
    setSavingGithub(true);
    try {
      const result = await api.put<CredentialStatus>('/api/credentials/github', { token: githubToken.trim() });
      setGithubStatus(result);
      setGithubToken('');
      setShowGithubForm(false);
      showSuccessToast('GitHub token saved');
    } catch (err: any) {
      showErrorToast(err.message || 'Failed to save GitHub token');
    } finally {
      setSavingGithub(false);
    }
  }

  async function handleSaveOpenrouter(e: React.FormEvent, environment: CredentialEnvironment) {
    e.preventDefault();
    if (!openrouterKey.trim()) return;

    const envState = getEnvState(environment);
    if (envState.anthropicStatus.connected) {
      setPendingSave({
        provider: 'openrouter',
        environment,
        competingProvider: 'Anthropic',
        execute: async () => {
          await doSaveOpenrouter(environment);
        },
      });
      return;
    }

    await doSaveOpenrouter(environment);
  }

  async function doSaveOpenrouter(environment: CredentialEnvironment) {
    setSavingOpenrouter(true);
    try {
      const result = await api.put<CredentialStatus>('/api/credentials/openrouter', {
        apiKey: openrouterKey.trim(),
        opusModel,
        sonnetModel,
        haikuModel,
        environment,
      });
      const envState = getEnvState(environment);
      setEnvState(environment, { ...envState, openrouterStatus: result, anthropicStatus: { connected: false } });
      setOpenrouterKey('');
      setShowOpenrouterForm(false);
      showSuccessToast('OpenRouter API key saved');
    } catch (err: any) {
      showErrorToast(err.message || 'Failed to save OpenRouter key');
    } finally {
      setSavingOpenrouter(false);
    }
  }

  async function handleDisconnect(provider: 'anthropic' | 'github' | 'openrouter', environment?: CredentialEnvironment) {
    setDisconnecting(provider);
    try {
      const envParam = environment ? `?environment=${environment}` : '';
      await api.delete(`/api/credentials/${provider}${envParam}`);
      if (provider === 'github') {
        setGithubStatus({ connected: false });
      } else if (environment) {
        const envState = getEnvState(environment);
        if (provider === 'anthropic') {
          setEnvState(environment, { ...envState, anthropicStatus: { connected: false } });
        } else {
          setEnvState(environment, { ...envState, openrouterStatus: { connected: false } });
        }
      }
      const names = { anthropic: 'Claude Code', github: 'GitHub', openrouter: 'OpenRouter' };
      showSuccessToast(`${names[provider]} disconnected`);
    } catch (err: any) {
      showErrorToast(err.message || 'Failed to disconnect');
    } finally {
      setDisconnecting(null);
    }
  }

  function handleConfirmSwitch() {
    if (pendingSave) {
      pendingSave.execute();
      setPendingSave(null);
    }
  }

  function startEditingModels(environment: CredentialEnvironment) {
    const envState = getEnvState(environment);
    const meta = envState.openrouterStatus.metadata;
    setEditOpusModel(meta?.opusModel || 'anthropic/claude-opus-4');
    setEditSonnetModel(meta?.sonnetModel || 'anthropic/claude-sonnet-4');
    setEditHaikuModel(meta?.haikuModel || 'anthropic/claude-haiku-4');
    setEditingModels(environment);
  }

  async function handleSaveModels(environment: CredentialEnvironment) {
    setSavingModels(true);
    try {
      const result = await api.patch<CredentialStatus>('/api/credentials/openrouter/models', {
        opusModel: editOpusModel,
        sonnetModel: editSonnetModel,
        haikuModel: editHaikuModel,
        environment,
      });
      const envState = getEnvState(environment);
      setEnvState(environment, { ...envState, openrouterStatus: result });
      setEditingModels(null);
      showSuccessToast('Model mappings updated');
    } catch (err: any) {
      showErrorToast(err.message || 'Failed to update models');
    } finally {
      setSavingModels(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (user?.plan !== 'pro') {
    return null;
  }

  const envLabel = (env: CredentialEnvironment) => env === 'local' ? 'Local' : 'VPS';
  const providerName = (p: 'anthropic' | 'openrouter') => p === 'anthropic' ? 'Anthropic' : 'OpenRouter';
  const currentTabEnv = activeTab as CredentialEnvironment;

  function renderAnthropicCard(environment: CredentialEnvironment) {
    const envState = getEnvState(environment);
    const status = envState.anthropicStatus;
    const isLocal = environment === 'local';

    return (
      <div className="bg-bg-surface border border-border rounded-xl p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-orange-400 to-orange-600 rounded-lg flex items-center justify-center text-white font-bold text-lg">
              C
            </div>
            <div>
              <h4 className="text-sm font-semibold text-text">Claude Code</h4>
              {status.connected ? (
                <p className="text-xs text-text-muted">
                  Connected &middot; <span className="font-mono">{status.metadata?.keyPrefix}</span>
                </p>
              ) : (
                <p className="text-xs text-text-muted">Add your Anthropic API key</p>
              )}
            </div>
          </div>

          {status.connected ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-danger hover:text-danger-dark"
              onClick={() => handleDisconnect('anthropic', environment)}
              disabled={disconnecting === 'anthropic'}
            >
              {disconnecting === 'anthropic' ? 'Disconnecting...' : 'Disconnect'}
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => { setShowAnthropicForm(!showAnthropicForm); setShowOpenrouterForm(false); }}>
              Connect
            </Button>
          )}
        </div>

        {/* Claude OAuth detection banner (Local tab only) */}
        {isLocal && claudeOauthDetected && !status.connected && (
          <div className="mt-3 p-3 bg-success/10 border border-success/20 rounded-lg text-sm text-success flex items-start gap-2">
            <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p>Claude Code session detected &mdash; connected via Claude subscription.</p>
          </div>
        )}

        {showAnthropicForm && !status.connected && (
          <div className="mt-4 space-y-3">
            <div className="p-3 bg-bg rounded-lg border border-border text-xs text-text-muted space-y-2">
              <p className="font-medium text-text text-sm">Get an API key:</p>
              <ol className="list-decimal list-inside space-y-1">
                <li>Go to <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer" className="text-primary underline">console.anthropic.com/settings/keys</a></li>
                <li>Click "Create Key" and copy it</li>
              </ol>
              {isLocal && (
                <>
                  <p className="mt-2">
                    You can also use <code className="px-1 py-0.5 bg-bg-surface rounded font-mono text-text">claude login</code> via SSH for OAuth with a Claude subscription (Pro, Max, Team, Enterprise).
                  </p>
                  <p className="mt-1">
                    <button type="button" onClick={() => setShowTerminal(true)} className="text-primary underline hover:text-primary-dark">
                      Open a terminal
                    </button> to run <code className="px-1 py-0.5 bg-bg-surface rounded font-mono text-text">claude login</code> directly.
                  </p>
                </>
              )}
            </div>

            <form onSubmit={(e) => handleSaveAnthropic(e, environment)} className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-text-muted mb-1">API Key</label>
                <input
                  type="password"
                  value={anthropicKey}
                  onChange={(e) => setAnthropicKey(e.target.value)}
                  placeholder="sk-ant-..."
                  className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text font-mono placeholder:text-text-dim focus:outline-none focus:ring-2 focus:ring-primary"
                  autoComplete="off"
                />
              </div>
              <div className="flex items-center gap-2 justify-end">
                <Button type="button" variant="ghost" size="sm" onClick={() => { setShowAnthropicForm(false); setAnthropicKey(''); }}>
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={savingAnthropic || !anthropicKey.trim()}>
                  {savingAnthropic ? 'Saving...' : 'Save Key'}
                </Button>
              </div>
            </form>
          </div>
        )}
      </div>
    );
  }

  function renderOpenrouterCard(environment: CredentialEnvironment) {
    const envState = getEnvState(environment);
    const status = envState.openrouterStatus;

    return (
      <div className="bg-bg-surface border border-border rounded-xl p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-emerald-400 to-emerald-600 rounded-lg flex items-center justify-center text-white font-bold text-lg">
              OR
            </div>
            <div>
              <h4 className="text-sm font-semibold text-text">OpenRouter</h4>
              {status.connected ? (
                <p className="text-xs text-text-muted">
                  Connected &middot; <span className="font-mono">{status.metadata?.keyPrefix}</span>
                </p>
              ) : (
                <p className="text-xs text-text-muted">Route through OpenRouter API</p>
              )}
            </div>
          </div>

          {status.connected ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-danger hover:text-danger-dark"
              onClick={() => handleDisconnect('openrouter', environment)}
              disabled={disconnecting === 'openrouter'}
            >
              {disconnecting === 'openrouter' ? 'Disconnecting...' : 'Disconnect'}
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => { setShowOpenrouterForm(!showOpenrouterForm); setShowAnthropicForm(false); }}>
              Connect
            </Button>
          )}
        </div>

        {/* Connected: show model mappings (read-only or edit mode) */}
        {status.connected && status.metadata && editingModels !== environment && (
          <div className="mt-3 p-3 bg-bg rounded-lg border border-border text-xs text-text-muted space-y-1">
            <div className="flex items-center justify-between mb-1">
              <span className="font-medium text-text text-xs uppercase tracking-wide">Model Mappings</span>
              <button
                type="button"
                onClick={() => startEditingModels(environment)}
                className="text-xs text-primary hover:text-primary-dark"
              >
                Edit
              </button>
            </div>
            <p><span className="font-medium text-text">Opus:</span> {openrouterModels.find(m => m.id === status.metadata?.opusModel)?.name || status.metadata.opusModel}</p>
            <p><span className="font-medium text-text">Sonnet:</span> {openrouterModels.find(m => m.id === status.metadata?.sonnetModel)?.name || status.metadata.sonnetModel}</p>
            <p><span className="font-medium text-text">Haiku:</span> {openrouterModels.find(m => m.id === status.metadata?.haikuModel)?.name || status.metadata.haikuModel}</p>
          </div>
        )}

        {/* Edit model mappings */}
        {status.connected && editingModels === environment && (
          <div className="mt-3 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-text-muted mb-1">Opus Model</label>
                <ModelSearchSelect
                  value={editOpusModel}
                  onChange={setEditOpusModel}
                  models={openrouterModels}
                  loadingModels={loadingModels}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-muted mb-1">Sonnet Model</label>
                <ModelSearchSelect
                  value={editSonnetModel}
                  onChange={setEditSonnetModel}
                  models={openrouterModels}
                  loadingModels={loadingModels}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-muted mb-1">Haiku Model</label>
                <ModelSearchSelect
                  value={editHaikuModel}
                  onChange={setEditHaikuModel}
                  models={openrouterModels}
                  loadingModels={loadingModels}
                />
              </div>
            </div>
            <div className="flex items-center gap-2 justify-end">
              <Button type="button" variant="ghost" size="sm" onClick={() => setEditingModels(null)}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => handleSaveModels(environment)} disabled={savingModels}>
                {savingModels ? 'Saving...' : 'Save Models'}
              </Button>
            </div>
          </div>
        )}

        {showOpenrouterForm && !status.connected && (
          <div className="mt-4 space-y-3">
            <div className="p-3 bg-bg rounded-lg border border-border text-xs text-text-muted space-y-2">
              <p className="font-medium text-text text-sm">Get an API key:</p>
              <ol className="list-decimal list-inside space-y-1">
                <li>Go to <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer" className="text-primary underline">openrouter.ai/keys</a></li>
                <li>Create a key and copy it</li>
              </ol>
              <p className="mt-2">
                OpenRouter routes Claude Code requests through their API. Useful on VPS where browser-based Anthropic OAuth isn't available.
              </p>
            </div>

            <form onSubmit={(e) => handleSaveOpenrouter(e, environment)} className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-text-muted mb-1">API Key</label>
                <input
                  type="password"
                  value={openrouterKey}
                  onChange={(e) => setOpenrouterKey(e.target.value)}
                  placeholder="sk-or-..."
                  className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text font-mono placeholder:text-text-dim focus:outline-none focus:ring-2 focus:ring-primary"
                  autoComplete="off"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-text-muted mb-1">Opus Model</label>
                  <ModelSearchSelect
                    value={opusModel}
                    onChange={setOpusModel}
                    models={openrouterModels}
                    loadingModels={loadingModels}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-muted mb-1">Sonnet Model</label>
                  <ModelSearchSelect
                    value={sonnetModel}
                    onChange={setSonnetModel}
                    models={openrouterModels}
                    loadingModels={loadingModels}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-muted mb-1">Haiku Model</label>
                  <ModelSearchSelect
                    value={haikuModel}
                    onChange={setHaikuModel}
                    models={openrouterModels}
                    loadingModels={loadingModels}
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 justify-end">
                <Button type="button" variant="ghost" size="sm" onClick={() => { setShowOpenrouterForm(false); setOpenrouterKey(''); }}>
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={savingOpenrouter || !openrouterKey.trim()}>
                  {savingOpenrouter ? 'Saving...' : 'Save Key'}
                </Button>
              </div>
            </form>
          </div>
        )}
      </div>
    );
  }

  function renderGithubCard() {
    return (
      <div className="bg-bg-surface border border-border rounded-xl p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gray-800 rounded-lg flex items-center justify-center">
              <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
              </svg>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-text">GitHub</h4>
              {githubStatus.connected ? (
                <p className="text-xs text-text-muted">
                  Connected &middot; <span className="font-mono">{githubStatus.metadata?.tokenPrefix}</span>
                </p>
              ) : (
                <p className="text-xs text-text-muted">Add your GitHub personal access token</p>
              )}
            </div>
          </div>

          {githubStatus.connected ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-danger hover:text-danger-dark"
              onClick={() => handleDisconnect('github')}
              disabled={disconnecting === 'github'}
            >
              {disconnecting === 'github' ? 'Disconnecting...' : 'Disconnect'}
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setShowGithubForm(!showGithubForm)}>
              Connect
            </Button>
          )}
        </div>

        {showGithubForm && !githubStatus.connected && (
          <div className="mt-4 space-y-3">
            <div className="p-3 bg-bg rounded-lg border border-border text-xs text-text-muted space-y-2">
              <p className="font-medium text-text text-sm">Create a Personal Access Token:</p>
              <ol className="list-decimal list-inside space-y-1">
                <li>Go to <a href="https://github.com/settings/tokens?type=beta" target="_blank" rel="noopener noreferrer" className="text-primary underline">GitHub Token Settings</a></li>
                <li>Click "Generate new token" (fine-grained)</li>
                <li>Set a name, expiration, and select the repositories you want access to</li>
                <li>Under "Permissions", grant <strong>Contents</strong> (read & write) at minimum</li>
                <li>Click "Generate token" and copy it</li>
              </ol>
              <p className="mt-1">
                Or <button type="button" onClick={() => setShowTerminal(true)} className="text-primary underline hover:text-primary-dark">open a terminal</button> to run <code className="px-1 py-0.5 bg-bg-surface rounded font-mono text-text">gh auth login</code> directly.
              </p>
            </div>

            <form onSubmit={handleSaveGithub} className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-text-muted mb-1">Personal Access Token</label>
                <input
                  type="password"
                  value={githubToken}
                  onChange={(e) => setGithubToken(e.target.value)}
                  placeholder="github_pat_..."
                  className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text font-mono placeholder:text-text-dim focus:outline-none focus:ring-2 focus:ring-primary"
                  autoComplete="off"
                />
              </div>
              <div className="flex items-center gap-2 justify-end">
                <Button type="button" variant="ghost" size="sm" onClick={() => { setShowGithubForm(false); setGithubToken(''); }}>
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={savingGithub || !githubToken.trim()}>
                  {savingGithub ? 'Saving...' : 'Save Token'}
                </Button>
              </div>
            </form>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toast */}
      {toast && (
        <div className={`${
          toast.type === 'success'
            ? 'bg-success/10 border-success/20 text-success'
            : 'bg-danger/10 border-danger/20 text-danger'
        } border rounded-lg px-4 py-2 text-sm`}>
          {toast.message}
        </div>
      )}

      <h3 className="text-base font-semibold text-text flex items-center gap-2">
        <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-2.536a4.5 4.5 0 00-1.242-7.244l-4.5-4.5a4.5 4.5 0 00-6.364 6.364L4.25 8.497" />
        </svg>
        Integrations
      </h3>

      <Tabs defaultValue={dashboardEnv} onValueChange={(v) => { setActiveTab(v); setShowAnthropicForm(false); setShowOpenrouterForm(false); setShowGithubForm(false); }}>
        <div className="border-b border-border">
          <TabsList>
            <TabsTrigger value="local">Local</TabsTrigger>
            <TabsTrigger value="vps">VPS</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="local" className="pt-4 space-y-4">
          {renderAnthropicCard('local')}
          {renderOpenrouterCard('local')}
        </TabsContent>

        <TabsContent value="vps" className="pt-4 space-y-4">
          {renderAnthropicCard('vps')}
          {renderOpenrouterCard('vps')}

          <p className="text-xs font-medium text-text-muted uppercase tracking-wide pt-2">VPS Only</p>
          {renderGithubCard()}
        </TabsContent>
      </Tabs>

      {/* Terminal section */}
      {showTerminal ? (
        <SettingsTerminal onClose={() => setShowTerminal(false)} />
      ) : (
        <button
          onClick={() => setShowTerminal(true)}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm text-text-muted hover:text-text bg-bg-surface border border-border rounded-xl hover:border-primary/30 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
          </svg>
          Open Terminal
        </button>
      )}

      {/* Mutual exclusivity confirmation modal */}
      <AlertDialog open={!!pendingSave} onOpenChange={(open) => !open && setPendingSave(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Switch AI Provider?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingSave ? `Switching to ${providerName(pendingSave.provider)} will disconnect ${pendingSave.competingProvider} on your ${envLabel(pendingSave.environment)} environment. Continue?` : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmSwitch}>Continue</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
