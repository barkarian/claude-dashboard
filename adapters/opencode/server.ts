/**
 * OpenCode server adapter — message-based chat backed by @opencode-ai/sdk.
 *
 * v1 design choices (kept deliberately small to land the integration):
 *   • Singleton OpenCode subprocess: createOpencode() spawns one server per
 *     dashboard process, lazily on first use. All chats share it.
 *   • Per-chat OpenCode session id stored on chat.sessionId (resume-friendly).
 *   • Non-streaming prompt for now: client.session.prompt() returns the full
 *     assistant message; we emit it as one sdk:message event. Streaming via
 *     client.event.subscribe() is a follow-up — the wire protocol is already
 *     stream-compatible (sdk:partial), just not exercised here.
 *   • No tool-permissions or question UX yet (manifest opts out).
 */

import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Socket, Server as SocketIOServer } from 'socket.io';
import type { IChatAdapterServer, AdapterStartParams, AdapterSession } from '../../server/adapters/types.ts';
import type { SessionStateContext } from '../../shared/types/session.ts';
import type { SDKChatMessage } from '../../shared/types/sdk.ts';
import type { ModelInfo, PrerequisiteResult } from '../../shared/types/adapter.ts';
import manifest from './manifest.ts';
import projectManager from '../../server/services/projectManager.ts';

// The OpenCode SDK is loaded lazily — adapter discovery (server boot) does
// not require it, and a missing/broken SDK shouldn't prevent the adapter
// from registering and surfacing prereq errors to the user.
type OpencodeClient = any;

const execFileAsync = promisify(execFile);

interface AssistantBuffer {
  /** Our SDKChatMessage.id used for this opencode messageID. */
  sdkMessageId: string;
  /** Per-part text contents, keyed by opencode part.id, kept in arrival order
   *  so concatenation is stable even when multiple text parts interleave. */
  partOrder: string[];
  partText: Map<string, string>;
}

interface OpencodeSession {
  chatId: string;
  projectId: string;
  /** OpenCode-side session id (returned from client.session.create) */
  opencodeSessionId: string;
  io: SocketIOServer;
  status: 'idle' | 'starting' | 'streaming' | 'exited' | 'error' | 'waiting-permission';
  messages: SDKChatMessage[];
  abortController: AbortController | null;
  /** opencode messageID → in-flight assistant bubble. One bubble per
   *  assistant message, no matter how many text parts are inside. */
  assistantBuffers: Map<string, AssistantBuffer>;
  /** opencode messageID → role. Populated from message.updated events.
   *  Used to ignore parts of opencode's mirrored user message (which would
   *  otherwise render as a duplicate assistant bubble echoing the prompt). */
  messageRoles: Map<string, 'user' | 'assistant'>;
  /** Parts that arrived before their parent message.updated. We hold them
   *  until the role is known, then replay or drop. */
  pendingParts: Map<string, any[]>;
  /** opencode permissionID → our requestId (1:1 in v1). */
  pendingPermissions: Map<string, string>;
  /** Last activity label we emitted, so we don't re-emit duplicates. */
  lastActivity: string | null;
}

export default class OpencodeAdapter extends EventEmitter implements IChatAdapterServer {
  readonly metadata = manifest;

  /** TEMP: distinct event types seen this process — used by handleStreamEvent
   *  to log a sample of each shape exactly once. Remove once the streaming
   *  flow is verified to work in the wild. */
  static seenEventTypes = new Set<string>();

  private clientPromise: Promise<OpencodeClient> | null = null;
  private serverHandle: { close(): void } | null = null;
  private sessions = new Map<string, OpencodeSession>();

  /** Lazily start the OpenCode subprocess on first use, then reuse it.
   *  Also kicks off the global SSE event loop so streaming works. */
  private async getClient(): Promise<OpencodeClient> {
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        const sdk = await import('@opencode-ai/sdk');
        const { client, server } = await sdk.createOpencode();
        this.serverHandle = server;
        // Fire-and-forget event loop. Errors are logged; the loop attempts
        // to keep iterating because the SSE client has built-in reconnect.
        this.startEventLoop(client).catch(err =>
          console.error('[opencode] event loop crashed:', err),
        );
        return client;
      })();
    }
    return this.clientPromise;
  }

  /** Subscribe to OpenCode's global event stream and demux events to the
   *  matching chat session. Runs for the lifetime of the adapter. */
  private async startEventLoop(client: OpencodeClient): Promise<void> {
    let result: any;
    try {
      result = await client.event.subscribe();
    } catch (err) {
      console.error('[opencode] event.subscribe failed:', err);
      return;
    }
    if (!result?.stream) {
      console.error('[opencode] event subscription returned no stream');
      return;
    }
    for await (const event of result.stream as AsyncIterable<any>) {
      try {
        this.handleStreamEvent(event);
      } catch (err) {
        console.error('[opencode] event handler error:', err);
      }
    }
  }

  /** Find the chat owning a given OpenCode session id. */
  private findChatByOpencodeSessionId(sessionID: string): { chatId: string; session: OpencodeSession } | null {
    for (const [chatId, session] of this.sessions) {
      if (session.opencodeSessionId === sessionID) return { chatId, session };
    }
    return null;
  }

  /** Push a transient activity hint ("Reading foo.ts", "Thinking…") to the
   *  client. Pass null to clear. Dedupes to avoid re-rendering. */
  private setActivity(session: OpencodeSession, label: string | null): void {
    if (session.lastActivity === label) return;
    session.lastActivity = label;
    session.io.to(`claude:${session.chatId}`).emit('sdk:activity', {
      chatId: session.chatId,
      label,
    });
  }

  private handleStreamEvent(event: any): void {
    if (!event || typeof event.type !== 'string') return;

    const eventType: string = event.type;
    const props = event.properties ?? {};

    // TEMP DIAGNOSTIC: log every distinct event type once per process so we
    // can confirm the actual event shapes coming back from opencode. Remove
    // once the streaming flow is stable.
    if (!OpencodeAdapter.seenEventTypes.has(eventType)) {
      OpencodeAdapter.seenEventTypes.add(eventType);
      try {
        const summary = JSON.stringify(event, null, 2).slice(0, 1500);
        console.log(`[opencode][event:first ${eventType}]\n${summary}`);
      } catch {
        console.log(`[opencode][event:first ${eventType}] (unserializable)`);
      }
    }

    // Resolve the chat this event belongs to. The sessionID can live at
    // various depths depending on the event type:
    //   message.updated         → properties.info.sessionID
    //   message.part.updated    → properties.part.sessionID
    //   message.removed         → properties.sessionID
    //   session.* / permission  → properties.sessionID
    const sessionID: string | undefined =
      props.sessionID ||
      props.part?.sessionID ||
      props.info?.sessionID;
    if (!sessionID) return;
    const match = this.findChatByOpencodeSessionId(sessionID);
    if (!match) return;
    const { session } = match;

    if (eventType === 'message.updated') {
      const info = props.info;
      const messageID: string | undefined = info?.id;
      const role: string | undefined = info?.role;
      if (messageID && (role === 'user' || role === 'assistant')) {
        session.messageRoles.set(messageID, role);
        // Replay any parts that arrived before we knew the role.
        const queued = session.pendingParts.get(messageID);
        if (queued) {
          session.pendingParts.delete(messageID);
          for (const p of queued) this.handlePartUpdate(session, p);
        }
      }
      return;
    }

    if (eventType === 'message.removed') {
      const removedID: string | undefined = props.messageID;
      if (removedID) {
        session.messageRoles.delete(removedID);
        session.assistantBuffers.delete(removedID);
        session.pendingParts.delete(removedID);
      }
      return;
    }

    if (eventType === 'message.part.updated') {
      this.handlePartUpdate(session, props.part);
      return;
    }

    if (eventType === 'session.status') {
      this.handleSessionStatus(session, props.status);
      return;
    }

    if (eventType === 'session.idle') {
      this.handleSessionIdle(session);
      return;
    }

    if (eventType === 'session.error') {
      const errMsg = this.formatSessionError(props.error);
      this.setActivity(session, null);
      session.status = 'error';
      session.io.to(`claude:${session.chatId}`).emit('sdk:status', { chatId: session.chatId, status: 'error' });
      session.io.to(`claude:${session.chatId}`).emit('sdk:error', { chatId: session.chatId, error: errMsg });
      return;
    }

    if (eventType === 'permission.updated') {
      this.handlePermission(session, props);
      return;
    }
  }

  private handlePartUpdate(session: OpencodeSession, part: any): void {
    if (!part) return;

    const messageID: string | undefined = part.messageID;
    if (!messageID) return;

    // Opencode mirrors the user prompt as its own UserMessage and emits
    // text parts for it. We've already pushed the user bubble locally —
    // ignore opencode's user-side parts so they don't render as a fake
    // assistant echo. Tool/reasoning parts only appear under assistant
    // messages, but check role uniformly to be safe.
    const role = session.messageRoles.get(messageID);
    if (role === 'user') return;
    if (role === undefined) {
      // Race: part arrived before message.updated. Hold it until we know
      // the role, then replay. Cap is generous because assistant streaming
      // can produce many incremental updates for one bubble.
      const queue = session.pendingParts.get(messageID) || [];
      if (queue.length < 64) {
        queue.push(part);
        session.pendingParts.set(messageID, queue);
      } else {
        // Queue is overflowing — assume this is an assistant message and
        // process the part directly. User messages rarely have many parts.
        console.warn(`[opencode] role unknown for ${messageID} after 64 parts — assuming assistant`);
        session.messageRoles.set(messageID, 'assistant');
        session.pendingParts.delete(messageID);
        for (const p of queue) this.handlePartUpdate(session, p);
        this.handlePartUpdate(session, part);
      }
      return;
    }

    // From here on, role === 'assistant'.

    // Tool parts drive the live activity hint — "Reading foo.ts", etc.
    if (part.type === 'tool') {
      const status: string | undefined = part.state?.status;
      if (status === 'running' || status === 'pending') {
        const label = formatToolActivity(part);
        if (label) this.setActivity(session, label);
      } else if (status === 'completed' || status === 'error') {
        // Don't clear here — session.idle is the authoritative "done" signal.
        // We keep the last activity visible until the session goes idle, so
        // a quick tool-complete-then-next-tool-start doesn't flash empty.
      }
      return;
    }

    if (part.type !== 'text') return;
    if (part.synthetic || part.ignored) return; // opencode placeholders

    const partID: string | undefined = part.id;
    const text: string = typeof part.text === 'string' ? part.text : '';
    if (!partID) return;

    // Don't materialize a bubble for an empty delta — that's how we end up
    // with a "just three dots" ghost bubble above the real response.
    if (!text && !session.assistantBuffers.has(messageID)) return;

    const room = `claude:${session.chatId}`;
    let buf = session.assistantBuffers.get(messageID);

    if (!buf) {
      // First non-empty text for this assistant message — create the bubble.
      const sdkMessageId = `assistant-${messageID}`;
      buf = { sdkMessageId, partOrder: [], partText: new Map() };
      session.assistantBuffers.set(messageID, buf);

      buf.partOrder.push(partID);
      buf.partText.set(partID, text);

      // The bubble itself now communicates progress — clear the "Thinking…"
      // hint so we don't double-render activity + streaming text.
      this.setActivity(session, null);

      const message: SDKChatMessage = {
        id: sdkMessageId,
        role: 'assistant',
        content: [{ type: 'text', text }],
        isPartial: true,
        timestamp: new Date().toISOString(),
      };
      session.messages.push(message);
      session.io.to(room).emit('sdk:message', { chatId: session.chatId, message });
      return;
    }

    // Subsequent update — store this part's latest text, then re-emit the
    // concatenation of all parts in arrival order so the bubble shows the
    // full message-so-far instead of just the latest part.
    if (!buf.partText.has(partID)) buf.partOrder.push(partID);
    buf.partText.set(partID, text);

    const merged = buf.partOrder.map(id => buf!.partText.get(id) ?? '').join('');
    const idx = session.messages.findIndex(m => m.id === buf!.sdkMessageId);
    if (idx >= 0) {
      session.messages[idx] = {
        ...session.messages[idx],
        content: [{ type: 'text', text: merged }],
        isPartial: true,
      };
    }
    session.io.to(room).emit('sdk:partial-update', {
      chatId: session.chatId,
      messageId: buf.sdkMessageId,
      content: [{ type: 'text', text: merged }],
    });
  }

  private handleSessionStatus(session: OpencodeSession, status: any): void {
    if (!status || typeof status.type !== 'string') return;
    if (status.type === 'busy') {
      // Only set "Thinking…" if no tool activity is already showing — tool
      // labels are more specific.
      if (!session.lastActivity) this.setActivity(session, 'Thinking…');
    } else if (status.type === 'retry') {
      const attempt = typeof status.attempt === 'number' ? status.attempt : '?';
      const msg = typeof status.message === 'string' && status.message ? `: ${status.message}` : '';
      this.setActivity(session, `Retrying (attempt ${attempt})${msg}`);
    } else if (status.type === 'idle') {
      // session.status idle is informational; the dedicated session.idle
      // event handles the transition.
    }
  }

  private handleSessionIdle(session: OpencodeSession): void {
    const room = `claude:${session.chatId}`;

    // Flush any parts that were queued waiting for message.updated to land.
    // If we never learned the role by now, assume assistant — user messages
    // are mirrored locally so a misclassified user is the safer failure
    // (renders a redundant bubble) than dropping an assistant streaming part.
    for (const [messageID, queue] of session.pendingParts) {
      if (!session.messageRoles.has(messageID)) {
        session.messageRoles.set(messageID, 'assistant');
      }
      for (const p of queue) this.handlePartUpdate(session, p);
    }
    session.pendingParts.clear();

    // Finalize any in-flight bubbles: drop the partial flag so the UI stops
    // treating them as streaming.
    for (const buf of session.assistantBuffers.values()) {
      const idx = session.messages.findIndex(m => m.id === buf.sdkMessageId);
      if (idx >= 0 && session.messages[idx].isPartial) {
        session.messages[idx] = { ...session.messages[idx], isPartial: false };
        session.io.to(room).emit('sdk:message', { chatId: session.chatId, message: session.messages[idx] });
      }
    }
    session.assistantBuffers.clear();

    this.setActivity(session, null);

    // Idempotent: if we're already idle (e.g. session.idle already fired and
    // sendInput is now also calling us as a safety net), skip the transition.
    if (session.status === 'idle' || session.status === 'error' || session.status === 'exited') {
      return;
    }
    session.status = 'idle';
    session.io.to(room).emit('sdk:status', { chatId: session.chatId, status: 'idle' });
    this.emit('state-change', session.chatId, session.projectId,
      { status: 'idle' } as SessionStateContext,
      { status: 'working' } as SessionStateContext,
    );
  }

  private handlePermission(session: OpencodeSession, props: any): void {
    // permission.updated payload IS the Permission object.
    const permission = props ?? {};
    const permissionID: string | undefined = permission.id;
    if (!permissionID) return;

    // 1:1 mapping in v1 — use opencode's permissionID as our requestId.
    session.pendingPermissions.set(permissionID, permissionID);

    const toolName: string =
      typeof permission.metadata?.tool === 'string' ? permission.metadata.tool :
      typeof permission.type === 'string' ? permission.type :
      'tool';
    const toolInput: Record<string, unknown> =
      (permission.metadata && typeof permission.metadata === 'object') ? permission.metadata : {};
    const description: string = permission.title || `${toolName} requires permission`;

    const room = `claude:${session.chatId}`;
    session.status = 'waiting-permission';
    session.io.to(room).emit('sdk:status', { chatId: session.chatId, status: 'waiting-permission' });
    session.io.to(room).emit('sdk:permission-request', {
      chatId: session.chatId,
      requestId: permissionID,
      toolName,
      toolInput,
      description,
    });
    this.setActivity(session, `Waiting for permission: ${toolName}`);
  }

  private formatSessionError(err: any): string {
    if (!err) return 'OpenCode session error';
    if (typeof err === 'string') return err;
    if (typeof err.message === 'string') return err.message;
    if (typeof err.data?.message === 'string') return err.data.message;
    return 'OpenCode session error';
  }

  async start(params: AdapterStartParams): Promise<AdapterSession> {
    const { chatId, projectId, projectPath, io, sessionId } = params;
    const chat = projectManager.getChat(chatId);
    const room = `claude:${chatId}`; // share the same room namespace as claw-chat

    let client: OpencodeClient;
    try {
      client = await this.getClient();
    } catch (err: any) {
      console.error(`[opencode:${chatId}] failed to start opencode server:`, err);
      this.emit('error', chatId, err.message || 'Failed to start OpenCode');
      return { chatId, projectId, status: 'error' };
    }

    // Resume an existing session if we have one persisted, otherwise create.
    const existing = sessionId || chat?.sessionId || chat?.sdkSessionId || null;
    let opencodeSessionId = existing;
    if (!opencodeSessionId) {
      try {
        const created = await client.session.create({
          body: { title: chat?.label || 'New Chat' },
          query: { directory: projectPath },
        });
        opencodeSessionId = (created as any)?.data?.id ?? null;
      } catch (err: any) {
        console.error(`[opencode:${chatId}] session.create failed:`, err);
        this.emit('error', chatId, err.message || 'Failed to create OpenCode session');
        return { chatId, projectId, status: 'error' };
      }
    }
    if (!opencodeSessionId) {
      this.emit('error', chatId, 'OpenCode returned no session id');
      return { chatId, projectId, status: 'error' };
    }

    const session: OpencodeSession = {
      chatId,
      projectId,
      opencodeSessionId,
      io,
      status: 'idle',
      messages: [],
      abortController: null,
      assistantBuffers: new Map(),
      messageRoles: new Map(),
      pendingParts: new Map(),
      pendingPermissions: new Map(),
      lastActivity: null,
    };
    this.sessions.set(chatId, session);
    if (!chat?.sessionId) {
      this.emit('session-id', chatId, opencodeSessionId);
    }
    io.to(room).emit('sdk:status', { chatId, status: 'idle' });
    return { chatId, projectId, status: 'idle' };
  }

  stop(chatId: string): void {
    const s = this.sessions.get(chatId);
    if (!s) return;
    s.abortController?.abort();
    this.sessions.delete(chatId);
  }

  attach(chatId: string, socket: Socket): void {
    const room = `claude:${chatId}`;
    socket.join(room);
    const session = this.sessions.get(chatId);
    if (session) {
      socket.emit('sdk:status', { chatId, status: session.status });
      if (session.messages.length > 0) {
        socket.emit('sdk:history', { chatId, messages: session.messages });
      }
    }
  }

  detach(chatId: string, socket: Socket): void {
    socket.leave(`claude:${chatId}`);
  }

  checkSession(chatId: string): { exists: boolean; status?: string } {
    const s = this.sessions.get(chatId);
    return s ? { exists: true, status: s.status } : { exists: false };
  }

  endAll(): void {
    for (const id of this.sessions.keys()) this.stop(id);
    this.serverHandle?.close();
    this.serverHandle = null;
    this.clientPromise = null;
  }

  async sendInput(chatId: string, input: string | Record<string, unknown>): Promise<void> {
    const session = this.sessions.get(chatId);
    if (!session) return;
    const prompt = typeof input === 'string' ? input : (input as any).prompt || '';
    if (!prompt) return;

    const room = `claude:${chatId}`;
    const chat = projectManager.getChat(chatId);

    // Emit title-hint on first user prompt
    if (chat && chat.label === 'New Chat') {
      const userMsgCount = session.messages.filter(m => m.role === 'user').length;
      if (userMsgCount === 0) {
        this.emit('title-hint', chatId, session.projectId, prompt);
      }
    }

    // Append user message and broadcast
    const userMessage: SDKChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: [{ type: 'text', text: prompt }],
      timestamp: new Date().toISOString(),
    };
    session.messages.push(userMessage);
    session.io.to(room).emit('sdk:message', { chatId, message: userMessage });
    session.status = 'streaming';
    session.io.to(room).emit('sdk:status', { chatId, status: 'streaming' });
    // Show "Thinking…" right away. Tool activity from message.part.updated
    // events will overwrite this once the agent starts doing real work; if
    // it just replies with text, this remains visible until the first text
    // delta arrives, then the bubble itself takes over.
    session.lastActivity = null;
    this.setActivity(session, 'Thinking…');

    // Parse adapter-opaque model id ("provider/model") into OpenCode's shape.
    const modelStr = chat?.model || null;
    let modelObj: { providerID: string; modelID: string } | undefined;
    if (modelStr) {
      const slash = modelStr.indexOf('/');
      if (slash > 0) {
        modelObj = { providerID: modelStr.slice(0, slash), modelID: modelStr.slice(slash + 1) };
      }
    }

    const assistantCountBefore = session.messages.filter(m => m.role === 'assistant').length;
    session.abortController = new AbortController();

    try {
      const client = await this.getClient();
      // Drive the request. Streaming output flows in via the global event
      // loop (handleStreamEvent) — bubbles, activity, and the idle/error
      // transitions are all event-driven now. We only fall back here if
      // the prompt returned without any streaming events at all.
      const result = await client.session.prompt({
        path: { id: session.opencodeSessionId },
        body: {
          model: modelObj,
          parts: [{ type: 'text', text: prompt }],
        },
      });

      // Safety net: if no assistant message landed during this turn (event
      // stream silent / missed), recover text from the prompt response and
      // emit it as one bubble. Counts compare to the pre-turn snapshot so we
      // don't double-emit when streaming worked.
      const assistantCountAfter = session.messages.filter(m => m.role === 'assistant').length;
      if (assistantCountAfter === assistantCountBefore) {
        const assistantText = extractAssistantText((result as any)?.data);
        if (assistantText) {
          const fallback: SDKChatMessage = {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: [{ type: 'text', text: assistantText }],
            timestamp: new Date().toISOString(),
          };
          session.messages.push(fallback);
          session.io.to(room).emit('sdk:message', { chatId, message: fallback });
        }
      }
      // session.idle may already have fired; handleSessionIdle is idempotent
      // when the buffers are empty and status is already idle. Calling it
      // unconditionally guarantees we leave 'streaming' even if the event
      // stream missed the idle signal.
      if (session.status === 'streaming') this.handleSessionIdle(session);
    } catch (err: any) {
      console.error(`[opencode:${chatId}] prompt failed:`, err);
      session.status = 'error';
      session.assistantBuffers.clear();
      this.setActivity(session, null);
      session.io.to(room).emit('sdk:status', { chatId, status: 'error' });
      this.emit('error', chatId, err.message || 'OpenCode prompt failed');
    } finally {
      session.abortController = null;
    }
  }

  resize(_chatId: string, _cols: number, _rows: number): void {
    // No-op
  }

  interrupt(chatId: string): void {
    this.sessions.get(chatId)?.abortController?.abort();
  }

  /** Respond to an opencode permission request. The wire protocol from the
   *  dashboard is binary (granted yes/no); we map yes → "once" and no →
   *  "reject". The richer "always" response could be wired through later. */
  async resolvePermission(chatId: string, requestId: string, granted: boolean): Promise<void> {
    const session = this.sessions.get(chatId);
    if (!session) return;
    if (!session.pendingPermissions.has(requestId)) return;
    session.pendingPermissions.delete(requestId);

    try {
      const client = await this.getClient();
      await client.postSessionIdPermissionsPermissionId({
        path: { id: session.opencodeSessionId, permissionID: requestId },
        body: { response: granted ? 'once' : 'reject' },
      });
    } catch (err: any) {
      console.error(`[opencode:${chatId}] permission respond failed:`, err);
      this.emit('error', chatId, err.message || 'Permission response failed');
    }

    // Clear the waiting-permission status; subsequent activity will reset it.
    if (session.status === 'waiting-permission') {
      session.status = 'streaming';
      session.io.to(`claude:${chatId}`).emit('sdk:status', { chatId, status: 'streaming' });
    }
    this.setActivity(session, null);
  }

  getSessionState(chatId: string): SessionStateContext | null {
    const s = this.sessions.get(chatId);
    if (!s) return null;
    const status = s.status === 'streaming' ? 'working' : 'idle';
    return { status } as SessionStateContext;
  }

  getProjectSessionStates(projectId: string): Record<string, SessionStateContext> {
    const out: Record<string, SessionStateContext> = {};
    for (const [chatId, s] of this.sessions) {
      if (s.projectId !== projectId) continue;
      const status = s.status === 'streaming' ? 'working' : 'idle';
      out[chatId] = { status } as SessionStateContext;
    }
    return out;
  }

  getMessageHistory(chatId: string): SDKChatMessage[] {
    return this.sessions.get(chatId)?.messages ?? [];
  }

  async checkPrerequisites(): Promise<PrerequisiteResult> {
    // 1. opencode binary on PATH
    try {
      const cmd = process.platform === 'win32' ? 'where' : 'which';
      await execFileAsync(cmd, ['opencode'], { timeout: 5000 });
    } catch {
      return {
        satisfied: false,
        message: 'OpenCode CLI not installed.',
        installHint: 'npm install -g opencode-ai',
      };
    }
    // 2. auth.json with at least one provider
    try {
      const authPath = path.join(os.homedir(), '.local/share/opencode/auth.json');
      const raw = await fs.readFile(authPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
        return { satisfied: true };
      }
      return {
        satisfied: false,
        message: 'OpenCode is installed but no provider is authenticated.',
        installHint: 'Run `opencode auth login` in a terminal.',
      };
    } catch {
      return {
        satisfied: false,
        message: 'OpenCode is installed but no provider is authenticated.',
        installHint: 'Run `opencode auth login` in a terminal.',
      };
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    let client: OpencodeClient;
    try {
      client = await this.getClient();
    } catch {
      return [];
    }
    try {
      const res = await client.config.providers();
      const data = (res as any)?.data;
      const providers: any[] = data?.providers ?? [];
      const out: ModelInfo[] = [];
      for (const p of providers) {
        const provName = p.name || p.id;
        for (const [modelKey, m] of Object.entries(p.models ?? {})) {
          const model = m as any;
          out.push({
            id: `${p.id}/${modelKey}`,
            label: model?.name || modelKey,
            family: provName,
          });
        }
      }
      return out;
    } catch (err) {
      console.error('[opencode] listModels failed:', err);
      return [];
    }
  }
}

/** Build a one-line "what is this tool doing right now" hint from a ToolPart.
 *  Falls back through state.title → key fields in state.input → tool name. */
function formatToolActivity(part: any): string | null {
  const toolName: string = part.tool || 'tool';
  const state = part.state || {};
  if (typeof state.title === 'string' && state.title.trim()) {
    return state.title.trim();
  }
  const input = state.input || {};
  // Common shapes across tools: file path, command, query, URL.
  const target =
    input.file_path || input.path || input.filename ||
    input.command || input.cmd ||
    input.query || input.url || null;
  if (typeof target === 'string' && target.trim()) {
    const t = target.length > 80 ? target.slice(0, 77) + '…' : target;
    return `${toolName}: ${t}`;
  }
  return `Running ${toolName}`;
}

/** Pull plain text from an OpenCode prompt response. The shape is a Message
 *  with a `parts` array; we concatenate every TextPart. Other part types
 *  (tool, file, reasoning) are ignored in v1. */
function extractAssistantText(data: any): string {
  if (!data) return '';
  // Possible shapes: { info, parts } or just an array of parts
  const parts: any[] =
    Array.isArray(data?.parts) ? data.parts :
    Array.isArray(data) ? data :
    Array.isArray(data?.message?.parts) ? data.message.parts :
    [];
  let text = '';
  for (const p of parts) {
    if (p?.type === 'text' && typeof p.text === 'string') text += p.text;
  }
  // Fallback: if data is just a string, return it directly.
  if (!text && typeof data === 'string') return data;
  return text;
}

