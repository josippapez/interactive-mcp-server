import { describe, it, expect } from 'vitest';
import { findStaleGenericDirectChannels } from './channel-cleanup';

describe('findStaleGenericDirectChannels', () => {
  it('selects unregistered Agent N channels that are not active', () => {
    const stale = findStaleGenericDirectChannels(
      [
        {
          sessionId: 'conn-old-agent',
          label: 'Agent 1',
          openCodeSessionId: null,
        },
        {
          sessionId: 'conn-active-agent',
          label: 'Agent 2',
          openCodeSessionId: null,
        },
        {
          sessionId: 'conn-registered',
          label: 'OpenCode - Main Channel',
          openCodeSessionId: 'ses_main',
        },
        {
          sessionId: 'conn-custom-direct',
          label: 'My Debug Channel',
          openCodeSessionId: null,
        },
      ],
      new Set(['conn-active-agent', 'conn-current']),
      'conn-current',
    );

    expect(stale).toEqual(['conn-old-agent']);
  });

  it('keeps current connection even if generic and unregistered', () => {
    const stale = findStaleGenericDirectChannels(
      [
        {
          sessionId: 'conn-current',
          label: 'Agent 1',
          openCodeSessionId: null,
        },
      ],
      new Set(['conn-current']),
      'conn-current',
    );

    expect(stale).toEqual([]);
  });
});
