/**
 * Server-side chat adapter interface.
 *
 * Every adapter (claude-code, sdk, opencode, aider, etc.) implements this
 * interface. The adapter orchestrator routes socket events to the correct
 * adapter, and wire-events.ts subscribes to the standardized events for
 * cross-cutting concerns (activeChatsTracker, push, AI titling, unread).
 */

import { EventEmitter } from 'node:events';
import type { Socket, Server as SocketIOServer } from 'socket.io';
import type { SessionStateContext } from '../../shared/types/session.ts';
import type { AdapterMetadata, PrerequisiteResult } from '../../shared/types/adapter.ts';
import type { SDKChatMessage } from '../../shared/types/sdk.ts';

// ── Params passed to adapter.start() ──────────────────────────────

export interface AdapterStartParams {
  chatId: string;
  projectId: string;
  projectPath: string;
  io: SocketIOServer;
  /** For resume — the previous session ID */
  sessionId?: string;
  /** Terminal dimensions */
  cols?: number;
  rows?: number;
  /** Per-project adapter config from projects.adapter_configs[adapterId] */
  config?: Record<string, unknown>;
  /** Shell override from project settings */
  shellOverride?: string;
  /** Filtered child environment variables */
  env?: Record<string, string>;
}

// ── Session handle returned by start() ────────────────────────────

export interface AdapterSession {
  chatId: string;
  projectId: string;
  status: 'running' | 'idle' | 'exited' | 'error';
}

// ── The adapter interface ─────────────────────────────────────────

export interface IChatAdapterServer extends EventEmitter {
  readonly metadata: AdapterMetadata;

  // ── Lifecycle ──

  /** Start a new session or resume an existing one */
  start(params: AdapterStartParams): Promise<AdapterSession>;

  /** Stop/kill a running session */
  stop(chatId: string): void;

  /** Attach a socket to receive output from an existing session */
  attach(chatId: string, socket: Socket, options?: { cols?: number; rows?: number }): void;

  /** Detach a socket from a session (stop receiving output) */
  detach(chatId: string, socket: Socket): void;

  /** Check if a session exists and its status */
  checkSession(chatId: string): { exists: boolean; status?: string };

  /** End all sessions (server shutdown) */
  endAll(): void;

  // ── Communication ──

  /** Send user input. For terminal adapters: raw PTY data. For message adapters: prompt text / structured data. */
  sendInput(chatId: string, input: string | Record<string, unknown>): void;

  /** Resize terminal (terminal adapters only; no-op for message adapters) */
  resize(chatId: string, cols: number, rows: number): void;

  /** Respond to a permission request (adapters with capabilities.permissions) */
  resolvePermission?(chatId: string, requestId: string, granted: boolean): void;

  /** Respond to a question (adapters with capabilities.questions) */
  resolveQuestion?(chatId: string, requestId: string, answers: Record<number, string[]>): void;

  /** Interrupt current operation */
  interrupt?(chatId: string): void;

  /** Handle adapter-specific custom events from the frontend */
  handleCustomEvent?(chatId: string, event: string, data: unknown): void;

  // ── State ──

  /** Get current session state for a chat */
  getSessionState(chatId: string): SessionStateContext | null;

  /** Get all session states for a project */
  getProjectSessionStates(projectId: string): Record<string, SessionStateContext>;

  /** Get message history (message-based adapters) */
  getMessageHistory?(chatId: string): SDKChatMessage[];

  // ── Prerequisites ──

  /** Check if this adapter's prerequisites are met */
  checkPrerequisites?(): Promise<PrerequisiteResult>;

  // ── Push notification customization ──

  /** Return null to suppress push, or a custom push event.
   *  If not implemented, wire-events uses default push logic. */
  formatPush?(chatId: string, state: SessionStateContext, prevState: SessionStateContext): {
    event: string;
    data: Record<string, unknown>;
  } | null;
}

/**
 * Events emitted by adapters (consumed by wire-events.ts):
 *
 * 'state-change'   (chatId, projectId, newState: SessionStateContext, prevState: SessionStateContext)
 * 'output'         (chatId, data: string)           — terminal adapters
 * 'message'        (chatId, message: SDKChatMessage) — message adapters
 * 'exit'           (chatId, projectId, exitCode: number)
 * 'error'          (chatId, errorMsg: string)
 * 'session-id'     (chatId, sessionId: string)      — when adapter discovers/assigns session ID
 * 'title-hint'     (chatId, projectId, promptText: string) — first user prompt for auto-titling
 * 'custom-event'   (chatId, event: string, data: unknown) — adapter-specific, forwarded to room
 */
