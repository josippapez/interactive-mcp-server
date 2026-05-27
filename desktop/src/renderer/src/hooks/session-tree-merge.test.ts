import { describe, expect, it } from 'vitest';
import type { SessionNode } from '../types';
import {
  groupByProject,
  mergeSessionTreeSnapshot,
  toPinnedProjectOptions,
  type SnapshotNode,
} from './session-tree-merge';

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

function makeSnapshotNode(overrides: Partial<SnapshotNode> = {}): SnapshotNode {
  return {
    providerSessionId: overrides.providerSessionId ?? 'ses_live',
    openCodeParentId: overrides.openCodeParentId ?? null,
    title: overrides.title ?? 'Live Session',
    directory: overrides.directory ?? '/tmp/project',
    createdAt: overrides.createdAt ?? 2,
    updatedAt: overrides.updatedAt ?? 3,
    depth: overrides.depth ?? 0,
    connectionId: overrides.connectionId ?? 'conn_live',
    channelName: overrides.channelName ?? 'Live Session',
    hasMcpChannel: overrides.hasMcpChannel ?? true,
    baseDirectory: overrides.baseDirectory ?? '/tmp/project',
    registeredParentSessionId: overrides.registeredParentSessionId ?? null,
    providerType: overrides.providerType ?? 'opencode',
    vcsInfo: overrides.vcsInfo ?? null,
  };
}

describe('mergeSessionTreeSnapshot', () => {
  it('drops stale OpenCode nodes missing from the limited live snapshot', () => {
    const prev = new Map<string, SessionNode>([
      [
        'ses_inactive',
        makeNode({
          id: 'ses_inactive',
          providerSessionId: 'ses_inactive',
          title: 'Inactive Session',
          connectionId: null,
        }),
      ],
      [
        'direct_agent',
        makeNode({
          id: 'direct_agent',
          providerSessionId: 'direct_agent',
          title: 'Direct Agent',
          connectionId: 'direct_agent',
          isDirectConnection: true,
        }),
      ],
      [
        'ses_live',
        makeNode({
          id: 'ses_live',
          providerSessionId: 'ses_live',
          title: 'Old Live Title',
          connectionId: 'conn_live',
        }),
      ],
    ]);

    const next = mergeSessionTreeSnapshot(prev, [
      makeSnapshotNode({
        providerSessionId: 'ses_live',
        title: 'Live Session',
      }),
    ]);

    expect(next.has('ses_inactive')).toBe(false);
    expect(next.has('direct_agent')).toBe(true);
    expect(next.get('ses_live')?.title).toBe('Live Session');
  });
});

describe('groupByProject', () => {
  it('sorts pinned projects first, then unpinned projects by latest session creation date', () => {
    const nodes = new Map<string, SessionNode>([
      [
        'older_pinned',
        makeNode({
          id: 'older_pinned',
          providerSessionId: 'older_pinned',
          baseDirectory: '/tmp/pinned-project',
          directory: '/tmp/pinned-project',
          createdAt: 10,
        }),
      ],
      [
        'newest_unpinned',
        makeNode({
          id: 'newest_unpinned',
          providerSessionId: 'newest_unpinned',
          baseDirectory: '/tmp/newest-project',
          directory: '/tmp/newest-project',
          createdAt: 30,
        }),
      ],
      [
        'older_unpinned',
        makeNode({
          id: 'older_unpinned',
          providerSessionId: 'older_unpinned',
          baseDirectory: '/tmp/older-project',
          directory: '/tmp/older-project',
          createdAt: 20,
        }),
      ],
      [
        'newer_pinned',
        makeNode({
          id: 'newer_pinned',
          providerSessionId: 'newer_pinned',
          baseDirectory: '/tmp/pinned-project',
          directory: '/tmp/pinned-project',
          createdAt: 40,
        }),
      ],
    ]);

    const projects = groupByProject(nodes, ['/tmp/pinned-project']);

    expect(projects.map((project) => project.path)).toEqual([
      '/tmp/pinned-project',
      '/tmp/newest-project',
      '/tmp/older-project',
    ]);
    expect(projects[0].latestSessionCreatedAt).toBe(40);
  });

  it('skips empty/whitespace-only pinned paths so no phantom rail tile is produced', () => {
    const nodes = new Map<string, SessionNode>();

    const projects = groupByProject(nodes, ['', '   ', '/tmp/real-project']);

    expect(projects).toHaveLength(1);
    expect(projects[0].path).toBe('/tmp/real-project');
    expect(projects[0].name).toBe('real-project');
    expect(projects[0].isPinned).toBe(true);
  });

  it('returns empty when all pinned paths are empty and no sessions exist', () => {
    const nodes = new Map<string, SessionNode>();

    const projects = groupByProject(nodes, ['', '\t', ' ']);

    expect(projects).toEqual([]);
  });

  it('groups empty session directories as Unknown instead of rendering a blank project', () => {
    const nodes = new Map<string, SessionNode>([
      [
        'empty_path',
        makeNode({
          id: 'empty_path',
          providerSessionId: 'empty_path',
          baseDirectory: '',
          directory: '',
        }),
      ],
    ]);

    const projects = groupByProject(nodes);

    expect(projects[0].path).toBe('Unknown');
    expect(projects[0].name).toBe('Unknown');
  });

  it('attaches per-project pagination metadata', () => {
    const nodes = new Map<string, SessionNode>([
      [
        'project_session',
        makeNode({
          id: 'project_session',
          providerSessionId: 'project_session',
          baseDirectory: '/tmp/project',
          directory: '/tmp/project',
        }),
      ],
    ]);

    const projects = groupByProject(
      nodes,
      [],
      new Map([['/tmp/project', { hasMore: true }]]),
    );

    expect(projects[0].hasMoreSessions).toBe(true);
  });
});

describe('toPinnedProjectOptions', () => {
  it('includes detected session projects that are not pinned so the new-session picker matches the sidebar', () => {
    const projects = groupByProject(
      new Map<string, SessionNode>([
        [
          'session_project',
          makeNode({
            id: 'session_project',
            providerSessionId: 'session_project',
            baseDirectory: '/tmp/session-project',
            directory: '/tmp/session-project',
          }),
        ],
      ]),
      ['/tmp/pinned-project'],
    );

    expect(toPinnedProjectOptions(projects)).toEqual([
      { path: '/tmp/pinned-project', name: 'pinned-project' },
      { path: '/tmp/session-project', name: 'session-project' },
    ]);
  });
});
