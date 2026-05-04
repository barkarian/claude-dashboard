/**
 * OpenCode client adapter registration. Reuses the existing SDKChatView —
 * the wire protocol (sdk:status, sdk:message, sdk:history) is the same
 * whether the underlying provider is Claude or OpenCode.
 */

import { registerClientAdapter } from '../../../client/src/adapters/registry.ts';
import SDKChatView from '../../../client/src/components/chat/SDKChatView.tsx';
import manifest from '../manifest.ts';

registerClientAdapter({
  id: manifest.id,
  metadata: manifest,
  ChatView: SDKChatView,
});
