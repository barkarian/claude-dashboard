import { useState, useEffect, useCallback } from 'react';
import Header from '../components/layout/Header.tsx';
import MobileNav from '../components/layout/MobileNav.tsx';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from '../components/ui/alert-dialog.tsx';
import api from '../utils/api.ts';
import { haptics } from '../utils/haptics.ts';

interface PortEntry {
  port: number;
  pid: number;
  process: string;
  protocol: string;
  protected: boolean;
}

export default function MyComputerPage() {
  const [ports, setPorts] = useState<PortEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [killTarget, setKillTarget] = useState<PortEntry | null>(null);
  const [killing, setKilling] = useState<number | null>(null);
  const [showShutdown, setShowShutdown] = useState(false);
  const [shuttingDown, setShuttingDown] = useState(false);

  const loadPorts = useCallback(async () => {
    try {
      const data = await api.get<{ ports: PortEntry[] }>('/api/system/ports');
      setPorts(data.ports);
    } catch (err) {
      console.error('Failed to load ports:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPorts();
    const interval = setInterval(loadPorts, 5000);
    return () => clearInterval(interval);
  }, [loadPorts]);

  async function handleKill() {
    if (!killTarget) return;
    const port = killTarget.port;
    setKillTarget(null);
    setKilling(port);
    haptics.notificationError();
    try {
      await api.post(`/api/system/ports/${port}/kill`);
      // Remove from list immediately
      setPorts(prev => prev.filter(p => p.port !== port));
    } catch (err) {
      console.error('Failed to kill port:', err);
    } finally {
      setKilling(null);
    }
  }

  async function handleShutdown() {
    setShowShutdown(false);
    setShuttingDown(true);
    haptics.notificationError();
    try {
      await api.post('/api/system/shutdown');
    } catch {
      // Server will be going down — errors expected
    }
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <Header title="My Computer" backTo="/" />
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 md:p-6 space-y-6">

          {/* Open Ports Section */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-text uppercase tracking-wider">Open Ports</h2>
              <button
                onClick={() => { setLoading(true); loadPorts(); }}
                className="text-xs text-text-muted hover:text-text transition-colors flex items-center gap-1"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
                </svg>
                Refresh
              </button>
            </div>

            {loading && ports.length === 0 ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin w-5 h-5 border-2 border-primary border-t-transparent rounded-full" />
              </div>
            ) : ports.length === 0 ? (
              <div className="text-sm text-text-muted text-center py-6 bg-bg-surface rounded-lg border border-border">
                No open ports detected
              </div>
            ) : (
              <div className="space-y-1.5">
                {ports.map((entry) => (
                  <div
                    key={entry.port}
                    className="flex items-center justify-between px-3 py-2.5 bg-bg-surface rounded-lg border border-border"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-sm font-mono font-semibold text-primary">:{entry.port}</span>
                      <div className="min-w-0">
                        <span className="text-sm text-text truncate block">{entry.process}</span>
                        <span className="text-xs text-text-dim">PID {entry.pid}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {entry.protected ? (
                        <span className="text-[10px] font-medium text-text-dim bg-border/50 px-2 py-0.5 rounded-full">
                          PROTECTED
                        </span>
                      ) : killing === entry.port ? (
                        <div className="animate-spin w-4 h-4 border-2 border-danger border-t-transparent rounded-full" />
                      ) : (
                        <button
                          onClick={() => setKillTarget(entry)}
                          className="p-1.5 rounded-lg text-text-dim hover:text-danger hover:bg-danger/10 transition-colors"
                          title="Kill process"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Shutdown Section */}
          <section>
            <h2 className="text-sm font-semibold text-text uppercase tracking-wider mb-3">Power</h2>
            <div className="bg-bg-surface rounded-lg border border-border p-4">
              <p className="text-sm text-text-muted mb-3">
                Remotely shut down the computer. This will terminate all running processes including this dashboard.
              </p>
              <button
                onClick={() => setShowShutdown(true)}
                disabled={shuttingDown}
                className="flex items-center gap-2 px-4 py-2 bg-danger text-white text-sm font-medium rounded-lg hover:bg-danger/90 transition-colors disabled:opacity-50"
              >
                {shuttingDown ? (
                  <>
                    <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                    Shutting down...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5.636 5.636a9 9 0 1012.728 0M12 3v9" />
                    </svg>
                    Shut Down Computer
                  </>
                )}
              </button>
            </div>
          </section>

        </div>
      </div>
      <MobileNav />

      {/* Kill Port Confirmation */}
      <AlertDialog open={!!killTarget} onOpenChange={(open) => !open && setKillTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Kill process on port {killTarget?.port}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will force-kill <strong>{killTarget?.process}</strong> (PID {killTarget?.pid}) listening on port {killTarget?.port}. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleKill}
              className="bg-danger hover:bg-danger/90 text-white"
            >
              Kill Process
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Shutdown Confirmation */}
      <AlertDialog open={showShutdown} onOpenChange={setShowShutdown}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Shut down computer?</AlertDialogTitle>
            <AlertDialogDescription>
              This will immediately shut down the computer. All running processes will be terminated and you will lose access to this dashboard until the computer is manually turned back on.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleShutdown}
              className="bg-danger hover:bg-danger/90 text-white"
            >
              Shut Down
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
