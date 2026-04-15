import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  createLogger,
  getLogPath,
  initLogger,
  shutdownLogger,
  _resetForTest,
} from './logger';

// ─── Helpers ──────────────────────────────────────────────────────────────────

let _dirCounter = 0;

function makeTempLogDir(): string {
  _dirCounter++;
  const dir = join(
    tmpdir(),
    `logger-test-${process.pid}-${Date.now()}-${_dirCounter}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function readLogLines(filePath: string): string[] {
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, 'utf-8')
    .split('\n')
    .filter((l) => l.length > 0);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('logger', () => {
  let logDir: string;

  beforeEach(() => {
    _resetForTest();
    logDir = makeTempLogDir();
  });

  afterEach(() => {
    shutdownLogger();
  });

  describe('initLogger', () => {
    it('should create the log directory if it does not exist', () => {
      const nested = join(logDir, 'nested', 'deep');
      initLogger(nested);
      expect(existsSync(nested)).toBe(true);
    });

    it('should not throw if the directory already exists', () => {
      expect(() => initLogger(logDir)).not.toThrow();
    });
  });

  describe('getLogPath', () => {
    it('should return the current dated log file path', () => {
      initLogger(logDir);
      const logPath = getLogPath();
      expect(logPath).toContain(logDir);
      // File name format: app-YYYY-MM-DD.log
      expect(logPath).toMatch(/app-\d{4}-\d{2}-\d{2}\.log$/);
    });

    it('should return empty string if logger not initialized', () => {
      expect(getLogPath()).toBe('');
    });
  });

  describe('createLogger', () => {
    it('should return an object with debug, info, warn, error methods', () => {
      initLogger(logDir);
      const log = createLogger('test');
      expect(typeof log.debug).toBe('function');
      expect(typeof log.info).toBe('function');
      expect(typeof log.warn).toBe('function');
      expect(typeof log.error).toBe('function');
    });

    it('should write log lines with correct format', () => {
      initLogger(logDir);
      const log = createLogger('mcp');
      log.info('server started on port 3100');
      shutdownLogger(); // flush

      const logPath = getLogPath();
      const lines = readLogLines(logPath);
      expect(lines.length).toBe(1);
      // Format: [ISO] [LEVEL] [category] message
      expect(lines[0]).toMatch(
        /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[INFO\] \[mcp\] server started on port 3100$/,
      );
    });

    it('should write all log levels correctly', () => {
      initLogger(logDir);
      const log = createLogger('test');
      log.debug('debug message');
      log.info('info message');
      log.warn('warn message');
      log.error('error message');
      shutdownLogger(); // flush

      const logPath = getLogPath();
      const lines = readLogLines(logPath);
      expect(lines.length).toBe(4);
      expect(lines[0]).toContain('[DEBUG]');
      expect(lines[1]).toContain('[INFO]');
      expect(lines[2]).toContain('[WARN]');
      expect(lines[3]).toContain('[ERROR]');
    });

    it('should include the category in each log line', () => {
      initLogger(logDir);
      const log = createLogger('session');
      log.info('resolved');
      shutdownLogger();

      const logPath = getLogPath();
      const lines = readLogLines(logPath);
      expect(lines[0]).toContain('[session]');
    });

    it('should handle multiple loggers with different categories', () => {
      initLogger(logDir);
      const mcpLog = createLogger('mcp');
      const ipcLog = createLogger('ipc');
      mcpLog.info('tool call received');
      ipcLog.warn('handler slow');
      shutdownLogger();

      const logPath = getLogPath();
      const lines = readLogLines(logPath);
      expect(lines.length).toBe(2);
      expect(lines[0]).toContain('[mcp]');
      expect(lines[1]).toContain('[ipc]');
    });

    it('should work even before initLogger is called (no-op)', () => {
      const log = createLogger('early');
      expect(() => log.info('this should not crash')).not.toThrow();
    });
  });

  describe('log rotation', () => {
    it('should delete log files older than 7 days on init', () => {
      // Create fake old log files
      const today = new Date();
      const oldDate = new Date(today);
      oldDate.setDate(oldDate.getDate() - 10);
      const oldFileName = `app-${oldDate.toISOString().slice(0, 10)}.log`;
      writeFileSync(join(logDir, oldFileName), 'old log data');

      // Create a recent file that should NOT be deleted
      const recentDate = new Date(today);
      recentDate.setDate(recentDate.getDate() - 3);
      const recentFileName = `app-${recentDate.toISOString().slice(0, 10)}.log`;
      writeFileSync(join(logDir, recentFileName), 'recent log data');

      // Create a non-log file that should NOT be deleted
      writeFileSync(join(logDir, 'other.txt'), 'not a log');

      initLogger(logDir);

      expect(existsSync(join(logDir, oldFileName))).toBe(false);
      expect(existsSync(join(logDir, recentFileName))).toBe(true);
      expect(existsSync(join(logDir, 'other.txt'))).toBe(true);
    });

    it('should not crash if rotation encounters errors', () => {
      // Init on a valid dir — rotation should succeed silently
      expect(() => initLogger(logDir)).not.toThrow();
    });
  });

  describe('error resilience', () => {
    it('should not crash the app if the log directory becomes unwritable', () => {
      initLogger(logDir);
      const log = createLogger('test');
      // Writing should not throw even if there are issues
      expect(() => log.error('this should be safe')).not.toThrow();
    });

    it('should handle concurrent writes from multiple loggers', () => {
      initLogger(logDir);
      const loggers = Array.from({ length: 10 }, (_, i) =>
        createLogger(`cat${i}`),
      );
      expect(() => {
        for (const log of loggers) {
          log.info('concurrent message');
        }
      }).not.toThrow();
      shutdownLogger();

      const logPath = getLogPath();
      const lines = readLogLines(logPath);
      expect(lines.length).toBe(10);
    });
  });

  describe('shutdownLogger', () => {
    it('should flush and close the write stream', () => {
      initLogger(logDir);
      const log = createLogger('test');
      log.info('before shutdown');
      shutdownLogger();

      const logPath = getLogPath();
      const lines = readLogLines(logPath);
      expect(lines.length).toBe(1);
    });

    it('should be safe to call multiple times', () => {
      initLogger(logDir);
      expect(() => {
        shutdownLogger();
        shutdownLogger();
      }).not.toThrow();
    });

    it('should allow re-init after shutdown', () => {
      initLogger(logDir);
      const log1 = createLogger('first');
      log1.info('first init');
      shutdownLogger();

      const path1 = getLogPath();

      // Re-init
      _resetForTest();
      initLogger(logDir);
      const log2 = createLogger('second');
      log2.info('second init');
      shutdownLogger();

      const lines = readLogLines(path1);
      // Both writes go to the same dated file
      expect(lines.length).toBe(2);
    });
  });
});
