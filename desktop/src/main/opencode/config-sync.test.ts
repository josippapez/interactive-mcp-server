// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';

// vi.hoisted runs before vi.mock hoisting, so these constants are available
const { TEST_DIR, FAKE_HOME, FAKE_CONFIG_DIR, FAKE_CONFIG_FILE } = vi.hoisted(
  () => {
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
    };
  },
);

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return {
    ...actual,
    homedir: () => FAKE_HOME,
  };
});

import { syncRemoteConfig } from './config-sync';

describe('opencode-config-sync', () => {
  beforeEach(() => {
    // Create test directories
    mkdirSync(FAKE_CONFIG_DIR, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(TEST_DIR, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('returns "opencode-config-missing" when no config file exists', () => {
    const result = syncRemoteConfig(3100);
    expect(result).toBe('opencode-config-missing');
  });

  it('creates the mcp.interactive-desktop remote entry when config has no mcp section', () => {
    writeFileSync(
      FAKE_CONFIG_FILE,
      JSON.stringify({ $schema: 'test' }),
      'utf-8',
    );

    const result = syncRemoteConfig(3100);
    expect(result).toBe('updated');

    const config = JSON.parse(readFileSync(FAKE_CONFIG_FILE, 'utf-8'));
    expect(config.mcp['interactive-desktop']).toEqual({
      type: 'remote',
      url: 'http://localhost:3100/mcp',
      timeout: 860_000, // default: 800s * 1000 + 60_000 buffer
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

    const result = syncRemoteConfig(3100);
    expect(result).toBe('updated');

    const config = JSON.parse(readFileSync(FAKE_CONFIG_FILE, 'utf-8'));
    expect(config.mcp['interactive-desktop'].type).toBe('remote');
    expect(config.mcp['interactive-desktop'].url).toBe(
      'http://localhost:3100/mcp',
    );
    // Existing entries should be preserved
    expect(config.mcp.Context7).toBeDefined();
  });

  it('updates a stale local/bridge entry to remote', () => {
    writeFileSync(
      FAKE_CONFIG_FILE,
      JSON.stringify({
        mcp: {
          'interactive-desktop': {
            command: ['node', '/old/path/bridge.cjs'],
            type: 'local',
            timeout: 1_810_000,
          },
        },
      }),
      'utf-8',
    );

    const result = syncRemoteConfig(3100);
    expect(result).toBe('updated');

    const config = JSON.parse(readFileSync(FAKE_CONFIG_FILE, 'utf-8'));
    expect(config.mcp['interactive-desktop'].type).toBe('remote');
    expect(config.mcp['interactive-desktop'].url).toBe(
      'http://localhost:3100/mcp',
    );
    // Old command key should be gone (replaced entirely)
    expect(config.mcp['interactive-desktop'].command).toBeUndefined();
  });

  it('returns "already-current" when the remote entry is already correct', () => {
    writeFileSync(
      FAKE_CONFIG_FILE,
      JSON.stringify({
        mcp: {
          'interactive-desktop': {
            type: 'remote',
            url: 'http://localhost:3100/mcp',
            timeout: 860_000,
          },
        },
      }),
      'utf-8',
    );

    const result = syncRemoteConfig(3100);
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

    const result = syncRemoteConfig(3100);
    expect(result).toBe('updated');

    const config = JSON.parse(readFileSync(FAKE_CONFIG_FILE, 'utf-8'));
    expect(config.mcp['interactive-desktop']).toBeDefined();
    expect(config.mcp['interactive-desktop'].type).toBe('remote');
    expect(config.mcp.Context7).toBeDefined();
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

    const result = syncRemoteConfig(3100);
    expect(result).toBe('updated');

    const config = JSON.parse(readFileSync(FAKE_CONFIG_FILE, 'utf-8'));
    expect(config.$schema).toBe('https://opencode.ai/config.json');
    expect(config.autoupdate).toBe(true);
    expect(config.plugin).toEqual(['./plugins/test.js']);
  });

  it('removes stale interactive-bridge entry when it exists', () => {
    writeFileSync(
      FAKE_CONFIG_FILE,
      JSON.stringify({
        mcp: {
          'interactive-desktop': {
            url: 'http://localhost:3100/mcp',
            type: 'remote',
            timeout: 860_000,
          },
          'interactive-bridge': {
            command: ['node', '/old/dev/path/desktop-bridge.cjs'],
            type: 'local',
            timeout: 1_810_000,
          },
          Context7: {
            type: 'local',
            command: ['npx', '-y', '@upstash/context7-mcp'],
          },
        },
      }),
      'utf-8',
    );

    const result = syncRemoteConfig(3100);
    // Should still report updated because it removed the stale entry
    expect(result).toBe('updated');

    const config = JSON.parse(readFileSync(FAKE_CONFIG_FILE, 'utf-8'));
    // interactive-bridge should be removed
    expect(config.mcp['interactive-bridge']).toBeUndefined();
    // Other entries preserved
    expect(config.mcp.Context7).toBeDefined();
    expect(config.mcp['interactive-desktop']).toBeDefined();
  });

  it('uses dynamic timeout based on promptTimeoutSeconds when provided', () => {
    writeFileSync(FAKE_CONFIG_FILE, JSON.stringify({ mcp: {} }), 'utf-8');

    const result = syncRemoteConfig(3100, 1200);
    expect(result).toBe('updated');

    const config = JSON.parse(readFileSync(FAKE_CONFIG_FILE, 'utf-8'));
    // timeout should be promptTimeoutSeconds * 1000 + 60_000 buffer
    expect(config.mcp['interactive-desktop'].timeout).toBe(1_200_000 + 60_000);
  });

  it('uses default timeout when promptTimeoutSeconds is not provided', () => {
    writeFileSync(FAKE_CONFIG_FILE, JSON.stringify({ mcp: {} }), 'utf-8');

    const result = syncRemoteConfig(3100);
    expect(result).toBe('updated');

    const config = JSON.parse(readFileSync(FAKE_CONFIG_FILE, 'utf-8'));
    // Default: 800s * 1000 + 60_000 = 860_000
    expect(config.mcp['interactive-desktop'].timeout).toBe(860_000);
  });

  it('detects timeout change and updates the entry', () => {
    // First sync with default timeout
    writeFileSync(FAKE_CONFIG_FILE, JSON.stringify({ mcp: {} }), 'utf-8');
    syncRemoteConfig(3100);

    // Second sync with different timeout — should update
    const result = syncRemoteConfig(3100, 1800);
    expect(result).toBe('updated');

    const config = JSON.parse(readFileSync(FAKE_CONFIG_FILE, 'utf-8'));
    expect(config.mcp['interactive-desktop'].timeout).toBe(1_800_000 + 60_000);
  });

  it('updates when port changes', () => {
    writeFileSync(
      FAKE_CONFIG_FILE,
      JSON.stringify({
        mcp: {
          'interactive-desktop': {
            type: 'remote',
            url: 'http://localhost:3100/mcp',
            timeout: 860_000,
          },
        },
      }),
      'utf-8',
    );

    const result = syncRemoteConfig(4200);
    expect(result).toBe('updated');

    const config = JSON.parse(readFileSync(FAKE_CONFIG_FILE, 'utf-8'));
    expect(config.mcp['interactive-desktop'].url).toBe(
      'http://localhost:4200/mcp',
    );
  });
});
