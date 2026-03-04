/**
 * Strip ANSI escape codes, OSC sequences, and carriage returns from terminal output.
 */
export function stripAnsi(text: string): string {
  return text
    // OSC sequences (e.g. title setting)
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    // CSI sequences (colors, cursor movement, etc.)
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    // Other escape sequences
    .replace(/\x1b[^[\]()][^\x1b]*/g, '')
    // Remaining raw ESC
    .replace(/\x1b/g, '')
    // Carriage returns (handle \r\n and standalone \r)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '');
}
