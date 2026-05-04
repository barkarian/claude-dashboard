import type { AdapterMetadata } from '../../shared/types/adapter.ts';

const manifest: AdapterMetadata = {
  id: 'opencode',
  displayName: 'OpenCode Agent',
  description: 'Multi-provider AI coding agent. Bring your own provider keys via the OpenCode CLI.',
  shortLabel: 'OpenCode',
  badgeColor: 'bg-emerald-500/10 text-emerald-500',
  icon: 'message-square',
  capabilities: {
    terminal: false,
    messages: true,
    resume: true,
    fileWatching: false,
    permissions: false,       // tool permissions UX deferred — slice c v1 is text-only
    questions: false,
    prerequisites: true,      // requires `opencode` binary + auth.json
    concurrentSessions: true,
  },
  defaultConfig: {},
};

export default manifest;
