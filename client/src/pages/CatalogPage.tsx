import { useNavigate } from 'react-router-dom';
import Header from '../components/layout/Header.tsx';
import { Switch } from '../components/ui/switch.tsx';
import { useServices } from '../hooks/useService.ts';
import { toast } from 'sonner';
import api from '../utils/api.ts';

interface AppCard {
  id: string;
  name: string;
  description: string;
  installed: boolean;
  comingSoon?: boolean;
}

const APPS: AppCard[] = [
  { id: 'claude-code', name: 'Claude Code', description: 'Terminal-style chat. Surfaced in Dev workspaces.', installed: true },
  { id: 'google-drive', name: 'Google Drive', description: 'Let the agent read and write files in your Drive.', installed: false, comingSoon: true },
  { id: 'email', name: 'Email me results', description: 'Receive completed work directly in your inbox.', installed: false, comingSoon: true },
  { id: 'slack', name: 'Slack', description: 'Send messages and notifications to Slack channels.', installed: false, comingSoon: true },
];

export default function CatalogPage() {
  const navigate = useNavigate();
  const { services, refresh } = useServices();

  async function toggleService(id: string, enabled: boolean) {
    try {
      await api.patch(`/api/services/${id}`, { enabled });
      refresh();
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

          {/* Apps section */}
          <section>
            <h2 className="text-xs font-medium text-text-dim uppercase tracking-wider mb-1">Apps</h2>
            <p className="text-sm text-text-muted mb-4">Skills that the agent can use. Enable per workspace.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {APPS.map(app => (
                <div
                  key={app.id}
                  className={`relative border border-border rounded-lg p-4 bg-bg-surface ${
                    app.comingSoon ? 'opacity-60' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-medium text-text">{app.name}</h3>
                      <p className="text-xs text-text-muted mt-1">{app.description}</p>
                    </div>
                    {app.comingSoon ? (
                      <span className="flex-shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full bg-border text-text-dim">
                        Coming soon
                      </span>
                    ) : app.installed ? (
                      <span className="flex-shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full bg-success/15 text-success">
                        Installed
                      </span>
                    ) : (
                      <span className="flex-shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full bg-primary/15 text-primary">
                        Available
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
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
    </div>
  );
}
