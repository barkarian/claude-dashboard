import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import Header from '../components/layout/Header.tsx';
import { Button } from '../components/ui/button.tsx';
import { Switch } from '../components/ui/switch.tsx';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from '../components/ui/alert-dialog.tsx';
import api from '../utils/api.ts';
import { haptics } from '../utils/haptics.ts';
import { toast } from 'sonner';
import { useService } from '../hooks/useService.ts';

interface PortEntry {
  port: number;
  pid: number;
  process: string;
  protocol: string;
  protected: boolean;
}

function LocalComputerDetail({ enabled }: { enabled: boolean }) {
  const [ports, setPorts] = useState<PortEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [killTarget, setKillTarget] = useState<PortEntry | null>(null);
  const [killing, setKilling] = useState<number | null>(null);
  const [showShutdown, setShowShutdown] = useState(false);
  const [shuttingDown, setShuttingDown] = useState(false);

  const loadPorts = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    try {
      const data = await api.get<{ ports: PortEntry[] }>('/api/system/ports');
      setPorts(data.ports);
    } catch {
      // 403 expected when service disabled mid-poll — fall through.
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    loadPorts();
    if (!enabled) return;
    const interval = setInterval(loadPorts, 5000);
    return () => clearInterval(interval);
  }, [loadPorts, enabled]);

  async function handleKill() {
    if (!killTarget) return;
    const port = killTarget.port;
    setKillTarget(null);
    setKilling(port);
    haptics.notificationError();
    try {
      await api.post(`/api/system/ports/${port}/kill`);
      setPorts(prev => prev.filter(p => p.port !== port));
      toast.success(`Killed process on port ${port}`);
    } catch {
      toast.error(`Failed to kill port ${port}`);
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
      toast.success('Shutting down…');
    } catch {
      // Server going down — errors expected
    }
  }

  if (!enabled) {
    return (
      <div className="border border-border rounded-lg bg-bg-surface p-8 text-center">
        <p className="text-sm text-text-muted">
          Enable Local Computer above to manage open ports and shut down your machine remotely.
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Open Ports */}
      <section className="border border-border rounded-lg bg-bg-surface overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="text-sm font-medium text-text">Open ports</h3>
          {loading ? (
            <span className="text-xs text-text-dim">Loading…</span>
          ) : (
            <span className="text-xs text-text-dim">{ports.length} listening</span>
          )}
        </div>
        {loading ? null : ports.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-text-muted">No listening ports.</div>
        ) : (
          <ul className="divide-y divide-border">
            {ports.map(p => (
              <li key={`${p.port}-${p.pid}`} className="flex items-center gap-3 px-4 py-2">
                <span className="font-mono text-sm text-text w-16">:{p.port}</span>
                <span className="flex-1 min-w-0 text-xs text-text-muted truncate">
                  {p.process} · pid {p.pid}
                </span>
                {p.protected ? (
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-border text-text-dim">Protected</span>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={killing === p.port}
                    onClick={() => setKillTarget(p)}
                  >
                    {killing === p.port ? 'Killing…' : 'Kill'}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Shutdown */}
      <section className="border border-border rounded-lg bg-bg-surface p-4">
        <h3 className="text-sm font-medium text-text mb-1">Shut down</h3>
        <p className="text-xs text-text-muted mb-3">
          Issue a system shutdown command on this machine. Any unsaved work will be lost.
        </p>
        <Button variant="danger" size="sm" onClick={() => setShowShutdown(true)} disabled={shuttingDown}>
          {shuttingDown ? 'Shutting down…' : 'Shut down My Computer'}
        </Button>
      </section>

      {/* Kill confirmation */}
      <AlertDialog open={!!killTarget} onOpenChange={(open) => !open && setKillTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Kill process on port {killTarget?.port}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will send SIGKILL to <strong className="text-text">{killTarget?.process}</strong> (pid {killTarget?.pid}).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleKill} className="bg-danger hover:bg-danger/90 text-white">
              Kill
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Shutdown confirmation */}
      <AlertDialog open={showShutdown} onOpenChange={setShowShutdown}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Shut down your computer?</AlertDialogTitle>
            <AlertDialogDescription>
              This will issue a system shutdown command. Any unsaved work will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={shuttingDown}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleShutdown(); }}
              disabled={shuttingDown}
              className="bg-danger hover:bg-danger/90 text-white"
            >
              {shuttingDown ? 'Shutting down…' : 'Shut down'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default function CatalogItemPage() {
  const { id } = useParams<{ id: string }>();
  const { service, loading, setEnabled } = useService(id || '');

  if (loading) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header title="Catalog" backTo="/catalog" />
        <div className="flex-1 flex items-center justify-center">
          <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
        </div>
      </div>
    );
  }

  if (!service) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header title="Catalog" backTo="/catalog" />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <h3 className="text-lg font-medium text-text mb-1">Not found</h3>
            <p className="text-text-muted">This Catalog item doesn't exist.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <Header title={service.name} backTo="/catalog" />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto w-full p-4 md:p-6 space-y-4">

          {/* Service header / toggle */}
          <section className="border border-border rounded-lg bg-bg-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-base font-medium text-text">{service.name}</h2>
                <p className="text-sm text-text-muted mt-1">{service.description}</p>
              </div>
              <Switch
                checked={service.enabled}
                onCheckedChange={(checked) => {
                  setEnabled(checked).catch(() => toast.error('Failed to update service'));
                }}
                className="flex-shrink-0 mt-1"
                aria-label={`${service.enabled ? 'Disable' : 'Enable'} ${service.name}`}
              />
            </div>
          </section>

          {/* Service-specific body */}
          {service.id === 'local-computer' && <LocalComputerDetail enabled={service.enabled} />}
        </div>
      </div>
    </div>
  );
}
