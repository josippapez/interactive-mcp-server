import { describe, expect, it } from 'vitest';
import type { SessionNode } from '../../types';
import {
  countRunningBackgroundSubagents,
  deriveBackgroundSubagents,
  getBackgroundSubagentTabBadge,
  getBackgroundSubagentTabCount,
  isSubagentStalled,
  summarizeBackgroundSubagents,
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
    prompt: overrides.prompt ?? null,
    activeSession: overrides.activeSession ?? null,
    baseDirectory: overrides.baseDirectory ?? '/repo',
    channelMessages: [],
    unreadCount: 0,
    lastReadMessageId: null,
    hasPendingPrompt: false,
    sessionChannel: overrides.sessionChannel ?? null,
    sessionStatuses: overrides.sessionStatuses ?? [],
    pendingPermissions: [],
    pendingQuestions: [],
    vcsInfo: null,
  };
}

const NOW_MS = 1_700_000_000_000;

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
            {
              status: 'Running',
              type: 'working',
              timestamp: new Date(NOW_MS - 60_000),
            },
          ],
        }),
      ],
      [
        'ses_other',
        makeNode({ id: 'ses_other', openCodeParentId: 'ses_unrelated' }),
      ],
    ]);

    expect(deriveBackgroundSubagents(nodes, 'ses_parent', NOW_MS)).toEqual([
      expect.objectContaining({
        id: 'ses_child',
        title: 'Background child',
        status: 'running',
        depth: 1,
        createdAt: undefined,
        model: null,
        variant: null,
        isStalled: false,
        lastStatus: 'Running',
        statusLabel: 'Running',
      }),
    ]);
  });

  it('orders stalled, running, and ended subagents deterministically', () => {
    const nodes = new Map<string, SessionNode>([
      ['ses_parent', makeNode({ id: 'ses_parent', title: 'Parent' })],
      [
        'ses_ended',
        makeNode({
          id: 'ses_ended',
          title: 'Alpha ended',
          openCodeParentId: 'ses_parent',
          createdAt: NOW_MS - 1_000,
        }),
      ],
      [
        'ses_running_b',
        makeNode({
          id: 'ses_running_b',
          title: 'Beta running',
          openCodeParentId: 'ses_parent',
          sessionStatuses: [
            {
              status: 'Collecting files',
              type: 'working',
              timestamp: new Date(NOW_MS - 2 * 60_000),
            },
          ],
        }),
      ],
      [
        'ses_running_a',
        makeNode({
          id: 'ses_running_a',
          title: 'Alpha running',
          openCodeParentId: 'ses_parent',
          sessionStatuses: [
            {
              status: 'Reviewing patch',
              type: 'working',
              timestamp: new Date(NOW_MS - 60_000),
            },
          ],
        }),
      ],
      [
        'ses_stalled',
        makeNode({
          id: 'ses_stalled',
          title: 'Zeta stalled',
          openCodeParentId: 'ses_parent',
          sessionStatuses: [
            {
              status: 'Waiting on long task',
              type: 'working',
              timestamp: new Date(NOW_MS - 12 * 60_000),
            },
          ],
        }),
      ],
    ]);

    expect(
      deriveBackgroundSubagents(nodes, 'ses_parent', NOW_MS).map(
        (subagent) => subagent.id,
      ),
    ).toEqual(['ses_stalled', 'ses_running_a', 'ses_running_b', 'ses_ended']);
  });

  it('derives inspector display fields from status and prompt metadata', () => {
    const nodes = new Map<string, SessionNode>([
      ['ses_parent', makeNode({ id: 'ses_parent', title: 'Parent' })],
      [
        'ses_child',
        makeNode({
          id: 'ses_child',
          title: 'Background child',
          openCodeParentId: 'ses_parent',
          createdAt: NOW_MS - 20 * 60_000,
          prompt: {
            id: 'prompt-1',
            message: 'Continue',
            projectName: 'Repo',
            connectionName: 'Agent',
            timeoutSeconds: 60,
            expiresAt: 0,
            clientInfo: { model: 'gpt-5.5', mode: 'high' },
          },
          sessionStatuses: [
            {
              status: 'Analyzing repository',
              type: 'working',
              timestamp: new Date(NOW_MS - 11 * 60_000),
            },
          ],
        }),
      ],
    ]);

    expect(deriveBackgroundSubagents(nodes, 'ses_parent', NOW_MS)[0]).toEqual(
      expect.objectContaining({
        model: 'gpt-5.5',
        variant: 'high',
        isStalled: true,
        lastStatus: 'Analyzing repository',
        lastStatusAt: NOW_MS - 11 * 60_000,
        activityAt: NOW_MS - 11 * 60_000,
        statusLabel: 'Stalled',
        statusSummary: 'Stalled for 11m',
      }),
    );
  });

  it('falls back to stable titles when a child session has no display title', () => {
    const nodes = new Map<string, SessionNode>([
      ['ses_parent', makeNode({ id: 'ses_parent', title: 'Parent' })],
      [
        'ses_channel_label',
        makeNode({
          id: 'ses_channel_label',
          title: '   ',
          openCodeParentId: 'ses_parent',
          sessionChannel: {
            sessionId: 'ses_channel_label',
            label: ' Indexer ',
          },
        }),
      ],
      [
        'ses_missing_title',
        makeNode({
          id: 'ses_missing_title',
          title: '',
          openCodeParentId: 'ses_parent',
        }),
      ],
    ]);

    expect(
      deriveBackgroundSubagents(nodes, 'ses_parent', NOW_MS).map(
        (subagent) => subagent.title,
      ),
    ).toEqual(['Background Agent (ses_missing_title)', 'Indexer']);
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

  it('summarizes subagents for inspector tab badge display', () => {
    const subagents = [
      {
        id: 'ses_stalled',
        title: 'Stalled',
        status: 'running' as const,
        depth: 1,
        model: null,
        variant: null,
        isStalled: true,
      },
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
    ];

    expect(summarizeBackgroundSubagents(subagents)).toEqual({
      total: 3,
      running: 2,
      stalled: 1,
      ended: 1,
    });
    expect(getBackgroundSubagentTabCount(subagents)).toBe(3);
    expect(getBackgroundSubagentTabBadge(subagents)).toEqual({
      count: 3,
      label: '3',
      tone: 'attention',
      title: '3 background subagents, 2 running, 1 stalled',
    });
    expect(
      getBackgroundSubagentTabBadge([
        {
          id: 'ses_ended_1',
          title: 'Ended 1',
          status: 'ended' as const,
          depth: 1,
          model: null,
          variant: null,
          isStalled: false,
        },
        {
          id: 'ses_ended_2',
          title: 'Ended 2',
          status: 'ended' as const,
          depth: 1,
          model: null,
          variant: null,
          isStalled: false,
        },
      ]),
    ).toEqual({
      count: 2,
      label: '2',
      tone: 'neutral',
      title: '2 background subagents, 2 ended',
    });
    expect(getBackgroundSubagentTabBadge([])).toBeNull();
  });
});
