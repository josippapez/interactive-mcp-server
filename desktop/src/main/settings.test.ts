// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/test-user-data' },
}));

const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockWriteFileSync = vi.fn();

vi.mock('fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
}));

import { loadSettings, defaultSettings } from './settings';

describe('loadSettings', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns defaultSettings when no settings file exists', () => {
    mockExistsSync.mockReturnValue(false);
    const result = loadSettings();
    expect(result).toEqual(defaultSettings);
  });

  it('merges saved settings over defaults', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ port: 9999 }));
    const result = loadSettings();
    expect(result.port).toBe(9999);
    expect(result.promptTimeoutSeconds).toBe(
      defaultSettings.promptTimeoutSeconds,
    );
  });

  it('returns defaultSettings when the file is corrupt JSON', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('NOT_JSON{{{');
    const result = loadSettings();
    expect(result).toEqual(defaultSettings);
  });

  describe('migration: promptTimeoutSeconds 200 → 1200', () => {
    it('upgrades 200 to 1200 and persists the migrated value', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({ promptTimeoutSeconds: 200 }),
      );
      const result = loadSettings();
      expect(result.promptTimeoutSeconds).toBe(1200);
      expect(mockWriteFileSync).toHaveBeenCalledOnce();
      const written = JSON.parse(mockWriteFileSync.mock.calls[0][1] as string);
      expect(written.promptTimeoutSeconds).toBe(1200);
    });

    it('does not write file when no migration is needed', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({ promptTimeoutSeconds: 600 }),
      );
      loadSettings();
      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });

    it('does not migrate a deliberately chosen value other than 200', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({ promptTimeoutSeconds: 300 }),
      );
      const result = loadSettings();
      expect(result.promptTimeoutSeconds).toBe(300);
    });
  });
});
