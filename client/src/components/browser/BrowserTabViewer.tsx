/**
 * BrowserTabViewer — single-tab live view with address bar, viewport selector,
 * and a fully interactive canvas. Used inside the BrowserPopover dialog.
 *
 * One tabId per instance. Frames arrive via the unified
 * `project:browser-frame` event and are filtered locally by tabId.
 */

import { useEffect, useRef, useState } from 'react';
import { useSocket } from '../../context/SocketContext.tsx';
import type { BrowserViewportMode } from '../../../../shared/types/models.ts';

interface BrowserTabViewerProps {
  projectId: string;
  tabId: string;
  /** Initial URL hint shown in the address bar. */
  initialUrl?: string;
  /** When set, renders a "Go to chat" button that calls this. */
  onGoToChat?: () => void;
}

/** Manual (user-created) tabs are user-owned end-to-end — no agent will ever
 *  drive them, so input is always live and there's no Take Over button.
 *  Chat-bound tabs (tabId === chatId) default to view-only with a button. */
function isManualTab(tabId: string): boolean {
  return tabId.startsWith('manual_');
}

interface FrameState {
  width: number;
  height: number;
  viewportMode: BrowserViewportMode;
}

const VIEWPORT_CSS_WIDTH: Record<BrowserViewportMode, number> = {
  desktop: 1440,
  tablet: 1024,
  mobile: 393,
};

export default function BrowserTabViewer({ projectId, tabId, initialUrl, onGoToChat }: BrowserTabViewerProps) {
  const { socket } = useSocket();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastImageRef = useRef<HTMLImageElement | null>(null);

  const [frameState, setFrameState] = useState<FrameState>({ width: 1440, height: 900, viewportMode: 'desktop' });
  const [hasFrame, setHasFrame] = useState(false);
  const [url, setUrl] = useState(initialUrl || '');
  const [urlInput, setUrlInput] = useState(initialUrl && initialUrl !== 'about:blank' ? initialUrl : '');

  // Takeover state — only meaningful for chat-bound tabs. Manual tabs are
  // always user-controlled (no agent contesting), so we treat them as "in
  // control" immediately. Chat tabs default to view-only and require an
  // explicit Take Over click to start dispatching input.
  const tabIsManual = isManualTab(tabId);
  const [paused, setPaused] = useState(false);
  const [lockedBy, setLockedBy] = useState<string | null>(null);
  const inControl = tabIsManual || (!!socket && lockedBy === socket.id);

  // Subscribe to frames + url updates filtered by tabId.
  useEffect(() => {
    if (!socket) return;
    socket.emit('project:browser-join', { projectId });
    // Ask for an immediate frame in case CDP hasn't emitted one (static page).
    socket.emit('project:browser-refresh-tab', { projectId, tabId });

    function handleFrame(p: { projectId: string; tabId: string; frame: string; width: number; height: number; viewportMode: BrowserViewportMode }) {
      if (p.projectId !== projectId || p.tabId !== tabId) return;
      const img = new Image();
      img.onload = () => {
        lastImageRef.current = img;
        setFrameState({ width: p.width, height: p.height, viewportMode: p.viewportMode });
        setHasFrame(true);
        drawTo(canvasRef.current, img, p.width, p.height);
      };
      img.src = `data:image/jpeg;base64,${p.frame}`;
    }
    function handleUrl(p: { projectId: string; tabId: string; url: string }) {
      if (p.projectId !== projectId || p.tabId !== tabId) return;
      setUrl(p.url);
      if (document.activeElement?.tagName !== 'INPUT') {
        setUrlInput(p.url === 'about:blank' ? '' : p.url);
      }
    }
    function handleState(p: { projectId: string; tabId: string; chatId: string | null; paused: boolean; lockedBy: string | null }) {
      if (p.projectId !== projectId || p.tabId !== tabId) return;
      setPaused(p.paused);
      setLockedBy(p.lockedBy);
    }
    socket.on('project:browser-frame', handleFrame);
    socket.on('project:browser-url', handleUrl);
    socket.on('chat:browser-state', handleState);
    return () => {
      socket.off('project:browser-frame', handleFrame);
      socket.off('project:browser-url', handleUrl);
      socket.off('chat:browser-state', handleState);
    };
  }, [socket, projectId, tabId]);

  function takeOver() {
    if (tabIsManual) return;
    socket?.emit('chat:browser-pause', { projectId, tabId });
  }
  function releaseControl() {
    if (tabIsManual) return;
    socket?.emit('chat:browser-resume', { projectId, tabId });
  }

  function navigateUrl(target: string) {
    if (!socket) return;
    let normalized = target.trim();
    if (!normalized) return;
    if (!/^https?:\/\//i.test(normalized) && !normalized.startsWith('about:')) {
      normalized = `https://${normalized}`;
    }
    socket.emit('project:browser-navigate-tab', { projectId, tabId, url: normalized }, (resp: any) => {
      if (resp?.url) setUrl(resp.url);
    });
  }

  function setViewport(mode: BrowserViewportMode) {
    socket?.emit('project:browser-viewport-tab', { projectId, tabId, mode });
  }

  function toFramePoint(e: { clientX: number; clientY: number; currentTarget: HTMLCanvasElement }): { x: number; y: number } {
    const c = e.currentTarget;
    const rect = c.getBoundingClientRect();
    const sx = (e.clientX - rect.left) / rect.width;
    const sy = (e.clientY - rect.top) / rect.height;
    const dpr = (frameState.width / VIEWPORT_CSS_WIDTH[frameState.viewportMode]) || 1;
    return {
      x: (sx * frameState.width) / dpr,
      y: (sy * frameState.height) / dpr,
    };
  }

  function emitInput(payload: any) {
    socket?.emit('project:browser-input-tab', { projectId, tabId, ...payload });
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex-shrink-0 px-3 py-2 flex items-center gap-2 flex-wrap border-b border-border">
        <form
          onSubmit={(e) => { e.preventDefault(); navigateUrl(urlInput); }}
          className="flex items-center gap-2 flex-1 min-w-[200px]"
        >
          <span className="text-text-dim text-xs" aria-hidden>⌐</span>
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="Enter URL"
            className="flex-1 bg-bg border border-border rounded px-2 py-1 text-sm focus:outline-none focus:border-primary"
          />
          <button type="submit" className="rounded border border-border px-3 py-1 text-sm hover:bg-bg-hover">Go</button>
        </form>
        <ViewportSelector value={frameState.viewportMode} onChange={setViewport} />
        {!tabIsManual && (
          inControl ? (
            <button
              type="button"
              onClick={releaseControl}
              className="rounded border border-green-500 bg-green-500/10 px-3 py-1 text-sm hover:bg-green-500/20"
              title="Release the tab back to the agent"
            >
              Release control
            </button>
          ) : (
            <button
              type="button"
              onClick={takeOver}
              className="rounded border border-primary bg-primary/10 px-3 py-1 text-sm hover:bg-primary/20"
              title="Pause the agent on this tab and take over input"
            >
              Take over
            </button>
          )
        )}
        {onGoToChat && (
          <button
            type="button"
            onClick={onGoToChat}
            className="rounded border border-border px-3 py-1 text-sm hover:bg-bg-hover"
            title="Open the chat that owns this browser tab"
          >
            Go to chat
          </button>
        )}
      </div>

      {/* Banner reflects current control state on chat-bound tabs. Manual
          tabs are always user-controlled — no banner needed. */}
      {!tabIsManual && (
        <div className={`flex-shrink-0 px-3 py-1.5 text-xs text-center border-b border-border ${
          inControl
            ? 'bg-green-500/10 text-green-600 dark:text-green-400'
            : paused && lockedBy
              ? 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400'
              : 'bg-bg-surface text-text-dim'
        }`}>
          {inControl
            ? 'You have control — agent is paused on this tab. Click Release control when done.'
            : paused && lockedBy
              ? 'Another viewer has control of this tab — agent paused.'
              : 'View only — agent is driving. Click Take over to interact.'}
        </div>
      )}

      <div className="flex-1 flex items-center justify-center bg-bg-surface overflow-auto p-2">
        <div className={frameState.viewportMode === 'mobile' ? 'rounded-[40px] border-[14px] border-black p-0 bg-black' : ''}>
          <canvas
            ref={canvasRef}
            width={frameState.width}
            height={frameState.height}
            className="block max-w-full max-h-[70vh]"
            style={{
              aspectRatio: `${frameState.width} / ${frameState.height}`,
              cursor: inControl ? 'crosshair' : 'not-allowed',
              background: hasFrame ? 'transparent' : '#000',
            }}
            onMouseMove={inControl ? (e) => emitInput({ kind: 'mouse-move', ...toFramePoint(e) }) : undefined}
            onMouseDown={inControl ? (e) => { const p = toFramePoint(e); emitInput({ kind: 'mouse-down', ...p, button: e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left' }); } : undefined}
            onMouseUp={inControl ? (e) => { const p = toFramePoint(e); emitInput({ kind: 'mouse-up', ...p, button: e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left' }); } : undefined}
            onWheel={inControl ? (e) => emitInput({ kind: 'mouse-wheel', deltaX: e.deltaX, deltaY: e.deltaY }) : undefined}
            onKeyDown={inControl ? (e) => {
              e.preventDefault();
              if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
                emitInput({ kind: 'type', text: e.key });
              } else {
                emitInput({ kind: 'key-down', key: mapKey(e.key) });
              }
            } : undefined}
            onKeyUp={inControl ? (e) => {
              e.preventDefault();
              if (!(e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey)) {
                emitInput({ kind: 'key-up', key: mapKey(e.key) });
              }
            } : undefined}
            tabIndex={inControl ? 0 : -1}
          />
        </div>
      </div>

      {url && (
        <div className="flex-shrink-0 text-xs text-text-dim px-3 py-1 border-t border-border truncate" title={url}>
          {url}
        </div>
      )}
    </div>
  );
}

function ViewportSelector({ value, onChange }: { value: BrowserViewportMode; onChange: (m: BrowserViewportMode) => void }) {
  const modes: BrowserViewportMode[] = ['desktop', 'tablet', 'mobile'];
  return (
    <div className="flex rounded border border-border overflow-hidden text-xs">
      {modes.map(m => (
        <button
          key={m}
          onClick={() => onChange(m)}
          className={`px-2 py-1 ${value === m ? 'bg-bg-hover font-medium' : 'hover:bg-bg-hover'}`}
        >
          {m}
        </button>
      ))}
    </div>
  );
}

function mapKey(k: string): string {
  if (k === ' ') return 'Space';
  return k;
}

function drawTo(canvas: HTMLCanvasElement | null, img: HTMLImageElement, w: number, h: number): void {
  if (!canvas) return;
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.drawImage(img, 0, 0, w, h);
}
