import { describe, expect, it } from 'vitest';
import {
  UNWRAPPED_SIDE_BY_SIDE_DIFF_ROW_SELECTOR,
  UNWRAPPED_UNIFIED_DIFF_ROW_SELECTOR,
} from './diff-css-selectors';

describe('diff css selectors', () => {
  it('targets only unwrapped side-by-side diff rows', () => {
    expect(UNWRAPPED_SIDE_BY_SIDE_DIFF_ROW_SELECTOR).toContain(
      "[data-wrap='false']",
    );
    expect(UNWRAPPED_SIDE_BY_SIDE_DIFF_ROW_SELECTOR).toContain(
      "[data-slot='diff-row']",
    );
  });

  it('targets only unwrapped unified diff rows', () => {
    expect(UNWRAPPED_UNIFIED_DIFF_ROW_SELECTOR).toContain(
      "[data-variant='unified']",
    );
    expect(UNWRAPPED_UNIFIED_DIFF_ROW_SELECTOR).toContain(
      "[data-wrap='false']",
    );
    expect(UNWRAPPED_UNIFIED_DIFF_ROW_SELECTOR).toContain(
      "[data-slot='diff-row']",
    );
  });
});
