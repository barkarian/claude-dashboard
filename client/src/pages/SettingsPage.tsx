import Header from '../components/layout/Header.tsx';
import MobileNav from '../components/layout/MobileNav.tsx';
import UpdateSection from '../components/settings/UpdateSection.tsx';
import DesktopNotificationsSection from '../components/settings/DesktopNotificationsSection.tsx';
import ThemeSection from '../components/settings/ThemeSection.tsx';
import AIToolsSection from '../components/settings/AIToolsSection.tsx';
import PermissionsManagementSection from '../components/settings/PermissionsManagementSection.tsx';
import SystemInfoSection from '../components/settings/SystemInfoSection.tsx';
import { useAuth } from '../context/AuthContext.tsx';

export default function SettingsPage() {
  const { isDesktop } = useAuth();

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <Header title="Settings" backTo="/" />
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 md:p-6 space-y-6">
          <ThemeSection />
          <AIToolsSection />
          <PermissionsManagementSection />
          <SystemInfoSection />
          <UpdateSection />
          {isDesktop && <DesktopNotificationsSection />}
        </div>
      </div>
      <MobileNav />
    </div>
  );
}
