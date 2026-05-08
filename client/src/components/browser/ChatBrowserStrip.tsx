/**
 * ChatBrowserStrip — small horizontal row of this chat's browser tab(s),
 * displayed above the prompt input in SDK chat views. Click a row to expand
 * the live canvas in a dialog; × to close the tab.
 *
 * Hidden when this chat has no live tabs. Not used in CC chats.
 */

import { useEffect, useState } from 'react';
import { useSocket } from '../../context/SocketContext.tsx';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog.tsx';
import BrowserTabViewer from './BrowserTabViewer.tsx';

interface TabRow {
  tabId: string;
  kind: 'chat' | 'manual';
  chatId?: string;
  label: string;
  currentUrl: string | null;
  viewportMode: 'desktop' | 'tablet' | 'mobile';
  driving: boolean;
  alive: boolean;
}

interface ChatBrowserStripProps {
  projectId: string;
  chatId: string;
}

export default function ChatBrowserStrip({ projectId, chatId }: ChatBrowserStripProps) {
  const { socket } = useSocket();
  const [tabs, setTabs] = useState<TabRow[]>([]);
  const [openedTab, setOpenedTab] = useState<TabRow | null>(null);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});

  // Poll the project's tab list, filter to this chat. Lightweight — only
  // mounted while the chat is active and only for SDK chats.
  useEffect(() => {
    if (!socket) return;
    socket.emit('project:browser-join', { projectId });
    function refresh() {
      socket?.emit('project:browser-list-tabs', { projectId }, (resp: { tabs: TabRow[] }) => {
        const all = resp?.tabs || [];
        setTabs(all.filter(t => t.kind === 'chat' && t.chatId === chatId && t.alive));
      });
    }
    refresh();
    function handleCreated(p: { projectId: string; tabId: string }) {
      // Only refresh if this chat may be affected.
      if (p.projectId === projectId) refresh();
    }
    function handleClosed(p: { projectId: string; tabId: string }) {
      if (p.projectId === projectId) refresh();
    }
    socket.on('project:browser-tab-created', handleCreated);
    socket.on('project:browser-tab-closed', handleClosed);
    const interval = setInterval(refresh, 1500);
    return () => {
      socket.off('project:browser-tab-created', handleCreated);
      socket.off('project:browser-tab-closed', handleClosed);
      clearInterval(interval);
    };
  }, [socket, projectId, chatId]);

  // Capture frames for thumbnails (only for tabs we care about).
  useEffect(() => {
    if (!socket) return;
    function handleFrame(p: { projectId: string; tabId: string; frame: string }) {
      if (p.projectId !== projectId) return;
      setThumbnails((prev) => ({ ...prev, [p.tabId]: `data:image/jpeg;base64,${p.frame}` }));
    }
    socket.on('project:browser-frame', handleFrame);
    return () => { socket.off('project:browser-frame', handleFrame); };
  }, [socket, projectId]);

  function closeTab(t: TabRow) {
    setTabs((prev) => prev.filter((p) => p.tabId !== t.tabId));
    socket?.emit('project:browser-close-tab', { projectId, tabId: t.tabId });
  }

  if (tabs.length === 0) return null;

  return (
    <>
      <div className="flex-shrink-0 px-3 py-2 border-t border-border bg-bg-surface space-y-1.5">
        {tabs.map((t) => (
          <div
            key={t.tabId}
            className="rounded-md border border-border bg-surface px-2 py-1.5 flex items-center gap-2 hover:bg-bg-hover"
          >
            <button
              type="button"
              onClick={() => setOpenedTab(t)}
              className="flex items-center gap-2 flex-1 min-w-0 text-left"
            >
              <span className="relative inline-block h-2 w-2 flex-shrink-0" aria-hidden>
                <span className={`absolute inset-0 rounded-full ${t.driving ? 'bg-green-500' : 'bg-text-muted'}`} />
                {t.driving && <span className="absolute inset-0 rounded-full bg-green-500/60 animate-ping" />}
              </span>
              {thumbnails[t.tabId] ? (
                <img
                  src={thumbnails[t.tabId]}
                  alt=""
                  className="h-8 w-12 rounded border border-border object-cover flex-shrink-0"
                />
              ) : (
                <div className="h-8 w-12 rounded border border-border bg-bg flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">
                  {t.driving ? 'Agent is interacting…' : (t.currentUrl || 'Browser')}
                </div>
                {t.currentUrl && !t.driving && (
                  <div className="text-xs text-text-dim truncate">{t.currentUrl}</div>
                )}
              </div>
            </button>
            <button
              type="button"
              onClick={() => closeTab(t)}
              className="text-text-dim hover:text-danger px-2"
              aria-label="Close browser tab"
              title="Close browser tab"
            >×</button>
          </div>
        ))}
      </div>

      <Dialog open={!!openedTab} onOpenChange={(o) => !o && setOpenedTab(null)}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>{openedTab?.label || 'Browser'}</DialogTitle>
          </DialogHeader>
          {openedTab && (
            <BrowserTabViewer
              projectId={projectId}
              tabId={openedTab.tabId}
              initialUrl={openedTab.currentUrl || undefined}
              // hideGoToChat — we're already inside the chat
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
