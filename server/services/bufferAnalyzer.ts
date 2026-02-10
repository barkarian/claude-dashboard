import { stripAnsi } from '../../shared/utils/stripAnsi.ts';
import { detectInteractiveState } from './interactiveDetector.ts';
import type { BufferAnalysis, SessionStatus } from '../../shared/types/interactive.ts';

/**
 * Unified buffer analysis — replaces the old detectState() + interactive override logic.
 * Returns both the session status and interactive state in a single call.
 *
 * If an interactive element is detected, sessionStatus is always 'waiting-input'
 * (never falsely 'idle'), so no override logic is needed.
 */
export function analyzeBuffer(rawBuffer: string, startupComplete: boolean): BufferAnalysis {
  // Run interactive detection first
  const interactive = startupComplete ? detectInteractiveState(rawBuffer) : null;

  if (interactive) {
    return { sessionStatus: 'waiting-input', interactive };
  }

  // No interactive element — determine idle/thinking from buffer text
  const sessionStatus = detectSessionStatus(rawBuffer);
  return { sessionStatus, interactive: null };
}

/**
 * Detect whether Claude Code is idle (showing prompt) or thinking.
 * Extracted from the old detectState() but without interactive/confirmation checks
 * (those are handled by detectInteractiveState above).
 */
function detectSessionStatus(rawBuffer: string): SessionStatus {
  const clean = stripAnsi(rawBuffer.slice(-2000));
  const lastLines = clean.trim().split('\n').filter(l => l.trim());
  const lastLine = (lastLines[lastLines.length - 1] || '').trim();

  // Confirmation patterns — these mean Claude is waiting for user input
  const confirmPatterns = [
    /\(y\/n\)/i,
    /\[Y\/n\]/i,
    /\[y\/N\]/i,
    /Continue\?/i,
    /Apply changes\?/i,
    /Do you want to proceed\?/i,
    /Proceed\?/i,
  ];

  for (const pattern of confirmPatterns) {
    if (pattern.test(lastLine)) {
      return 'waiting-input';
    }
  }

  // Check for box-drawing + permission keywords (permission prompt)
  const recentText = lastLines.slice(-10).join(' ');
  const hasBoxDrawing = /[│┌┐└┘─╭╮╯╰┃┏┓┗┛━]/.test(recentText);
  const hasPermissionKeyword = /\b(allow|deny|permission|approve|bash|edit|write|read)\b/i.test(recentText);
  if (hasBoxDrawing && hasPermissionKeyword) {
    return 'waiting-input';
  }

  // Check for selection menu markers
  const menuLines = lastLines.slice(-15);
  const markerLine = menuLines.findIndex(l => /^\s*[❯›>]\s+\S/.test(l));
  if (markerLine !== -1) {
    let count = 1;
    for (let i = markerLine - 1; i >= 0; i--) {
      if (menuLines[i].trim() && menuLines[i].trim().length < 100) count++;
      else break;
    }
    for (let i = markerLine + 1; i < menuLines.length; i++) {
      if (menuLines[i].trim() && menuLines[i].trim().length < 100) count++;
      else break;
    }
    if (count >= 2) {
      return 'waiting-input';
    }
  }

  // Idle prompt: a lone ❯ on the last line
  if (/^[❯›»]\s*$/.test(lastLine)) {
    return 'idle';
  }

  // Also check for "> " prompt style
  if (/^>\s*$/.test(lastLine)) {
    return 'idle';
  }

  return 'thinking';
}
