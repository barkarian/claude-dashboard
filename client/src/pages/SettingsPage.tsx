import Header from '../components/layout/Header.tsx';
import MobileNav from '../components/layout/MobileNav.tsx';
import BillingSection from '../components/settings/BillingSection.tsx';
import VpsStatusSection from '../components/settings/VpsStatusSection.tsx';
import IntegrationsPanel from '../components/settings/IntegrationsPanel.tsx';
import SshAccessPanel from '../components/settings/SshAccessPanel.tsx';
import { useAuth } from '../context/AuthContext.tsx';

export default function SettingsPage() {
  const { user } = useAuth();

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <Header title="Settings" backTo="/" />
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 md:p-6 space-y-6">
          <div id="billing-section">
            <BillingSection />
          </div>
          {user?.plan === 'pro' && <VpsStatusSection />}
          <IntegrationsPanel />
          <div>
            <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-4">VPS Only</p>
            <SshAccessPanel />
          </div>
        </div>
      </div>
      <MobileNav />
    </div>
  );
}
