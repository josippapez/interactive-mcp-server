import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock dependencies ────────────────────────────────────────────────────────

vi.mock('../database', () => ({
  getRegisteredConnection: vi.fn(),
  appendSessionChannelMessage: vi.fn(),
}));

vi.mock('../session/resolver', () => ({
  resolveOpenCodeSessionId: vi.fn(),
}));

vi.mock('../ipc/channel', () => ({
  sendSessionStatus: vi.fn(),
  sendAgentMessage: vi.fn(),
}));

vi.mock('./connection-guard', () => ({
  staleConnectionError: vi.fn(() => null),
  missingSessionIdError: vi.fn(() => null),
  missingSessionIdParamError: vi.fn(() => null),
}));

import {
  appendSessionChannelMessage,
  getRegisteredConnection,
} from '../database';
import { resolveOpenCodeSessionId } from '../session/resolver';

// ─────────────────────────────────────────────────────────────────────────────
// Bug #1: send_message persists history using connectionId instead of resolved
// openCodeSessionId. When parent and subagent share the same connectionId,
// subagent messages are persisted under the parent's channel.
// ─────────────────────────────────────────────────────────────────────────────

describe('send_message — session ID routing for persistence', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getRegisteredConnection).mockReturnValue({
      providerType: 'opencode' as const,
      providerSessionId: 'ses_subagent',
      openCodeSessionId: 'ses_subagent',
      connectionId: 'shared-conn-uuid',
      channelName: 'Subagent',
      projectName: 'test',
      baseDirectory: null,
      idFilePath: '/tmp/test.json',
      parentSessionId: 'ses_parent',
      createdAt: '2025-01-01',
      updatedAt: '2025-01-01',
    });
  });

  it('persists message history under resolved openCodeSessionId, not connectionId', async () => {
    // ARRANGE: resolveOpenCodeSessionId returns the subagent's session ID
    vi.mocked(resolveOpenCodeSessionId).mockReturnValue('ses_subagent');

    // We need to import and call the actual tool handler.
    // Since registerSendMessageTool registers on an McpServer, we test the
    // internal logic by importing the module and checking the
    // appendSessionChannelMessage call.
    //
    // The tool calls appendSessionChannelMessage with { sessionId: connectionId }
    // which is the BUG — it should use resolveOpenCodeSessionId result instead.

    const { registerSendMessageTool } = await import('./session-channel');

    // Create a minimal McpServer mock
    let toolHandler: (args: Record<string, unknown>) => Promise<unknown>;
    const mockServer = {
      registerTool: vi.fn(
        (
          _name: string,
          _opts: unknown,
          handler: (args: Record<string, unknown>) => Promise<unknown>,
        ) => {
          toolHandler = handler;
        },
      ),
    };

    const mockWindow = {
      isDestroyed: vi.fn(() => false),
      show: vi.fn(),
      focus: vi.fn(),
      webContents: { send: vi.fn() },
    };

    registerSendMessageTool(
      mockServer as never,
      () => mockWindow as never,
      'shared-conn-uuid', // connectionId shared by parent + subagent
      false,
    );

    // ACT: call the tool handler with openCodeSessionId
    await toolHandler!({
      message: 'Build completed.',
      openCodeSessionId: 'ses_subagent',
    });

    // ASSERT: appendSessionChannelMessage should be called with the resolved
    // session ID ('ses_subagent'), NOT the connectionId ('shared-conn-uuid').
    expect(appendSessionChannelMessage).toHaveBeenCalledWith({
      sessionId: 'ses_subagent',
      messageType: 'agent_message',
      messageText: 'Build completed.',
    });

    // Verify it was NOT called with the raw connectionId
    expect(appendSessionChannelMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'shared-conn-uuid' }),
    );
  });

  it('falls back to connectionId when openCodeSessionId is not provided and resolver returns null', async () => {
    // ARRANGE: no openCodeSessionId passed, resolver returns null
    vi.mocked(resolveOpenCodeSessionId).mockReturnValue(null);

    const { registerSendMessageTool } = await import('./session-channel');

    let toolHandler: (args: Record<string, unknown>) => Promise<unknown>;
    const mockServer = {
      registerTool: vi.fn(
        (
          _name: string,
          _opts: unknown,
          handler: (args: Record<string, unknown>) => Promise<unknown>,
        ) => {
          toolHandler = handler;
        },
      ),
    };

    const mockWindow = {
      isDestroyed: vi.fn(() => false),
      show: vi.fn(),
      focus: vi.fn(),
      webContents: { send: vi.fn() },
    };

    registerSendMessageTool(
      mockServer as never,
      () => mockWindow as never,
      'standalone-conn-uuid',
      false,
    );

    // ACT
    await toolHandler!({ message: 'Hello standalone' });

    // ASSERT: falls back to connectionId when resolver returns null
    expect(appendSessionChannelMessage).toHaveBeenCalledWith({
      sessionId: 'standalone-conn-uuid',
      messageType: 'agent_message',
      messageText: 'Hello standalone',
    });
  });
});
