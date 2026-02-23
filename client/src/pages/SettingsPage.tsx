import Header from '../components/layout/Header.tsx';
import MobileNav from '../components/layout/MobileNav.tsx';
import SshAccessPanel from '../components/settings/SshAccessPanel.tsx';

export default function SettingsPage() {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <Header title="Settings" backTo="/" />
      <div className="flex-1 overflow-y-auto">
        <SshAccessPanel />
      </div>
      <MobileNav />
    </div>
  );
}
