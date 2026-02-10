/**
 * Strip ANSI escape codes for clean text analysis.
 * Handles CSI, OSC, DEC private mode sequences, and control characters.
 */
export function stripAnsi(str: string): string {
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
