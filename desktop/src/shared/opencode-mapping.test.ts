import { describe, expect, it } from 'vitest';
import type {
  AssistantMessage,
  TextPart,
  ToolPart,
} from '@opencode-ai/sdk/v2/client';
import { mapMessage, mapPart } from './opencode-mapping';

describe('opencode-mapping', () => {
  it('preserves completed tool attachments in metadata', () => {
    const part: ToolPart = {
      id: 'part_1',
      sessionID: 'ses_1',
      messageID: 'msg_1',
      type: 'tool',
      callID: 'call_1',
      tool: 'bash',
      state: {
        status: 'completed',
        input: { command: 'npm test' },
        output: 'ok',
        title: 'Run tests',
        metadata: { exitCode: 0 },
        time: { start: 1, end: 2 },
        attachments: [
          {
            id: 'file_1',
            sessionID: 'ses_1',
            messageID: 'msg_1',
            type: 'file',
            mime: 'text/plain',
            filename: 'output.txt',
            url: 'file:///tmp/output.txt',
          },
        ],
      },
    };

    expect(mapPart(part)?.toolMetadata).toEqual({
      exitCode: 0,
      attachments: part.state.attachments,
    });
    expect(mapPart(part)?.toolTitle).toBe('Run tests');
  });

  it('preserves text visibility flags', () => {
    const part: TextPart = {
      id: 'part_text',
      sessionID: 'ses_1',
      messageID: 'msg_1',
      type: 'text',
      text: 'hidden context',
      synthetic: true,
      ignored: true,
    };

    expect(mapPart(part)).toMatchObject({
      type: 'text',
      synthetic: true,
      ignored: true,
    });
  });

  it('preserves assistant cost, tokens, finish, error, and path root', () => {
    const message: AssistantMessage = {
      id: 'msg_1',
      sessionID: 'ses_1',
      role: 'assistant',
      time: { created: 10, completed: 25 },
      error: {
        name: 'UnknownError',
        data: { message: 'Something failed' },
      },
      parentID: 'user_1',
      modelID: 'gpt-5.5',
      providerID: 'github-copilot',
      mode: 'build',
      agent: 'build',
      path: { cwd: '/repo/app', root: '/repo' },
      cost: 0.0123,
      tokens: {
        input: 1,
        output: 2,
        reasoning: 3,
        cache: { read: 4, write: 5 },
      },
      finish: 'stop',
    };

    expect(mapMessage(message)).toMatchObject({
      cost: 0.0123,
      tokens: message.tokens,
      finish: 'stop',
      error: 'Something failed',
      errorName: 'UnknownError',
      path: { cwd: '/repo/app', root: '/repo' },
    });
  });
});
