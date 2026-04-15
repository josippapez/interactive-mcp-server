import { describe, expect, it } from 'vitest';
import { buildOpenCodePortCandidates } from './endpoints';

describe('buildOpenCodePortCandidates', () => {
  it('deduplicates and always includes default port', () => {
    expect(buildOpenCodePortCandidates(5000, [4096, 5000])).toEqual([
      5000, 4096,
    ]);
  });

  it('drops invalid ports', () => {
    expect(buildOpenCodePortCandidates(0, [-1, 70000, 4096])).toEqual([4096]);
  });
});
