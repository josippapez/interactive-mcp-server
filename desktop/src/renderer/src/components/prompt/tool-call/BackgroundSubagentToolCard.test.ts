import { describe, expect, it } from 'vitest';
import {
  resolveBackgroundSubagentTitle,
  resolveAction,
  type SubagentAction,
} from './background-subagent-helpers';

describe('resolveAction', () => {
  it('returns null when input is undefined', () => {
    expect(resolveAction(undefined)).toBeNull();
  });

  it('returns null when action field is missing', () => {
    expect(resolveAction({ title: 'My task' })).toBeNull();
  });

  it('returns null for an unknown action string', () => {
    expect(resolveAction({ action: 'unknown' })).toBeNull();
  });

  const KNOWN_ACTIONS: SubagentAction[] = [
    'start',
    'models',
    'list',
    'status',
    'output',
    'cancel',
  ];

  for (const action of KNOWN_ACTIONS) {
    it(`recognises "${action}" action (lowercase)`, () => {
      expect(resolveAction({ action })).toBe(action);
    });

    it(`recognises "${action.toUpperCase()}" action (uppercase)`, () => {
      expect(resolveAction({ action: action.toUpperCase() })).toBe(action);
    });
  }

  it('returns null for non-string action values', () => {
    expect(resolveAction({ action: 42 })).toBeNull();
    expect(resolveAction({ action: null })).toBeNull();
    expect(resolveAction({ action: {} })).toBeNull();
  });
});

describe('resolveBackgroundSubagentTitle', () => {
  it('uses the existing agent/title convention for start actions', () => {
    expect(
      resolveBackgroundSubagentTitle({
        action: 'start',
        agent: 'explore',
        title: 'Investigate rendering',
      }),
    ).toBe('explore');
  });

  it('uses action-specific titles for non-start management actions', () => {
    expect(resolveBackgroundSubagentTitle({ action: 'list' })).toBe(
      'Background subagents',
    );
    expect(resolveBackgroundSubagentTitle({ action: 'models' })).toBe(
      'Background models',
    );
    expect(resolveBackgroundSubagentTitle({ action: 'status' })).toBe(
      'Background status',
    );
    expect(resolveBackgroundSubagentTitle({ action: 'output' })).toBe(
      'Background output',
    );
    expect(resolveBackgroundSubagentTitle({ action: 'cancel' })).toBe(
      'Cancel background subagent',
    );
  });
});
