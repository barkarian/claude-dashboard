/**
 * ProjectBrowserPanel — direct-control browser entry point for a project.
 *
 * Lives in the project's nav as a "Browser" tab. Opens the project's
 * persistent Chromium tab dedicated to manual user control (separate from
 * the chat-armed tabs). Always in takeover mode; no agent contests input.
 *
 * Address bar at top, viewport selector, "Open in chat" button, then the
 * live canvas. Frames + URL come over the project: room. Tab stays open in
 * Chromium when the user navigates away from this view.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSocket } from '../../context/SocketContext.tsx';
import api from '../../utils/api.ts';
import type { BrowserViewportMode } from '../../../../shared/types/models.ts';

interface ProjectBrowserPanelProps {
  projectId: string;
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

export default function ProjectBrowserPanel({ projectId }: ProjectBrowserPanelProps) {
  const { socket } = useSocket();
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastImageRef = useRef<HTMLImageElement | null>(null);

  const [frameState, setFrameState] = useState<FrameState>({ width: 1440, height: 900, viewportMode: 'desktop' });
  const [hasFrame, setHasFrame] = useState(false);
  const [url, setUrl] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [opening, setOpening] = useState(true);
  const [openError, setOpenError] = useState<string | null>(null);

  // Join the project room + open the project-level browser tab.
  useEffect(() => {
    if (!socket) return;
    let cancelled = false;
    setOpening(true);
    setOpenError(null);
    socket.emit('project:browser-join', { projectId }, (resp: { url?: string; error?: string }) => {
      if (cancelled) return;
      setOpening(false);
      if (resp.error) {
        setOpenError(resp.error);
        return;
      }
      if (resp.url) {
        setUrl(resp.url);
        setUrlInput(resp.url === 'about:blank' ? '' : resp.url);
      }
    });
    return () => {
      cancelled = true;
      socket.emit('project:browser-leave', { projectId });
    };
  }, [socket, projectId]);

  // Subscribe to frames + url updates for the project room.
  useEffect(() => {
    if (!socket) return;
    function handleFrame(p: { projectId: string; frame: string; width: number; height: number; viewportMode: BrowserViewportMode }) {
      if (p.projectId !== projectId) return;
      const img = new Image();
      img.onload = () => {
        lastImageRef.current = img;
        setFrameState({ width: p.width, height: p.height, viewportMode: p.viewportMode });
        setHasFrame(true);
        drawTo(canvasRef.current, img, p.width, p.height);
      };
      img.src = `data:image/jpeg;base64,${p.frame}`;
    }
    function handleUrl(p: { projectId: string; url: string }) {
      if (p.projectId !== projectId) return;
      setUrl(p.url);
      // Don't clobber what the user is currently typing in the URL bar.
      // If the input is focused we leave it alone; otherwise sync.
      if (document.activeElement?.tagName !== 'INPUT') {
        setUrlInput(p.url === 'about:blank' ? '' : p.url);
      }
    }
    function handleReset(p: { projectId: string }) {
      if (p.projectId !== projectId) return;
      setHasFrame(false);
      setUrl('');
      setUrlInput('');
      lastImageRef.current = null;
    }
    socket.on('project:browser-frame', handleFrame);
    socket.on('project:browser-url', handleUrl);
    socket.on('project:browser-reset', handleReset);
    return () => {
      socket.off('project:browser-frame', handleFrame);
      socket.off('project:browser-url', handleUrl);
      socket.off('project:browser-reset', handleReset);
    };
  }, [socket, projectId]);

  const navigateUrl = useCallback((target: string) => {
    if (!socket) return;
    let normalized = target.trim();
    if (!normalized) return;
    if (!/^https?:\/\//i.test(normalized) && !normalized.startsWith('about:')) {
      normalized = `https://${normalized}`;
    }
    socket.emit('project:browser-navigate', { projectId, url: normalized }, (resp: { url?: string; error?: string }) => {
      if (resp.error) {
        setOpenError(resp.error);
      } else if (resp.url) {
        setUrl(resp.url);
      }
    });
  }, [socket, projectId]);

  function setViewport(mode: BrowserViewportMode) {
    socket?.emit('project:browser-viewport', { projectId, mode });
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
    socket?.emit('project:browser-input', { projectId, ...payload });
  }

  async function openInChat() {
    try {
      // Spawn a new claw-chat with the current URL as the first prompt.
      // The dashboard's chat creation uses the project's default adapter.
      const res = await api.post<{ chat: { id: string } }>(`/api/projects/${projectId}/chats`, {
        label: url ? `Browser: ${shortHost(url)}` : 'Browser session',
        adapter: 'claw-chat',
      });
      if (res.chat?.id) {
        // Navigate to the new chat. The user can prompt the agent — they
        // already have the URL in their head from the address bar.
        navigate(`/project/${projectId}/chats/${res.chat.id}`, {
          state: { isNewChat: true },
        });
      }
    } catch (err: any) {
      console.error('open in chat failed:', err);
    }
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Address bar + controls */}
      <div className="flex-shrink-0 border-b border-border px-3 py-2 flex items-center gap-2 flex-wrap">
        <form
          onSubmit={(e) => { e.preventDefault(); navigateUrl(urlInput); }}
          className="flex items-center gap-2 flex-1 min-w-[200px]"
        >
          <span className="text-text-dim" aria-hidden>⌐</span>
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="Enter URL"
            className="flex-1 bg-bg border border-border rounded px-2 py-1 text-sm focus:outline-none focus:border-primary"
          />
          <button
            type="submit"
            className="rounded border border-border px-3 py-1 text-sm hover:bg-bg-hover"
          >
            Go
          </button>
        </form>
        <ViewportSelector value={frameState.viewportMode} onChange={setViewport} />
        <button
          type="button"
          onClick={openInChat}
          className="rounded border border-border px-3 py-1 text-sm hover:bg-bg-hover"
          title="Spawn a new chat in this project pre-armed with browser"
        >
          Open in chat
        </button>
      </div>

      {/* Canvas / loading / error */}
      <div className="flex-1 flex items-center justify-center bg-bg-surface overflow-auto">
        {opening && (
          <div className="text-text-dim text-sm">Opening browser…</div>
        )}
        {!opening && openError && (
          <div className="text-danger text-sm px-4 text-center">
            Failed to open browser: {openError}
          </div>
        )}
        {!opening && !openError && (
          <div className={frameState.viewportMode === 'mobile' ? 'rounded-[40px] border-[14px] border-black p-0 bg-black' : ''}>
            <canvas
              ref={canvasRef}
              width={frameState.width}
              height={frameState.height}
              className="block max-w-full max-h-[calc(100vh-180px)]"
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
                // Printable single character → type (Playwright generates the
                // proper down/press/up sequence). Non-printable → keyboard.down.
                if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
                  emitInput({ kind: 'type', text: e.key });
                } else {
                  emitInput({ kind: 'key-down', key: mapKey(e.key) });
                }
              }}
              onKeyUp={(e) => {
                e.preventDefault();
                // Pair only with the key-down branch above. Single-char types
                // already emitted their up via Playwright's keyboard.type.
                if (!(e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey)) {
                  emitInput({ kind: 'key-up', key: mapKey(e.key) });
                }
              }}
              tabIndex={0}
            />
          </div>
        )}
      </div>
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

function shortHost(u: string): string {
  try { return new URL(u).host; } catch { return u.slice(0, 40); }
}
