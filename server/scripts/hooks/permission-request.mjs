#!/usr/bin/env node
// Hook: PermissionRequest — fires when a tool needs user approval
// Writes permission signal to ~/.claude/session-signals/<session_id>.permission.json

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const SIGNALS_DIR = join(homedir(), '.claude', 'session-signals');
mkdirSync(SIGNALS_DIR, { recursive: true });

try {
  const input = JSON.parse(readFileSync('/dev/stdin', 'utf-8'));
  const sessionId = input.session_id;
  if (sessionId) {
    writeFileSync(
      join(SIGNALS_DIR, `${sessionId}.permission.json`),
      JSON.stringify({ ...input, pending_since: new Date().toISOString() })
    );
  }
} catch {}
