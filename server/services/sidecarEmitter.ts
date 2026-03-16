/**
 * Sidecar Emitter — writes JSON-line events to stdout when CLAW_DESKTOP=1.
 * No-op otherwise, so existing server behavior is unaffected.
 *
 * The Tauri desktop shell reads these lines to track sidecar state.
 */

// ── Event types ────────────────────────────────────────────────────

export interface SidecarReadyEvent {
  type: 'ready';
  port: number;
}

export interface SidecarFirstRunEvent {
  type: 'first-run';
}

export interface SidecarStatusEvent {
  type: 'status';
  tunnel: 'connecting' | 'connected' | 'disconnected';
  subdomain?: string;
}

export interface SidecarNotificationEvent {
  type: 'notification';
  title: string;
  body: string;
  deepLink?: string;
  event:
    | 'build-complete'
    | 'build-failed'
    | 'chat-reply';
}

export type SidecarEvent =
  | SidecarReadyEvent
  | SidecarFirstRunEvent
  | SidecarStatusEvent
  | SidecarNotificationEvent;

// ── Runtime guard ──────────────────────────────────────────────────

const isDesktop = process.env.CLAW_DESKTOP === '1';

/**
 * In desktop mode redirect console.log/warn/error to stderr so stdout
 * stays clean for the JSON protocol.
 */
if (isDesktop) {
  const stderrWrite = (...args: unknown[]) => {
    process.stderr.write(args.map(String).join(' ') + '\n');
  };
  console.log = stderrWrite;
  console.warn = stderrWrite;
  console.error = stderrWrite;
  console.info = stderrWrite;
}

// ── Emitter ────────────────────────────────────────────────────────

export function emitSidecarEvent(event: SidecarEvent): void {
  if (!isDesktop) return;
  process.stdout.write(JSON.stringify(event) + '\n');
}
