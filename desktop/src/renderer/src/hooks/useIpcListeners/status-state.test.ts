import { describe, expect, it } from 'vitest';
import type { SessionNode } from '../../types';
import {
  MAX_SESSION_STATUSES,
  clearTerminalSessionState,
  trimSessionStatuses,
} from './status-state';

function makeNode(overrides: Partial<SessionNode> = {}): SessionNode {
  return {
    id: overrides.id ?? 'ses_existing',
    providerSessionId: overrides.providerSessionId ?? 'ses_existing',
    openCodeParentId: overrides.openCodeParentId ?? null,
    title: overrides.title ?? 'Existing Session',
    directory: overrides.directory ?? '/tmp/project',
    createdAt: overrides.createdAt ?? 1,
    depth: overrides.depth ?? 0,
    connectionId: overrides.connectionId ?? null,
    hasMcpChannel: overrides.hasMcpChannel ?? true,
    isDirectConnection: overrides.isDirectConnection ?? false,
    providerType: overrides.providerType ?? 'opencode',
    prompt: overrides.prompt ?? null,
    activeSession: overrides.activeSession ?? null,
    baseDirectory: overrides.baseDirectory ?? '/tmp/project',
    channelMessages: overrides.channelMessages ?? [],
    unreadCount: overrides.unreadCount ?? 0,
    lastReadMessageId: overrides.lastReadMessageId ?? null,
    hasPendingPrompt: overrides.hasPendingPrompt ?? false,
    sessionChannel: overrides.sessionChannel ?? {
      sessionId: overrides.id ?? 'ses_existing',
    },
    sessionStatuses: overrides.sessionStatuses ?? [],
    pendingPermissions: overrides.pendingPermissions ?? [],
    pendingQuestions: overrides.pendingQuestions ?? [],
    vcsInfo: overrides.vcsInfo ?? null,
    docContextEnabled: overrides.docContextEnabled,
  };
}

describe('clearTerminalSessionState', () => {
  it('keeps the newest session statuses when trimming past the cap', () => {
    const statuses = Array.from(
      { length: MAX_SESSION_STATUSES + 1 },
      (_, index) => ({
        status: `status ${index}`,
        type: 'info' as const,
        timestamp: new Date(index),
      }),
    );

    const trimmed = trimSessionStatuses(statuses);

    expect(trimmed).toHaveLength(MAX_SESSION_STATUSES);
    expect(trimmed[0]?.status).toBe('status 1');
    expect(trimmed.at(-1)?.status).toBe(`status ${MAX_SESSION_STATUSES}`);
  });

  it('clears working statuses and stale pending questions when a session becomes terminal', () => {
    const prev = new Map<string, SessionNode>([
      [
        'ses_existing',
        makeNode({
          hasPendingPrompt: true,
          sessionStatuses: [
            {
              status: 'Session active',
              type: 'working',
              timestamp: new Date(),
            },
          ],
          pendingQuestions: [
            {
              requestId: 'que_stale',
              sessionID: 'ses_existing',
              questions: [
                { question: 'Continue?', header: 'Confirm', options: [] },
              ],
            },
          ],
        }),
      ],
    ]);

    const next = clearTerminalSessionState(prev, 'ses_existing');

    expect(next).not.toBe(prev);
    expect(next.get('ses_existing')?.sessionStatuses).toEqual([]);
    expect(next.get('ses_existing')?.pendingQuestions).toEqual([]);
    expect(next.get('ses_existing')?.hasPendingPrompt).toBe(false);
  });

  it('keeps pending prompt state when only question state is cleared', () => {
    const prev = new Map<string, SessionNode>([
      [
        'ses_existing',
        makeNode({
          prompt: {
            id: 'prompt_1',
            message: 'Legacy MCP prompt',
            projectName: 'Project',
            connectionName: 'Agent',
            timeoutSeconds: 120,
            expiresAt: 0,
          },
          hasPendingPrompt: true,
          pendingQuestions: [
            {
              requestId: 'que_stale',
              sessionID: 'ses_existing',
              questions: [
                { question: 'Continue?', header: 'Confirm', options: [] },
              ],
            },
          ],
        }),
      ],
    ]);

    const next = clearTerminalSessionState(prev, 'ses_existing');

    expect(next.get('ses_existing')?.pendingQuestions).toEqual([]);
    expect(next.get('ses_existing')?.hasPendingPrompt).toBe(true);
  });
});
