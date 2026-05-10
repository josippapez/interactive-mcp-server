import { describe, expect, it } from 'vitest';
import { resolveNextToolExpandedState } from './tool-expanded-state';

describe('resolveNextToolExpandedState', () => {
  it('keeps a tool expanded after pending auto-expansion when the tool completes', () => {
    expect(
      resolveNextToolExpandedState({
        currentExpanded: true,
        forceExpanded: false,
        isPending: false,
      }),
    ).toBe(true);
  });

  it('opens pending tools automatically', () => {
    expect(
      resolveNextToolExpandedState({
        currentExpanded: false,
        forceExpanded: false,
        isPending: true,
      }),
    ).toBe(true);
  });
});
