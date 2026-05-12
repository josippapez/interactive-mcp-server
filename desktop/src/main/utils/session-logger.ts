import {
  promises as fsp,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
} from 'fs';
import { join } from 'path';

export type SessionLogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

const MAX_SESSION_LOG_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_QUEUE_LEN = 1000;
const queues = new Map<string, string[]>();
const writeChains = new Map<string, Promise<void>>();
const flushing = new Set<string>();

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
  const content = await fsp.readFile(path, 'utf8').catch(() => '');
  if (lines <= 0) return content;
  return content.split('\n').filter(Boolean).slice(-lines).join('\n');
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
  try {
    mkdirSync(sessionsDir(logsDir), { recursive: true });
  } catch {
    return;
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
}
