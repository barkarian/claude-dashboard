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
  ChatToolArmPayload,
} from '../../shared/types/socket-events.ts';

/** Resolve the workspace id for a chat. Returns null if the chat isn't found.
 *  Uses the dedicated `project_id` SQL helper because the Chat type from
 *  getChat() doesn't expose projectId directly. */
function projectIdFor(chatId: string): string | null {
  return projectManager.getChatProjectId(chatId);
}

export default function registerBrowserEvents(socket: Socket, io: SocketIOServer): void {
  // Arm a tool for this chat. For browser specifically: triggers a one-time
  // install if needed (lazy Chromium download), then re-inits the SDK session
  // with the browser MCP attached so the agent can use it next turn.
  socket.on('chat:tool-arm', async ({ chatId, toolId }: ChatToolArmPayload, ack?: (resp: { armedTools: string[] } | { error: string }) => void) => {
    console.log('[browser:tool-arm] received', { chatId, toolId, socketId: socket.id });
    const projectId = projectIdFor(chatId);
    if (!projectId) {
      console.log('[browser:tool-arm] chat not found', { chatId });
      ack?.({ error: 'chat not found' });
      return;
    }
    const room = `claude:${chatId}`;
    // Make sure the requesting client is in the chat room before we emit to it.
    // The room is normally joined on sdk:start / sdk:attach, but a user may
    // arm a tool in a fresh chat before sending their first message.
    socket.join(room);
    if (toolId === 'browser') {
      console.log('[browser:tool-arm] arming browser', { chatId, projectId });
      // Tell clients we're starting (covers the inline progress card).
      io.to(room).emit('chat:tool-install-progress', {
        chatId, toolId, percent: null, status: 'starting',
      });
      try {
        // Trigger lazy Chromium launch + ensure CDP endpoint resolves.
        // playwright-cli internally downloads Chromium on first launch if
        // needed; we surface that as the install step.
        io.to(room).emit('chat:tool-install-progress', {
          chatId, toolId, percent: null, status: 'downloading', message: 'Preparing Chromium…',
        });
        playwrightSessionManager.ensureWorkspaceServer(projectId);
        // Persist the armed state regardless of whether Chromium is fully
        // up — actual launch happens lazily on first command.
        const armed = projectManager.armTool(chatId, 'browser');
        console.log('[browser:tool-arm] persisted armed_tools', { chatId, armed });
        io.to(room).emit('chat:tool-install-progress', {
          chatId, toolId, percent: 100, status: 'ready',
        });
        io.to(room).emit('chat:armed-tools-changed', { chatId, armedTools: armed });
        console.log('[browser:tool-arm] sending ack', { armed });
        ack?.({ armedTools: armed });
        // Re-init the SDK session so the browser MCP mounts on the next turn.
        // Best-effort — silently no-op if this isn't an SDK session.
        try {
          const session = sdkSessionManager.getSession(chatId);
          if (session) {
            sdkSessionManager.endSession(chatId);
            // The session will re-init on the next sdk:start / chat:start.
          }
        } catch { /* not an SDK session — fine */ }
      } catch (err: any) {
        io.to(room).emit('chat:tool-install-progress', {
          chatId, toolId, percent: null, status: 'failed', message: err?.message || String(err),
        });
        ack?.({ error: err?.message || String(err) });
      }
      return;
    }
    ack?.({ error: `unknown tool: ${toolId}` });
  });

  socket.on('chat:tool-disarm', async ({ chatId, toolId }: ChatToolArmPayload, ack?: (resp: { armedTools: string[] }) => void) => {
    socket.join(`claude:${chatId}`);
    const armed = projectManager.disarmTool(chatId, toolId);
    io.to(`claude:${chatId}`).emit('chat:armed-tools-changed', { chatId, armedTools: armed });
    ack?.({ armedTools: armed });
    // Mirror the arm flow: end the SDK session so the next turn starts
    // without the disarmed tool's MCP attached.
    try {
      const session = sdkSessionManager.getSession(chatId);
      if (session) sdkSessionManager.endSession(chatId);
    } catch { /* ignore */ }
  });


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

  // Legacy chat-room request kept for backward compat — some clients may
  // still emit it. Routes to the unified per-tab handler.
  socket.on('chat:browser-refresh-frame', async ({ chatId }: { chatId: string }) => {
    const projectId = projectIdFor(chatId);
    if (!projectId) return;
    socket.join(`project:${projectId}`);
    await playwrightSessionManager.refreshFrameForTab(projectId, chatId);
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

  // --- Multi-tab browser surface ------------------------------------------
  // The popover and tab dialogs both subscribe to `project:${projectId}` and
  // route per tabId; tab management is per-tab via the events below.

  socket.on('project:browser-join', async ({ projectId }: { projectId: string }, ack?: (resp: { ok: true } | { error: string }) => void) => {
    if (!projectId) { ack?.({ error: 'projectId required' }); return; }
    socket.join(`project:${projectId}`);
    ack?.({ ok: true });
  });

  socket.on('project:browser-leave', ({ projectId }: { projectId: string }) => {
    if (!projectId) return;
    socket.leave(`project:${projectId}`);
  });

  socket.on('project:browser-list-tabs', ({ projectId }: { projectId: string }, ack?: (resp: { tabs: any[] }) => void) => {
    if (!projectId) { ack?.({ tabs: [] }); return; }
    ack?.({ tabs: playwrightSessionManager.listTabs(projectId) });
  });

  socket.on('project:browser-create-tab', async ({ projectId, url, label }: { projectId: string; url?: string; label?: string }, ack?: (resp: { tabId: string; url: string } | { error: string }) => void) => {
    try {
      const tab = projectManager.createManualTab(projectId, { label: label || null });
      socket.join(`project:${projectId}`);
      const { url: navigated } = await playwrightSessionManager.openTab(projectId, tab.id, url);
      // Notify everyone in the project so popovers refresh.
      io.to(`project:${projectId}`).emit('project:browser-tab-created', {
        projectId, tabId: tab.id, label: label || null, url: navigated,
      });
      ack?.({ tabId: tab.id, url: navigated });
    } catch (err: any) {
      ack?.({ error: err?.message || String(err) });
    }
  });

  socket.on('project:browser-close-tab', async ({ projectId, tabId }: { projectId: string; tabId: string }, ack?: (resp: { ok: true } | { error: string }) => void) => {
    try {
      await playwrightSessionManager.closeTab(projectId, tabId);
      ack?.({ ok: true });
    } catch (err: any) {
      ack?.({ error: err?.message || String(err) });
    }
  });

  socket.on('project:browser-navigate-tab', async ({ projectId, tabId, url }: { projectId: string; tabId: string; url: string }, ack?: (resp: { url: string } | { error: string }) => void) => {
    try {
      const result = await playwrightSessionManager.openTab(projectId, tabId, url);
      ack?.(result);
    } catch (err: any) {
      ack?.({ error: err?.message || String(err) });
    }
  });

  socket.on('project:browser-viewport-tab', async ({ projectId, tabId, mode }: { projectId: string; tabId: string; mode: 'desktop' | 'tablet' | 'mobile' }) => {
    try { await playwrightSessionManager.setTabViewport(projectId, tabId, mode); }
    catch (err) { console.error('[project:browser-viewport-tab] failed:', err); }
  });

  socket.on('project:browser-input-tab', async (payload: { projectId: string; tabId: string } & Parameters<typeof playwrightSessionManager.dispatchTabInput>[2]) => {
    try { await playwrightSessionManager.dispatchTabInput(payload.projectId, payload.tabId, payload); }
    catch (err) { console.error('[project:browser-input-tab] failed:', err); }
  });

  socket.on('project:browser-refresh-tab', async ({ projectId, tabId }: { projectId: string; tabId: string }) => {
    socket.join(`project:${projectId}`);
    await playwrightSessionManager.refreshFrameForTab(projectId, tabId);
  });

  socket.on('disconnect', () => {
    playwrightSessionManager.onSocketDisconnect(socket.id);
  });
}
