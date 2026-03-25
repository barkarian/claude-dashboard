import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '../ui/button.tsx';
import { useAuth } from '../../context/AuthContext.tsx';
import { useDesktopUpdate } from '../../context/DesktopUpdateContext.tsx';
import api from '../../utils/api.ts';

// ─── Git-based update types (non-desktop) ───

interface CommitInfo {
  hash: string;
  message: string;
  date: string;
}

interface UpdateStatus {
  currentCommit: CommitInfo;
  currentBranch: string;
  latestCommit: CommitInfo;
  updateAvailable: boolean;
  updating: boolean;
  updateError: string | null;
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const seconds = Math.floor((now - then) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ─── Desktop (Tauri) update UI ───

function DesktopUpdateUI() {
  const {
    updateAvailable,
    updateVersion,
    updateBody,
    checking,
    downloading,
    downloadProgress,
    error,
    installed,
    checkForUpdate,
    downloadAndInstall,
    relaunch,
    dismissError,
  } = useDesktopUpdate();

  const [appVersion, setAppVersion] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const APP_MODULE = '@tauri-apps/' + 'api/app';
        const { getVersion } = await import(/* @vite-ignore */ APP_MODULE);
        setAppVersion(await getVersion());
      } catch {
        // Not in Tauri
      }
    })();
  }, []);

  return (
    <div className="bg-bg-surface border border-border rounded-xl p-5">
      <h3 className="text-base font-semibold text-text mb-4 flex items-center gap-2">
        <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.992 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" />
        </svg>
        App Updates
      </h3>

      <div className="space-y-3">
        {/* Current version */}
        {appVersion && (
          <div className="text-sm">
            <div className="flex items-center gap-2 text-text">
              <span className="font-medium">Current Version</span>
              <span className="text-text-muted">·</span>
              <span className="font-mono text-text-muted">v{appVersion}</span>
            </div>
          </div>
        )}

        {/* Update installed — restart needed */}
        {installed && (
          <div className="mt-2 p-3 bg-success/10 border border-success/20 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <svg className="w-4 h-4 text-success" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
              <span className="text-sm font-medium text-success">Update Installed</span>
            </div>
            <p className="text-sm text-text-muted mb-3">Restart the app to apply the update.</p>
            <Button variant="default" size="sm" onClick={relaunch}>
              Restart Now
            </Button>
          </div>
        )}

        {/* Downloading */}
        {downloading && (
          <div className="mt-2 space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <span className="text-text">
                {downloadProgress > 0 ? `Downloading... ${downloadProgress}%` : 'Downloading...'}
              </span>
            </div>
            {downloadProgress > 0 && (
              <div className="w-full bg-bg-hover rounded-full h-1.5">
                <div
                  className="bg-primary h-1.5 rounded-full transition-all duration-300"
                  style={{ width: `${downloadProgress}%` }}
                />
              </div>
            )}
          </div>
        )}

        {/* Update available */}
        {!installed && !downloading && updateAvailable && (
          <div className="mt-2 p-3 bg-success/10 border border-success/20 rounded-lg">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-2 h-2 rounded-full bg-success" />
              <span className="text-sm font-medium text-success">Update Available</span>
            </div>
            <div className="text-sm text-text-muted">
              {updateVersion && <span className="font-mono">v{updateVersion}</span>}
              {updateBody && <span> — {updateBody}</span>}
            </div>
          </div>
        )}

        {/* Up to date */}
        {!installed && !downloading && !updateAvailable && !checking && !error && (
          <div className="flex items-center gap-2 text-sm text-text-muted">
            <div className="w-2 h-2 rounded-full bg-success" />
            Up to date
          </div>
        )}

        {/* Error */}
        {error && !downloading && (
          <div className="p-3 bg-danger/10 border border-danger/20 rounded-lg text-sm text-danger flex items-center justify-between">
            <span>{error}</span>
            <button onClick={dismissError} className="text-danger/60 hover:text-danger ml-2 flex-shrink-0">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* Actions */}
        {!installed && !downloading && (
          <div className="pt-2 flex gap-2">
            {updateAvailable && (
              <Button variant="default" size="sm" onClick={downloadAndInstall}>
                Download &amp; Install
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={checkForUpdate}
              disabled={checking}
            >
              {checking ? 'Checking...' : error ? 'Retry' : 'Check for Updates'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Git-based update UI (VPS / local dev) ───

function GitUpdateUI() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const data = await api.get<UpdateStatus>('/api/settings/update-status');
      setStatus(data);
      setError(data.updateError || null);
      return data;
    } catch (err: any) {
      throw err;
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchStatus()
      .catch((err) => setError(err.message || 'Failed to check update status'))
      .finally(() => setLoading(false));
    return clearPoll;
  }, [fetchStatus, clearPoll]);

  // Poll during updating state
  useEffect(() => {
    if (!status?.updating) return;

    pollRef.current = setInterval(async () => {
      try {
        const data = await fetchStatus();
        if (!data.updating) {
          clearPoll();
        }
      } catch {
        clearPoll();
        setRestarting(true);

        const restartPoll = setInterval(async () => {
          try {
            await fetchStatus();
            clearInterval(restartPoll);
            setRestarting(false);
            window.location.reload();
          } catch {
            // Still restarting
          }
        }, 2000);
      }
    }, 3000);

    return clearPoll;
  }, [status?.updating, fetchStatus, clearPoll]);

  const handleCheck = async () => {
    setChecking(true);
    setError(null);
    try {
      await fetchStatus();
    } catch (err: any) {
      setError(err.message || 'Failed to check for updates');
    } finally {
      setChecking(false);
    }
  };

  const handleUpdate = async () => {
    setError(null);
    try {
      await api.post('/api/settings/update');
      setStatus((prev) => prev ? { ...prev, updating: true } : prev);
    } catch (err: any) {
      if (err.message?.includes('409')) {
        setStatus((prev) => prev ? { ...prev, updating: true } : prev);
      } else {
        setError(err.message || 'Failed to start update');
      }
    }
  };

  if (loading) {
    return (
      <div className="bg-bg-surface border border-border rounded-xl p-5">
        <div className="h-5 w-40 bg-bg-hover rounded animate-pulse mb-4" />
        <div className="space-y-2">
          <div className="h-4 w-48 bg-bg-hover rounded animate-pulse" />
          <div className="h-4 w-56 bg-bg-hover rounded animate-pulse" />
        </div>
      </div>
    );
  }

  const isUpdating = status?.updating || false;

  return (
    <div className="bg-bg-surface border border-border rounded-xl p-5">
      <h3 className="text-base font-semibold text-text mb-4 flex items-center gap-2">
        <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.992 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" />
        </svg>
        Dashboard Updates
      </h3>

      <div className="space-y-3">
        {status && (
          <div className="text-sm">
            <div className="flex items-center gap-2 text-text">
              <span className="font-medium">{status.currentBranch}</span>
              <span className="text-text-muted">·</span>
              <span className="font-mono text-text-muted">{status.currentCommit.hash}</span>
            </div>
            <div className="text-text-muted mt-0.5">
              "{status.currentCommit.message}" · {timeAgo(status.currentCommit.date)}
            </div>
          </div>
        )}

        {restarting && (
          <div className="flex items-center gap-2 text-sm">
            <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <span className="text-text">Restarting...</span>
          </div>
        )}

        {isUpdating && !restarting && (
          <div className="flex items-center gap-2 text-sm">
            <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <span className="text-text">Updating...</span>
          </div>
        )}

        {!isUpdating && !restarting && status?.updateAvailable && (
          <div className="mt-2 p-3 bg-success/10 border border-success/20 rounded-lg">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-2 h-2 rounded-full bg-success" />
              <span className="text-sm font-medium text-success">Update Available</span>
            </div>
            <div className="text-sm text-text-muted">
              <span className="font-mono">{status.latestCommit.hash}</span>
              <span> · "{status.latestCommit.message}" · {timeAgo(status.latestCommit.date)}</span>
            </div>
          </div>
        )}

        {!isUpdating && !restarting && status && !status.updateAvailable && !error && (
          <div className="flex items-center gap-2 text-sm text-text-muted">
            <div className="w-2 h-2 rounded-full bg-success" />
            Up to date
          </div>
        )}

        {error && !isUpdating && !restarting && (
          <div className="p-3 bg-danger/10 border border-danger/20 rounded-lg text-sm text-danger">
            {error}
          </div>
        )}

        {!isUpdating && !restarting && (
          <div className="pt-2 flex gap-2">
            {status?.updateAvailable ? (
              <Button variant="default" size="sm" onClick={handleUpdate}>
                Update &amp; Restart
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              onClick={handleCheck}
              disabled={checking}
            >
              {checking ? 'Checking...' : error ? 'Retry' : 'Check for Updates'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main export ───

export default function UpdateSection() {
  const { isDesktop } = useAuth();
  return isDesktop ? <DesktopUpdateUI /> : <GitUpdateUI />;
}
