import { useState, useEffect, useCallback } from 'react';

interface PermissionStatus {
  applicable: boolean;
  full_disk_access: boolean;
  desktop: boolean;
  documents: boolean;
  downloads: boolean;
}

const TAURI_CORE = '@tauri-apps/' + 'api/core';

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import(/* @vite-ignore */ TAURI_CORE);
  return tauriInvoke(cmd, args);
}

const PERMISSIONS = [
  {
    key: 'full_disk_access' as const,
    label: 'Full Disk Access',
    description: 'Allows the app to access all files and folders on your Mac',
    pane: 'full_disk_access',
  },
  {
    key: 'desktop' as const,
    label: 'Desktop Folder',
    description: 'Access to files on your Desktop',
    pane: 'files_and_folders',
  },
  {
    key: 'documents' as const,
    label: 'Documents Folder',
    description: 'Access to your Documents folder',
    pane: 'files_and_folders',
  },
  {
    key: 'downloads' as const,
    label: 'Downloads Folder',
    description: 'Access to your Downloads folder',
    pane: 'files_and_folders',
  },
];

export default function PermissionsSection() {
  const [status, setStatus] = useState<PermissionStatus | null>(null);
  const [error, setError] = useState(false);

  const checkPermissions = useCallback(async () => {
    try {
      const result = await invoke<PermissionStatus>('check_macos_permissions');
      setStatus(result);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    checkPermissions();

    // Re-check when the window regains focus (user may have toggled in System Settings)
    const onFocus = () => checkPermissions();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [checkPermissions]);

  async function openSettings(pane: string) {
    try {
      await invoke('open_privacy_settings', { pane });
    } catch {
      // Fallback: ignore
    }
  }

  if (error || !status || !status.applicable) return null;

  const allGranted = status.full_disk_access || (status.desktop && status.documents && status.downloads);

  return (
    <div>
      <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-4">
        macOS Permissions
      </p>

      {allGranted ? (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
          <div className="flex items-center gap-2">
            <span className="text-emerald-400 text-sm">&#10003;</span>
            <span className="text-sm text-emerald-300">
              All required permissions are granted
            </span>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl">
            <p className="text-sm text-amber-300">
              Some permissions are missing. The app needs filesystem access to manage
              your projects without interruptions.
            </p>
            <p className="text-xs text-text-muted mt-1">
              Tip: Granting <strong>Full Disk Access</strong> covers everything.
            </p>
          </div>

          {PERMISSIONS.map((perm) => {
            const granted = status[perm.key];
            return (
              <div
                key={perm.key}
                className="flex items-center justify-between p-3 bg-surface rounded-xl border border-border"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      granted ? 'bg-emerald-400' : 'bg-red-400'
                    }`}
                  />
                  <div>
                    <div className="text-sm font-medium">{perm.label}</div>
                    <div className="text-xs text-text-muted">{perm.description}</div>
                  </div>
                </div>
                {!granted && (
                  <button
                    onClick={() => openSettings(perm.pane)}
                    className="text-xs font-medium text-primary hover:text-primary/80 px-3 py-1.5 rounded-lg bg-primary/10 hover:bg-primary/20 transition-colors flex-shrink-0"
                  >
                    Open Settings
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
