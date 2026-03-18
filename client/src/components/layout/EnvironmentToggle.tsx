import { useAuth } from '../../context/AuthContext.tsx';

export default function EnvironmentToggle() {
  const { user } = useAuth();

  // Only show on tunnel domain when user is authenticated
  const isTunnel = window.location.hostname.endsWith('.claw-dev.com');
  if (!user || !isTunnel) return null;

  const envMatch = window.location.pathname.match(/^\/(local|vps)/);
  const currentEnv = envMatch ? envMatch[1] as 'local' | 'vps' : 'local';

  function switchTo(target: 'local' | 'vps') {
    if (target === currentEnv) return;
    // Full page nav to env root — changing env prefix requires new basename
    window.location.href = `/${target}/`;
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
