/**
 * BrowserPopover — popover anchored to the Browser nav button. Lists every
 * browser tab in the project (chat-bound and manual) with a live thumbnail,
 * driving indicator, and close button. + Add tab creates a new manual tab.
 *
 * Click a tab → opens the BrowserTabDialog with the full canvas viewer.
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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

interface BrowserPopoverProps {
  projectId: string;
  open: boolean;
  onClose: () => void;
}

export default function BrowserPopover({ projectId, open, onClose }: BrowserPopoverProps) {
  const { socket } = useSocket();
  const navigate = useNavigate();
  const [tabs, setTabs] = useState<TabRow[]>([]);
  const [openedTab, setOpenedTab] = useState<TabRow | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  // Timestamp when the dialog was last opened. On mobile webviews the touch
  // that opens the dialog can register as an "outside touch" on the freshly-
  // mounted Radix overlay and close it instantly — Radix's
  // onPointerDownOutside / onInteractOutside fires for that stale event. We
  // suppress closure within a short window after opening.
  const dialogOpenedAt = useRef<number>(0);
  // Per-tab live frame data URL for the thumbnail strip.
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [busyClose, setBusyClose] = useState<Record<string, boolean>>({});

  // Initial fetch + auto-refresh on tab events.
  useEffect(() => {
    if (!socket || !open) return;
    socket.emit('project:browser-join', { projectId });
    function refresh() {
      socket?.emit('project:browser-list-tabs', { projectId }, (resp: { tabs: TabRow[] }) => {
        setTabs(resp.tabs || []);
      });
    }
    refresh();
    function handleCreated() { refresh(); }
    function handleClosed() { refresh(); }
    socket.on('project:browser-tab-created', handleCreated);
    socket.on('project:browser-tab-closed', handleClosed);
    // Live driving status — refresh every 1.5s while popover is open.
    const interval = setInterval(refresh, 1500);
    return () => {
      socket.off('project:browser-tab-created', handleCreated);
      socket.off('project:browser-tab-closed', handleClosed);
      clearInterval(interval);
    };
  }, [socket, projectId, open]);

  // Capture frames for thumbnail strip.
  useEffect(() => {
    if (!socket || !open) return;
    function handleFrame(p: { projectId: string; tabId: string; frame: string }) {
      if (p.projectId !== projectId) return;
      setThumbnails((prev) => ({ ...prev, [p.tabId]: `data:image/jpeg;base64,${p.frame}` }));
    }
    socket.on('project:browser-frame', handleFrame);
    return () => { socket.off('project:browser-frame', handleFrame); };
  }, [socket, projectId, open]);

  // Close on outside click. Disabled while a tab dialog is open — the
  // dialog renders in a portal outside the popover, so taps inside the
  // dialog would otherwise look "outside" and close the popover.
  useEffect(() => {
    if (!open || openedTab) return;
    function onDoc(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open, openedTab, onClose]);

  function addTab() {
    socket?.emit('project:browser-create-tab', { projectId }, (resp: any) => {
      if (resp?.tabId) {
        // Eagerly select the new tab.
        const t: TabRow = {
          tabId: resp.tabId, kind: 'manual', label: 'New tab',
          currentUrl: resp.url || null, viewportMode: 'desktop',
          driving: false, alive: true,
        };
        dialogOpenedAt.current = Date.now();
        setOpenedTab(t);
      }
    });
  }

  function closeTab(t: TabRow) {
    // Optimistically remove from the list so repeated clicks don't stack.
    setTabs((prev) => prev.filter((p) => p.tabId !== t.tabId));
    setBusyClose((b) => ({ ...b, [t.tabId]: true }));
    socket?.emit('project:browser-close-tab', { projectId, tabId: t.tabId }, () => {
      setBusyClose((b) => { const n = { ...b }; delete n[t.tabId]; return n; });
    });
  }

  if (!open && !openedTab) return null;

  return (
    <>
      {open && (
        <div
          ref={popoverRef}
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-80 bg-bg-surface border border-border rounded-xl shadow-lg shadow-black/40 z-50 overflow-hidden"
        >
          <div className="px-3 py-2 border-b border-border flex items-center justify-between">
            <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">Browser tabs</span>
            <button
              onClick={addTab}
              className="text-xs text-primary hover:text-primary-hover transition-colors"
            >
              + Add tab
            </button>
          </div>

          {tabs.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-text-dim">
              No browser tabs yet. Click "+ Add tab" to start one, or arm Browser in a chat.
            </div>
          ) : (
            <div className="max-h-80 overflow-y-auto">
              {tabs.map((t) => (
                <button
                  key={t.tabId}
                  onClick={() => { dialogOpenedAt.current = Date.now(); setOpenedTab(t); }}
                  className="w-full px-3 py-2 border-b border-border/50 last:border-b-0 flex items-center gap-2 hover:bg-bg-hover text-left"
                >
                  <span className="relative inline-block h-2 w-2 flex-shrink-0" aria-hidden>
                    <span className={`absolute inset-0 rounded-full ${t.alive ? (t.driving ? 'bg-green-500' : 'bg-text-muted') : 'bg-text-dim'}`} />
                    {t.driving && (
                      <span className="absolute inset-0 rounded-full bg-green-500/60 animate-ping" />
                    )}
                  </span>
                  {thumbnails[t.tabId] ? (
                    <img
                      src={thumbnails[t.tabId]}
                      alt=""
                      className="h-10 w-16 rounded border border-border object-cover flex-shrink-0"
                    />
                  ) : (
                    <div className="h-10 w-16 rounded border border-border bg-bg flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate flex items-center gap-1">
                      {t.kind === 'chat' && (
                        <span className="text-[10px] uppercase text-primary bg-primary/10 px-1 rounded">chat</span>
                      )}
                      <span className="truncate">{t.label}</span>
                    </div>
                    <div className="text-xs text-text-dim truncate">
                      {t.currentUrl || (t.alive ? 'about:blank' : 'closed')}
                    </div>
                  </div>
                  <span
                    role="button"
                    onClick={(e) => { e.stopPropagation(); closeTab(t); }}
                    aria-disabled={busyClose[t.tabId]}
                    className="text-text-dim hover:text-danger px-1 cursor-pointer"
                    aria-label="Close tab"
                    title="Close tab"
                  >×</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <Dialog
        open={!!openedTab}
        onOpenChange={(o) => {
          // NOTE: Radix only calls onOpenChange(true) when it opens itself
          // (via Trigger). For externally controlled `open`, opening doesn't
          // fire this — so we set dialogOpenedAt at the click site instead.
          if (!o) setOpenedTab(null);
        }}
      >
        <DialogContent
          className="max-w-5xl"
          // Block the "stale touch" close on mobile: the touchend that
          // opened the dialog can hit the overlay the instant it mounts,
          // which Radix interprets as outside-click and closes the dialog
          // again — visible as a flicker. Reject any outside event within
          // 400 ms of open.
          onPointerDownOutside={(e) => {
            if (Date.now() - dialogOpenedAt.current < 400) e.preventDefault();
          }}
          onInteractOutside={(e) => {
            if (Date.now() - dialogOpenedAt.current < 400) e.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>{openedTab?.label || 'Browser'}</DialogTitle>
          </DialogHeader>
          {openedTab && (
            <BrowserTabViewer
              projectId={projectId}
              tabId={openedTab.tabId}
              initialUrl={openedTab.currentUrl || undefined}
              onGoToChat={openedTab.kind === 'chat' && openedTab.chatId ? () => {
                navigate(`/project/${projectId}/chats/${openedTab.chatId}`);
                setOpenedTab(null);
                onClose();
              } : undefined}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
