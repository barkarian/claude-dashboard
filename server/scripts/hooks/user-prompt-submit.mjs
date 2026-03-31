#!/usr/bin/env node
// Hook: UserPromptSubmit — fires when user sends a message
// Writes working signal to ~/.claude/session-signals/<session_id>.working.json

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
      join(SIGNALS_DIR, `${sessionId}.working.json`),
      JSON.stringify({ ...input, working_since: new Date().toISOString() })
    );
    // Clear stop signal since new turn is starting
    try { unlinkSync(join(SIGNALS_DIR, `${sessionId}.stop.json`)); } catch {}
  }
} catch {}
