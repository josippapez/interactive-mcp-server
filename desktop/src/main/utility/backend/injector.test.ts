import { describe, expect, it } from 'vitest';
import { resolveOpenCodeSessionDirectory } from './injector';

describe('resolveOpenCodeSessionDirectory', () => {
  it('prefers the actual OpenCode session directory over the registered base directory', () => {
    expect(
      resolveOpenCodeSessionDirectory({
        sessionDirectory: '/repo/current-workspace',
        registeredBaseDirectory: '/Users/josippapez',
      }),
    ).toBe('/repo/current-workspace');
  });

  it('falls back to the registered base directory when OpenCode does not report one', () => {
    expect(
      resolveOpenCodeSessionDirectory({
        sessionDirectory: null,
        registeredBaseDirectory: '/repo/main',
      }),
    ).toBe('/repo/main');
  });

  it('returns undefined when neither directory is available', () => {
    expect(
      resolveOpenCodeSessionDirectory({
        sessionDirectory: ' ',
        registeredBaseDirectory: null,
      }),
    ).toBeUndefined();
  });
});
