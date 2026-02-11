// Strip ANSI escape codes from terminal output
function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
}

const PORT_PATTERNS = [
  // http://localhost:PORT or http://0.0.0.0:PORT or http://127.0.0.1:PORT
  /https?:\/\/(?:localhost|0\.0\.0\.0|127\.0\.0\.1):(\d+)/gi,
  // listening on port PORT
  /listening\s+on\s+port\s+(\d+)/gi,
  // server running on port PORT
  /server\s+running\s+on\s+(?:port\s+)?(\d+)/gi,
  // started on port PORT
  /started\s+on\s+port\s+(\d+)/gi,
  // Port PORT
  /\bport\s+(\d+)\b/gi,
  // 0.0.0.0:PORT or :::PORT
  /(?:0\.0\.0\.0|:::)(\d+)/gi,
];

const IGNORED_PORTS = new Set([80, 443]);

export function detectPorts(bufferText: string): number[] {
  // Only scan last 50K chars for performance
  const text = stripAnsi(bufferText.slice(-50000));
  const ports = new Set<number>();

  for (const pattern of PORT_PATTERNS) {
    // Reset lastIndex for global regex
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const port = parseInt(match[1], 10);
      if (port >= 1024 && port <= 65535 && !IGNORED_PORTS.has(port)) {
        ports.add(port);
      }
    }
  }

  return Array.from(ports).sort((a, b) => a - b);
}
