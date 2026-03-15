import session from 'express-session';
import type Database from 'better-sqlite3';

interface SessionStoreOptions {
  db: Database.Database;
  clearInterval?: number; // ms between expired session cleanup (default: 1 hour)
}

export default class SqliteSessionStore extends session.Store {
  private db: Database.Database;
  private clearIntervalTimer: ReturnType<typeof setInterval> | null = null;

  private stmtGet: Database.Statement;
  private stmtSet: Database.Statement;
  private stmtDestroy: Database.Statement;
  private stmtTouch: Database.Statement;
  private stmtClearExpired: Database.Statement;

  constructor(options: SessionStoreOptions) {
    super();
    this.db = options.db;

    // Prepare statements
    this.stmtGet = this.db.prepare('SELECT sess FROM sessions WHERE sid = ? AND expired > datetime(\'now\')');
    this.stmtSet = this.db.prepare(
      'INSERT OR REPLACE INTO sessions (sid, sess, expired) VALUES (?, ?, datetime(\'now\', ? || \' seconds\'))'
    );
    this.stmtDestroy = this.db.prepare('DELETE FROM sessions WHERE sid = ?');
    this.stmtTouch = this.db.prepare(
      'UPDATE sessions SET expired = datetime(\'now\', ? || \' seconds\') WHERE sid = ?'
    );
    this.stmtClearExpired = this.db.prepare('DELETE FROM sessions WHERE expired < datetime(\'now\')');

    // Periodic cleanup
    const interval = options.clearInterval ?? 3600000;
    this.clearIntervalTimer = setInterval(() => this.clearExpired(), interval);

    // Initial cleanup
    this.clearExpired();
  }

  get(sid: string, callback: (err?: any, session?: session.SessionData | null) => void): void {
    try {
      const row = this.stmtGet.get(sid) as { sess: string } | undefined;
      if (!row) {
        return callback(null, null);
      }
      const sess = JSON.parse(row.sess);
      callback(null, sess);
    } catch (err) {
      callback(err);
    }
  }

  set(sid: string, sessionData: session.SessionData, callback?: (err?: any) => void): void {
    try {
      const maxAge = sessionData.cookie?.maxAge;
      const ttlSeconds = maxAge ? Math.ceil(maxAge / 1000) : 86400; // default 1 day
      const sess = JSON.stringify(sessionData);
      this.stmtSet.run(sid, sess, ttlSeconds.toString());
      callback?.();
    } catch (err) {
      callback?.(err);
    }
  }

  destroy(sid: string, callback?: (err?: any) => void): void {
    try {
      this.stmtDestroy.run(sid);
      callback?.();
    } catch (err) {
      callback?.(err);
    }
  }

  touch(sid: string, sessionData: session.SessionData, callback?: (err?: any) => void): void {
    try {
      const maxAge = sessionData.cookie?.maxAge;
      const ttlSeconds = maxAge ? Math.ceil(maxAge / 1000) : 86400;
      this.stmtTouch.run(ttlSeconds.toString(), sid);
      callback?.();
    } catch (err) {
      callback?.(err);
    }
  }

  clearExpired(): void {
    try {
      const result = this.stmtClearExpired.run();
      if (result.changes > 0) {
        console.log(`[session-store] Cleared ${result.changes} expired session(s)`);
      }
    } catch (err) {
      console.error('[session-store] Error clearing expired sessions:', err);
    }
  }

  close(): void {
    if (this.clearIntervalTimer) {
      clearInterval(this.clearIntervalTimer);
      this.clearIntervalTimer = null;
    }
  }
}
