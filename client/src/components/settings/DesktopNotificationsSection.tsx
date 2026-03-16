import { useState, useEffect } from 'react';

declare global {
  interface Window {
    __TAURI__?: unknown;
  }
}

interface NotificationToggle {
  key: string;
  label: string;
  description: string;
}

const NOTIFICATION_TYPES: NotificationToggle[] = [
  { key: 'chat-reply', label: 'Chat Replies', description: 'When an AI response completes' },
  { key: 'build-complete', label: 'Build Complete', description: 'When a script finishes successfully' },
  { key: 'build-failed', label: 'Build Failed', description: 'When a script exits with an error' },
];

export default function DesktopNotificationsSection() {
  const [toggles, setToggles] = useState<Record<string, boolean>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    loadToggles();
  }, []);

  async function loadToggles() {
    try {
      const { Store } = await import('@tauri-apps/plugin-store');
      const store = await Store.load('settings.json');
      const newToggles: Record<string, boolean> = {};
      for (const nt of NOTIFICATION_TYPES) {
        const val = await store.get<boolean>(`notifications.${nt.key}`);
        newToggles[nt.key] = val !== false; // default: enabled
      }
      setToggles(newToggles);
      setLoaded(true);
    } catch {
      // Not in Tauri environment
      setLoaded(true);
    }
  }

  async function handleToggle(key: string) {
    const newValue = !toggles[key];
    setToggles(prev => ({ ...prev, [key]: newValue }));
    try {
      const { Store } = await import('@tauri-apps/plugin-store');
      const store = await Store.load('settings.json');
      await store.set(`notifications.${key}`, newValue);
      await store.save();
    } catch {
      // Ignore store errors
    }
  }

  if (!loaded) return null;

  return (
    <div>
      <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-4">Desktop Notifications</p>
      <div className="space-y-3">
        {NOTIFICATION_TYPES.map(nt => (
          <label
            key={nt.key}
            className="flex items-center justify-between p-3 bg-surface rounded-xl border border-border"
          >
            <div>
              <div className="text-sm font-medium">{nt.label}</div>
              <div className="text-xs text-text-muted">{nt.description}</div>
            </div>
            <button
              onClick={() => handleToggle(nt.key)}
              className={`relative w-10 h-6 rounded-full transition-colors ${
                toggles[nt.key] ? 'bg-accent' : 'bg-border'
              }`}
            >
              <span
                className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${
                  toggles[nt.key] ? 'translate-x-4' : ''
                }`}
              />
            </button>
          </label>
        ))}
      </div>
    </div>
  );
}
