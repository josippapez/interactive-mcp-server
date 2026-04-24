import { describe, expect, it } from 'vitest';
import { pruneDiffWrapState, toggleDiffWrapState } from './diff-wrap-state';

describe('diff-wrap-state', () => {
  it('toggles wrapping on and off for the targeted diff block', () => {
    const enabled = toggleDiffWrapState({}, 'diff-1');
    expect(enabled).toEqual({ 'diff-1': true });

    const disabled = toggleDiffWrapState(enabled, 'diff-1');
    expect(disabled).toEqual({ 'diff-1': false });
  });

  it('preserves other diff blocks when toggling one block', () => {
    expect(toggleDiffWrapState({ 'diff-1': true }, 'diff-2')).toEqual({
      'diff-1': true,
      'diff-2': true,
    });
  });

  it('drops stale diff ids when the preview set changes', () => {
    expect(
      pruneDiffWrapState(
        {
          'diff-1': true,
          'diff-2': false,
        },
        ['diff-2', 'diff-3'],
      ),
    ).toEqual({ 'diff-2': false });
  });
});
