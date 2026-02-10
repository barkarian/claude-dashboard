// Strip ANSI escape codes for clean text analysis
function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
            .replace(/\x1b\][^\x07]*\x07/g, '')
            .replace(/\x1b[^[]*\[?[0-9;]*[a-zA-Z]/g, '')
            .replace(/[\x00-\x09\x0b-\x1f]/g, '');
}

/**
 * Detect arrow-navigable selection menus (e.g. /model, /mcp, etc.)
 * Looks for ❯ or > markers with consecutive list items.
 */
function detectSelectionMenu(lines) {
  const selectedIdx = lines.findIndex(l => /^\s*[❯›>]\s+/.test(l));
  if (selectedIdx === -1) return null;

  // Gather contiguous option lines around the selected one
  const options = [];
  let startIdx = selectedIdx;

  // Walk backward to find start of menu
  for (let i = selectedIdx - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    // Menu items are either selected (❯) or unselected (plain text or with spaces)
    if (trimmed && !trimmed.includes('─') && !trimmed.includes('│') && trimmed.length < 100) {
      startIdx = i;
    } else {
      break;
    }
  }

  // Walk forward to find end of menu
  let endIdx = selectedIdx;
  for (let i = selectedIdx + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed && !trimmed.includes('─') && !trimmed.includes('│') && trimmed.length < 100) {
      endIdx = i;
    } else {
      break;
    }
  }

  // Need at least 2 items to be a menu
  if (endIdx - startIdx < 1) return null;

  for (let i = startIdx; i <= endIdx; i++) {
    const raw = lines[i].trim();
    // Strip leading marker characters
    const label = raw.replace(/^[❯›>]\s+/, '').replace(/^\s+/, '').trim();
    if (label) {
      options.push({
        label,
        selected: i === selectedIdx,
      });
    }
  }

  if (options.length < 2) return null;

  const selectedOptionIdx = options.findIndex(o => o.selected);

  return {
    type: 'selection-menu',
    options: options.map(o => o.label),
    selectedIndex: selectedOptionIdx >= 0 ? selectedOptionIdx : 0,
    navigation: 'vertical',
  };
}

/**
 * Detect permission prompts with box-drawing characters.
 * Claude Code draws permission boxes with │┌┐└┘─╭╮╯╰ etc.
 */
function detectPermissionPrompt(lines) {
  const boxChars = /[│┌┐└┘─╭╮╯╰┃┏┓┗┛━]/;
  const hasBox = lines.some(l => boxChars.test(l));
  if (!hasBox) return null;

  // Look for permission-related keywords
  const permissionKeywords = /\b(allow|deny|permission|approve|reject|bash|edit|write|read|execute|always)\b/i;
  const hasPermission = lines.some(l => permissionKeywords.test(l));
  if (!hasPermission) return null;

  // Extract options from the box content
  const options = [];
  const optionPatterns = [
    /\bAllow\s+once\b/i,
    /\bAllow\s+always\b/i,
    /\bAllow\b/i,
    /\bDeny\b/i,
    /\bYes\b/i,
    /\bNo\b/i,
  ];

  const joinedText = lines.join(' ');
  for (const pattern of optionPatterns) {
    const match = joinedText.match(pattern);
    if (match) {
      const label = match[0];
      if (!options.includes(label)) {
        options.push(label);
      }
    }
  }

  if (options.length === 0) {
    // Default permission options
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

  // Match patterns like (yes/no/always), (y/n/a), etc.
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

  // Prompt ending with colon, possibly with a trailing space
  if (/:\s*$/.test(lastLine) && lastLine.length > 3 && lastLine.length < 200) {
    // Exclude lines that look like log output or code
    if (/^\d{2,4}[:\-]/.test(lastLine)) return null; // timestamps
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
 * Main export: run all detectors in priority order and return first match.
 */
export function detectInteractiveState(rawBuffer) {
  const clean = stripAnsi(rawBuffer.slice(-3000));
  const lines = clean.split('\n').filter(l => l.trim());

  if (lines.length === 0) return null;

  // Run detectors in priority order
  return detectSelectionMenu(lines)
    || detectPermissionPrompt(lines)
    || detectMultiOptionConfirmation(lines)
    || detectSimpleConfirmation(lines)
    || detectTextInputField(lines)
    || null;
}

export default { detectInteractiveState };
