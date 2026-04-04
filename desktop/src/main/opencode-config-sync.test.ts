import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';

// vi.hoisted runs before vi.mock hoisting, so these constants are available
const { TEST_DIR, FAKE_HOME, FAKE_CONFIG_DIR, FAKE_CONFIG_FILE, FAKE_BRIDGE } =
  vi.hoisted(() => {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const os = require('os') as typeof import('os');
    const path = require('path') as typeof import('path');
    /* eslint-enable @typescript-eslint/no-require-imports */
    const testDir = path.join(
      os.tmpdir(),
      `imcp-config-sync-test-${process.pid}`,
    );
    const fakeHome = path.join(testDir, 'home');
    return {
      TEST_DIR: testDir,
      FAKE_HOME: fakeHome,
      FAKE_CONFIG_DIR: path.join(fakeHome, '.config', 'opencode'),
      FAKE_CONFIG_FILE: path.join(
        fakeHome,
        '.config',
        'opencode',
        'opencode.json',
      ),
      FAKE_BRIDGE: path.join(testDir, 'desktop-bridge.cjs'),
    };
  });

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return {
    ...actual,
    homedir: () => FAKE_HOME,
  };
});

vi.mock('./session-file', () => ({
  resolveBridgePath: () => FAKE_BRIDGE,
}));

import { syncBridgeConfig } from '../main/opencode-config-sync';

describe('opencode-config-sync', () => {
  beforeEach(() => {
    // Create test directories
    mkdirSync(FAKE_CONFIG_DIR, { recursive: true });
    // Create a fake bridge file
    writeFileSync(FAKE_BRIDGE, '// fake bridge', 'utf-8');
  });

  afterEach(() => {
    try {
      rmSync(TEST_DIR, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('returns "opencode-config-missing" when no config file exists', () => {
    // beforeEach creates the directory but not the file, so no unlink needed
    const result = syncBridgeConfig();
    expect(result).toBe('opencode-config-missing');
  });

  it('creates the mcp.interactive-desktop entry when config has no mcp section', () => {
    writeFileSync(
      FAKE_CONFIG_FILE,
      JSON.stringify({ $schema: 'test' }),
      'utf-8',
    );

    const result = syncBridgeConfig();
    expect(result).toBe('updated');

    const config = JSON.parse(readFileSync(FAKE_CONFIG_FILE, 'utf-8'));
    expect(config.mcp['interactive-desktop']).toEqual({
      command: ['node', FAKE_BRIDGE],
      type: 'local',
      timeout: 1_210_000,
    });
  });

  it('creates the entry when mcp section exists but has no interactive-desktop', () => {
    writeFileSync(
      FAKE_CONFIG_FILE,
      JSON.stringify({
        mcp: {
          Context7: {
            type: 'local',
            command: ['npx', '-y', '@upstash/context7-mcp'],
          },
        },
      }),
      'utf-8',
    );

    const result = syncBridgeConfig();
    expect(result).toBe('updated');

    const config = JSON.parse(readFileSync(FAKE_CONFIG_FILE, 'utf-8'));
    expect(config.mcp['interactive-desktop'].command).toEqual([
      'node',
      FAKE_BRIDGE,
    ]);
    // Existing entries should be preserved
    expect(config.mcp.Context7).toBeDefined();
  });

  it('updates the bridge path when it differs', () => {
    writeFileSync(
      FAKE_CONFIG_FILE,
      JSON.stringify({
        mcp: {
          'interactive-desktop': {
            command: ['node', '/old/path/bridge.cjs'],
            type: 'local',
            timeout: 1_210_000,
          },
        },
      }),
      'utf-8',
    );

    const result = syncBridgeConfig();
    expect(result).toBe('updated');

    const config = JSON.parse(readFileSync(FAKE_CONFIG_FILE, 'utf-8'));
    expect(config.mcp['interactive-desktop'].command[1]).toBe(FAKE_BRIDGE);
  });

  it('returns "already-current" when the path is already correct', () => {
    writeFileSync(
      FAKE_CONFIG_FILE,
      JSON.stringify({
        mcp: {
          'interactive-desktop': {
            command: ['node', FAKE_BRIDGE],
            type: 'local',
            timeout: 1_210_000,
          },
        },
      }),
      'utf-8',
    );

    const result = syncBridgeConfig();
    expect(result).toBe('already-current');
  });

  it('handles configs with JS-style comments', () => {
    const configWithComments = `{
  // This is a comment
  "mcp": {
    // Context7 for docs
    "Context7": {
      "type": "local",
      "command": ["npx", "-y", "@upstash/context7-mcp"]
    }
  }
}`;
    writeFileSync(FAKE_CONFIG_FILE, configWithComments, 'utf-8');

    const result = syncBridgeConfig();
    expect(result).toBe('updated');

    const config = JSON.parse(readFileSync(FAKE_CONFIG_FILE, 'utf-8'));
    expect(config.mcp['interactive-desktop']).toBeDefined();
    // Note: comments are lost after re-serialization, which is expected
    expect(config.mcp.Context7).toBeDefined();
  });

  it('updates remote type entries to local bridge', () => {
    writeFileSync(
      FAKE_CONFIG_FILE,
      JSON.stringify({
        mcp: {
          'interactive-desktop': {
            url: 'http://localhost:3100/mcp',
            type: 'remote',
            timeout: 1_210_000,
          },
        },
      }),
      'utf-8',
    );

    const result = syncBridgeConfig();
    expect(result).toBe('updated');

    const config = JSON.parse(readFileSync(FAKE_CONFIG_FILE, 'utf-8'));
    expect(config.mcp['interactive-desktop'].type).toBe('local');
    expect(config.mcp['interactive-desktop'].command).toEqual([
      'node',
      FAKE_BRIDGE,
    ]);
    // Old 'url' key should be gone (replaced entirely)
    expect(config.mcp['interactive-desktop'].url).toBeUndefined();
  });

  it('preserves other config keys (schema, plugin, etc.)', () => {
    writeFileSync(
      FAKE_CONFIG_FILE,
      JSON.stringify({
        $schema: 'https://opencode.ai/config.json',
        autoupdate: true,
        plugin: ['./plugins/test.js'],
        mcp: {},
      }),
      'utf-8',
    );

    const result = syncBridgeConfig();
    expect(result).toBe('updated');

    const config = JSON.parse(readFileSync(FAKE_CONFIG_FILE, 'utf-8'));
    expect(config.$schema).toBe('https://opencode.ai/config.json');
    expect(config.autoupdate).toBe(true);
    expect(config.plugin).toEqual(['./plugins/test.js']);
  });
});
