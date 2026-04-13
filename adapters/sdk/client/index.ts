/**
 * Claude Agent SDK client adapter registration.
 *
 * Registers the existing SDKChatView as the chat view for the
 * 'claude-agent-sdk' adapter. The view component is unchanged.
 */

import { registerClientAdapter } from '../../../client/src/adapters/registry.ts';
import SDKChatView from '../../../client/src/components/chat/SDKChatView.tsx';
import manifest from '../manifest.ts';

registerClientAdapter({
  id: manifest.id,
  metadata: manifest,
  ChatView: SDKChatView,
});
