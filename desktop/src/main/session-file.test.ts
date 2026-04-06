import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, existsSync, unlinkSync } from 'fs';
import {
  writeSessionFile,
  clearSessionFile,
  writeMcpConfigHint,
  SESSION_FILE,
  MCP_CONFIG_FILE,
} from '../main/session-file';

describe('session-file', () => {
  // Clean up any leftover files
  afterEach(() => {
    for (const f of [SESSION_FILE, MCP_CONFIG_FILE]) {
      try {
        unlinkSync(f);
      } catch {
        // ignore
      }
    }
  });

  describe('writeSessionFile', () => {
    it('writes a JSON file to the expected tmp path', () => {
      writeSessionFile('test-session', 3100);

      expect(existsSync(SESSION_FILE)).toBe(true);
      const data = JSON.parse(readFileSync(SESSION_FILE, 'utf-8'));
      expect(data.sessionId).toBe('test-session');
      expect(data.port).toBe(3100);
    });

    it('does not include bridgePath (bridge removed)', () => {
      writeSessionFile('test-session', 3100);

      const data = JSON.parse(readFileSync(SESSION_FILE, 'utf-8'));
      expect(data.bridgePath).toBeUndefined();
    });

    it('includes promptTimeoutMs when provided', () => {
      writeSessionFile('test-session', 3100, 1_200_000);

      const data = JSON.parse(readFileSync(SESSION_FILE, 'utf-8'));
      expect(data.promptTimeoutMs).toBe(1_200_000);
    });

    it('omits promptTimeoutMs when not provided', () => {
      writeSessionFile('test-session', 3100);

      const data = JSON.parse(readFileSync(SESSION_FILE, 'utf-8'));
      expect(data.promptTimeoutMs).toBeUndefined();
    });

    it('omits promptTimeoutMs when zero', () => {
      writeSessionFile('test-session', 3100, 0);

      const data = JSON.parse(readFileSync(SESSION_FILE, 'utf-8'));
      expect(data.promptTimeoutMs).toBeUndefined();
    });
  });

  describe('clearSessionFile', () => {
    it('removes the session file', () => {
      writeSessionFile('test-session', 3100);
      expect(existsSync(SESSION_FILE)).toBe(true);

      clearSessionFile();
      expect(existsSync(SESSION_FILE)).toBe(false);
    });

    it('also removes the MCP config hint', () => {
      writeMcpConfigHint(3100);
      expect(existsSync(MCP_CONFIG_FILE)).toBe(true);

      clearSessionFile();
      expect(existsSync(MCP_CONFIG_FILE)).toBe(false);
    });

    it('does not throw when files do not exist', () => {
      expect(() => clearSessionFile()).not.toThrow();
    });
  });

  describe('writeMcpConfigHint', () => {
    it('writes a JSON config file with remote entry', () => {
      writeMcpConfigHint(3100);

      expect(existsSync(MCP_CONFIG_FILE)).toBe(true);
      const data = JSON.parse(readFileSync(MCP_CONFIG_FILE, 'utf-8'));

      expect(data['interactive-desktop']).toBeDefined();
      expect(data['interactive-desktop'].type).toBe('remote');
      expect(data['interactive-desktop'].url).toBe('http://localhost:3100/mcp');
    });

    it('uses the correct port in the URL', () => {
      writeMcpConfigHint(9999);

      const data = JSON.parse(readFileSync(MCP_CONFIG_FILE, 'utf-8'));
      expect(data['interactive-desktop'].url).toBe('http://localhost:9999/mcp');
    });
  });
});
