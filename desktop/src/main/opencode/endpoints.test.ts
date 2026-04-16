import { describe, expect, it } from 'vitest';
import { DEFAULT_OPENCODE_PORT } from './endpoints';

describe('endpoints', () => {
  it('exports DEFAULT_OPENCODE_PORT as 4096', () => {
    expect(DEFAULT_OPENCODE_PORT).toBe(4096);
  });
});
