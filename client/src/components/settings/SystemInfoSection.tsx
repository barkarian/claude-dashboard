import { useState, useEffect } from 'react';
import api from '../../utils/api.ts';

interface SystemInfo {
  platform: string;
  arch: string;
  nodeVersion: string | null;
  npmVersion: string | null;
  gitVersion: string | null;
  shell: string;
  homeDir: string;
}

const PLATFORM_LABELS: Record<string, string> = {
  darwin: 'macOS',
  win32: 'Windows',
  linux: 'Linux',
  freebsd: 'FreeBSD',
};

export default function SystemInfoSection() {
  const [info, setInfo] = useState<SystemInfo | null>(null);

  useEffect(() => {
    api.get<SystemInfo>('/api/tools/system-info')
      .then(setInfo)
      .catch(() => {});
  }, []);

  if (!info) return null;

  const items = [
    { label: 'Platform', value: `${PLATFORM_LABELS[info.platform] || info.platform} (${info.arch})` },
    { label: 'Node.js', value: info.nodeVersion ? `v${info.nodeVersion}` : null, ok: !!info.nodeVersion },
    { label: 'npm', value: info.npmVersion ? `v${info.npmVersion}` : null, ok: !!info.npmVersion },
    { label: 'Git', value: info.gitVersion ? `v${info.gitVersion}` : null, ok: !!info.gitVersion },
    { label: 'Shell', value: info.shell },
  ];

  return (
    <div className="bg-bg-surface border border-border rounded-xl p-5">
      <h3 className="text-base font-semibold text-text mb-4 flex items-center gap-2">
        <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25" />
        </svg>
        System Info
      </h3>
      <div className="space-y-2">
        {items.map(item => (
          <div key={item.label} className="flex items-center justify-between text-sm">
            <span className="text-text-muted">{item.label}</span>
            <div className="flex items-center gap-2">
              {'ok' in item && (
                <span className={`w-1.5 h-1.5 rounded-full ${item.ok ? 'bg-success' : 'bg-danger'}`} />
              )}
              <span className={`font-mono text-xs ${item.value ? 'text-text' : 'text-danger'}`}>
                {item.value || 'Not found'}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
