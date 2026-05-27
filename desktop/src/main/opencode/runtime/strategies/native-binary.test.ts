import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
  },
}));

import { resolveOpenCodeSpawnCwd } from './native-binary';

describe('resolveOpenCodeSpawnCwd', () => {
  it('uses HOME when launched from a root cwd', () => {
    expect(
      resolveOpenCodeSpawnCwd({
        rawCwd: '/',
        home: '/Users/tester',
        userProfile: undefined,
      }),
    ).toBe('/Users/tester');
  });

  it('uses the repository root when dev launches from the desktop package', () => {
    expect(
      resolveOpenCodeSpawnCwd({
        rawCwd: '/repo/desktop',
        isPackaged: false,
        exists: (path) => path === '/repo/.opencode',
      }),
    ).toBe('/repo');
  });

  it('keeps the current cwd when the desktop parent is not an OpenCode project', () => {
    expect(
      resolveOpenCodeSpawnCwd({
        rawCwd: '/tmp/desktop',
        isPackaged: false,
        exists: () => false,
      }),
    ).toBe('/tmp/desktop');
  });

  it('does not rewrite packaged app cwd', () => {
    expect(
      resolveOpenCodeSpawnCwd({
        rawCwd: '/Applications/Eden.app/Contents/Resources/app.asar/desktop',
        isPackaged: true,
        exists: () => true,
      }),
    ).toBe('/Applications/Eden.app/Contents/Resources/app.asar/desktop');
  });
});
