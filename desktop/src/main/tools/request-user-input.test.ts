import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerRequestUserInput } from './request-user-input';

vi.mock('./connection-guard', () => ({
  staleConnectionError: vi.fn().mockReturnValue(null),
  missingSessionIdError: vi.fn().mockReturnValue(null),
  missingSessionIdParamError: vi.fn().mockReturnValue(null),
}));

vi.mock('../ipc-prompt', () => ({
  getPromptTimeoutSeconds: vi.fn().mockReturnValue(120),
  promptUser: vi.fn(),
}));

import {
  staleConnectionError,
  missingSessionIdError,
  missingSessionIdParamError,
} from './connection-guard';

type ToolInput = {
  projectName: string;
  message: string;
  predefinedOptions?: string[];
  baseDirectory: string;
};

type ToolResult = {
  isError?: boolean;
  content: Array<{ type: string; text?: string }>;
};

type ToolHandler = (
  input: ToolInput,
  extra: { signal: AbortSignal },
) => Promise<ToolResult>;

function getToolHandler(
  connectionId = 'conn-test',
  promptFn: Mock = vi.fn(),
  requireSessionId = false,
): ToolHandler {
  const server = {
    registerTool: vi.fn(),
  } as unknown as McpServer;

  registerRequestUserInput(
    server,
    () => null,
    promptFn as never,
    connectionId,
    'Test Channel',
    requireSessionId,
  );

  const toolCall = (server.registerTool as Mock).mock.calls[0];
  return toolCall[2] as ToolHandler;
}

const mockSignal = {} as AbortSignal;

describe('request_user_input tool', () => {
  const mockStaleError = staleConnectionError as Mock;
  const mockMissingSessionError = missingSessionIdError as Mock;

  beforeEach(() => {
    mockStaleError.mockReset();
    mockMissingSessionError.mockReset();
    mockStaleError.mockReturnValue(null);
    mockMissingSessionError.mockReturnValue(null);
  });

  it('returns MISSING_SESSION_ID error when missingSessionIdError returns an error', async () => {
    const expectedError = {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            error: 'MISSING_SESSION_ID',
            message: 'Missing session ID',
            action: 'Call register_connection with openCodeSessionId',
            connectionId: 'conn-no-session',
          }),
        },
      ],
    };
    mockMissingSessionError.mockReturnValue(expectedError);

    const handler = getToolHandler('conn-no-session', vi.fn(), true);
    const result = await handler(
      {
        projectName: 'proj',
        message: 'Test question?',
        baseDirectory: '/repo',
      },
      { signal: mockSignal },
    );

    expect(result).toBe(expectedError);
    expect(mockMissingSessionError).toHaveBeenCalledWith(
      'conn-no-session',
      true,
    );
  });

  it('checks staleConnectionError before missingSessionIdError', async () => {
    const staleErr = {
      isError: true,
      content: [{ type: 'text' as const, text: '{"error":"SESSION_REMOVED"}' }],
    };
    mockStaleError.mockReturnValue(staleErr);

    const handler = getToolHandler('conn-stale', vi.fn(), true);
    const result = await handler(
      {
        projectName: 'proj',
        message: 'Test?',
        baseDirectory: '/repo',
      },
      { signal: mockSignal },
    );

    // staleConnectionError should short-circuit before missingSessionIdError
    expect(result).toBe(staleErr);
  });

  it('proceeds normally when missingSessionIdError returns null (openCodeSessionId present)', async () => {
    mockMissingSessionError.mockReturnValue(null);

    const promptFn = vi.fn().mockResolvedValue({
      answer: 'User said yes',
      attachments: [],
    });

    const handler = getToolHandler('conn-ok', promptFn, true);
    const result = await handler(
      {
        projectName: 'proj',
        message: 'Test question?',
        baseDirectory: '/repo',
      },
      { signal: mockSignal },
    );

    expect(result.isError).toBeFalsy();
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: 'User replied: User said yes',
    });
  });

  it('proceeds normally when requireSessionId is false (standalone mode)', async () => {
    mockMissingSessionError.mockReturnValue(null);

    const promptFn = vi.fn().mockResolvedValue({
      answer: 'Hello',
      attachments: [],
    });

    const handler = getToolHandler('conn-standalone', promptFn, false);
    const result = await handler(
      {
        projectName: 'proj',
        message: 'Question?',
        baseDirectory: '/repo',
      },
      { signal: mockSignal },
    );

    expect(result.isError).toBeFalsy();
    expect(mockMissingSessionError).toHaveBeenCalledWith(
      'conn-standalone',
      false,
    );
  });
});
