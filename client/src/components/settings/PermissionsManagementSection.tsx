import { useState, useEffect, useCallback } from 'react';
import { Button } from '../ui/button.tsx';
import api from '../../utils/api.ts';

interface PermissionCheck {
  id: string;
  label: string;
  description: string;
  granted: boolean;
  instructions: string;
  actionType: 'open_settings' | 'run_command' | 'manual';
  actionValue?: string;
  category: 'filesystem' | 'execution' | 'agent';
}

interface PermissionsReport {
  platform: string;
  permissions: PermissionCheck[];
}

const CATEGORY_CONFIG = {
  filesystem: {
    label: 'File System Access',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
      </svg>
    ),
  },
  execution: {
    label: 'Execution & Runtime',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
      </svg>
    ),
  },
  agent: {
    label: 'Agent Configuration',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
      </svg>
    ),
  },
} as const;

const PLATFORM_NAMES: Record<string, string> = {
  darwin: 'macOS',
  win32: 'Windows',
  linux: 'Linux',
};

export default function PermissionsManagementSection() {
  const [report, setReport] = useState<PermissionsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchPermissions = useCallback(async () => {
    try {
      const data = await api.get<PermissionsReport>('/api/tools/permissions');
      setReport(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPermissions();

    // Re-check when window regains focus (user may have toggled in system settings)
    const onFocus = () => fetchPermissions();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [fetchPermissions]);

  async function handleAction(perm: PermissionCheck) {
    if (!perm.actionValue) return;
    setActionLoading(perm.id);

    try {
      if (perm.actionType === 'open_settings') {
        await api.post('/api/tools/permissions/open-settings', { url: perm.actionValue });
      } else if (perm.actionType === 'run_command') {
        await api.post('/api/tools/permissions/run-command', { command: perm.actionValue });
        // Re-check after running command
        await fetchPermissions();
      }
    } catch {
      // ignore
    } finally {
      setActionLoading(null);
    }
  }

  if (loading) {
    return (
      <div className="bg-bg-surface border border-border rounded-xl p-5">
        <div className="h-5 w-48 bg-bg-hover rounded animate-pulse mb-4" />
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-14 bg-bg-hover rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!report) return null;

  const categories = ['filesystem', 'execution', 'agent'] as const;
  const grouped = categories.map(cat => ({
    ...CATEGORY_CONFIG[cat],
    category: cat,
    perms: report.permissions.filter(p => p.category === cat),
  })).filter(g => g.perms.length > 0);

  const totalGranted = report.permissions.filter(p => p.granted).length;
  const total = report.permissions.length;
  const allGranted = totalGranted === total;

  return (
    <div className="bg-bg-surface border border-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-text flex items-center gap-2">
          <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
          </svg>
          Permissions ({PLATFORM_NAMES[report.platform] || report.platform})
        </h3>
        <Button variant="ghost" size="sm" onClick={fetchPermissions}>
          Refresh
        </Button>
      </div>

      {/* Summary */}
      {allGranted ? (
        <div className="p-3 bg-success/10 border border-success/20 rounded-lg mb-4">
          <div className="flex items-center gap-2">
            <span className="text-success text-sm font-medium">All {total} permissions granted</span>
          </div>
          <p className="text-xs text-text-muted mt-1">
            Agents have full access to run commands, edit files, and manage your system.
          </p>
        </div>
      ) : (
        <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg mb-4">
          <div className="flex items-center gap-2">
            <span className="text-amber-400 text-sm font-medium">{totalGranted}/{total} permissions granted</span>
          </div>
          <p className="text-xs text-text-muted mt-1">
            Some permissions are missing. Agents may be limited in what they can do.
            {report.platform === 'darwin' && ' Tip: granting Full Disk Access covers most file-related permissions.'}
          </p>
        </div>
      )}

      {/* Permission groups */}
      <div className="space-y-4">
        {grouped.map(group => (
          <div key={group.category}>
            <div className="flex items-center gap-2 mb-2 text-text-muted">
              {group.icon}
              <span className="text-xs font-medium uppercase tracking-wider">{group.label}</span>
            </div>
            <div className="space-y-1.5">
              {group.perms.map(perm => {
                const isExpanded = expandedId === perm.id;
                return (
                  <div key={perm.id} className="border border-border rounded-lg overflow-hidden">
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : perm.id)}
                      className="w-full flex items-center justify-between p-3 hover:bg-bg-hover/50 transition-colors text-left"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${perm.granted ? 'bg-success' : 'bg-danger'}`} />
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-text">{perm.label}</div>
                          <div className="text-xs text-text-muted truncate">{perm.description}</div>
                        </div>
                      </div>
                      <svg className={`w-4 h-4 text-text-dim flex-shrink-0 ml-2 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                      </svg>
                    </button>

                    {isExpanded && (
                      <div className="border-t border-border bg-bg px-3 py-3">
                        <p className="text-xs text-text-muted mb-2">{perm.instructions}</p>
                        {perm.actionValue && (
                          <div className="flex items-center gap-2">
                            {perm.actionType === 'open_settings' && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleAction(perm)}
                                disabled={actionLoading === perm.id}
                              >
                                {actionLoading === perm.id ? 'Opening...' : 'Open Settings'}
                              </Button>
                            )}
                            {perm.actionType === 'run_command' && (
                              <>
                                <code className="text-xs font-mono text-text-muted bg-bg-surface px-2 py-1 rounded border border-border">
                                  {perm.actionValue}
                                </code>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleAction(perm)}
                                  disabled={actionLoading === perm.id}
                                >
                                  {actionLoading === perm.id ? 'Running...' : 'Run'}
                                </Button>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
