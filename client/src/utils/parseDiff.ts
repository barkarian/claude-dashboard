export interface DiffLine {
  type: 'context' | 'addition' | 'deletion' | 'hunk-header';
  content: string;
  oldLine?: number;
  newLine?: number;
  hunkHeader?: string;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export function parseDiff(diffText: string): DiffHunk[] {
  if (!diffText) return [];

  const lines = diffText.split('\n');
  const hunks: DiffHunk[] = [];
  let currentHunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const line of lines) {
    // Skip diff meta lines
    if (
      line.startsWith('diff ') ||
      line.startsWith('index ') ||
      line.startsWith('--- ') ||
      line.startsWith('+++ ') ||
      line.startsWith('Binary files')
    ) {
      continue;
    }

    // Hunk header
    const hunkMatch = line.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@(.*)/);
    if (hunkMatch) {
      oldLine = parseInt(hunkMatch[1], 10);
      newLine = parseInt(hunkMatch[2], 10);
      currentHunk = {
        header: line,
        lines: [
          {
            type: 'hunk-header',
            content: hunkMatch[3]?.trim() || '',
            hunkHeader: line,
          },
        ],
      };
      hunks.push(currentHunk);
      continue;
    }

    if (!currentHunk) continue;

    // No newline marker
    if (line.startsWith('\\ No newline')) {
      currentHunk.lines.push({ type: 'context', content: line });
      continue;
    }

    if (line.startsWith('+')) {
      currentHunk.lines.push({
        type: 'addition',
        content: line.substring(1),
        newLine: newLine++,
      });
    } else if (line.startsWith('-')) {
      currentHunk.lines.push({
        type: 'deletion',
        content: line.substring(1),
        oldLine: oldLine++,
      });
    } else {
      // Context line (starts with space or is empty)
      currentHunk.lines.push({
        type: 'context',
        content: line.startsWith(' ') ? line.substring(1) : line,
        oldLine: oldLine++,
        newLine: newLine++,
      });
    }
  }

  return hunks;
}
