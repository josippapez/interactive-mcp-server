import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerIntensiveChatTools } from './intensive-chat';

vi.mock('./connection-guard', () => ({
  staleSessionError: vi.fn().mockReturnValue(null),
  requireProviderSessionId: vi.fn().mockReturnValue(null),
}));

vi.mock('../ipc/prompt', () => ({
  getPromptTimeoutSeconds: vi.fn().mockReturnValue(120),
}));

vi.mock('../session/resolver', () => ({
  resolveProviderSessionId: vi.fn((_cid: string, sid?: string) => sid ?? null),
}));

vi.mock('../ipc/channel', () => ({
  sendIntensiveChatStart: vi.fn(),
  sendIntensiveChatStop: vi.fn(),
}));

type ToolInput = Record<string, unknown>;
type ToolResult = {
  isError?: boolean;
  content: Array<{ type: string; text?: string; data?: string }>;
};
type ToolHandler = (
  input: ToolInput,
  extra: { signal: AbortSignal },
) => Promise<ToolResult>;

interface RegisteredTool {
  name: string;
  handler: ToolHandler;
}

function registerAndCollect(promptFn: Mock): Record<string, ToolHandler> {
  const registered: RegisteredTool[] = [];
  const server = {
    registerTool: vi.fn(
      (name: string, _schema: unknown, handler: ToolHandler) => {
        registered.push({ name, handler });
      },
    ),
  } as unknown as McpServer;

  registerIntensiveChatTools(
    server,
    () => null,
    promptFn as never,
    'conn-test',
    'Test Channel',
    false,
  );

  const map: Record<string, ToolHandler> = {};
  for (const t of registered) map[t.name] = t.handler;
  return map;
}

const mockSignal = {} as AbortSignal;

async function startSession(
  handlers: Record<string, ToolHandler>,
): Promise<string> {
  const result = await handlers['start_intensive_chat'](
    { sessionTitle: 'Test', baseDirectory: '/repo' },
    { signal: mockSignal },
  );
  const text = result.content.find((p) => p.type === 'text')?.text ?? '';
  const match = text.match(/session id:\s*([a-f0-9-]+)/i);
  if (!match) throw new Error(`Could not parse session id from: ${text}`);
  return match[1];
}

describe('ask_intensive_chat tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('image attachment handling', () => {
    it('emits image attachments as text "[Image file: <abs-path>]" instead of inline base64', async () => {
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

      const handlers = registerAndCollect(promptFn);
      const sessionId = await startSession(handlers);

      const result = await handlers['ask_intensive_chat'](
        { sessionId, question: 'Screenshot?' },
        { signal: mockSignal },
      );

      const imageParts = result.content.filter((p) => p.type === 'image');
      expect(imageParts).toHaveLength(0);

      const imageTextParts = result.content.filter(
        (p) =>
          p.type === 'text' &&
          typeof p.text === 'string' &&
          p.text.startsWith('[Image file: '),
      );
      expect(imageTextParts).toHaveLength(1);
      expect(imageTextParts[0].text).toMatch(/^\[Image file: \/.+\.png\]$/);
    });

    it('still inlines non-image text attachments', async () => {
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

      const handlers = registerAndCollect(promptFn);
      const sessionId = await startSession(handlers);

      const result = await handlers['ask_intensive_chat'](
        { sessionId, question: 'File?' },
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
