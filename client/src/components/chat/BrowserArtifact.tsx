/**
 * BrowserArtifact — live screencast viewer for a Playwright browser session.
 *
 * Collapsed: thumbnail of the latest frame + URL + status badge.
 * Expanded:  full-size canvas + Pause / Take Over / Resume + viewport switcher.
 *
 * The canvas renders raw JPEG frames received over Socket.IO. When the local
 * client holds the input lock, mouse and keyboard events on the canvas are
 * forwarded to the server and dispatched into Chromium via Playwright's
 * Page.mouse / Page.keyboard.
 *
 * Multiple clients (mobile + desktop) connected to the same chat receive the
 * same broadcast frames. Only the lock holder's input is dispatched; other
 * clients see a "view only" badge.
 */

import { useEffect, useRef, useState } from 'react';
import { useSocket } from '../../context/SocketContext.tsx';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog.tsx';
import type { ChatBrowserSession, BrowserViewportMode } from '../../../../shared/types/models.ts';
import type {
  BrowserFramePayload,
  BrowserStatePayload,
  BrowserInputPayload,
} from '../../../../shared/types/socket-events.ts';

interface BrowserArtifactProps {
  session: ChatBrowserSession;
}

interface FrameState {
  width: number;
  height: number;
  viewportMode: BrowserViewportMode;
  url?: string;
}

export default function BrowserArtifact({ session }: BrowserArtifactProps) {
  const { socket } = useSocket();
  const chatId = session.chatId;
  const [open, setOpen] = useState(false);
  const [paused, setPaused] = useState(false);
  const [lockedBy, setLockedBy] = useState<string | null>(null);
  const [frameState, setFrameState] = useState<FrameState>({ width: 1440, height: 900, viewportMode: 'desktop' });
  const [hasFrame, setHasFrame] = useState(false);

  // Two canvases: one for the inline thumbnail, one for the dialog full-size
  // view. We draw the same image into whichever is mounted.
  const thumbCanvasRef = useRef<HTMLCanvasElement>(null);
  const fullCanvasRef = useRef<HTMLCanvasElement>(null);

  // Subscribe to frames + state. We keep the latest decoded image in a ref so
  // the dialog can paint it immediately when it opens (without waiting for the
  // next frame).
  const lastImageRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!socket) return;

    function handleFrame(p: BrowserFramePayload) {
      if (p.chatId !== chatId) return;
      const img = new Image();
      img.onload = () => {
        lastImageRef.current = img;
        setFrameState({ width: p.width, height: p.height, viewportMode: p.viewportMode });
        setHasFrame(true);
        drawTo(thumbCanvasRef.current, img, p.width, p.height);
        drawTo(fullCanvasRef.current, img, p.width, p.height);
      };
      img.src = `data:image/jpeg;base64,${p.frame}`;
    }
    function handleState(p: BrowserStatePayload) {
      if (p.chatId !== chatId) return;
      setPaused(p.paused);
      setLockedBy(p.lockedBy);
    }
    socket.on('chat:browser-frame', handleFrame);
    socket.on('chat:browser-state', handleState);
    return () => {
      socket.off('chat:browser-frame', handleFrame);
      socket.off('chat:browser-state', handleState);
    };
  }, [socket, chatId]);

  // When the dialog opens, blast the cached image onto the full canvas so the
  // user doesn't see a blank frame for up to FRAME_INTERVAL_MS.
  useEffect(() => {
    if (open && lastImageRef.current) {
      drawTo(fullCanvasRef.current, lastImageRef.current, frameState.width, frameState.height);
    }
  }, [open, frameState.width, frameState.height]);

  const isMyLock = !!socket && !!lockedBy && socket.id === lockedBy;
  const isViewOnly = !isMyLock && !!lockedBy;

  function pause() {
    socket?.emit('chat:browser-pause', { chatId });
  }
  function resume() {
    socket?.emit('chat:browser-resume', { chatId });
  }
  function setViewport(mode: BrowserViewportMode) {
    socket?.emit('chat:browser-viewport', { chatId, mode });
  }

  // Convert canvas-event coords → frame pixel coords (account for displayed
  // size vs the native frame resolution).
  function toFramePoint(e: { clientX: number; clientY: number; currentTarget: HTMLCanvasElement }): { x: number; y: number } {
    const c = e.currentTarget;
    const rect = c.getBoundingClientRect();
    const sx = (e.clientX - rect.left) / rect.width;
    const sy = (e.clientY - rect.top) / rect.height;
    // Frame coords are device pixels; Playwright's mouse API expects CSS pixels.
    // Divide by deviceScaleFactor to land in CSS-pixel space.
    const dpr = (frameState.width / VIEWPORT_CSS_WIDTH[frameState.viewportMode]) || 1;
    return {
      x: (sx * frameState.width) / dpr,
      y: (sy * frameState.height) / dpr,
    };
  }

  function emitInput(payload: Omit<BrowserInputPayload, 'chatId'>) {
    if (!isMyLock) return;
    socket?.emit('chat:browser-input', { chatId, ...payload });
  }

  // --- Inline collapsed card ---------------------------------------------

  const isClosed = session.status === 'closed';

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-border bg-surface px-3 py-2 text-sm flex items-center gap-3 hover:bg-surface-2 w-full text-left"
      >
        <span
          className={`inline-block h-2 w-2 rounded-full ${isClosed ? 'bg-text-muted' : paused ? 'bg-yellow-500' : 'bg-green-500'}`}
          aria-hidden
        />
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate">{session.label || 'Browser session'}</div>
          <div className="text-xs text-text-muted truncate">
            {isClosed ? 'closed' : paused ? 'paused — click to take control' : 'agent driving — click to view'}
          </div>
        </div>
        {hasFrame && (
          <canvas
            ref={thumbCanvasRef}
            width={frameState.width}
            height={frameState.height}
            className="h-12 w-20 rounded border border-border object-contain"
            style={{ imageRendering: 'auto' }}
          />
        )}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <span>Browser</span>
              <ViewportSelector value={frameState.viewportMode} onChange={setViewport} />
              <div className="flex-1" />
              {!paused ? (
                <button onClick={pause} className="rounded-md border border-border px-3 py-1 text-sm hover:bg-surface-2">
                  Pause &amp; take control
                </button>
              ) : (
                <button onClick={resume} className="rounded-md border border-green-500 bg-green-500/10 px-3 py-1 text-sm hover:bg-green-500/20">
                  Resume agent
                </button>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="relative w-full flex items-center justify-center bg-surface-2">
            {/* Phone-frame chrome around mobile-emulated views so the small
                rectangle reads as "this is a phone" instead of a tiny window. */}
            <div className={frameState.viewportMode === 'mobile' ? 'rounded-[40px] border-[14px] border-black p-0 bg-black' : ''}>
              <canvas
                ref={fullCanvasRef}
                width={frameState.width}
                height={frameState.height}
                className="block max-w-full max-h-[70vh]"
                style={{ aspectRatio: `${frameState.width} / ${frameState.height}`, cursor: isMyLock ? 'crosshair' : 'default' }}
                onMouseMove={isMyLock ? (e) => emitInput({ kind: 'mouse-move', ...toFramePoint(e) }) : undefined}
                onMouseDown={isMyLock ? (e) => { const p = toFramePoint(e); emitInput({ kind: 'mouse-down', ...p, button: e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left' }); } : undefined}
                onMouseUp={isMyLock ? (e) => { const p = toFramePoint(e); emitInput({ kind: 'mouse-up', ...p, button: e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left' }); } : undefined}
                onWheel={isMyLock ? (e) => emitInput({ kind: 'mouse-wheel', deltaX: e.deltaX, deltaY: e.deltaY }) : undefined}
                onKeyDown={isMyLock ? (e) => {
                  e.preventDefault();
                  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
                    emitInput({ kind: 'type', text: e.key });
                  } else {
                    emitInput({ kind: 'key-down', key: mapKey(e.key) });
                  }
                } : undefined}
                onKeyUp={isMyLock ? (e) => {
                  e.preventDefault();
                  if (!(e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey)) {
                    emitInput({ kind: 'key-up', key: mapKey(e.key) });
                  }
                } : undefined}
                tabIndex={isMyLock ? 0 : -1}
              />
            </div>
            {isViewOnly && (
              <div className="absolute top-2 right-2 rounded bg-black/70 px-2 py-1 text-xs text-white">
                View only — another client has control
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Phone-frame width for mobile emulation needs the *CSS pixel* width, not the
// device-pixel screencast width. These match the descriptors in
// playwrightSessionManager's VIEWPORTS.
const VIEWPORT_CSS_WIDTH: Record<BrowserViewportMode, number> = {
  desktop: 1440,
  tablet: 1024,
  mobile: 393,
};

function ViewportSelector({ value, onChange }: { value: BrowserViewportMode; onChange: (m: BrowserViewportMode) => void }) {
  const modes: BrowserViewportMode[] = ['desktop', 'tablet', 'mobile'];
  return (
    <div className="flex rounded-md border border-border overflow-hidden text-xs">
      {modes.map(m => (
        <button
          key={m}
          onClick={() => onChange(m)}
          className={`px-2 py-1 ${value === m ? 'bg-surface-2 font-medium' : 'hover:bg-surface-2'}`}
        >
          {m}
        </button>
      ))}
    </div>
  );
}

/** Map browser KeyboardEvent.key to Playwright key strings (mostly identical). */
function mapKey(k: string): string {
  // Playwright accepts most natural key names directly; this stub is here so
  // we have a single place to add aliases as we encounter them.
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
