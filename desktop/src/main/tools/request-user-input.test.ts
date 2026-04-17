import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerRequestUserInput } from './request-user-input';

vi.mock('./connection-guard', () => ({
  staleSessionError: vi.fn().mockReturnValue(null),
  requireProviderSessionId: vi.fn().mockReturnValue(null),
}));

vi.mock('../ipc-prompt', () => ({
  getPromptTimeoutSeconds: vi.fn().mockReturnValue(120),
  promptUser: vi.fn(),
}));

import {
  staleSessionError,
  requireProviderSessionId,
} from './connection-guard';

type ToolInput = {
  projectName: string;
  message: string;
  predefinedOptions?: string[];
  baseDirectory: string;
  openCodeSessionId?: string;
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
  const mockStaleError = staleSessionError as Mock;
  const mockRequireProviderSessionId = requireProviderSessionId as Mock;

  beforeEach(() => {
    mockStaleError.mockReset();
    mockRequireProviderSessionId.mockReset();
    mockStaleError.mockReturnValue(null);
    mockRequireProviderSessionId.mockReturnValue(null);
  });

  it('returns MISSING_SESSION_ID error when requireProviderSessionId returns an error', async () => {
    const expectedError = {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            error: 'MISSING_SESSION_ID',
            message: 'Missing session ID',
            action: 'Call register_connection with openCodeSessionId',
          }),
        },
      ],
    };
    mockRequireProviderSessionId.mockReturnValue(expectedError);

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
    expect(mockRequireProviderSessionId).toHaveBeenCalled();
  });

  it('checks staleSessionError before requireProviderSessionId', async () => {
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
        openCodeSessionId: 'ses_stale',
      },
      { signal: mockSignal },
    );

    // staleSessionError should short-circuit before requireProviderSessionId
    expect(result).toBe(staleErr);
  });

  it('proceeds normally when requireProviderSessionId returns null (openCodeSessionId present)', async () => {
    mockRequireProviderSessionId.mockReturnValue(null);

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
        openCodeSessionId: 'ses_ok',
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
    mockRequireProviderSessionId.mockReturnValue(null);

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
    expect(mockRequireProviderSessionId).toHaveBeenCalled();
  });

  describe('image attachment handling', () => {
    it('emits image attachments as text "[Image file: <abs-path>]" instead of inline base64', async () => {
      mockRequireProviderSessionId.mockReturnValue(null);

      // 1×1 transparent PNG
      const tinyPngBase64 =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

      const promptFn = vi.fn().mockResolvedValue({
        answer: 'See image',
        attachments: [
          {
            data: tinyPngBase64,
            mimeType: 'image/png',
            name: 'screenshot.png',
            size: 70,
          },
        ],
      });

      const handler = getToolHandler('conn-img', promptFn, false);
      const result = await handler(
        {
          projectName: 'proj',
          message: 'Screenshot?',
          baseDirectory: '/repo',
        },
        { signal: mockSignal },
      );

      // No base64 image content part should be emitted.
      const imageParts = result.content.filter((p) => p.type === 'image');
      expect(imageParts).toHaveLength(0);

      // Exactly one "[Image file: …]" text part, pointing at an absolute path
      // inside the attachments directory, with a .png extension.
      const imageTextParts = result.content.filter(
        (p) =>
          p.type === 'text' &&
          typeof p.text === 'string' &&
          p.text.startsWith('[Image file: '),
      );
      expect(imageTextParts).toHaveLength(1);
      const text = imageTextParts[0].text as string;
      expect(text).toMatch(/^\[Image file: \/.+\.png\]$/);
    });

    it('still inlines non-image text attachments as "--- File: … ---"', async () => {
      mockRequireProviderSessionId.mockReturnValue(null);

      const promptFn = vi.fn().mockResolvedValue({
        answer: 'See file',
        attachments: [
          {
            data: 'hello world',
            mimeType: 'text/plain',
            name: 'notes.txt',
            size: 11,
          },
        ],
      });

      const handler = getToolHandler('conn-txt', promptFn, false);
      const result = await handler(
        {
          projectName: 'proj',
          message: 'File?',
          baseDirectory: '/repo',
        },
        { signal: mockSignal },
      );

      const fileText = result.content.find(
        (p) => p.type === 'text' && p.text?.startsWith('--- File: notes.txt'),
      );
      expect(fileText).toBeTruthy();
      expect(fileText?.text).toContain('hello world');
    });
  });
});
