/**
 * prompt-event-forwarder.test.ts — pure unit tests for frame builders.
 *
 * These tests exercise the side-effect-free `build*Frame` helpers and
 * the `forward*` public entry points with a mocked `ctx`. They must not
 * touch Electron, the database, or the filesystem.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  buildPermissionAskedFrame,
  buildPermissionRepliedFrame,
  buildQuestionAskedFrame,
  buildQuestionClearedFrame,
  forwardPermissionAsked,
  forwardPermissionReplied,
  forwardQuestionAsked,
  forwardQuestionReplied,
  type PromptForwarderContext,
} from './prompt-event-forwarder';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('../../utils/logger', () => ({
  createLogger: () => ({
    info: () => {},
    warn: () => {},
    debug: () => {},
  }),
}));

vi.mock('./permission-reply', () => ({
  replyToOpenCodePermission: vi.fn().mockResolvedValue({ ok: true }),
}));

type SendMock = ReturnType<typeof vi.fn>;

function makeCtx(overrides: Partial<PromptForwarderContext> = {}): {
  ctx: PromptForwarderContext;
  send: SendMock;
} {
  const send: SendMock = vi.fn();
  const ctx: PromptForwarderContext = {
    sendToRenderer: (channel, payload) => send(channel, payload),
    resolveConnection: () => ({ connectionId: 'conn-xyz' }),
    getAllowedPermissions: () => [],
    getAllowedReadFolders: () => [],
    getOpenCodePort: () => 4096,
    ...overrides,
  };
  return { ctx, send };
}

// ─── buildPermissionAskedFrame ───────────────────────────────────────────────

describe('buildPermissionAskedFrame', () => {
  it('includes connectionId and providerSessionId routing fields', () => {
    const frame = buildPermissionAskedFrame(
      {
        sessionID: 'ses_abc',
        id: 'req_1',
        permission: 'bash',
        patterns: ['/tmp/**'],
        always: ['*'],
        tool: { messageID: 'm1', callID: 'c1' },
        metadata: { foo: 'bar' },
      },
      'conn-1',
    );

    expect(frame).not.toBeNull();
    expect(frame).toEqual({
      connectionId: 'conn-1',
      providerSessionId: 'ses_abc',
      requestId: 'req_1',
      sessionID: 'ses_abc',
      permission: 'bash',
      patterns: ['/tmp/**'],
      always: ['*'],
      tool: { messageID: 'm1', callID: 'c1' },
      metadata: { foo: 'bar' },
      directory: undefined,
    });
  });

  it('returns null when required fields are missing', () => {
    expect(
      buildPermissionAskedFrame(
        { sessionID: 'ses_abc', id: 'req_1' }, // no permission
        'conn-1',
      ),
    ).toBeNull();
  });

  it('propagates null connectionId when no MCP transport is bound', () => {
    const frame = buildPermissionAskedFrame(
      { sessionID: 'ses_abc', id: 'req_1', permission: 'bash' },
      null,
    );
    expect(frame?.connectionId).toBeNull();
    expect(frame?.providerSessionId).toBe('ses_abc');
  });
});

// ─── buildPermissionRepliedFrame ─────────────────────────────────────────────

describe('buildPermissionRepliedFrame', () => {
  it('includes routing fields', () => {
    const frame = buildPermissionRepliedFrame(
      { sessionID: 'ses_abc', requestID: 'req_1', reply: 'once' },
      'conn-1',
    );
    expect(frame).toEqual({
      connectionId: 'conn-1',
      providerSessionId: 'ses_abc',
      sessionID: 'ses_abc',
      requestID: 'req_1',
      reply: 'once',
    });
  });
});

// ─── buildQuestionAskedFrame ─────────────────────────────────────────────────

describe('buildQuestionAskedFrame', () => {
  it('includes routing fields and questions array', () => {
    const frame = buildQuestionAskedFrame(
      {
        sessionID: 'ses_abc',
        id: 'q_1',
        questions: [
          {
            question: 'Continue?',
            header: 'Ready?',
            options: [{ label: 'Yes' }],
            multiple: false,
            custom: true,
          },
        ],
      },
      'conn-1',
    );
    expect(frame?.connectionId).toBe('conn-1');
    expect(frame?.providerSessionId).toBe('ses_abc');
    expect(frame?.questions).toHaveLength(1);
  });

  it('returns null when questions array is empty', () => {
    expect(
      buildQuestionAskedFrame(
        { sessionID: 'ses_abc', id: 'q_1', questions: [] },
        'conn-1',
      ),
    ).toBeNull();
  });
});

// ─── buildQuestionClearedFrame ───────────────────────────────────────────────

describe('buildQuestionClearedFrame', () => {
  it('carries answer for question.replied', () => {
    const frame = buildQuestionClearedFrame(
      { sessionID: 'ses_abc', requestID: 'q_1', answer: 'Yes' },
      null,
    );
    expect(frame?.answer).toBe('Yes');
    expect(frame?.rejected).toBeUndefined();
  });

  it('marks rejected=true for question.rejected', () => {
    const frame = buildQuestionClearedFrame(
      { sessionID: 'ses_abc', requestID: 'q_1', rejected: true },
      null,
    );
    expect(frame?.rejected).toBe(true);
  });
});

// ─── forwardPermissionAsked ──────────────────────────────────────────────────

describe('forwardPermissionAsked', () => {
  it('sends an IPC frame on the permission-asked channel with routing fields', async () => {
    const { ctx, send } = makeCtx();
    const approved = await forwardPermissionAsked(
      {
        sessionID: 'ses_abc',
        id: 'req_1',
        permission: 'bash',
      },
      ctx,
    );

    expect(approved).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
    const [channel, frame] = send.mock.calls[0];
    expect(channel).toBe('permission-asked');
    expect(frame).toMatchObject({
      connectionId: 'conn-xyz',
      providerSessionId: 'ses_abc',
      requestId: 'req_1',
      sessionID: 'ses_abc',
      permission: 'bash',
    });
  });

  it('auto-approves and skips IPC send when permission is in allow-list', async () => {
    const { ctx, send } = makeCtx({
      getAllowedPermissions: () => ['bash'],
    });
    const approved = await forwardPermissionAsked(
      { sessionID: 'ses_abc', id: 'req_1', permission: 'bash' },
      ctx,
    );

    expect(approved).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  it('auto-approves file-read when patterns fall inside an allowed folder', async () => {
    const { ctx, send } = makeCtx({
      getAllowedReadFolders: () => ['/Users/test/project'],
    });
    const approved = await forwardPermissionAsked(
      {
        sessionID: 'ses_abc',
        id: 'req_1',
        permission: 'read',
        patterns: ['/Users/test/project/src/file.ts'],
      },
      ctx,
    );

    expect(approved).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });
});

// ─── forwardPermissionReplied / forwardQuestionAsked / forwardQuestionReplied ─

describe('forwardPermissionReplied', () => {
  it('sends on permission-replied channel', async () => {
    const { ctx, send } = makeCtx();
    forwardPermissionReplied(
      { sessionID: 'ses_abc', requestID: 'req_1', reply: 'reject' },
      ctx,
    );
    await Promise.resolve();
    expect(send).toHaveBeenCalledWith(
      'permission-replied',
      expect.objectContaining({
        connectionId: 'conn-xyz',
        providerSessionId: 'ses_abc',
        reply: 'reject',
      }),
    );
  });
});

describe('forwardQuestionAsked', () => {
  it('sends on question-asked channel', async () => {
    const { ctx, send } = makeCtx();
    forwardQuestionAsked(
      {
        sessionID: 'ses_abc',
        id: 'q_1',
        questions: [
          {
            question: 'Continue?',
            header: 'Ready?',
            options: [],
            multiple: false,
            custom: true,
          },
        ],
      },
      ctx,
    );
    await Promise.resolve();
    expect(send).toHaveBeenCalledWith(
      'question-asked',
      expect.objectContaining({
        connectionId: 'conn-xyz',
        providerSessionId: 'ses_abc',
      }),
    );
  });
});

describe('forwardQuestionReplied', () => {
  it('sends on question-cleared channel (preload contract)', async () => {
    const { ctx, send } = makeCtx();
    forwardQuestionReplied(
      { sessionID: 'ses_abc', requestID: 'q_1', answer: 'Yes' },
      ctx,
    );
    await Promise.resolve();
    expect(send).toHaveBeenCalledWith(
      'question-cleared',
      expect.objectContaining({
        connectionId: 'conn-xyz',
        providerSessionId: 'ses_abc',
        answer: 'Yes',
      }),
    );
  });
});
