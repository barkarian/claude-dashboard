import type { AdapterMetadata } from '../../shared/types/adapter.ts';

const manifest: AdapterMetadata = {
  id: 'claude-code',
  displayName: 'Claude Code',
  description: 'Claude Code terminal — PTY-based AI coding assistant with JSONL status tracking',
  shortLabel: 'CC',
  badgeColor: 'bg-primary/10 text-primary',
  icon: 'terminal',
  capabilities: {
    terminal: true,
    messages: false,
    resume: true,
    fileWatching: true,
    permissions: false,      // CC uses --dangerously-skip-permissions
    questions: false,        // questions handled in terminal TUI
    prerequisites: true,     // needs `claude` binary on PATH
    concurrentSessions: true,
  },
  defaultConfig: {},
};

export default manifest;
