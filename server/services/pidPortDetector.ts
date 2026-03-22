import { execFile } from 'child_process';

const IGNORED_PORTS = new Set([80, 443]);
let lsofWarned = false;

function exec(cmd: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout }, (err, stdout) => {
      if (err) {
        // pgrep exit code 1 = no matches, lsof exit code 1 = no results
        if ((err as any).code === 1) return resolve('');
        return reject(err);
      }
      resolve(stdout);
    });
  });
}

/**
 * Walk the process tree via BFS using pgrep -P to find all descendant PIDs.
 */
export async function getDescendantPids(pid: number): Promise<number[]> {
  const result: number[] = [pid];
  const queue = [pid];

  while (queue.length > 0) {
    const current = queue.shift()!;
    try {
      const stdout = await exec('pgrep', ['-P', String(current)], 3000);
      const children = stdout.trim().split('\n').filter(Boolean).map(Number).filter(n => !isNaN(n));
      for (const child of children) {
        result.push(child);
        queue.push(child);
      }
    } catch {
      // pgrep failed or timed out for this PID — skip
    }
  }

  return result;
}

/**
 * Detect TCP LISTEN ports for a process and all its descendants using lsof.
 */
export async function detectPortsByPid(pid: number): Promise<number[]> {
  const pids = await getDescendantPids(pid);
  if (pids.length === 0) return [];

  let stdout: string;
  try {
    stdout = await exec('lsof', ['-iTCP', '-sTCP:LISTEN', '-P', '-n', '-F', 'pn'], 5000);
  } catch (err: any) {
    if (!lsofWarned && err?.code === 'ENOENT') {
      console.warn('[pidPortDetector] lsof not found on this system — port detection disabled');
      lsofWarned = true;
    }
    return [];
  }

  if (!stdout) return [];

  const pidSet = new Set(pids);
  const ports = new Set<number>();
  let currentPid: number | null = null;

  for (const line of stdout.split('\n')) {
    if (line.startsWith('p')) {
      currentPid = parseInt(line.slice(1), 10);
    } else if (line.startsWith('n') && currentPid !== null && pidSet.has(currentPid)) {
      // Format: n*:PORT or n127.0.0.1:PORT or n[::1]:PORT
      const match = line.match(/:(\d+)$/);
      if (match) {
        const port = parseInt(match[1], 10);
        if (port >= 1024 && port <= 65535 && !IGNORED_PORTS.has(port)) {
          ports.add(port);
        }
      }
    }
  }

  return Array.from(ports).sort((a, b) => a - b);
}
