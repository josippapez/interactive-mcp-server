import { describe, expect, it } from 'vitest';
import type { SessionNode } from '../../types';
import {
  countRunningBackgroundSubagents,
  deriveBackgroundSubagents,
  isSubagentStalled,
} from './background-subagents';

function makeNode(overrides: Partial<SessionNode>): SessionNode {
  return {
    id: overrides.id ?? 'ses_default',
    providerSessionId:
      overrides.providerSessionId ?? overrides.id ?? 'ses_default',
    openCodeParentId: overrides.openCodeParentId ?? null,
    title: overrides.title ?? 'Session',
    directory: overrides.directory ?? '/repo',
    createdAt: overrides.createdAt,
    depth: overrides.depth ?? 0,
    connectionId: overrides.connectionId ?? null,
    hasMcpChannel: overrides.hasMcpChannel ?? false,
    isDirectConnection: overrides.isDirectConnection ?? false,
    providerType: overrides.providerType ?? 'opencode',
    prompt: null,
    activeSession: null,
    baseDirectory: overrides.baseDirectory ?? '/repo',
    channelMessages: [],
    unreadCount: 0,
    lastReadMessageId: null,
    hasPendingPrompt: false,
    sessionChannel: null,
    sessionStatuses: overrides.sessionStatuses ?? [],
    pendingPermissions: [],
    pendingQuestions: [],
    vcsInfo: null,
  };
}

describe('deriveBackgroundSubagents', () => {
  it('returns child OpenCode sessions for the active parent', () => {
    const nodes = new Map<string, SessionNode>([
      ['ses_parent', makeNode({ id: 'ses_parent', title: 'Parent' })],
      [
        'ses_child',
        makeNode({
          id: 'ses_child',
          title: 'Background child',
          openCodeParentId: 'ses_parent',
          depth: 1,
          sessionStatuses: [
            { status: 'Running', type: 'working', timestamp: new Date(1) },
          ],
        }),
      ],
      [
        'ses_other',
        makeNode({ id: 'ses_other', openCodeParentId: 'ses_unrelated' }),
      ],
    ]);

    expect(deriveBackgroundSubagents(nodes, 'ses_parent')).toEqual([
      {
        id: 'ses_child',
        title: 'Background child',
        status: 'running',
        depth: 1,
        createdAt: undefined,
        model: null,
        variant: null,
        isStalled: false,
      },
    ]);
  });

  it('counts only running background subagents', () => {
    expect(
      countRunningBackgroundSubagents([
        {
          id: 'ses_running',
          title: 'Running',
          status: 'running' as const,
          depth: 1,
          model: null,
          variant: null,
          isStalled: false,
        },
        {
          id: 'ses_ended',
          title: 'Ended',
          status: 'ended' as const,
          depth: 1,
          model: null,
          variant: null,
          isStalled: false,
        },
      ]),
    ).toBe(1);
  });

  it('detects stalled running subagents', () => {
    expect(isSubagentStalled('running', Date.now() - 11 * 60_000)).toBe(true);
    expect(isSubagentStalled('running', Date.now() - 2 * 60_000)).toBe(false);
    expect(isSubagentStalled('ended', Date.now() - 20 * 60_000)).toBe(false);
  });
});
