/**
 * ChatViewShell — looks up the adapter and renders its view component.
 *
 * This replaces the hardcoded ChatViewRouter that switches between
 * ClaudeCodeChatView and SDKChatView. With the adapter registry,
 * any registered adapter's view component is rendered automatically.
 *
 * The shell provides NO chat-specific UI behavior. All scroll, gestures,
 * input, overlays, and search are owned by the adapter's ChatView.
 */

import { useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useProject } from '../../context/ProjectContext.tsx';
import { useSocket } from '../../context/SocketContext.tsx';
import { useSessionStates } from '../../hooks/useSessionStatuses.ts';
import { useSearch, type SearchHandler as ContextSearchHandler } from '../../context/SearchContext.tsx';
import { getClientAdapter } from '../../adapters/registry.ts';
import type { SearchHandler } from '../../adapters/types.ts';

interface ChatViewShellProps {
  projectId: string;
}

export default function ChatViewShell({ projectId }: ChatViewShellProps) {
  const { chatId } = useParams<{ chatId: string }>();
  const { project } = useProject();
  const { socket } = useSocket();
  const sessionStates = useSessionStates(projectId);
  const { registerHandler, unregisterHandler } = useSearch();
  const isNewChatRef = useRef(false);
  const currentHandlerRef = useRef<ContextSearchHandler | null>(null);

  // Find the chat object
  const chat = project?.chats?.find(c => c.id === chatId);

  // Determine which adapter to use:
  // 1. The chat's own adapter field (if set and registered)
  // 2. Fall back to the project's default adapter
  const adapterId = chat?.adapter || project?.defaultAdapter || 'claude-agent-sdk';
  const adapterEntry = getClientAdapter(adapterId);

  // Register search handler from adapter (bridges adapter SearchHandler to context SearchHandler)
  const onSearchRegister = useCallback((handler: SearchHandler | null) => {
    // Unregister previous handler
    if (currentHandlerRef.current) {
      unregisterHandler(currentHandlerRef.current);
      currentHandlerRef.current = null;
    }
    // Register new handler
    if (handler) {
      const contextHandler: ContextSearchHandler = {
        findNext: handler.findNext,
        findPrevious: handler.findPrevious,
        clearSearch: handler.clear,
      };
      currentHandlerRef.current = contextHandler;
      registerHandler(contextHandler);
    }
  }, [registerHandler, unregisterHandler]);

  if (!socket || !chatId || !chat) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted">
        Select a chat to start
      </div>
    );
  }

  if (!adapterEntry) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-muted gap-2">
        <p className="text-sm font-medium">Unknown adapter: {adapterId}</p>
        <p className="text-xs">This chat uses an adapter that is not installed.</p>
      </div>
    );
  }

  const AdapterView = adapterEntry.ChatView;

  return (
    <AdapterView
      projectId={projectId}
      chatId={chatId}
      chat={chat}
      socket={socket}
      sessionState={sessionStates[chatId]}
      isNewChat={isNewChatRef.current}
      onSearchRegister={onSearchRegister}
    />
  );
}
