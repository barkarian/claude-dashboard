/**
 * claw-chat client adapter registration.
 *
 * Reuses the existing SDKChatView. The artifact rendering is built into
 * SDKChatView itself (subscribes to `chat:artifact` socket events and pulls
 * historical artifacts via REST), so it works for any chat — but only
 * claw-chat sessions actually populate artifacts.
 */

import { registerClientAdapter } from '../../../client/src/adapters/registry.ts';
import SDKChatView from '../../../client/src/components/chat/SDKChatView.tsx';
import manifest from '../manifest.ts';

registerClientAdapter({
  id: manifest.id,
  metadata: manifest,
  ChatView: SDKChatView,
});
