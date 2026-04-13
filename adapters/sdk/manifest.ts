import type { AdapterMetadata } from '../../shared/types/adapter.ts';

const manifest: AdapterMetadata = {
  id: 'claude-agent-sdk',
  displayName: 'Agent SDK',
  description: 'Claude Agent SDK — message-based API chat with tool permissions and questions',
  shortLabel: 'SDK',
  badgeColor: 'bg-violet-500/10 text-violet-500',
  icon: 'message-square',
  capabilities: {
    terminal: false,
    messages: true,
    resume: true,
    fileWatching: true,       // also uses JSONL watcher for richer state
    permissions: true,
    questions: true,
    prerequisites: false,     // SDK is bundled, no external binary needed
    concurrentSessions: true,
  },
  defaultConfig: {},
};

export default manifest;
