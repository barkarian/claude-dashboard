/**
 * Centralized regex detection for Claude Code TUI states.
 *
 * Scans terminal buffer text (plain strings, no ANSI) to determine which
 * interactive prompt Claude Code is currently showing. This drives the mobile
 * UI: arrow buttons, text input focus, action buttons.
 *
 * All patterns live here so they're easy to update when the Claude CLI changes.
 */

// ---------------------------------------------------------------------------
// Regex patterns
// ---------------------------------------------------------------------------

/** ❯ on a numbered option: "  ❯ 3. Some option" */
const RE_CURSOR_NUMBERED = /^\s*❯\s*\d+\.\s/;

/** ❯ alone on a line (the free-input prompt): "  ❯  " or "❯" */
const RE_CURSOR_EMPTY = /^\s*❯\s*$/;

/** Horizontal rule boundary: at least 4 box-drawing dashes */
const RE_HORIZONTAL_RULE = /[─]{4,}/;

/** ctrl+g / ctrl-g to edit in Vim (text-input footer signal) */
const RE_CTRL_G_VIM = /ctrl[+\-]g\s+to\s+edit/i;

/** shift+tab to approve (plan-review footer signal) */
const RE_SHIFT_TAB_APPROVE = /shift\+tab\s+to\s+approve/i;

/** Tab bar with section checkboxes: "← ☐ Backend ☐ Database ✔ Submit →" */
const RE_TAB_BAR = /←\s.*[☐✔].*→/;

/** Dismiss prompt: "Press Space, Enter, or Escape to dismiss" */
const RE_DISMISS_A = /Space.*Enter.*Escape.*dismiss/i;
const RE_DISMISS_B = /press.*to\s+dismiss/i;

/** Detail-view footer: "← to go back · ... to close" */
const RE_GO_BACK = /go\s*back/i;
const RE_CLOSE = /close/i;

/** Session search footer: "Type to Search · Enter to select · Esc to clear" */
const RE_SESSION_SEARCH_FOOTER = /Type to Search.*Enter to select/i;

/** Search icon in the search box: "⌕ Search" */
const RE_SEARCH_ICON = /⌕\s*Search/;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Detected terminal UI mode. Each variant tells the mobile prompt area
 * which controls to display.
 *
 * - `none`             – No recognizable TUI pattern; fall back to JSONL status.
 * - `multi-choice`     – ❯ on a numbered option; show up/down arrows + checkmark.
 * - `multi-choice-tabs`– Same + tab bar; add left/right arrows.
 * - `text-input`       – User is in the text-entry sub-mode (ctrl+g footer visible).
 * - `plan-review`      – Plan form with shift+tab to approve.
 * - `free-prompt`      – Bare ❯ prompt; user types freely.
 * - `dismiss`          – "Press Space/Enter/Escape to dismiss" overlay.
 * - `detail-view`      – "← to go back" overlay.
 * - `session-search`   – /resume session picker; show up/down + search sync.
 */
export type TerminalUIMode =
  | { mode: 'none' }
  | { mode: 'multi-choice' }
  | { mode: 'multi-choice-tabs' }
  | { mode: 'text-input' }
  | { mode: 'plan-review' }
  | { mode: 'free-prompt' }
  | { mode: 'dismiss' }
  | { mode: 'detail-view' }
  | { mode: 'session-search' };

// ---------------------------------------------------------------------------
// Detection function
// ---------------------------------------------------------------------------

/**
 * Scan an array of plain-text terminal lines and return the current TUI mode.
 *
 * @param lines - Last ~40 lines from the xterm buffer near the cursor,
 *                obtained via `buffer.getLine(row).translateToString(true)`.
 *                Order does not matter.
 */
export function detectTerminalUIMode(lines: string[]): TerminalUIMode {
  // Single pass: accumulate boolean flags
  let hasDetailView = false;
  let hasDismiss = false;
  let hasCursorNumbered = false;
  let hasCursorEmpty = false;
  let hasHorizontalRule = false;
  let hasCtrlGVim = false;
  let hasShiftTabApprove = false;
  let hasTabBar = false;
  let hasSessionSearch = false;

  for (const line of lines) {
    if (RE_GO_BACK.test(line) && RE_CLOSE.test(line)) hasDetailView = true;
    if (RE_DISMISS_A.test(line) || RE_DISMISS_B.test(line)) hasDismiss = true;
    if (RE_CURSOR_NUMBERED.test(line)) hasCursorNumbered = true;
    if (RE_CURSOR_EMPTY.test(line)) hasCursorEmpty = true;
    if (RE_HORIZONTAL_RULE.test(line)) hasHorizontalRule = true;
    if (RE_CTRL_G_VIM.test(line)) hasCtrlGVim = true;
    if (RE_SHIFT_TAB_APPROVE.test(line)) hasShiftTabApprove = true;
    if (RE_TAB_BAR.test(line)) hasTabBar = true;
    if (RE_SESSION_SEARCH_FOOTER.test(line) || RE_SEARCH_ICON.test(line)) hasSessionSearch = true;
  }

  // Priority evaluation — first match wins

  // 1. Full-screen overlays take absolute priority
  if (hasDetailView) return { mode: 'detail-view' };
  if (hasDismiss) return { mode: 'dismiss' };

  // 1b. Session search picker (/resume, etc.): up/down + search sync
  if (hasSessionSearch) return { mode: 'session-search' };

  // 2. Free prompt: bare ❯ between horizontal rules
  if (hasCursorEmpty && hasHorizontalRule) return { mode: 'free-prompt' };

  // 3. Text input: ctrl+g footer WITHOUT shift+tab (plan-review also has ctrl+g)
  if (hasCtrlGVim && !hasShiftTabApprove) return { mode: 'text-input' };

  // 4. Plan review: shift+tab to approve
  if (hasShiftTabApprove) return { mode: 'plan-review' };

  // 5. Multi-choice with tab bar (plan interview sections)
  if (hasCursorNumbered && hasTabBar) return { mode: 'multi-choice-tabs' };

  // 6. Multi-choice (numbered options)
  if (hasCursorNumbered) return { mode: 'multi-choice' };

  // 7. Nothing recognized
  return { mode: 'none' };
}
