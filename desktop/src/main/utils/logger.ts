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
 * Uses `appendFileSync` for crash-safe writes — every log line is flushed
 * to disk immediately so nothing is lost on unexpected exits.
 *
 * Usage:
 *   import { initLogger, createLogger } from './utils/logger';
 *   initLogger(app.getPath('logs'));     // call once at app startup
 *   const log = createLogger('mcp');
 *   log.info('server started on port 3100');
 */

import {
  appendFileSync,
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
 * Write a log line synchronously to the current log file.
 * Silently ignores errors to avoid crashing the app.
 */
function writeLine(level: LogLevel, category: string, message: string): void {
  if (!_activeLogFilePath) return;
  try {
    appendFileSync(_activeLogFilePath, formatLine(level, category, message));
  } catch {
    // Swallow write errors — logging must never crash the app.
  }
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
 * up the log file path for synchronous writes.
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
 * Stop accepting new log writes.
 *
 * With `appendFileSync`, all writes are already flushed, so this just
 * clears the active path to prevent further writes. `getLogPath()` still
 * returns the last known path. Safe to call multiple times.
 */
export function shutdownLogger(): void {
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
}
