import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  _resetSessionLoggerForTest,
  buildSessionLogFilePath,
  buildSessionLogOpenResult,
  flushSessionLogger,
  readSessionLog,
  sanitizeSessionIdForFilename,
  writeSessionLog,
} from './session-logger';

let tempDir: string | null = null;

afterEach(async () => {
  _resetSessionLoggerForTest();
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

async function makeTempDir(): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), 'session-logger-'));
  return tempDir;
}

describe('session-logger', () => {
  it('sanitizes session ids for safe filenames', () => {
    expect(sanitizeSessionIdForFilename('ses_abc123')).toBe('ses_abc123');
    expect(sanitizeSessionIdForFilename('../ses bad!*')).toBe('ses_bad');
    expect(sanitizeSessionIdForFilename('')).toBe('unknown-session');
  });

  it('builds paths under logs/sessions', () => {
    expect(buildSessionLogFilePath('/tmp/logs', 'ses_abc123')).toBe(
      join('/tmp/logs', 'sessions', 'ses_abc123.log'),
    );
  });

  it('appends session log lines to a per-session file', async () => {
    const logsDir = await makeTempDir();

    writeSessionLog(logsDir, 'ses_abc123', 'INFO', 'renderer', 'selected');
    await flushSessionLogger();

    const filePath = buildSessionLogFilePath(logsDir, 'ses_abc123');
    await expect(stat(filePath)).resolves.toBeTruthy();
    await expect(readFile(filePath, 'utf8')).resolves.toMatch(
      /\[INFO\] \[renderer\] \[session:ses_abc123\] selected/,
    );
  });

  it('reads the tail of a session log', async () => {
    const logsDir = await makeTempDir();

    writeSessionLog(logsDir, 'ses_abc123', 'INFO', 'test', 'first');
    writeSessionLog(logsDir, 'ses_abc123', 'INFO', 'test', 'second');
    await flushSessionLogger();

    await expect(readSessionLog(logsDir, 'ses_abc123', 1)).resolves.toMatch(
      'second',
    );
    await expect(readSessionLog(logsDir, 'ses_abc123', 1)).resolves.not.toMatch(
      'first',
    );
  });

  it('builds a session log open result', () => {
    expect(buildSessionLogOpenResult('/tmp/logs', 'ses_abc123')).toEqual({
      ok: true,
      path: join('/tmp/logs', 'sessions', 'ses_abc123.log'),
    });
  });

  it('returns an error open result when logsDir is missing', () => {
    expect(buildSessionLogOpenResult(undefined, 'ses_abc123')).toEqual({
      ok: false,
      error: 'Session logs directory is not configured.',
    });
  });
});
