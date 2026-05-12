import {
  promises as fsp,
  createReadStream,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
} from 'fs';
import { join } from 'path';

export type SessionLogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

const MAX_SESSION_LOG_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_QUEUE_LEN = 200;
const INITIAL_TAIL_READ_BYTES = 64 * 1024;
const queues = new Map<string, string[]>();
const writeChains = new Map<string, Promise<void>>();
const flushing = new Set<string>();
const ensuredSessionDirs = new Set<string>();

export function sanitizeSessionIdForFilename(sessionId: string): string {
  const sanitized = sessionId
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return sanitized.length > 0 ? sanitized : 'unknown-session';
}

function sessionsDir(logsDir: string): string {
  return join(logsDir, 'sessions');
}

export function buildSessionLogFilePath(
  logsDir: string,
  sessionId: string,
): string {
  return join(
    sessionsDir(logsDir),
    `${sanitizeSessionIdForFilename(sessionId)}.log`,
  );
}

export function buildSessionLogOpenResult(
  logsDir: string | null | undefined,
  sessionId: string,
): { ok: true; path: string } | { ok: false; error: string } {
  if (!logsDir) {
    return { ok: false, error: 'Session logs directory is not configured.' };
  }
  return { ok: true, path: buildSessionLogFilePath(logsDir, sessionId) };
}

export async function readSessionLog(
  logsDir: string,
  sessionId: string,
  lines = 200,
): Promise<string> {
  await flushSessionLogger();
  const path = buildSessionLogFilePath(logsDir, sessionId);
  if (lines <= 0) return fsp.readFile(path, 'utf8').catch(() => '');
  return readSessionLogTail(path, lines);
}

async function readSessionLogTail(
  path: string,
  lines: number,
): Promise<string> {
  const stat = await fsp.stat(path).catch(() => null);
  if (!stat) return '';
  let readBytes = Math.min(stat.size, INITIAL_TAIL_READ_BYTES);

  while (readBytes <= stat.size) {
    const start = stat.size - readBytes;
    const content = await readFileRange(path, start, stat.size - 1);
    const lineParts = content.split('\n').filter(Boolean);
    if (lineParts.length > lines || readBytes === stat.size) {
      return lineParts.slice(-lines).join('\n');
    }
    readBytes = Math.min(stat.size, readBytes * 2);
  }

  return '';
}

function readFileRange(
  path: string,
  start: number,
  end: number,
): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    const stream = createReadStream(path, { start, end, encoding: 'utf8' });
    stream.on('data', (chunk) => {
      chunks.push(Buffer.from(chunk));
    });
    stream.on('error', () => resolve(''));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

function formatSessionLine(
  level: SessionLogLevel,
  category: string,
  sessionId: string,
  message: string,
): string {
  return `[${new Date().toISOString()}] [${level}] [${category}] [session:${sessionId}] ${message}\n`;
}

export function rotateOldSessionLogs(logsDir: string): void {
  const dir = sessionsDir(logsDir);
  try {
    mkdirSync(dir, { recursive: true });
    const cutoff = Date.now() - MAX_SESSION_LOG_AGE_MS;
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith('.log')) continue;
      const path = join(dir, entry);
      try {
        if (statSync(path).mtimeMs < cutoff) {
          unlinkSync(path);
        }
      } catch {
        // best effort
      }
    }
  } catch {
    // best effort
  }
}

function scheduleDrain(path: string): void {
  if (flushing.has(path)) return;
  flushing.add(path);
  const chain = writeChains.get(path) ?? Promise.resolve();
  const nextChain = chain.then(async () => {
    const queue = queues.get(path);
    if (!queue || queue.length === 0) {
      flushing.delete(path);
      return;
    }
    const batch = queue.splice(0, queue.length).join('');
    flushing.delete(path);
    try {
      await fsp.appendFile(path, batch);
    } catch {
      // logging must never crash the app
    }
  });
  writeChains.set(path, nextChain);
  void nextChain.then(() => {
    const queue = queues.get(path);
    if (queue && queue.length > 0) {
      scheduleDrain(path);
    }
  });
}

export function writeSessionLog(
  logsDir: string,
  sessionId: string | null | undefined,
  level: SessionLogLevel,
  category: string,
  message: string,
): void {
  if (!logsDir || !sessionId) return;
  const path = buildSessionLogFilePath(logsDir, sessionId);
  const dir = sessionsDir(logsDir);
  if (!ensuredSessionDirs.has(dir)) {
    try {
      mkdirSync(dir, { recursive: true });
      ensuredSessionDirs.add(dir);
    } catch {
      return;
    }
  }
  const queue = queues.get(path) ?? [];
  if (queue.length >= MAX_QUEUE_LEN) {
    queue.shift();
  }
  queue.push(formatSessionLine(level, category, sessionId, message));
  queues.set(path, queue);
  scheduleDrain(path);
}

export async function flushSessionLogger(): Promise<void> {
  await Promise.all([...writeChains.values()]);
  if ([...queues.values()].some((queue) => queue.length > 0)) {
    await Promise.all([...writeChains.values()]);
  }
}

export function _resetSessionLoggerForTest(): void {
  queues.clear();
  writeChains.clear();
  flushing.clear();
  ensuredSessionDirs.clear();
}
