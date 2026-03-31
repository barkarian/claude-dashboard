import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SETTINGS_FILE = path.join(os.homedir(), '.claude', 'settings.json');
const SIGNALS_DIR = path.join(os.homedir(), '.claude', 'session-signals');
const HOOKS_DIR = path.resolve(__dirname, '../scripts/hooks');

// Our hook identifier — used to detect if hooks are already installed
const HOOK_MARKER = 'claude-dashboard-signal-hook';

interface HookEntry {
  matcher: string;
  hooks: Array<{ type: string; command: string }>;
}

interface ClaudeSettings {
  hooks?: Record<string, HookEntry[]>;
  [key: string]: any;
}

const HOOK_CONFIG: Array<{ event: string; script: string }> = [
  { event: 'UserPromptSubmit', script: 'user-prompt-submit.mjs' },
  { event: 'PermissionRequest', script: 'permission-request.mjs' },
  { event: 'Stop', script: 'stop.mjs' },
  { event: 'SessionEnd', script: 'session-end.mjs' },
];

/**
 * Install signal hook scripts into ~/.claude/settings.json.
 * Idempotent — safe to call multiple times.
 */
export function installHooks(): void {
  // Ensure signals directory exists
  fs.mkdirSync(SIGNALS_DIR, { recursive: true });

  // Ensure ~/.claude directory exists
  const claudeDir = path.dirname(SETTINGS_FILE);
  fs.mkdirSync(claudeDir, { recursive: true });

  // Read or create settings
  let settings: ClaudeSettings = {};
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, 'utf-8');
    settings = JSON.parse(raw);
  } catch {
    // File doesn't exist or is invalid — start fresh
  }

  if (!settings.hooks) {
    settings.hooks = {};
  }

  let changed = false;

  for (const { event, script } of HOOK_CONFIG) {
    const scriptPath = path.join(HOOKS_DIR, script);
    const command = `node "${scriptPath}" # ${HOOK_MARKER}`;

    // Check if our hook is already installed for this event
    const existing = settings.hooks[event] || [];
    const alreadyInstalled = existing.some(
      (entry: HookEntry) => entry.hooks?.some(h => h.command?.includes(HOOK_MARKER))
    );

    if (alreadyInstalled) continue;

    // Add our hook entry — preserve any existing hooks for this event
    existing.push({
      matcher: '',
      hooks: [{ type: 'command', command }],
    });
    settings.hooks[event] = existing;
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2) + '\n');
    console.log('[signalHooks] Installed session signal hooks into ~/.claude/settings.json');
  }
}

/**
 * Remove our signal hooks from ~/.claude/settings.json.
 */
export function uninstallHooks(): void {
  let settings: ClaudeSettings;
  try {
    settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
  } catch {
    return;
  }

  if (!settings.hooks) return;

  let changed = false;

  for (const { event } of HOOK_CONFIG) {
    const existing = settings.hooks[event];
    if (!existing) continue;

    const filtered = existing.filter(
      (entry: HookEntry) => !entry.hooks?.some(h => h.command?.includes(HOOK_MARKER))
    );

    if (filtered.length !== existing.length) {
      if (filtered.length === 0) {
        delete settings.hooks[event];
      } else {
        settings.hooks[event] = filtered;
      }
      changed = true;
    }
  }

  if (changed) {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2) + '\n');
    console.log('[signalHooks] Removed session signal hooks from ~/.claude/settings.json');
  }
}
