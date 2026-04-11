import { describe, it, expect } from 'vitest';
import { pickUnregisteredConnectionsForCleanup } from './registration-cleanup';

describe('pickUnregisteredConnectionsForCleanup', () => {
  it('cleans unregistered generic Agent N channels', () => {
    const result = pickUnregisteredConnectionsForCleanup(
      [
        {
          connectionId: 'conn-1',
          connectionName: 'OpenCode - Main Channel',
          isRegistered: true,
        },
        {
          connectionId: 'conn-2',
          connectionName: 'Agent 2',
          isRegistered: false,
        },
      ],
      { connectionId: 'conn-1', channelName: 'OpenCode - Main Channel' },
    );

    expect(result).toEqual(['conn-2']);
  });

  it('cleans unregistered channels that duplicate the registered agent name', () => {
    const result = pickUnregisteredConnectionsForCleanup(
      [
        {
          connectionId: 'conn-new',
          connectionName: 'OpenCode - Main Channel',
          isRegistered: true,
        },
        {
          connectionId: 'conn-old',
          connectionName: 'OpenCode - Main Channel',
          isRegistered: false,
        },
      ],
      { connectionId: 'conn-new', channelName: 'OpenCode - Main Channel' },
    );

    expect(result).toEqual(['conn-old']);
  });
});
