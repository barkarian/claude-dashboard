import type { AdapterMetadata } from '../../shared/types/adapter.ts';

const manifest: AdapterMetadata = {
  id: 'claw-chat',
  displayName: 'Chat',
  description: 'Conversational AI for everyone — chat with files and get artifacts back inline.',
  shortLabel: 'Chat',
  badgeColor: 'bg-blue-500/10 text-blue-500',
  icon: 'message-square',
  capabilities: {
    terminal: false,
    messages: true,
    resume: true,
    fileWatching: true,       // shares the JSONL watcher with the underlying SDK adapter
    permissions: true,
    questions: true,
    prerequisites: false,     // SDK is bundled, no external binary needed
    concurrentSessions: true,
  },
  defaultConfig: {},
};

export default manifest;
