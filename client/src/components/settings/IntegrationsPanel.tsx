import { useState, useEffect } from 'react';
import { Button } from '../ui/button.tsx';
import { useAuth } from '../../context/AuthContext.tsx';
import api from '../../utils/api.ts';
import SettingsTerminal from './SettingsTerminal.tsx';

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

const MODEL_OPTIONS = [
  { label: 'claude-opus-4', value: 'anthropic/claude-opus-4' },
  { label: 'claude-sonnet-4', value: 'anthropic/claude-sonnet-4' },
  { label: 'claude-haiku-4', value: 'anthropic/claude-haiku-4' },
  { label: 'claude-3.5-sonnet', value: 'anthropic/claude-3.5-sonnet' },
  { label: 'claude-3.5-haiku', value: 'anthropic/claude-3.5-haiku' },
];

export default function IntegrationsPanel() {
  const { user } = useAuth();
  const [anthropicStatus, setAnthropicStatus] = useState<CredentialStatus>({ connected: false });
  const [githubStatus, setGithubStatus] = useState<CredentialStatus>({ connected: false });
  const [openrouterStatus, setOpenrouterStatus] = useState<CredentialStatus>({ connected: false });
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

  const [showTerminal, setShowTerminal] = useState(false);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    loadStatuses();
  }, []);

  async function loadStatuses() {
    setLoading(true);
    try {
      const [anthro, gh, or] = await Promise.all([
        api.get<CredentialStatus>('/api/credentials/anthropic/status'),
        api.get<CredentialStatus>('/api/credentials/github/status'),
        api.get<CredentialStatus>('/api/credentials/openrouter/status'),
      ]);
      setAnthropicStatus(anthro);
      setGithubStatus(gh);
      setOpenrouterStatus(or);

      // Populate model dropdowns from stored metadata
      if (or.connected && or.metadata) {
        if (or.metadata.opusModel) setOpusModel(or.metadata.opusModel);
        if (or.metadata.sonnetModel) setSonnetModel(or.metadata.sonnetModel);
        if (or.metadata.haikuModel) setHaikuModel(or.metadata.haikuModel);
      }

      // Auto-detect local env credentials for any disconnected provider
      if (!anthro.connected || !gh.connected || !or.connected) {
        try {
          const { detected } = await api.post<{ detected: { provider: string; saved: boolean }[] }>('/api/credentials/auto-detect', {});
          if (detected.length > 0) {
            // Re-fetch statuses if anything was detected
            const [anthro2, gh2, or2] = await Promise.all([
              api.get<CredentialStatus>('/api/credentials/anthropic/status'),
              api.get<CredentialStatus>('/api/credentials/github/status'),
              api.get<CredentialStatus>('/api/credentials/openrouter/status'),
            ]);
            setAnthropicStatus(anthro2);
            setGithubStatus(gh2);
            setOpenrouterStatus(or2);
            if (or2.connected && or2.metadata) {
              if (or2.metadata.opusModel) setOpusModel(or2.metadata.opusModel);
              if (or2.metadata.sonnetModel) setSonnetModel(or2.metadata.sonnetModel);
              if (or2.metadata.haikuModel) setHaikuModel(or2.metadata.haikuModel);
            }
          }
        } catch {
          // Auto-detect is best-effort, ignore failures
        }
      }
    } catch (err) {
      console.error('Failed to load credential statuses:', err);
    } finally {
      setLoading(false);
    }
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  async function handleSaveAnthropic(e: React.FormEvent) {
    e.preventDefault();
    if (!anthropicKey.trim()) return;
    setSavingAnthropic(true);
    try {
      const result = await api.put<CredentialStatus>('/api/credentials/anthropic', { apiKey: anthropicKey.trim() });
      setAnthropicStatus(result);
      setAnthropicKey('');
      setShowAnthropicForm(false);
      showToast('Anthropic API key saved');
    } catch (err) {
      console.error('Failed to save Anthropic key:', err);
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
      showToast('GitHub token saved');
    } catch (err) {
      console.error('Failed to save GitHub token:', err);
    } finally {
      setSavingGithub(false);
    }
  }

  async function handleSaveOpenrouter(e: React.FormEvent) {
    e.preventDefault();
    if (!openrouterKey.trim()) return;
    setSavingOpenrouter(true);
    try {
      const result = await api.put<CredentialStatus>('/api/credentials/openrouter', {
        apiKey: openrouterKey.trim(),
        opusModel,
        sonnetModel,
        haikuModel,
      });
      setOpenrouterStatus(result);
      setOpenrouterKey('');
      setShowOpenrouterForm(false);
      showToast('OpenRouter API key saved');
    } catch (err) {
      console.error('Failed to save OpenRouter key:', err);
    } finally {
      setSavingOpenrouter(false);
    }
  }

  async function handleDisconnect(provider: 'anthropic' | 'github' | 'openrouter') {
    setDisconnecting(provider);
    try {
      await api.delete(`/api/credentials/${provider}`);
      if (provider === 'anthropic') {
        setAnthropicStatus({ connected: false });
      } else if (provider === 'github') {
        setGithubStatus({ connected: false });
      } else {
        setOpenrouterStatus({ connected: false });
      }
      const names = { anthropic: 'Claude Code', github: 'GitHub', openrouter: 'OpenRouter' };
      showToast(`${names[provider]} disconnected`);
    } catch (err) {
      console.error('Failed to disconnect:', err);
    } finally {
      setDisconnecting(null);
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

  return (
    <div className="space-y-4">
      {toast && (
        <div className="bg-success/10 border border-success/20 text-success rounded-lg px-4 py-2 text-sm">
          {toast}
        </div>
      )}

      {/* Warning when both Anthropic and OpenRouter are connected */}
      {anthropicStatus.connected && openrouterStatus.connected && (
        <div className="bg-warning/10 border border-warning/20 text-warning rounded-lg px-4 py-3 text-sm flex items-start gap-2">
          <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <p>Both Anthropic and OpenRouter are connected. OpenRouter will take precedence for routing Claude Code requests. Disconnect one if this is unintended.</p>
        </div>
      )}

      <h3 className="text-base font-semibold text-text flex items-center gap-2">
        <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-2.536a4.5 4.5 0 00-1.242-7.244l-4.5-4.5a4.5 4.5 0 00-6.364 6.364L4.25 8.497" />
        </svg>
        Integrations
      </h3>

      {/* ── All Environments ── */}
      <p className="text-xs font-medium text-text-muted uppercase tracking-wide">All Environments</p>

      {/* Claude Code Card */}
      <div className="bg-bg-surface border border-border rounded-xl p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-orange-400 to-orange-600 rounded-lg flex items-center justify-center text-white font-bold text-lg">
              C
            </div>
            <div>
              <h4 className="text-sm font-semibold text-text">Claude Code</h4>
              {anthropicStatus.connected ? (
                <p className="text-xs text-text-muted">
                  Connected &middot; <span className="font-mono">{anthropicStatus.metadata?.keyPrefix}</span>
                </p>
              ) : (
                <p className="text-xs text-text-muted">Add your Anthropic API key</p>
              )}
            </div>
          </div>

          {anthropicStatus.connected ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-danger hover:text-danger-dark"
              onClick={() => handleDisconnect('anthropic')}
              disabled={disconnecting === 'anthropic'}
            >
              {disconnecting === 'anthropic' ? 'Disconnecting...' : 'Disconnect'}
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setShowAnthropicForm(!showAnthropicForm)}>
              Connect
            </Button>
          )}
        </div>

        {showAnthropicForm && !anthropicStatus.connected && (
          <div className="mt-4 space-y-3">
            <div className="p-3 bg-bg rounded-lg border border-border text-xs text-text-muted space-y-2">
              <p className="font-medium text-text text-sm">Get an API key:</p>
              <ol className="list-decimal list-inside space-y-1">
                <li>Go to <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer" className="text-primary underline">console.anthropic.com/settings/keys</a></li>
                <li>Click "Create Key" and copy it</li>
              </ol>
              <p className="mt-2">
                You can also use <code className="px-1 py-0.5 bg-bg-surface rounded font-mono text-text">claude login</code> via SSH for OAuth with a Claude subscription (Pro, Max, Team, Enterprise).
              </p>
              <p className="mt-1">
                <button type="button" onClick={() => setShowTerminal(true)} className="text-primary underline hover:text-primary-dark">
                  Open a terminal
                </button> to run <code className="px-1 py-0.5 bg-bg-surface rounded font-mono text-text">claude login</code> directly.
              </p>
            </div>

            <form onSubmit={handleSaveAnthropic} className="space-y-3">
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

      {/* OpenRouter Card */}
      <div className="bg-bg-surface border border-border rounded-xl p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-emerald-400 to-emerald-600 rounded-lg flex items-center justify-center text-white font-bold text-lg">
              OR
            </div>
            <div>
              <h4 className="text-sm font-semibold text-text">OpenRouter</h4>
              {openrouterStatus.connected ? (
                <p className="text-xs text-text-muted">
                  Connected &middot; <span className="font-mono">{openrouterStatus.metadata?.keyPrefix}</span>
                </p>
              ) : (
                <p className="text-xs text-text-muted">Route through OpenRouter API</p>
              )}
            </div>
          </div>

          {openrouterStatus.connected ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-danger hover:text-danger-dark"
              onClick={() => handleDisconnect('openrouter')}
              disabled={disconnecting === 'openrouter'}
            >
              {disconnecting === 'openrouter' ? 'Disconnecting...' : 'Disconnect'}
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setShowOpenrouterForm(!showOpenrouterForm)}>
              Connect
            </Button>
          )}
        </div>

        {/* Connected: show model mappings */}
        {openrouterStatus.connected && openrouterStatus.metadata && (
          <div className="mt-3 p-3 bg-bg rounded-lg border border-border text-xs text-text-muted space-y-1">
            <p><span className="font-medium text-text">Opus:</span> {openrouterStatus.metadata.opusModel}</p>
            <p><span className="font-medium text-text">Sonnet:</span> {openrouterStatus.metadata.sonnetModel}</p>
            <p><span className="font-medium text-text">Haiku:</span> {openrouterStatus.metadata.haikuModel}</p>
          </div>
        )}

        {showOpenrouterForm && !openrouterStatus.connected && (
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

            <form onSubmit={handleSaveOpenrouter} className="space-y-3">
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
                  <select
                    value={opusModel}
                    onChange={(e) => setOpusModel(e.target.value)}
                    className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    {MODEL_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-muted mb-1">Sonnet Model</label>
                  <select
                    value={sonnetModel}
                    onChange={(e) => setSonnetModel(e.target.value)}
                    className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    {MODEL_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-muted mb-1">Haiku Model</label>
                  <select
                    value={haikuModel}
                    onChange={(e) => setHaikuModel(e.target.value)}
                    className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    {MODEL_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
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

      {/* ── VPS Only ── */}
      <p className="text-xs font-medium text-text-muted uppercase tracking-wide pt-2">VPS Only</p>

      {/* GitHub Card */}
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
    </div>
  );
}
