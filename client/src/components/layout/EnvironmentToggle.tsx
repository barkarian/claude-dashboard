import { useAuth } from '../../context/AuthContext.tsx';

export default function EnvironmentToggle() {
  const { user, dashboardEnv } = useAuth();

  // Only show for authenticated tunnel-connected users
  if (!user) return null;

  const envMatch = window.location.pathname.match(/^\/(local|vps)/);
  const currentEnv = envMatch ? envMatch[1] as 'local' | 'vps' : dashboardEnv;

  function switchTo(target: 'local' | 'vps') {
    if (target === currentEnv) return;
    // Full page nav — different server instance
    const newPath = window.location.pathname.replace(/^\/(local|vps)/, `/${target}`);
    window.location.href = newPath || `/${target}/`;
  }

  return (
    <div className="flex items-center gap-1 bg-bg-hover rounded-lg p-0.5">
      <button
        onClick={() => switchTo('local')}
        className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
          currentEnv === 'local'
            ? 'bg-bg-surface text-text shadow-sm'
            : 'text-text-dim hover:text-text'
        }`}
      >
        Local
      </button>
      <button
        onClick={() => switchTo('vps')}
        className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
          currentEnv === 'vps'
            ? 'bg-bg-surface text-text shadow-sm'
            : 'text-text-dim hover:text-text'
        }`}
      >
        VPS
      </button>
    </div>
  );
}
