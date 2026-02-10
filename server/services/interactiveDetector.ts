import type { InteractiveState } from '../../shared/types/interactive.ts';

/**
 * Detect arrow-navigable selection menus (e.g. /model, init wizard, etc.)
 * Scans from the END of the buffer so we find the current menu, not old prompts.
 */
function detectSelectionMenu(lines: string[]): InteractiveState | null {
  let selectedIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^\s*[❯›]\s+\S/.test(lines[i])) {
      selectedIdx = i;
      break;
    }
  }
  if (selectedIdx === -1) return null;

  const selectedContent = lines[selectedIdx].replace(/^\s*[❯›]\s+/, '').trim();
  if (!selectedContent) return null;

  const tailText = lines.slice(selectedIdx).join(' ');
  const hasNavHint = /arrow|navigate|select|enter|tab|esc/i.test(tailText);

  let startIdx = selectedIdx;
  for (let i = selectedIdx - 1; i >= Math.max(0, selectedIdx - 20); i--) {
    const trimmed = lines[i].trim();
    if (!trimmed || /^[─━╭╮╰╯┌┐└┘┃│]+$/.test(trimmed)) break;
    if (/[─━]{5,}/.test(trimmed)) break;
    startIdx = i;
  }

  let endIdx = selectedIdx;
  for (let i = selectedIdx + 1; i < Math.min(lines.length, selectedIdx + 20); i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) break;
    if (/[─━]{5,}/.test(trimmed)) break;
    if (/enter to select|arrow keys|esc to cancel/i.test(trimmed)) break;
    endIdx = i;
  }

  let itemCount = 0;
  for (let i = startIdx; i <= endIdx; i++) {
    if (/^\s*[❯›]\s+/.test(lines[i]) || /^\d+\.\s+\S/.test(lines[i].trim())) {
      itemCount++;
    }
  }

  if (itemCount < 2 && !hasNavHint) return null;
  if (itemCount < 1) return null;

  return {
    type: 'selection-menu',
    options: [],
    selectedIndex: 0,
    navigation: 'vertical',
  };
}

/**
 * Detect permission prompts with box-drawing characters.
 */
function detectPermissionPrompt(lines: string[]): InteractiveState | null {
  const tail = lines.slice(-20);

  const boxChars = /[│┌┐└┘╭╮╯╰┃┏┓┗┛]/;
  const hasBox = tail.some(l => boxChars.test(l));
  if (!hasBox) return null;

  const tailText = tail.join(' ');
  const hasPermission = /\b(allow|deny|permission|approve)\b/i.test(tailText);
  if (!hasPermission) return null;

  const options: string[] = [];
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
function detectMultiOptionConfirmation(lines: string[]): InteractiveState | null {
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
function detectSimpleConfirmation(lines: string[]): InteractiveState | null {
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
function detectTextInputField(lines: string[]): InteractiveState | null {
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
 */
function detectNavigationHint(lines: string[]): InteractiveState | null {
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
export function detectInteractiveState(renderedLines: string[]): InteractiveState | null {
  try {
    const lines = renderedLines.filter(l => l.trim());

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
