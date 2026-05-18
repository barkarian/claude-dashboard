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

/** Resolve the workspace id for a chat. Returns null if the chat isn't found.
 *  Uses the dedicated `project_id` SQL helper because the Chat type from
 *  getChat() doesn't expose projectId directly. */
function projectIdFor(chatId: string): string | null {
  return projectManager.getChatProjectId(chatId);
}

export default function registerBrowserEvents(socket: Socket, io: SocketIOServer): void {
  // Arm a tool for this chat. For browser specifically: triggers a one-time
  // (The chat:tool-arm / chat:tool-disarm handlers lived here. Browser is
  // now a project-level toggle in Project Settings — no per-chat arming.)

  socket.on('chat:browser-pause', ({ chatId }: BrowserPauseRequestPayload) => {
    const projectId = projectIdFor(chatId);
    if (!projectId) return;
    socket.join(`project:${projectId}`);
    // Per-chat pause: the agent for THIS chat sees "paused" on its next
    // browser command (and stops); other chats in the same project keep
    // working normally. We don't interrupt the SDK turn — the agent reads
    // the paused message and stops on its own. Less destructive.
    playwrightSessionManager.setChatPaused(projectId, chatId, true);
    playwrightSessionManager.beginTakeover(projectId, chatId);
    playwrightSessionManager.acquireChatLock(projectId, chatId, socket.id);
  });

  socket.on('chat:browser-resume', async ({ chatId }: BrowserPauseRequestPayload) => {
    const projectId = projectIdFor(chatId);
    if (!projectId) return;
    const { descriptions } = playwrightSessionManager.endTakeover(projectId, chatId);
    playwrightSessionManager.releaseChatLock(projectId, chatId, socket.id);
    playwrightSessionManager.setChatPaused(projectId, chatId, false);

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
    socket.join(`project:${projectId}`);
    if (payload.acquire) {
      const result = playwrightSessionManager.acquireChatLock(projectId, payload.chatId, socket.id);
      ack?.(result);
    } else {
      playwrightSessionManager.releaseChatLock(projectId, payload.chatId, socket.id);
      ack?.({ acquired: false, lockedBy: null });
    }
  });

  socket.on('chat:browser-input', async (payload: BrowserInputPayload) => {
    const projectId = projectIdFor(payload.chatId);
    if (!projectId) return;
    // Only the lock holder for this chat's tab may dispatch input.
    // acquireChatLock returns acquired:true if either no one holds it or
    // we already hold it — either way safe. acquired:false means someone
    // else is in control; silently drop.
    const probe = playwrightSessionManager.acquireChatLock(projectId, payload.chatId, socket.id);
    if (!probe.acquired) return;
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
