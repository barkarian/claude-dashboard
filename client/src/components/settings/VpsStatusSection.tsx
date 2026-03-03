import { useState, useEffect, useRef } from 'react';
import { Button } from '../ui/button.tsx';
import api from '../../utils/api.ts';

interface VpsInstance {
  id: string;
  name: string;
  status: 'provisioning' | 'bootstrapping' | 'running' | 'stopped' | 'destroying' | 'destroyed';
  ipv4?: string;
  region?: string;
}

export default function VpsStatusSection() {
  const [vps, setVps] = useState<VpsInstance | null>(null);
  const [loading, setLoading] = useState(true);
  const [destroying, setDestroying] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetchStatus();
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);

    const shouldPoll = vps && ['provisioning', 'bootstrapping', 'destroying'].includes(vps.status);
    if (shouldPoll) {
      intervalRef.current = setInterval(fetchStatus, 8000);
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [vps?.status]);

  async function fetchStatus() {
    try {
      const data = await api.get<{ vpsInstance: VpsInstance | null }>('/api/billing/vps-status');
      setVps(data.vpsInstance || null);
    } catch {
      setVps(null);
    } finally {
      setLoading(false);
    }
  }

  async function handleDestroy() {
    setDestroying(true);
    try {
      await api.delete('/api/billing/vps-destroy');
      setShowConfirm(false);
      await fetchStatus();
    } catch (err) {
      console.error('Failed to destroy VPS:', err);
    } finally {
      setDestroying(false);
    }
  }

  async function handleProvision() {
    setProvisioning(true);
    try {
      const data = await api.post<{ vpsInstance: VpsInstance }>('/api/billing/vps-provision');
      setVps(data.vpsInstance || null);
    } catch (err) {
      console.error('Failed to provision VPS:', err);
    } finally {
      setProvisioning(false);
    }
  }

  if (loading) {
    return (
      <div className="bg-bg-surface border border-border rounded-xl p-6">
        <div className="animate-pulse space-y-3">
          <div className="h-5 bg-border rounded w-32" />
          <div className="h-4 bg-border rounded w-48" />
        </div>
      </div>
    );
  }

  if (!vps || vps.status === 'destroyed') {
    return (
      <div className="bg-bg-surface border border-border rounded-xl p-5">
        <h3 className="text-base font-semibold text-text mb-3 flex items-center gap-2">
          <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 14.25h13.5m-13.5 0a3 3 0 01-3-3m3 3a3 3 0 100 6h13.5a3 3 0 100-6m-16.5-3a3 3 0 013-3h13.5a3 3 0 013 3m-19.5 0a4.5 4.5 0 01.9-2.7L5.737 5.1a3.375 3.375 0 012.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 01.9 2.7m0 0a3 3 0 01-3 3m0 3h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008zm-3 6h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008z" />
          </svg>
          VPS Instance
        </h3>
        <p className="text-sm text-text-muted mb-3">No VPS active.</p>
        <Button
          variant="primary"
          size="sm"
          onClick={handleProvision}
          disabled={provisioning}
        >
          {provisioning ? 'Creating...' : 'Create VPS'}
        </Button>
      </div>
    );
  }

  const statusConfig: Record<string, { color: string; label: string; spinning?: boolean }> = {
    provisioning: { color: 'bg-warning', label: 'Provisioning', spinning: true },
    bootstrapping: { color: 'bg-warning', label: 'Bootstrapping', spinning: true },
    running: { color: 'bg-success', label: 'Running' },
    stopped: { color: 'bg-warning', label: 'Stopped' },
    destroying: { color: 'bg-danger', label: 'Destroying', spinning: true },
  };

  const status = statusConfig[vps.status] || { color: 'bg-border', label: vps.status };

  return (
    <div className="bg-bg-surface border border-border rounded-xl p-5">
      <h3 className="text-base font-semibold text-text mb-4 flex items-center gap-2">
        <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 14.25h13.5m-13.5 0a3 3 0 01-3-3m3 3a3 3 0 100 6h13.5a3 3 0 100-6m-16.5-3a3 3 0 013-3h13.5a3 3 0 013 3m-19.5 0a4.5 4.5 0 01.9-2.7L5.737 5.1a3.375 3.375 0 012.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 01.9 2.7m0 0a3 3 0 01-3 3m0 3h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008zm-3 6h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008z" />
        </svg>
        VPS Instance
      </h3>

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          {status.spinning ? (
            <div className={`w-2.5 h-2.5 rounded-full ${status.color} animate-pulse`} />
          ) : (
            <div className={`w-2.5 h-2.5 rounded-full ${status.color}`} />
          )}
          <span className="text-sm font-medium text-text">{status.label}</span>
          {status.spinning && (
            <div className="animate-spin w-4 h-4 border-2 border-primary border-t-transparent rounded-full ml-1" />
          )}
        </div>

        {(vps.status === 'provisioning' || vps.status === 'bootstrapping') && (
          <p className="text-sm text-text-muted">Setting up your VPS... This may take a few minutes.</p>
        )}

        {(vps.status === 'running' || vps.status === 'stopped') && (
          <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <span className="text-text-muted">Name</span>
            <span className="text-text font-mono">{vps.name}</span>
            {vps.ipv4 && (
              <>
                <span className="text-text-muted">IP</span>
                <span className="text-text font-mono">{vps.ipv4}</span>
              </>
            )}
            {vps.region && (
              <>
                <span className="text-text-muted">Region</span>
                <span className="text-text font-mono">{vps.region}</span>
              </>
            )}
          </div>
        )}

        {vps.status !== 'destroying' && (
          <div className="pt-2">
            {showConfirm ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-danger">This will permanently destroy your VPS.</span>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={handleDestroy}
                  disabled={destroying}
                >
                  {destroying ? 'Destroying...' : 'Confirm Destroy'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowConfirm(false)}
                  disabled={destroying}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowConfirm(true)}
              >
                Destroy VPS
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
