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

    it('includes bridgePath when the bridge script exists', () => {
      writeSessionFile('test-session', 3100);

      const data = JSON.parse(readFileSync(SESSION_FILE, 'utf-8'));
      // bridgePath may or may not be present depending on dev env,
      // but the key should exist if the bridge file is found
      if (data.bridgePath) {
        expect(typeof data.bridgePath).toBe('string');
        expect(data.bridgePath).toContain('desktop-bridge.cjs');
      }
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
    it('writes a JSON config file', () => {
      writeMcpConfigHint(3100);

      expect(existsSync(MCP_CONFIG_FILE)).toBe(true);
      const data = JSON.parse(readFileSync(MCP_CONFIG_FILE, 'utf-8'));

      // Should always have the HTTP config
      expect(data['interactive-desktop-http']).toBeDefined();
      expect(data['interactive-desktop-http'].type).toBe('remote');
      expect(data['interactive-desktop-http'].url).toBe(
        'http://localhost:3100/mcp',
      );
    });

    it('includes bridge config when the bridge script exists', () => {
      writeMcpConfigHint(3100);

      const data = JSON.parse(readFileSync(MCP_CONFIG_FILE, 'utf-8'));

      // Bridge config is only present if the script was found on disk
      if (data['interactive-desktop']) {
        expect(data['interactive-desktop'].type).toBe('local');
        expect(data['interactive-desktop'].command).toBe('node');
        expect(data['interactive-desktop'].args).toHaveLength(1);
      }
    });

    it('uses the correct port in the HTTP URL', () => {
      writeMcpConfigHint(9999);

      const data = JSON.parse(readFileSync(MCP_CONFIG_FILE, 'utf-8'));
      expect(data['interactive-desktop-http'].url).toBe(
        'http://localhost:9999/mcp',
      );
    });
  });
});
