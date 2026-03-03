import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext.tsx';
import api from '../../utils/api.ts';

export default function EnvironmentToggle() {
  const { user, dashboardEnv } = useAuth();
  const [modes, setModes] = useState<string[]>([]);

  useEffect(() => {
    if (!user) return;
    api.get<{ modes: string[] }>('/api/tunnel-auth/modes')
      .then((data) => setModes(data.modes))
      .catch(() => setModes([]));
  }, [user]);

  // Only show when both local AND vps are connected
  if (!user || !modes.includes('local') || !modes.includes('vps')) return null;

  const envMatch = window.location.pathname.match(/^\/(local|vps)/);
  const currentEnv = envMatch ? envMatch[1] as 'local' | 'vps' : dashboardEnv;

  function switchTo(target: 'local' | 'vps') {
    if (target === currentEnv) return;
    // Full page nav — navigate to environment root
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
