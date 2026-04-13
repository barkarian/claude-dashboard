/**
 * Claude Code client adapter registration.
 *
 * Registers the existing ClaudeCodeChatView as the chat view for the
 * 'claude-code' adapter. The view component is unchanged — it just gets
 * registered in the adapter registry for the ChatViewShell to discover.
 */

import { registerClientAdapter } from '../../../client/src/adapters/registry.ts';
import ClaudeCodeChatView from '../../../client/src/components/chat/ClaudeCodeChatView.tsx';
import manifest from '../manifest.ts';

registerClientAdapter({
  id: manifest.id,
  metadata: manifest,
  ChatView: ClaudeCodeChatView,
});
