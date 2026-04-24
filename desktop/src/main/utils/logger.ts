/**
 * Persistent file-based logger for the Interactive MCP Desktop main process.
 *
 * Writes structured log lines to dated files in the platform-specific logs
 * directory. Provides a factory function `createLogger(category)` that returns
 * level-specific methods (`debug`, `info`, `warn`, `error`).
 *
 * Log line format:
 *   [YYYY-MM-DDTHH:mm:ss.sssZ] [LEVEL] [category] message
 *
 * Auto-rotates on startup: deletes log files older than 7 days.
 *
 * Writes are queued and appended asynchronously via `fs.promises.appendFile`
 * on a single-writer chain. This keeps the Electron main-process event loop
 * (and IPC dispatch) unblocked during bursty logging, e.g. the 16 ms
 * streaming flush timer. Queue is bounded — oldest entries are dropped
 * (with a single `console.warn`) if the queue exceeds {@link MAX_QUEUE_LEN}.
 * Call {@link flushLogger} on app shutdown to drain pending writes.
 *
 * Usage:
 *   import { initLogger, createLogger, flushLogger } from './utils/logger';
 *   initLogger(app.getPath('logs'));     // call once at app startup
 *   const log = createLogger('mcp');
 *   log.info('server started on port 3100');
 *   // on app quit:
 *   await flushLogger();
 */

import {
  promises as fsp,
  mkdirSync,
  readdirSync,
  unlinkSync,
  openSync,
  closeSync,
} from 'fs';
import { join } from 'path';

// ─── Types ────────────────────────────────────────────────────────────────────

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface Logger {
  debug: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

// ─── Module state ─────────────────────────────────────────────────────────────

/**
 * Active log file path — set by initLogger, cleared by shutdownLogger.
 * When null, writeLine is a no-op.
 */
let _activeLogFilePath: string | null = null;

/**
 * Snapshot of the log file path preserved across shutdown so that
 * getLogPath() continues to return a useful value after shutdown.
 */
let _lastKnownLogFilePath: string | null = null;

/** Maximum age of log files in days before rotation deletes them. */
const MAX_LOG_AGE_DAYS = 7;

/** Pattern matching dated log file names: app-YYYY-MM-DD.log */
const LOG_FILE_PATTERN = /^app-(\d{4}-\d{2}-\d{2})\.log$/;

/**
 * Bounded queue capacity. When exceeded, the oldest pending line is
 * dropped (single console.warn emitted). Chosen large enough that only
 * truly pathological bursts can overflow — normal streaming settles
 * within a few ms per batch.
 */
const MAX_QUEUE_LEN = 1000;

/** Pending log lines waiting to be written. FIFO. */
const _pendingLines: string[] = [];

/**
 * Single-writer serialization chain. Every append is appended to this
 * chain so writes are strictly serial and ordered.
 */
let _writeChain: Promise<void> = Promise.resolve();

/** Set when the queue has overflowed at least once since the last drain. */
let _droppedSinceLastDrainWarned = false;

/** Number of lines currently being flushed (so tests can assert idleness). */
let _flushing = false;

// ─── Internal helpers ─────────────────────────────────────────────────────────

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

function buildLogFilePath(logDir: string): string {
  return join(logDir, `app-${todayDateString()}.log`);
}

function formatLine(
  level: LogLevel,
  category: string,
  message: string,
): string {
  const timestamp = new Date().toISOString();
  return `[${timestamp}] [${level}] [${category}] ${message}\n`;
}

/**
 * Drain the pending-lines queue into a single appendFile call. Chained
 * onto `_writeChain` so writes are strictly ordered with respect to each
 * other across callers.
 *
 * Called implicitly after every `enqueueLine`; re-entrant calls are
 * coalesced by the chain semantics (a draining call that finds the
 * queue empty is a cheap no-op).
 */
function scheduleDrain(): void {
  if (_flushing) return;
  _flushing = true;
  _writeChain = _writeChain.then(async () => {
    // Snapshot and clear the queue atomically (single-threaded JS).
    if (_pendingLines.length === 0 || !_activeLogFilePath) {
      _flushing = false;
      return;
    }
    const batch = _pendingLines.splice(0, _pendingLines.length).join('');
    const target = _activeLogFilePath;
    _flushing = false;
    try {
      await fsp.appendFile(target, batch);
    } catch {
      // Swallow — logging must never crash the app. Next write will try
      // again with a fresh queue; no retry/backoff for the dropped batch.
    }
  });
  // If more lines were added while the above microtask was running,
  // schedule another drain at the end of the chain to pick them up.
  void _writeChain.then(() => {
    if (_pendingLines.length > 0 && _activeLogFilePath) {
      scheduleDrain();
    }
  });
}

/**
 * Enqueue a formatted line for async append. Drops the oldest pending
 * line when the queue is full (with a single console.warn per overflow
 * episode).
 */
function enqueueLine(line: string): void {
  if (_pendingLines.length >= MAX_QUEUE_LEN) {
    _pendingLines.shift();
    if (!_droppedSinceLastDrainWarned) {
      _droppedSinceLastDrainWarned = true;

      console.warn(
        `[logger] queue exceeded ${MAX_QUEUE_LEN} pending lines — dropping oldest`,
      );
    }
  } else if (_pendingLines.length === 0) {
    // New non-full batch — allow the next overflow to warn again.
    _droppedSinceLastDrainWarned = false;
  }
  _pendingLines.push(line);
  scheduleDrain();
}

/**
 * Queue a log line for async append to the current log file. No-op when
 * the logger has not been initialized.
 */
function writeLine(level: LogLevel, category: string, message: string): void {
  if (!_activeLogFilePath) return;
  enqueueLine(formatLine(level, category, message));
}

/**
 * Delete log files older than MAX_LOG_AGE_DAYS.
 * Only touches files matching the `app-YYYY-MM-DD.log` pattern.
 */
function rotateOldLogs(logDir: string): void {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - MAX_LOG_AGE_DAYS);
    const cutoffTime = cutoff.getTime();

    const entries = readdirSync(logDir);
    for (const entry of entries) {
      const match = LOG_FILE_PATTERN.exec(entry);
      if (!match) continue;

      const fileDate = new Date(match[1] + 'T00:00:00.000Z');
      if (fileDate.getTime() < cutoffTime) {
        try {
          unlinkSync(join(logDir, entry));
        } catch {
          // best effort — skip files that can't be deleted
        }
      }
    }
  } catch {
    // Rotation is best-effort; don't crash on readdir failures.
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Initialize the logger with a specific log directory.
 *
 * Creates the directory if it doesn't exist, rotates old logs, and sets
 * up the log file path for async writes.
 *
 * In production, call this once at app startup with `app.getPath('logs')`.
 * In tests, pass a temporary directory.
 */
export function initLogger(logDir: string): void {
  // Ensure directory exists
  try {
    mkdirSync(logDir, { recursive: true });
  } catch {
    // If we can't create the directory, logging will silently no-op.
    return;
  }

  // Rotate old log files
  rotateOldLogs(logDir);

  // Set up log file path
  const filePath = buildLogFilePath(logDir);

  // Touch the file to ensure it exists (creates if missing, no-op if present)
  try {
    const fd = openSync(filePath, 'a');
    closeSync(fd);
  } catch {
    // If we can't create the file, logging will silently no-op.
    return;
  }

  _activeLogFilePath = filePath;
  _lastKnownLogFilePath = filePath;
}

/**
 * Stop accepting new log writes and drain any pending ones.
 *
 * Resolves when the queue has been fully flushed (or dropped on error).
 * Safe to call multiple times; on second invocation the queue is already
 * empty so it resolves immediately.
 */
export async function flushLogger(): Promise<void> {
  // Capture the current chain tail; any writes enqueued after this call
  // would extend the chain, but we only guarantee draining what was
  // already queued when flushLogger was called.
  const chain = _writeChain;
  await chain;
  // If additional drains were chained during the await (e.g. re-entrant
  // logs), wait one more tick so the recursive scheduleDrain completes.
  if (_pendingLines.length > 0 && _activeLogFilePath) {
    await _writeChain;
  }
}

/**
 * Stop accepting new log writes. Drains any pending writes best-effort
 * via {@link flushLogger} before clearing the active path. `getLogPath()`
 * still returns the last known path. Safe to call multiple times.
 */
export function shutdownLogger(): void {
  // Fire-and-forget drain so we don't block the caller; callers that
  // need a deterministic flush should await {@link flushLogger} first.
  void flushLogger();
  _activeLogFilePath = null;
}

/**
 * Return the absolute path of the current (or last) log file.
 * Returns an empty string if the logger has never been initialized.
 */
export function getLogPath(): string {
  return _lastKnownLogFilePath ?? '';
}

/**
 * Create a categorized logger.
 *
 * @param category - A short string identifying the subsystem (e.g. 'mcp',
 *                   'ipc', 'session', 'sse').
 * @returns An object with `debug`, `info`, `warn`, and `error` methods.
 *
 * If `initLogger()` has not been called yet, the returned methods are no-ops.
 */
export function createLogger(category: string): Logger {
  return {
    debug: (message: string) => writeLine('DEBUG', category, message),
    info: (message: string) => writeLine('INFO', category, message),
    warn: (message: string) => writeLine('WARN', category, message),
    error: (message: string) => writeLine('ERROR', category, message),
  };
}

/**
 * Reset all module state. **Test-only** — allows tests to re-initialize
 * the logger from a clean slate without leaking state between test cases.
 */
export function _resetForTest(): void {
  _activeLogFilePath = null;
  _lastKnownLogFilePath = null;
  _pendingLines.length = 0;
  _writeChain = Promise.resolve();
  _droppedSinceLastDrainWarned = false;
  _flushing = false;
}
