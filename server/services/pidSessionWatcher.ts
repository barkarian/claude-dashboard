import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { watch, type FSWatcher } from 'chokidar';

const CLAUDE_SESSIONS_DIR = path.join(os.homedir(), '.claude', 'sessions');

interface Tracked {
  pid: number;
  currentSessionId: string;
  onDrift: (newSessionId: string) => void;
}

/**
 * Watches `~/.claude/sessions/{pid}.json` for the lifetime of each PTY so we
 * notice when Claude rotates its sessionId mid-session — `/resume`, `/compact`,
 * or any other in-CLI flow that forks the conversation. Without this the
 * dashboard keeps watching the pre-rotation JSONL and the persisted
 * `chat.sessionId` drifts out of sync with reality.
 *
 * One chokidar watcher serves all tracked PTYs (matches the `signalWatcher`
 * pattern in `jsonlWatcher.ts`).
 */
export class PidSessionWatcher extends EventEmitter {
  private tracked = new Map<number, Tracked>();
  private watcher: FSWatcher | null = null;

  start(): void {
    if (this.watcher) return;
    if (!fs.existsSync(CLAUDE_SESSIONS_DIR)) {
      fs.mkdirSync(CLAUDE_SESSIONS_DIR, { recursive: true });
    }
    this.watcher = watch(CLAUDE_SESSIONS_DIR, {
      persistent: true,
      ignoreInitial: false,
      depth: 0,
    });
    this.watcher
      .on('add', (filepath: string) => this.handleFile(filepath))
      .on('change', (filepath: string) => this.handleFile(filepath))
      .on('error', () => {});
  }

  /**
   * Begin tracking a PTY. `onDrift` fires whenever the sessionId in
   * `~/.claude/sessions/{pid}.json` differs from the currently-tracked id.
   * The internal expected id is updated *before* the callback runs, so the
   * callback can synchronously call `track()` again with no re-entry hazard.
   */
  track(pid: number, expectedSessionId: string, onDrift: (newSessionId: string) => void): void {
    this.tracked.set(pid, { pid, currentSessionId: expectedSessionId, onDrift });

    // Eager check: the file may already exist when we start tracking
    // (claude can write it before chokidar sees the add event).
    const file = path.join(CLAUDE_SESSIONS_DIR, `${pid}.json`);
    if (fs.existsSync(file)) {
      this.handleFile(file);
    }
  }

  untrack(pid: number): void {
    this.tracked.delete(pid);
  }

  private handleFile(filepath: string): void {
    const match = path.basename(filepath).match(/^(\d+)\.json$/);
    if (!match) return;

    const pid = Number(match[1]);
    const tracked = this.tracked.get(pid);
    if (!tracked) return;

    let data: any;
    try {
      data = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
    } catch {
      return;
    }
    const newId = data?.sessionId;
    if (typeof newId !== 'string' || newId === tracked.currentSessionId) return;

    tracked.currentSessionId = newId;
    tracked.onDrift(newId);
  }

  dispose(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    this.tracked.clear();
  }
}

const pidSessionWatcher = new PidSessionWatcher();
export default pidSessionWatcher;
