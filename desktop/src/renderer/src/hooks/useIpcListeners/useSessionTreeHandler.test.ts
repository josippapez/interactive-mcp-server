import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SnapshotNode } from '../session-tree-merge';
import { useSessionTreeHandler } from './useSessionTreeHandler';
import type { HandlerContext } from './types';

function makeSnapshotNode(overrides: Partial<SnapshotNode> = {}): SnapshotNode {
  return {
    openCodeSessionId: 'ses_new',
    openCodeParentId: null,
    title: 'OpenCode Session',
    directory: '/repo',
    depth: 0,
    connectionId: 'conn-new',
    channelName: 'Agent X',
    hasMcpChannel: true,
    baseDirectory: '/repo',
    registeredParentSessionId: null,
    providerType: 'opencode',
    vcsInfo: null,
    ...overrides,
  };
}

function makeContext(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    getActiveConnectionId: () => null,
    activateRef: { current: vi.fn() },
    setNodes: vi.fn(),
    selectChannel: vi.fn(),
    setClientInfo: vi.fn(),
    withNode: vi.fn(),
    clearAllNodes: vi.fn(),
    loadChannelHistory: vi.fn(async () => {}),
    applyStartupHistoryBuffer: vi.fn(),
    applyStartupPromptBuffer: vi.fn(),
    rehydrateActivePrompts: vi.fn(async () => {}),
    loadedHistoryIds: { current: new Set<string>() },
    appendMessage: vi.fn(),
    ...overrides,
  };
}

describe('useSessionTreeHandler', () => {
  let onSessionTreeUpdated:
    | ((snapshotNodes: SnapshotNode[]) => void)
    | undefined;
  let onOptimisticSessionNodeCreated:
    | ((snapshotNode: SnapshotNode) => void)
    | undefined;

  beforeEach(() => {
    onSessionTreeUpdated = undefined;
    onOptimisticSessionNodeCreated = undefined;
    (globalThis as { window?: unknown }).window = {
      api: {
        onOptimisticSessionNodeCreated: (
          cb: (snapshotNode: SnapshotNode) => void,
        ) => {
          onOptimisticSessionNodeCreated = cb;
        },
        onSessionTreeUpdated: (cb: (snapshotNodes: SnapshotNode[]) => void) => {
          onSessionTreeUpdated = cb;
        },
      },
    };
  });

  it('auto-selects newly created MCP-bound session from session-tree snapshot', () => {
    let nodes = new Map();
    const context = makeContext({
      setNodes: vi.fn(
        (updater: (prev: Map<string, never>) => Map<string, never>) => {
          nodes = updater(nodes);
        },
      ),
    });

    useSessionTreeHandler(context);
    onSessionTreeUpdated?.([makeSnapshotNode()]);

    expect(context.selectChannel).toHaveBeenCalledWith(
      'ses_new',
      'connection-opened',
    );
    expect(context.activateRef.current).toHaveBeenCalledTimes(1);
    expect(context.loadChannelHistory).toHaveBeenCalledWith('conn-new');
  });

  it('does not auto-select when snapshot only updates an existing session', () => {
    let nodes = new Map([
      [
        'ses_existing',
        {
          id: 'ses_existing',
          openCodeSessionId: 'ses_existing',
          openCodeParentId: null,
          title: 'Existing',
          directory: '/repo',
          depth: 0,
          connectionId: 'conn-existing',
          hasMcpChannel: true,
          isDirectConnection: false,
          baseDirectory: '/repo',
          providerType: 'opencode',
          vcsInfo: null,
          sessionChannel: { sessionId: 'ses_existing', label: 'Existing' },
          prompt: null,
          activeSession: null,
          channelMessages: [],
          unreadCount: 0,
          lastReadMessageId: null,
          hasPendingPrompt: false,
          sessionStatuses: [],
          pendingPermissions: [],
        },
      ],
    ]);

    const context = makeContext({
      setNodes: vi.fn(
        (updater: (prev: Map<string, never>) => Map<string, never>) => {
          nodes = updater(nodes);
        },
      ),
    });

    useSessionTreeHandler(context);
    onSessionTreeUpdated?.([
      makeSnapshotNode({
        openCodeSessionId: 'ses_existing',
        connectionId: 'conn-existing',
        channelName: 'Existing',
      }),
    ]);

    expect(context.selectChannel).not.toHaveBeenCalled();
    expect(context.activateRef.current).not.toHaveBeenCalled();
  });

  it('does not auto-select a new session when another channel is already active', () => {
    let nodes = new Map();
    const context = makeContext({
      getActiveConnectionId: () => 'ses_active',
      setNodes: vi.fn(
        (updater: (prev: Map<string, never>) => Map<string, never>) => {
          nodes = updater(nodes);
        },
      ),
    });

    useSessionTreeHandler(context);
    onSessionTreeUpdated?.([
      makeSnapshotNode({ openCodeSessionId: 'ses_new' }),
    ]);

    expect(context.selectChannel).not.toHaveBeenCalled();
    expect(context.activateRef.current).not.toHaveBeenCalled();
  });

  it('rehydrates active prompts after session tree updates', async () => {
    let nodes = new Map();
    const context = makeContext({
      setNodes: vi.fn(
        (updater: (prev: Map<string, never>) => Map<string, never>) => {
          nodes = updater(nodes);
        },
      ),
    });

    useSessionTreeHandler(context);
    onSessionTreeUpdated?.([makeSnapshotNode()]);

    await Promise.resolve();

    expect(context.rehydrateActivePrompts).toHaveBeenCalledTimes(1);
  });

  it('upserts an optimistic child session before full snapshot reconciliation', () => {
    let nodes = new Map();
    const context = makeContext({
      setNodes: vi.fn(
        (updater: (prev: Map<string, never>) => Map<string, never>) => {
          nodes = updater(nodes);
        },
      ),
    });

    useSessionTreeHandler(context);
    onOptimisticSessionNodeCreated?.(
      makeSnapshotNode({
        openCodeSessionId: 'ses_child',
        openCodeParentId: 'ses_parent',
        connectionId: null,
        hasMcpChannel: false,
      }),
    );

    const node = nodes.get('ses_child');
    expect(node?.openCodeParentId).toBe('ses_parent');
    expect(node?.isDirectConnection).toBe(false);
    expect(node?.sessionChannel?.sessionId).toBe('ses_child');
  });
});
