/**
 * Client-side adapter types.
 *
 * Each adapter registers a ClientChatAdapter that includes its React component.
 * The ChatViewShell looks up the adapter and renders its ChatView.
 */

import type { ComponentType } from 'react';
import type { Socket } from 'socket.io-client';
import type { Chat } from '../../../shared/types/models.ts';
import type { SessionStateContext } from '../../../shared/types/session.ts';
import type { AdapterMetadata } from '../../../shared/types/adapter.ts';

/** Props that the ChatViewShell passes to every adapter view */
export interface AdapterViewProps {
  projectId: string;
  chatId: string;
  chat: Chat;
  socket: Socket;
  sessionState: SessionStateContext | undefined;
  isNewChat: boolean;
  /** Register search callbacks for Ctrl+F integration */
  onSearchRegister: (handler: SearchHandler | null) => void;
}

/** Search interface — adapters implement this for Ctrl+F */
export interface SearchHandler {
  findNext: (query: string, incremental?: boolean) => boolean;
  findPrevious: (query: string) => boolean;
  clear: () => void;
}

/** Client-side adapter registration */
export interface ClientChatAdapter {
  /** Must match the adapter id from the server manifest */
  id: string;
  metadata: AdapterMetadata;
  /** The React component that renders the full chat view (owns scroll, gestures, input, etc.) */
  ChatView: ComponentType<AdapterViewProps>;
}
