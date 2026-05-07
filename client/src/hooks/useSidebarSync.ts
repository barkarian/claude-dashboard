import { useEffect } from 'react';
import { useSocket } from '../context/SocketContext.tsx';
import type {
  SidebarChatCreated,
  SidebarChatDeleted,
  SidebarChatMetaChanged,
  SidebarChatTabsReordered,
  SidebarProjectPinChanged,
  SidebarProjectReordered,
  SidebarProjectActivity,
  SidebarProjectCreated,
  SidebarProjectDeleted,
} from '../../../shared/types/socket-events.ts';

export interface SidebarSyncHandlers {
  onChatCreated?: (e: SidebarChatCreated) => void;
  onChatDeleted?: (e: SidebarChatDeleted) => void;
  onChatMetaChanged?: (e: SidebarChatMetaChanged) => void;
  onChatTabsReordered?: (e: SidebarChatTabsReordered) => void;
  onProjectPinChanged?: (e: SidebarProjectPinChanged) => void;
  onProjectReordered?: (e: SidebarProjectReordered) => void;
  onProjectActivity?: (e: SidebarProjectActivity) => void;
  onProjectCreated?: (e: SidebarProjectCreated) => void;
  onProjectDeleted?: (e: SidebarProjectDeleted) => void;
}

/**
 * Subscribe to sidebar live-sync events broadcast by the server. Pair with
 * sidebarSync.* on the server. Handlers should be stable (wrap in useCallback)
 * — when they change, the listener unsubscribes/re-subscribes.
 */
export function useSidebarSync(handlers: SidebarSyncHandlers): void {
  const { socket } = useSocket();

  useEffect(() => {
    if (!socket) return;

    const wrappers: Array<[string, (...args: unknown[]) => void]> = [];
    const bind = <E,>(event: string, cb?: (e: E) => void) => {
      if (!cb) return;
      const w = (payload: unknown) => cb(payload as E);
      socket.on(event, w);
      wrappers.push([event, w]);
    };

    bind<SidebarChatCreated>('sidebar:chat-created', handlers.onChatCreated);
    bind<SidebarChatDeleted>('sidebar:chat-deleted', handlers.onChatDeleted);
    bind<SidebarChatMetaChanged>('sidebar:chat-meta-changed', handlers.onChatMetaChanged);
    bind<SidebarChatTabsReordered>('sidebar:chat-tabs-reordered', handlers.onChatTabsReordered);
    bind<SidebarProjectPinChanged>('sidebar:project-pin-changed', handlers.onProjectPinChanged);
    bind<SidebarProjectReordered>('sidebar:project-reordered', handlers.onProjectReordered);
    bind<SidebarProjectActivity>('sidebar:project-activity', handlers.onProjectActivity);
    bind<SidebarProjectCreated>('sidebar:project-created', handlers.onProjectCreated);
    bind<SidebarProjectDeleted>('sidebar:project-deleted', handlers.onProjectDeleted);

    return () => {
      for (const [event, w] of wrappers) socket.off(event, w);
    };
  }, [
    socket,
    handlers.onChatCreated,
    handlers.onChatDeleted,
    handlers.onChatMetaChanged,
    handlers.onChatTabsReordered,
    handlers.onProjectPinChanged,
    handlers.onProjectReordered,
    handlers.onProjectActivity,
    handlers.onProjectCreated,
    handlers.onProjectDeleted,
  ]);
}
