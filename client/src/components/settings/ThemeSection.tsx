import { MonitorSmartphone, Sun, Moon } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext.tsx';
import { haptics } from '../../utils/haptics.ts';
import type { ThemePreference } from '../../utils/themeStorage.ts';

const options: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: 'system', label: 'System', icon: MonitorSmartphone },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
];

export default function ThemeSection() {
  const { preference, setPreference } = useTheme();

  function handleSelect(value: ThemePreference) {
    haptics.impactLight();
    setPreference(value);
  }

  return (
    <div>
      <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-4">Appearance</p>
      <div className="flex gap-2">
        {options.map((opt) => {
          const Icon = opt.icon;
          const active = preference === opt.value;
          return (
            <button
              key={opt.value}
              onClick={() => handleSelect(opt.value)}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-medium rounded-xl border transition-colors ${
                active
                  ? 'bg-primary/10 border-primary text-primary'
                  : 'bg-bg-surface border-border text-text-muted hover:text-text hover:border-border-light'
              }`}
            >
              <Icon className="w-4 h-4" />
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
