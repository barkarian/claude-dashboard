import net from 'net';

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

/**
 * Check if a port is actually listening by attempting a TCP connection.
 */
function isPortListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host: '127.0.0.1' });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 500);

    socket.on('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });

    socket.on('error', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(false);
    });
  });
}

/** Regex-only port detection (no TCP verification). */
export function detectPortCandidates(bufferText: string): number[] {
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

/** Detect ports from terminal output and verify each is actually listening via TCP. */
export async function detectPorts(bufferText: string): Promise<number[]> {
  const candidates = detectPortCandidates(bufferText);
  if (candidates.length === 0) return [];

  const results = await Promise.all(
    candidates.map(async (port) => ({ port, listening: await isPortListening(port) }))
  );

  return results.filter((r) => r.listening).map((r) => r.port);
}
