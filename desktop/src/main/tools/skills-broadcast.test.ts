import { describe, it, expect } from 'vitest';
import { pickReminderTargets } from './skills-broadcast';
import type { RegisteredConnection } from '../database';

function conn(
  providerType: RegisteredConnection['providerType'],
  providerSessionId: string,
  connectionId: string | null = 'cid',
): RegisteredConnection {
  return {
    providerType,
    providerSessionId,
    connectionId,
    channelName: 'name',
    projectName: 'proj',
    baseDirectory: null,
    idFilePath: '/tmp/x',
    parentSessionId: null,
    createdAt: '2025-01-01',
    updatedAt: '2025-01-01',
  };
}

describe('pickReminderTargets', () => {
  it('returns empty list when there are no connections', () => {
    expect(pickReminderTargets([])).toEqual([]);
  });

  it('includes opencode connections', () => {
    const result = pickReminderTargets([conn('opencode', 'ses_a')]);
    expect(result).toEqual([{ providerSessionId: 'ses_a' }]);
  });

  it('excludes non-opencode providers (no injection channel)', () => {
    const result = pickReminderTargets([
      conn('opencode', 'ses_a'),
      conn('copilot-cli', 'cid_b'),
      conn('claude-sdk', 'cid_c'),
      conn('standalone', 'cid_d'),
    ]);
    expect(result).toEqual([{ providerSessionId: 'ses_a' }]);
  });

  it('deduplicates by providerSessionId (parent + subagent rows share session)', () => {
    const result = pickReminderTargets([
      conn('opencode', 'ses_shared', 'parent-cid'),
      conn('opencode', 'ses_shared', 'child-cid'),
    ]);
    expect(result).toEqual([{ providerSessionId: 'ses_shared' }]);
  });

  it('skips opencode rows with empty providerSessionId', () => {
    const result = pickReminderTargets([
      conn('opencode', ''),
      conn('opencode', 'ses_real'),
    ]);
    expect(result).toEqual([{ providerSessionId: 'ses_real' }]);
  });
});
