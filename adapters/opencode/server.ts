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

interface OpencodeSession {
  chatId: string;
  projectId: string;
  /** OpenCode-side session id (returned from client.session.create) */
  opencodeSessionId: string;
  io: SocketIOServer;
  status: 'idle' | 'starting' | 'streaming' | 'exited' | 'error';
  messages: SDKChatMessage[];
  abortController: AbortController | null;
  /** OpenCode part.id → our SDKChatMessage.id, so streaming deltas land
   *  on the right message even when multiple parts arrive interleaved. */
  partToMessageId: Map<string, string>;
}

export default class OpencodeAdapter extends EventEmitter implements IChatAdapterServer {
  readonly metadata = manifest;

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

  private handleStreamEvent(event: any): void {
    if (!event || typeof event.type !== 'string') return;

    // Only the part-updated stream carries text deltas we want to surface.
    if (event.type !== 'message.part.updated') return;

    const part = event.properties?.part;
    if (!part || part.type !== 'text') return; // ignore reasoning/tool/file parts in v1

    const sessionID: string | undefined = part.sessionID;
    if (!sessionID) return;

    const match = this.findChatByOpencodeSessionId(sessionID);
    if (!match) return;
    const { chatId, session } = match;
    const room = `claude:${chatId}`;

    // Get-or-create the SDKChatMessage that mirrors this OpenCode part.
    let messageId = session.partToMessageId.get(part.id);
    const text: string = typeof part.text === 'string' ? part.text : '';

    if (!messageId) {
      // First delta for this part — push a new partial assistant message.
      messageId = `assistant-${part.id}`;
      session.partToMessageId.set(part.id, messageId);
      const message: SDKChatMessage = {
        id: messageId,
        role: 'assistant',
        content: [{ type: 'text', text }],
        isPartial: true,
        timestamp: new Date().toISOString(),
      };
      session.messages.push(message);
      session.io.to(room).emit('sdk:message', { chatId, message });
    } else {
      // Subsequent delta — patch the existing partial in place.
      const idx = session.messages.findIndex(m => m.id === messageId);
      if (idx >= 0) {
        session.messages[idx] = { ...session.messages[idx], content: [{ type: 'text', text }], isPartial: true };
      }
      session.io.to(room).emit('sdk:partial-update', {
        chatId,
        messageId,
        content: [{ type: 'text', text }],
      });
    }
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
      partToMessageId: new Map(),
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

    // Parse adapter-opaque model id ("provider/model") into OpenCode's shape.
    const modelStr = chat?.model || null;
    let modelObj: { providerID: string; modelID: string } | undefined;
    if (modelStr) {
      const slash = modelStr.indexOf('/');
      if (slash > 0) {
        modelObj = { providerID: modelStr.slice(0, slash), modelID: modelStr.slice(slash + 1) };
      }
    }

    session.abortController = new AbortController();

    try {
      const client = await this.getClient();
      // Drive the request. Streaming output flows in via the global event
      // loop (handleStreamEvent) — we don't synthesize an assistant message
      // here. If the response carries late text the events missed (rare),
      // we fall back below to ensure the user always sees something.
      const result = await client.session.prompt({
        path: { id: session.opencodeSessionId },
        body: {
          model: modelObj,
          parts: [{ type: 'text', text: prompt }],
        },
      });

      // Mark every streamed assistant message as final so the UI clears its
      // partial state. Then forget the part→message map for this turn so
      // the next turn starts a fresh assistant message.
      for (const partId of session.partToMessageId.keys()) {
        const messageId = session.partToMessageId.get(partId)!;
        const idx = session.messages.findIndex(m => m.id === messageId);
        if (idx >= 0) {
          session.messages[idx] = { ...session.messages[idx], isPartial: false };
          session.io.to(room).emit('sdk:message', { chatId, message: session.messages[idx] });
        }
      }

      // Safety net: if no assistant message arrived through events, recover
      // text from the prompt response and emit it as one message.
      const streamedAny = session.partToMessageId.size > 0;
      session.partToMessageId.clear();
      if (!streamedAny) {
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

      session.status = 'idle';
      session.io.to(room).emit('sdk:status', { chatId, status: 'idle' });
      this.emit('state-change', chatId, session.projectId,
        { status: 'idle' } as SessionStateContext,
        { status: 'working' } as SessionStateContext,
      );
    } catch (err: any) {
      console.error(`[opencode:${chatId}] prompt failed:`, err);
      session.status = 'error';
      session.partToMessageId.clear();
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

