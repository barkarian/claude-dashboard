#!/usr/bin/env node
// Hook: Stop — fires when Claude's turn ends
// Writes stop signal to ~/.claude/session-signals/<session_id>.stop.json

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
      join(SIGNALS_DIR, `${sessionId}.stop.json`),
      JSON.stringify({ ...input, stopped_at: new Date().toISOString() })
    );
    // Clear working and permission signals since turn ended
    try { unlinkSync(join(SIGNALS_DIR, `${sessionId}.working.json`)); } catch {}
    try { unlinkSync(join(SIGNALS_DIR, `${sessionId}.permission.json`)); } catch {}
  }
} catch {}
