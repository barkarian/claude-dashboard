#!/usr/bin/env node
// Hook: SessionEnd — fires when a session is closed
// Writes ended signal to ~/.claude/session-signals/<session_id>.ended.json

import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const SIGNALS_DIR = join(homedir(), '.claude', 'session-signals');
mkdirSync(SIGNALS_DIR, { recursive: true });

try {
  const input = JSON.parse(readFileSync('/dev/stdin', 'utf-8'));
  const sessionId = input.session_id;
  if (sessionId) {
    writeFileSync(
      join(SIGNALS_DIR, `${sessionId}.ended.json`),
      JSON.stringify({ ...input, ended_at: new Date().toISOString() })
    );
    // Clean up other signals
    try { unlinkSync(join(SIGNALS_DIR, `${sessionId}.permission.json`)); } catch {}
    try { unlinkSync(join(SIGNALS_DIR, `${sessionId}.stop.json`)); } catch {}
    try { unlinkSync(join(SIGNALS_DIR, `${sessionId}.working.json`)); } catch {}
  }
} catch {}
