// Strip ANSI escape codes for clean text analysis
function stripAnsi(str) {
  return str
    // CSI sequences: \x1b[ optionally followed by ? or > then digits/semicolons then letter
    .replace(/\x1b\[[\?>=!]?[0-9;]*[a-zA-Z]/g, '')
    // OSC sequences: \x1b] ... BEL or ST
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    // Other escape sequences (SS2, SS3, DCS, etc.)
    .replace(/\x1b[^[\]](.*?)(\x1b\\|\x07)/g, '')
    // Single-character escapes
    .replace(/\x1b[()#][A-Z0-9]/g, '')
    // Any remaining lone ESC + single char
    .replace(/\x1b[A-Z@\[\\\]^_`a-z{|}~]/g, '')
    // Control characters (except newline)
    .replace(/[\x00-\x09\x0b-\x1f]/g, '');
}

/**
 * Detect arrow-navigable selection menus (e.g. /model, init wizard, etc.)
 * Looks for ❯ or > markers with consecutive list items.
 * Scans from the END of the buffer so we find the current menu, not old prompts.
 */
function detectSelectionMenu(lines) {
  // Search from the end — the active menu is always near the bottom
  let selectedIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^\s*[❯›]\s+\S/.test(lines[i])) {
      selectedIdx = i;
      break;
    }
  }
  if (selectedIdx === -1) return null;

  // The selected line must have content after the marker (not just a lone ❯ prompt)
  const selectedContent = lines[selectedIdx].replace(/^\s*[❯›]\s+/, '').trim();
  if (!selectedContent) return null;

  // Look for hint text that confirms this is a navigable menu
  const tailText = lines.slice(selectedIdx).join(' ');
  const hasNavHint = /arrow|navigate|select|enter|tab|esc/i.test(tailText);

  // Walk backward to find start of menu (stop at box-drawing or empty gaps)
  let startIdx = selectedIdx;
  for (let i = selectedIdx - 1; i >= Math.max(0, selectedIdx - 20); i--) {
    const trimmed = lines[i].trim();
    if (!trimmed || /^[─━╭╮╰╯┌┐└┘┃│]+$/.test(trimmed)) break;
    // Stop at lines that are clearly headings/separators (all box-drawing)
    if (/[─━]{5,}/.test(trimmed)) break;
    startIdx = i;
  }

  // Walk forward to find end of menu
  let endIdx = selectedIdx;
  for (let i = selectedIdx + 1; i < Math.min(lines.length, selectedIdx + 20); i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) break;
    // Stop at box-drawing separators
    if (/[─━]{5,}/.test(trimmed)) break;
    // Stop at navigation hint lines (these are after the menu)
    if (/enter to select|arrow keys|esc to cancel/i.test(trimmed)) break;
    endIdx = i;
  }

  // Count actual numbered/bulleted items or ❯-prefixed items
  let itemCount = 0;
  for (let i = startIdx; i <= endIdx; i++) {
    const trimmed = lines[i].trim();
    // Numbered items like "1. React", "2. Vue", or ❯-prefixed
    if (/^\s*[❯›]\s+/.test(lines[i]) || /^\d+\.\s+\S/.test(trimmed)) {
      itemCount++;
    }
  }

  // Need at least 2 selectable items OR a nav hint to confirm it's a menu
  if (itemCount < 2 && !hasNavHint) return null;
  if (itemCount < 1) return null;

  return {
    type: 'selection-menu',
    options: [],      // Don't enumerate — just provide the arrow pad
    selectedIndex: 0,
    navigation: 'vertical',
  };
}

/**
 * Detect permission prompts with box-drawing characters.
 * Claude Code draws permission boxes with │┌┐└┘─╭╮╯╰ etc.
 * Must have box-drawing AND permission keywords in NEARBY lines (not the whole buffer).
 */
function detectPermissionPrompt(lines) {
  // Only look at the last 20 lines — permission prompts are always at the bottom
  const tail = lines.slice(-20);

  const boxChars = /[│┌┐└┘╭╮╯╰┃┏┓┗┛]/;
  const hasBox = tail.some(l => boxChars.test(l));
  if (!hasBox) return null;

  // Require permission-specific keywords in the same region
  const tailText = tail.join(' ');
  const hasPermission = /\b(allow|deny|permission|approve)\b/i.test(tailText);
  if (!hasPermission) return null;

  // Extract options from the box content
  const options = [];
  const optionPatterns = [
    /\bAllow\s+once\b/i,
    /\bAllow\s+always\b/i,
    /\bAllow\b/i,
    /\bDeny\b/i,
  ];

  for (const pattern of optionPatterns) {
    const match = tailText.match(pattern);
    if (match) {
      const label = match[0];
      if (!options.includes(label)) {
        options.push(label);
      }
    }
  }

  if (options.length === 0) {
    options.push('Allow', 'Deny');
  }

  return {
    type: 'permission-prompt',
    options,
    selectedIndex: 0,
    navigation: 'horizontal',
  };
}

/**
 * Detect multi-option confirmations like (yes/no/always), (y/n/a), etc.
 */
function detectMultiOptionConfirmation(lines) {
  const lastFewLines = lines.slice(-5).join(' ');

  const multiOptionMatch = lastFewLines.match(/\(([a-zA-Z]+(?:\/[a-zA-Z]+){2,})\)/);
  if (!multiOptionMatch) return null;

  const options = multiOptionMatch[1].split('/').map(o => o.trim());

  return {
    type: 'multi-option-confirmation',
    options,
    selectedIndex: 0,
    navigation: 'text',
  };
}

/**
 * Detect simple y/n confirmations.
 */
function detectSimpleConfirmation(lines) {
  const lastFewLines = lines.slice(-5).join(' ');

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
    if (pattern.test(lastFewLines)) {
      return {
        type: 'simple-confirmation',
        options: ['Yes', 'No'],
        selectedIndex: 0,
        navigation: 'text',
      };
    }
  }

  return null;
}

/**
 * Detect text input fields — prompts ending with : that expect typed input.
 */
function detectTextInputField(lines) {
  const lastLine = (lines[lines.length - 1] || '').trim();

  if (/:\s*$/.test(lastLine) && lastLine.length > 3 && lastLine.length < 200) {
    if (/^\d{2,4}[:\-]/.test(lastLine)) return null;
    if (/^(import|const|let|var|function|class|if|for|while)\s/.test(lastLine)) return null;

    return {
      type: 'text-input',
      prompt: lastLine,
      options: [],
      selectedIndex: -1,
      navigation: 'text',
    };
  }

  return null;
}

/**
 * Detect any navigation hint text from Claude Code's UI.
 * Lines like "Enter to select · Tab/Arrow keys to navigate · Esc to cancel"
 */
function detectNavigationHint(lines) {
  const tail = lines.slice(-5).join(' ');
  if (/arrow\s*keys?\s*(to\s*)?(navigate|move)/i.test(tail) ||
      /enter\s+to\s+select/i.test(tail) ||
      /tab.*navigate.*esc/i.test(tail)) {
    return {
      type: 'selection-menu',
      options: [],
      selectedIndex: 0,
      navigation: 'vertical',
    };
  }
  return null;
}

/**
 * Main export: run all detectors in priority order and return first match.
 * Wrapped in try-catch so a detection error never crashes the silence timer.
 */
export function detectInteractiveState(rawBuffer) {
  try {
    const clean = stripAnsi(rawBuffer.slice(-4000));
    const lines = clean.split('\n').filter(l => l.trim());

    if (lines.length === 0) return null;

    return detectSelectionMenu(lines)
      || detectPermissionPrompt(lines)
      || detectMultiOptionConfirmation(lines)
      || detectSimpleConfirmation(lines)
      || detectNavigationHint(lines)
      || detectTextInputField(lines)
      || null;
  } catch (err) {
    console.error('Interactive detection error:', err);
    return null;
  }
}

export default { detectInteractiveState };
