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

export default function BrowserTabViewer({ projectId, tabId, initialUrl }: BrowserTabViewerProps) {
  const { socket } = useSocket();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastImageRef = useRef<HTMLImageElement | null>(null);

  const [frameState, setFrameState] = useState<FrameState>({ width: 1440, height: 900, viewportMode: 'desktop' });
  const [hasFrame, setHasFrame] = useState(false);
  const [url, setUrl] = useState(initialUrl || '');
  const [urlInput, setUrlInput] = useState(initialUrl && initialUrl !== 'about:blank' ? initialUrl : '');

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
    socket.on('project:browser-frame', handleFrame);
    socket.on('project:browser-url', handleUrl);
    return () => {
      socket.off('project:browser-frame', handleFrame);
      socket.off('project:browser-url', handleUrl);
    };
  }, [socket, projectId, tabId]);

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
      </div>

      <div className="flex-1 flex items-center justify-center bg-bg-surface overflow-auto p-2">
        <div className={frameState.viewportMode === 'mobile' ? 'rounded-[40px] border-[14px] border-black p-0 bg-black' : ''}>
          <canvas
            ref={canvasRef}
            width={frameState.width}
            height={frameState.height}
            className="block max-w-full max-h-[70vh]"
            style={{
              aspectRatio: `${frameState.width} / ${frameState.height}`,
              cursor: 'crosshair',
              background: hasFrame ? 'transparent' : '#000',
            }}
            onMouseMove={(e) => emitInput({ kind: 'mouse-move', ...toFramePoint(e) })}
            onMouseDown={(e) => { const p = toFramePoint(e); emitInput({ kind: 'mouse-down', ...p, button: e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left' }); }}
            onMouseUp={(e) => { const p = toFramePoint(e); emitInput({ kind: 'mouse-up', ...p, button: e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left' }); }}
            onWheel={(e) => emitInput({ kind: 'mouse-wheel', deltaX: e.deltaX, deltaY: e.deltaY })}
            onKeyDown={(e) => {
              e.preventDefault();
              if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
                emitInput({ kind: 'type', text: e.key });
              } else {
                emitInput({ kind: 'key-down', key: mapKey(e.key) });
              }
            }}
            onKeyUp={(e) => {
              e.preventDefault();
              if (!(e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey)) {
                emitInput({ kind: 'key-up', key: mapKey(e.key) });
              }
            }}
            tabIndex={0}
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
