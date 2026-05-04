import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Header from '../components/layout/Header.tsx';
import { Switch } from '../components/ui/switch.tsx';
import { Button } from '../components/ui/button.tsx';
import { useServices } from '../hooks/useService.ts';
import { useAdapterSettings, type AdapterInfo } from '../hooks/useAdapterSettings.ts';
import ConfigureProviderDialog from '../components/catalog/ConfigureProviderDialog.tsx';
import { PROVIDERS, type Provider } from '../lib/providers.ts';
import { toast } from 'sonner';
import api from '../utils/api.ts';

interface ComingSoonCard {
  id: string;
  name: string;
  description: string;
}

const COMING_SOON: ComingSoonCard[] = [
  { id: 'google-drive', name: 'Google Drive', description: 'Let the agent read and write files in your Drive.' },
  { id: 'email', name: 'Email me results', description: 'Receive completed work directly in your inbox.' },
  { id: 'slack', name: 'Slack', description: 'Send messages and notifications to Slack channels.' },
];

type ProviderStatus = 'green' | 'amber' | 'grey';

/**
 * Aggregate status for a provider card. Green when at least one of its
 * adapters is fully ready (enabled + prereq met + authed). Amber when an
 * adapter is partially configured (e.g. authed but not enabled, or
 * installed but not authed). Grey when nothing is set up yet.
 */
function computeProviderStatus(provider: Provider, adapterInfos: AdapterInfo[]): ProviderStatus {
  const infos = provider.adapters
    .map(pa => adapterInfos.find(a => a.metadata.id === pa.id))
    .filter((x): x is AdapterInfo => !!x);
  if (infos.length === 0) return 'grey';

  let anyGreen = false;
  let anyAmber = false;

  for (const info of infos) {
    const prereqOk = !info.metadata.capabilities.prerequisites || info.prerequisites?.satisfied;
    const authed = !!info.authStatus?.authenticated;
    const enabled = info.enabled;

    if (prereqOk && authed && enabled) anyGreen = true;
    else if (prereqOk || authed || enabled) anyAmber = true;
  }

  if (anyGreen) return 'green';
  if (anyAmber) return 'amber';
  return 'grey';
}

function statusLabel(status: ProviderStatus): string {
  switch (status) {
    case 'green': return 'Ready';
    case 'amber': return 'Configure';
    case 'grey':  return 'Not configured';
  }
}

function statusBadgeClass(status: ProviderStatus): string {
  switch (status) {
    case 'green': return 'bg-success/15 text-success';
    case 'amber': return 'bg-warning/15 text-warning';
    case 'grey':  return 'bg-border text-text-dim';
  }
}

export default function CatalogPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { services, refresh: refreshServices } = useServices();
  const { adapters: adapterInfos, loading: adaptersLoading } = useAdapterSettings();
  const [configureProvider, setConfigureProvider] = useState<Provider | null>(null);

  // Deep-link: /catalog?configure=<provider-id> auto-opens the configure
  // dialog. Used by the chat-header model picker's "Manage models..." link.
  // We strip the query param after consuming it so back-nav doesn't re-open.
  useEffect(() => {
    const target = searchParams.get('configure');
    if (!target) return;
    const provider = PROVIDERS.find(p => p.id === target);
    if (provider) setConfigureProvider(provider);
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.delete('configure');
      return next;
    }, { replace: true });
  }, [searchParams, setSearchParams]);

  // Only render providers that have at least one of their adapters
  // currently registered. Prevents Cursor (or pre-slice-c OpenCode) from
  // appearing as a dead card.
  const visibleProviders = useMemo(() => {
    if (adaptersLoading) return PROVIDERS;
    return PROVIDERS.filter(p =>
      p.adapters.some(pa => adapterInfos.some(a => a.metadata.id === pa.id))
    );
  }, [adapterInfos, adaptersLoading]);

  async function toggleService(id: string, enabled: boolean) {
    try {
      await api.patch(`/api/services/${id}`, { enabled });
      refreshServices();
      toast.success(enabled ? 'Service enabled' : 'Service disabled');
    } catch {
      toast.error('Failed to update service');
    }
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <Header title="Catalog" backTo="/" />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto w-full p-4 md:p-6 space-y-8">

          {/* Providers section */}
          <section>
            <h2 className="text-xs font-medium text-text-dim uppercase tracking-wider mb-1">Providers</h2>
            <p className="text-sm text-text-muted mb-4">Chat agents you can use across all workspaces.</p>

            {adaptersLoading ? (
              <div className="space-y-3">
                {[1, 2].map(i => (
                  <div key={i} className="h-24 bg-bg-surface border border-border rounded-lg animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {visibleProviders.map(provider => {
                  const status = computeProviderStatus(provider, adapterInfos);
                  return (
                    <div
                      key={provider.id}
                      className="border border-border rounded-lg p-4 bg-bg-surface"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className={`flex-shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded ${provider.badgeColor}`}>
                              {provider.name}
                            </span>
                            <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${statusBadgeClass(status)}`}>
                              {statusLabel(status)}
                            </span>
                          </div>
                          <h3 className="text-sm font-medium text-text mt-2">{provider.name}</h3>
                          <p className="text-xs text-text-muted mt-0.5">{provider.description}</p>
                          <div className="text-xs text-text-dim mt-2">
                            Includes: {provider.adapters.map(a => a.label).join(' · ')}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant={status === 'green' ? 'outline' : 'default'}
                          onClick={() => setConfigureProvider(provider)}
                        >
                          Configure
                        </Button>
                      </div>
                    </div>
                  );
                })}

                {COMING_SOON.map(c => (
                  <div
                    key={c.id}
                    className="border border-border rounded-lg p-4 bg-bg-surface opacity-60"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-medium text-text">{c.name}</h3>
                        <p className="text-xs text-text-muted mt-1">{c.description}</p>
                      </div>
                      <span className="flex-shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full bg-border text-text-dim">
                        Coming soon
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Services section */}
          <section>
            <h2 className="text-xs font-medium text-text-dim uppercase tracking-wider mb-1">Services</h2>
            <p className="text-sm text-text-muted mb-4">System features for your whole account. Always on when enabled.</p>
            <div className="border border-border rounded-lg bg-bg-surface divide-y divide-border">
              {services.map(s => (
                <div key={s.id} className="flex items-start justify-between gap-3 p-4">
                  <button
                    onClick={() => navigate(`/catalog/${s.id}`)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <h3 className="text-sm font-medium text-text hover:text-primary transition-colors">{s.name}</h3>
                    <p className="text-xs text-text-muted mt-1">{s.description}</p>
                  </button>
                  <Switch
                    checked={s.enabled}
                    onCheckedChange={(checked) => toggleService(s.id, checked)}
                    className="flex-shrink-0 mt-1"
                    aria-label={`${s.enabled ? 'Disable' : 'Enable'} ${s.name}`}
                  />
                </div>
              ))}
              {services.length === 0 && (
                <div className="p-6 text-center text-sm text-text-muted">No services available.</div>
              )}
            </div>
          </section>

        </div>
      </div>

      {configureProvider && (
        <ConfigureProviderDialog
          open={!!configureProvider}
          onOpenChange={(open) => !open && setConfigureProvider(null)}
          provider={configureProvider}
        />
      )}
    </div>
  );
}
