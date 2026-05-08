/**
 * ChipTray — per-chat tool armer/disarmer.
 *
 * Renders armed-tool chips horizontally above the prompt input. Each chip
 * shows the tool's icon + name; click disarms (with optimistic UI). A "+"
 * chip opens a popover with available tools the user can arm. First-time
 * arm of a tool may trigger an inline install (progress card lives in
 * MessageList, not here).
 *
 * For Claude Code chats the tray is informational only — armed tools are
 * displayed but cannot be toggled (skills are passive).
 */

import { useEffect, useState, useRef } from 'react';
import { useSocket } from '../../context/SocketContext.tsx';

export interface ToolDescriptor {
  id: string;
  name: string;
  icon: string;
  description: string;
}

const KNOWN_TOOLS: Record<string, ToolDescriptor> = {
  browser: {
    id: 'browser',
    name: 'Browser',
    icon: '🌐',
    description: 'Drive Chromium with the project\'s persistent profile. Snapshot, click, screenshot.',
  },
};

interface ChipTrayProps {
  chatId: string;
  armedTools: string[];
  /** When true, render chips as informational pills (CC chats). */
  informational?: boolean;
}

export default function ChipTray({ chatId, armedTools, informational }: ChipTrayProps) {
  const { socket } = useSocket();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [localArmed, setLocalArmed] = useState<string[]>(armedTools);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Sync from prop only when the chat changes (mount or navigation). Once
  // mounted we treat local state + the chat:armed-tools-changed socket event
  // as authoritative — otherwise an optimistic arm gets stomped when the
  // parent's project context hasn't refreshed yet.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setLocalArmed(armedTools); }, [chatId]);

  useEffect(() => {
    if (!socket) return;
    function handleChange({ chatId: cid, armedTools: t }: { chatId: string; armedTools: string[] }) {
      if (cid !== chatId) return;
      setLocalArmed(t);
    }
    socket.on('chat:armed-tools-changed', handleChange);
    return () => { socket.off('chat:armed-tools-changed', handleChange); };
  }, [socket, chatId]);

  // Close picker on outside click.
  useEffect(() => {
    if (!pickerOpen) return;
    function onDoc(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [pickerOpen]);

  function arm(toolId: string) {
    if (busy || informational) return;
    setBusy(true);
    setLocalArmed((prev) => prev.includes(toolId) ? prev : [...prev, toolId]);
    setPickerOpen(false);
    socket?.emit('chat:tool-arm', { chatId, toolId }, (resp: any) => {
      setBusy(false);
      if (resp?.error) {
        setLocalArmed((prev) => prev.filter(t => t !== toolId));
        console.error('arm failed:', resp.error);
        return;
      }
      // Treat the ack as authoritative — it's delivered directly to this
      // socket regardless of room membership, so it works even if the
      // chat:armed-tools-changed broadcast doesn't reach us.
      if (Array.isArray(resp?.armedTools)) {
        setLocalArmed(resp.armedTools);
      }
    });
  }

  function disarm(toolId: string) {
    if (busy || informational) return;
    setBusy(true);
    setLocalArmed((prev) => prev.filter(t => t !== toolId));
    socket?.emit('chat:tool-disarm', { chatId, toolId }, (resp: any) => {
      setBusy(false);
      if (Array.isArray(resp?.armedTools)) {
        setLocalArmed(resp.armedTools);
      }
    });
  }

  const armedDescriptors = localArmed
    .map(id => KNOWN_TOOLS[id])
    .filter((t): t is ToolDescriptor => !!t);
  const availableToArm = Object.values(KNOWN_TOOLS).filter(t => !localArmed.includes(t.id));

  // Hide the tray entirely when there's nothing to show and nothing to add.
  if (armedDescriptors.length === 0 && availableToArm.length === 0) return null;
  if (informational && armedDescriptors.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5 px-1 pb-1.5 flex-wrap">
      {armedDescriptors.map(t => (
        <button
          key={t.id}
          type="button"
          onClick={() => disarm(t.id)}
          disabled={informational || busy}
          title={informational ? `${t.name} skill is available — Claude Code will load it on demand` : `${t.name} armed — click to disarm`}
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
            informational
              ? 'border-border bg-bg-surface text-text-dim cursor-default'
              : 'border-primary/40 bg-primary/10 text-text hover:bg-primary/20 transition-colors'
          }`}
        >
          <span aria-hidden>{t.icon}</span>
          <span>{t.name}</span>
          {!informational && (
            <span className="ml-0.5 text-text-dim">×</span>
          )}
        </button>
      ))}

      {!informational && availableToArm.length > 0 && (
        <div className="relative" ref={popoverRef}>
          <button
            type="button"
            onClick={() => setPickerOpen(o => !o)}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-border bg-transparent px-2 py-0.5 text-xs text-text-dim hover:text-text hover:border-text-dim transition-colors"
            title="Add a tool"
          >
            <span aria-hidden>+</span>
            <span>{armedDescriptors.length === 0 ? 'Add tools' : ''}</span>
          </button>
          {pickerOpen && (
            <div className="absolute bottom-full left-0 mb-1 z-50 w-64 rounded-md border border-border bg-bg-surface shadow-lg">
              <div className="px-3 py-2 text-xs text-text-dim border-b border-border">
                Tools for this chat
              </div>
              {availableToArm.map(t => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => arm(t.id)}
                  className="w-full text-left px-3 py-2 hover:bg-bg-hover flex items-start gap-2"
                >
                  <span className="text-base mt-0.5" aria-hidden>{t.icon}</span>
                  <div>
                    <div className="text-sm font-medium">{t.name}</div>
                    <div className="text-xs text-text-dim">{t.description}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {informational && armedDescriptors.length > 0 && (
        <span
          className="text-xs text-text-dim"
          title="Skills load on demand in Claude Code chats. Ask the agent to use them when needed."
        >
          ⓘ
        </span>
      )}
    </div>
  );
}
