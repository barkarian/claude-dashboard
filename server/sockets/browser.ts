// browser.ts — Socket.IO handlers for the BrowserArtifact UI.
// Pause/resume, input lock, takeover input, viewport switching.

import type { Server as SocketIOServer, Socket } from 'socket.io';
import projectManager from '../services/projectManager.ts';
import playwrightSessionManager from '../services/playwrightSessionManager.ts';
import sdkSessionManager from '../services/sdkSessionManager.ts';
import type {
  BrowserPauseRequestPayload,
  BrowserLockRequestPayload,
  BrowserInputPayload,
  BrowserViewportRequestPayload,
} from '../../shared/types/socket-events.ts';

/** Resolve the workspace id for a chat. Returns null if the chat isn't found. */
function projectIdFor(chatId: string): string | null {
  const chat = projectManager.getChat(chatId);
  return chat?.projectId || null;
}

export default function registerBrowserEvents(socket: Socket, _io: SocketIOServer): void {
  socket.on('chat:browser-pause', ({ chatId }: BrowserPauseRequestPayload) => {
    const projectId = projectIdFor(chatId);
    if (!projectId) return;
    // Abort any in-flight SDK turn so the agent stops issuing tools while the
    // user takes over. CC chats are paused at the shim layer (paused flag).
    try { sdkSessionManager.interrupt(chatId); } catch { /* not an SDK chat */ }
    playwrightSessionManager.setPaused(projectId, true);
    playwrightSessionManager.beginTakeover(projectId, chatId);
    // Pause grants the requesting client the input lock.
    playwrightSessionManager.acquireLock(projectId, socket.id);
  });

  socket.on('chat:browser-resume', async ({ chatId }: BrowserPauseRequestPayload) => {
    const projectId = projectIdFor(chatId);
    if (!projectId) return;
    const { descriptions } = playwrightSessionManager.endTakeover(projectId, chatId);
    playwrightSessionManager.releaseLock(projectId, socket.id);
    playwrightSessionManager.setPaused(projectId, false);

    // Inject a synthetic user message into the SDK chat summarizing the
    // takeover + a fresh snapshot, so the agent can continue from current state.
    // CC chats receive the same summary as a `cc:input` write (best-effort —
    // the user may want to send a different prompt instead).
    if (descriptions.length === 0) return;
    let snapshot = '';
    try { snapshot = await playwrightSessionManager.snapshotForChat(projectId, chatId); } catch { /* ignore */ }

    const summary = [
      '[Takeover summary] I took control of the browser and did the following:',
      ...descriptions.map(d => `- ${d}`),
      '',
      'Current page snapshot:',
      '```yaml',
      snapshot.slice(0, 8000), // keep prompt size sane
      '```',
      '',
      'Continue from here.',
    ].join('\n');

    const chat = projectManager.getChat(chatId);
    if (chat?.adapter === 'claw-chat' || chat?.adapter === 'claude-agent-sdk') {
      try { await sdkSessionManager.sendPrompt(chatId, summary); } catch (err) {
        console.error('[browser:resume] sendPrompt failed:', err);
      }
    }
    // For CC chats we don't auto-inject (PTY is the user's typing surface);
    // the user can paste the summary themselves if desired. Future improvement
    // could write it to the PTY input.
  });

  socket.on('chat:browser-lock', (payload: BrowserLockRequestPayload, ack?: (resp: { acquired: boolean; lockedBy: string | null }) => void) => {
    const projectId = projectIdFor(payload.chatId);
    if (!projectId) {
      ack?.({ acquired: false, lockedBy: null });
      return;
    }
    if (payload.acquire) {
      const result = playwrightSessionManager.acquireLock(projectId, socket.id);
      ack?.(result);
    } else {
      playwrightSessionManager.releaseLock(projectId, socket.id);
      ack?.({ acquired: false, lockedBy: null });
    }
  });

  socket.on('chat:browser-input', async (payload: BrowserInputPayload) => {
    const projectId = projectIdFor(payload.chatId);
    if (!projectId) return;
    // Only the lock holder may dispatch input. Silent drop otherwise.
    const ws = (playwrightSessionManager as any);
    if (typeof ws.acquireLock === 'function') {
      // Soft-check via the lock's current state without acquiring:
      const probe = playwrightSessionManager.acquireLock(projectId, socket.id);
      if (!probe.acquired) return;
    }
    try {
      await playwrightSessionManager.dispatchInput(projectId, payload.chatId, payload);
    } catch (err) {
      console.error('[browser:input] dispatch failed:', err);
    }
  });

  socket.on('chat:browser-viewport', async (payload: BrowserViewportRequestPayload) => {
    const projectId = projectIdFor(payload.chatId);
    if (!projectId) return;
    try {
      await playwrightSessionManager.setViewportForChat(projectId, payload.chatId, payload.mode);
    } catch (err) {
      console.error('[browser:viewport] set failed:', err);
    }
  });

  socket.on('disconnect', () => {
    playwrightSessionManager.onSocketDisconnect(socket.id);
  });
}
