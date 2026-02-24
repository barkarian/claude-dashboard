import { useState, useEffect } from 'react';
import { Button } from '../ui/button.tsx';
import { useAuth } from '../../context/AuthContext.tsx';
import api from '../../utils/api.ts';

interface SshKey {
  id: string;
  label: string;
  publicKey: string;
  fingerprint: string | null;
  createdAt: string;
}

interface DashboardSettings {
  isVps: boolean;
  vpsIp: string | null;
  sshUser: string;
  sshPort: number;
}

export default function SshAccessPanel() {
  const { user, isVps } = useAuth();
  const [settings, setSettings] = useState<DashboardSettings | null>(null);
  const [keys, setKeys] = useState<SshKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newPublicKey, setNewPublicKey] = useState('');
  const [adding, setAdding] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [vpsIpFromStatus, setVpsIpFromStatus] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [settingsData, keysData] = await Promise.all([
        api.get<DashboardSettings>('/api/settings'),
        api.get<{ keys: SshKey[] }>('/api/ssh-keys'),
      ]);
      setSettings(settingsData);
      setKeys(keysData.keys || []);

      // On local + pro, fetch VPS IP from billing status
      if (!settingsData.isVps && user?.plan === 'pro') {
        try {
          const vpsData = await api.get<{ vpsInstance: { ipv4?: string; status: string } | null }>('/api/billing/vps-status');
          if (vpsData.vpsInstance?.ipv4) {
            setVpsIpFromStatus(vpsData.vpsInstance.ipv4);
          }
        } catch { /* ignore */ }
      }
    } catch (err) {
      console.error('Failed to load SSH settings:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleAddKey(e: React.FormEvent) {
    e.preventDefault();
    if (!newLabel.trim() || !newPublicKey.trim()) return;

    setAdding(true);
    try {
      await api.post('/api/ssh-keys', {
        label: newLabel.trim(),
        publicKey: newPublicKey.trim(),
      });
      setNewLabel('');
      setNewPublicKey('');
      setShowAddForm(false);
      await loadData();
    } catch (err) {
      console.error('Failed to add SSH key:', err);
    } finally {
      setAdding(false);
    }
  }

  async function handleDeleteKey(keyId: string) {
    setDeletingId(keyId);
    try {
      await api.delete(`/api/ssh-keys/${keyId}`);
      await loadData();
    } catch (err) {
      console.error('Failed to delete SSH key:', err);
    } finally {
      setDeletingId(null);
    }
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  // Not on Pro plan — show upgrade prompt
  if (user?.plan !== 'pro') {
    return (
      <div className="bg-bg-surface border border-border rounded-xl p-6 text-center">
        <svg className="w-12 h-12 text-text-dim mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
        </svg>
        <h3 className="text-lg font-semibold text-text mb-1">SSH Access Not Available</h3>
        <p className="text-sm text-text-muted mb-3">
          SSH access is only available on Pro VPS instances. Upgrade to Pro to get a dedicated VPS with SSH access.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => document.getElementById('billing-section')?.scrollIntoView({ behavior: 'smooth' })}
        >
          Upgrade to Pro
        </Button>
      </div>
    );
  }

  // Resolve VPS IP: from settings (on VPS) or from vps-status (on local)
  const sshHost = settings?.vpsIp || vpsIpFromStatus || null;
  const sshUser = settings?.sshUser || 'claw-user';
  const sshPort = settings?.sshPort || 22;
  const sshCommand = sshHost
    ? (sshPort === 22 ? `ssh ${sshUser}@${sshHost}` : `ssh -p ${sshPort} ${sshUser}@${sshHost}`)
    : null;

  const hasNoKeys = keys.length === 0;

  return (
    <div className="space-y-6">
      {/* Setup prompt when no keys added yet */}
      {hasNoKeys && (
        <div className="bg-primary/5 border border-primary/20 rounded-xl p-5">
          <h3 className="text-base font-semibold text-text mb-2 flex items-center gap-2">
            <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
            </svg>
            Set up SSH Access
          </h3>
          <p className="text-sm text-text-muted mb-3">
            Add your SSH public key to connect to your VPS from the terminal. Here's how:
          </p>
          <ol className="text-sm text-text-muted space-y-2 mb-4 list-decimal list-inside">
            <li>
              Open a terminal and run: <code className="px-1.5 py-0.5 bg-bg rounded text-xs font-mono text-text">cat ~/.ssh/id_ed25519.pub</code>
            </li>
            <li>Copy the output (starts with <code className="px-1.5 py-0.5 bg-bg rounded text-xs font-mono text-text">ssh-ed25519</code> or <code className="px-1.5 py-0.5 bg-bg rounded text-xs font-mono text-text">ssh-rsa</code>)</li>
            <li>Click "Add Key" below and paste it</li>
            {sshCommand && (
              <li>
                Connect with: <code className="px-1.5 py-0.5 bg-bg rounded text-xs font-mono text-text">{sshCommand}</code>
              </li>
            )}
          </ol>
          <p className="text-xs text-text-dim">
            Don't have an SSH key? Run <code className="px-1 py-0.5 bg-bg rounded font-mono">ssh-keygen -t ed25519</code> to generate one.
          </p>
        </div>
      )}

      {/* Connection Info — show when we have a VPS IP */}
      {sshCommand && !hasNoKeys && (
        <div className="bg-bg-surface border border-border rounded-xl p-5">
          <h3 className="text-base font-semibold text-text mb-4 flex items-center gap-2">
            <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
            </svg>
            SSH Connection
          </h3>

          <div className="space-y-3">
            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <span className="text-text-muted">Host</span>
              <span className="text-text font-mono">{sshHost}</span>
              <span className="text-text-muted">Port</span>
              <span className="text-text font-mono">{sshPort}</span>
              <span className="text-text-muted">User</span>
              <span className="text-text font-mono">{sshUser}</span>
            </div>

            <div className="flex items-center gap-2 mt-3">
              <code className="flex-1 px-3 py-2 bg-bg rounded-lg text-sm font-mono text-text border border-border truncate">
                {sshCommand}
              </code>
              <Button
                variant="outline"
                size="sm"
                onClick={() => copyToClipboard(sshCommand)}
                className="flex-shrink-0"
              >
                {copied ? (
                  <svg className="w-4 h-4 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
                  </svg>
                )}
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* SSH Keys */}
      <div className="bg-bg-surface border border-border rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-text flex items-center gap-2">
            <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
            </svg>
            SSH Keys
          </h3>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAddForm(!showAddForm)}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Add Key
          </Button>
        </div>

        {/* Add Key Form */}
        {showAddForm && (
          <form onSubmit={handleAddKey} className="mb-4 p-4 bg-bg rounded-lg border border-border space-y-3">
            <div>
              <label className="block text-sm font-medium text-text-muted mb-1">Label</label>
              <input
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="e.g. my-macbook"
                className="w-full px-3 py-2 bg-bg-surface border border-border rounded-lg text-sm text-text placeholder:text-text-dim focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-muted mb-1">Public Key</label>
              <textarea
                value={newPublicKey}
                onChange={(e) => setNewPublicKey(e.target.value)}
                placeholder="ssh-ed25519 AAAA... or ssh-rsa AAAA..."
                rows={3}
                className="w-full px-3 py-2 bg-bg-surface border border-border rounded-lg text-sm text-text font-mono placeholder:text-text-dim focus:outline-none focus:ring-2 focus:ring-primary resize-none"
              />
            </div>
            <div className="flex items-center gap-2 justify-end">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowAddForm(false);
                  setNewLabel('');
                  setNewPublicKey('');
                }}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={adding || !newLabel.trim() || !newPublicKey.trim()}
              >
                {adding ? 'Adding...' : 'Add Key'}
              </Button>
            </div>
          </form>
        )}

        {/* Key List */}
        {keys.length === 0 ? (
          <div className="text-center py-6 text-text-muted text-sm">
            No SSH keys added yet. Add a key to enable SSH access to your VPS.
          </div>
        ) : (
          <div className="space-y-2">
            {keys.map((key) => (
              <div
                key={key.id}
                className="flex items-center justify-between p-3 bg-bg rounded-lg border border-border"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-text">{key.label}</span>
                    {key.fingerprint && (
                      <span className="text-xs font-mono text-text-dim truncate">{key.fingerprint}</span>
                    )}
                  </div>
                  <div className="text-xs text-text-dim mt-0.5">
                    Added {new Date(key.createdAt).toLocaleDateString()}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-danger hover:text-danger-dark flex-shrink-0"
                  onClick={() => handleDeleteKey(key.id)}
                  disabled={deletingId === key.id}
                >
                  {deletingId === key.id ? (
                    <div className="animate-spin w-4 h-4 border-2 border-danger border-t-transparent rounded-full" />
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                    </svg>
                  )}
                  Remove
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
