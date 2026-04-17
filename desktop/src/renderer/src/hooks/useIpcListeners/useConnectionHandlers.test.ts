import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HandlerContext } from './types';
import { useConnectionHandlers } from './useConnectionHandlers';

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

describe('useConnectionHandlers', () => {
  let onChannelLabelUpdated:
    | ((data: {
        connectionId: string;
        name: string;
        providerSessionId?: string | null;
      }) => void)
    | undefined;

  beforeEach(() => {
    onChannelLabelUpdated = undefined;
    (globalThis as { window?: unknown }).window = {
      api: {
        onConnectionOpened: vi.fn(),
        onConnectionClosed: vi.fn(),
        onChannelLabelUpdated: (
          cb: (data: {
            connectionId: string;
            name: string;
            providerSessionId?: string | null;
          }) => void,
        ) => {
          onChannelLabelUpdated = cb;
        },
      },
    };
  });

  it('rehydrates active prompts after a connection opens', async () => {
    let onConnectionOpened:
      | ((data: {
          connectionId: string;
          name: string;
          sessionId?: string | null;
          label?: string | null;
          providerType?: string | null;
        }) => void)
      | undefined;

    (globalThis as { window?: unknown }).window = {
      api: {
        onConnectionOpened: (
          cb: (data: {
            connectionId: string;
            name: string;
            sessionId?: string | null;
            label?: string | null;
            providerType?: string | null;
          }) => void,
        ) => {
          onConnectionOpened = cb;
        },
        onConnectionClosed: vi.fn(),
        onChannelLabelUpdated: vi.fn(),
      },
    };

    const context = makeContext();
    useConnectionHandlers(context);

    onConnectionOpened?.({
      connectionId: 'conn-new',
      name: 'Agent',
      sessionId: null,
      label: null,
      providerType: 'opencode',
    });

    await Promise.resolve();

    expect(context.rehydrateActivePrompts).toHaveBeenCalledTimes(1);
  });

  it('updates channel title by providerSessionId when provided', () => {
    let nodes = new Map([
      [
        'ses_child',
        {
          id: 'ses_child',
          providerSessionId: 'ses_child',
          openCodeParentId: null,
          title: 'Old Child Name',
          directory: '/repo',
          depth: 0,
          connectionId: 'conn-shared',
          hasMcpChannel: true,
          isDirectConnection: false,
          providerType: 'opencode',
          prompt: null,
          activeSession: null,
          baseDirectory: '/repo',
          channelMessages: [],
          unreadCount: 0,
          lastReadMessageId: null,
          hasPendingPrompt: false,
          sessionChannel: { sessionId: 'ses_child', label: 'Old Child Name' },
          sessionStatuses: [],
          pendingPermissions: [],
          vcsInfo: null,
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

    useConnectionHandlers(context);
    onChannelLabelUpdated?.({
      connectionId: 'conn-shared',
      name: 'New Child Name',
      providerSessionId: 'ses_child',
    });

    expect(nodes.get('ses_child')?.title).toBe('New Child Name');
    expect(nodes.get('ses_child')?.sessionChannel?.label).toBe(
      'New Child Name',
    );
  });
});
