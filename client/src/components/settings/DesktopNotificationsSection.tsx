import { useState, useEffect } from 'react';
import { Switch } from '../ui/switch.tsx';

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

  // Hide module specifier from Rollup's static analysis so the web build
  // doesn't fail when @tauri-apps/plugin-store isn't installed.
  const STORE_MODULE = '@tauri-apps/' + 'plugin-store';

  async function getStore() {
    const { Store } = await import(/* @vite-ignore */ STORE_MODULE);
    return Store.load('settings.json');
  }

  async function loadToggles() {
    try {
      const store = await getStore();
      const newToggles: Record<string, boolean> = {};
      for (const nt of NOTIFICATION_TYPES) {
        const val = await (store as any).get(`notifications.${nt.key}`);
        newToggles[nt.key] = val !== false; // default: enabled
      }
      setToggles(newToggles);
      setLoaded(true);
    } catch {
      // Not in Tauri environment — default all on
      const defaults: Record<string, boolean> = {};
      NOTIFICATION_TYPES.forEach(nt => { defaults[nt.key] = true; });
      setToggles(defaults);
      setLoaded(true);
    }
  }

  async function handleToggle(key: string) {
    const newValue = !toggles[key];
    setToggles(prev => ({ ...prev, [key]: newValue }));
    try {
      const store = await getStore();
      await (store as any).set(`notifications.${key}`, newValue);
      await (store as any).save();
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
            <Switch
              checked={toggles[nt.key]}
              onCheckedChange={() => handleToggle(nt.key)}
            />
          </label>
        ))}
      </div>
    </div>
  );
}
