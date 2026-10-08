import { describe, expect, it } from 'vitest';
import {
  closeSubagentSessionTab,
  openSubagentSessionTab,
  pruneSubagentSessionTabs,
} from './subagent-session-pane-utils';

describe('subagent session pane utils', () => {
  it('opens a new tab without duplicating an existing one', () => {
    expect(openSubagentSessionTab(['ses_a'], 'ses_b')).toEqual([
      'ses_a',
      'ses_b',
    ]);
    expect(openSubagentSessionTab(['ses_a', 'ses_b'], 'ses_b')).toEqual([
      'ses_a',
      'ses_b',
    ]);
  });

  it('keeps the active tab when a different tab closes', () => {
    expect(
      closeSubagentSessionTab(['ses_a', 'ses_b', 'ses_c'], 'ses_b', 'ses_a'),
    ).toEqual({
      sessionIds: ['ses_b', 'ses_c'],
      activeSessionId: 'ses_b',
    });
  });

  it('moves focus to the nearest surviving tab when the active tab closes', () => {
    expect(
      closeSubagentSessionTab(['ses_a', 'ses_b', 'ses_c'], 'ses_b', 'ses_b'),
    ).toEqual({
      sessionIds: ['ses_a', 'ses_c'],
      activeSessionId: 'ses_c',
    });

    expect(
      closeSubagentSessionTab(['ses_a', 'ses_b'], 'ses_b', 'ses_b'),
    ).toEqual({
      sessionIds: ['ses_a'],
      activeSessionId: 'ses_a',
    });
  });

  it('prunes tabs for sessions that no longer exist', () => {
    expect(
      pruneSubagentSessionTabs(
        ['ses_a', 'ses_b', 'ses_c'],
        'ses_b',
        new Set(['ses_a', 'ses_c']),
      ),
    ).toEqual({
      sessionIds: ['ses_a', 'ses_c'],
      activeSessionId: 'ses_c',
    });
  });
});
