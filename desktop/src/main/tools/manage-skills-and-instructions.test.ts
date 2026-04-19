import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerManageSkillsAndInstructionsTool } from './manage-skills-and-instructions';

vi.mock('../database', () => ({
  upsertSkillOrInstruction: vi.fn(),
  listSkillsAndInstructions: vi.fn(),
  getSkillOrInstructionByName: vi.fn(),
  deleteSkillOrInstruction: vi.fn(),
  getRegisteredConnection: vi.fn(() => null),
  getRegisteredConnectionBySessionId: vi.fn(() => null),
  getRegisteredConnectionsByConnectionId: vi.fn(() => []),
  getRegisteredConnectionsByProvider: vi.fn(() => []),
}));

vi.mock('./connection-guard', () => ({
  staleSessionError: vi.fn().mockReturnValue(null),
  requireProviderSessionId: vi.fn(() => null),
}));

vi.mock('../opencode/injector', () => ({
  injectOpenCodeMessage: vi.fn().mockResolvedValue({ ok: true }),
}));

import {
  upsertSkillOrInstruction,
  listSkillsAndInstructions,
  getSkillOrInstructionByName,
  deleteSkillOrInstruction,
  getRegisteredConnectionsByProvider,
} from '../database';
import { injectOpenCodeMessage } from '../opencode/injector';

type ToolInput = {
  action: 'register' | 'list' | 'get' | 'delete';
  name?: string;
  type?: 'skill' | 'instruction';
  description?: string;
  content?: string;
  filterType?: 'skill' | 'instruction';
};

type ToolResult = {
  isError?: boolean;
  content: Array<{ type: 'text'; text: string }>;
};

type ToolHandler = (input: ToolInput) => Promise<ToolResult>;

function getToolHandler(): ToolHandler {
  const server = {
    registerTool: vi.fn(),
  } as unknown as McpServer;

  const mockWindow = {
    webContents: { send: vi.fn() },
  };

  registerManageSkillsAndInstructionsTool(
    server,
    () => mockWindow as never,
    'conn-test',
    () => 4096,
  );

  const toolCall = (server.registerTool as Mock).mock.calls[0];
  return toolCall[2] as ToolHandler;
}

describe('manage_skills_and_instructions tool', () => {
  const mockUpsert = upsertSkillOrInstruction as Mock;
  const mockList = listSkillsAndInstructions as Mock;
  const mockGet = getSkillOrInstructionByName as Mock;
  const mockDelete = deleteSkillOrInstruction as Mock;
  const mockGetByProvider = getRegisteredConnectionsByProvider as Mock;
  const mockInject = injectOpenCodeMessage as Mock;

  beforeEach(() => {
    mockUpsert.mockReset();
    mockList.mockReset();
    mockGet.mockReset();
    mockDelete.mockReset();
    mockGetByProvider.mockReset();
    mockInject.mockReset();
    mockGetByProvider.mockReturnValue([]);
    mockInject.mockResolvedValue({ ok: true });
  });

  it('registers a skill successfully', async () => {
    const record = {
      id: 1,
      name: 'test-skill',
      type: 'skill' as const,
      description: 'A test skill',
      content: '# Test\n\nContent here.',
      createdAt: '2025-01-01',
      updatedAt: '2025-01-01',
    };
    mockUpsert.mockReturnValue(record);

    const handler = getToolHandler();
    const result = await handler({
      action: 'register',
      name: 'test-skill',
      type: 'skill',
      description: 'A test skill',
      content: '# Test\n\nContent here.',
    });

    const payload = JSON.parse(result.content[0].text) as {
      ok: boolean;
      action: string;
    };
    expect(payload.ok).toBe(true);
    expect(payload.action).toBe('registered');
    expect(mockUpsert).toHaveBeenCalledWith({
      name: 'test-skill',
      type: 'skill',
      description: 'A test skill',
      content: '# Test\n\nContent here.',
    });
  });

  it('returns error when register is missing required fields', async () => {
    const handler = getToolHandler();
    const result = await handler({
      action: 'register',
      name: 'test-skill',
      // missing type, description, content
    });

    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0].text) as { error: string };
    expect(payload.error).toBe('MISSING_FIELDS');
  });

  it('lists all entries', async () => {
    mockList.mockReturnValue([
      {
        id: 1,
        name: 'skill-a',
        type: 'skill',
        description: 'Skill A',
        content: 'content',
        updatedAt: '2025-01-01',
      },
      {
        id: 2,
        name: 'instruction-b',
        type: 'instruction',
        description: 'Instruction B',
        content: 'content',
        updatedAt: '2025-01-01',
      },
    ]);

    const handler = getToolHandler();
    const result = await handler({ action: 'list' });

    const payload = JSON.parse(result.content[0].text) as {
      ok: boolean;
      count: number;
    };
    expect(payload.ok).toBe(true);
    expect(payload.count).toBe(2);
    expect(mockList).toHaveBeenCalledWith(undefined, undefined);
  });

  it('lists with filter', async () => {
    mockList.mockReturnValue([]);

    const handler = getToolHandler();
    await handler({ action: 'list', filterType: 'skill' });

    expect(mockList).toHaveBeenCalledWith('skill', undefined);
  });

  it('gets an entry by name', async () => {
    const entry = {
      id: 1,
      name: 'test-skill',
      type: 'skill' as const,
      description: 'A test skill',
      content: '# Test Content',
      createdAt: '2025-01-01',
      updatedAt: '2025-01-01',
    };
    mockGet.mockReturnValue(entry);

    const handler = getToolHandler();
    const result = await handler({ action: 'get', name: 'test-skill' });

    expect(result.content).toHaveLength(2);
    const payload = JSON.parse(result.content[0].text) as {
      ok: boolean;
      action: string;
    };
    expect(payload.ok).toBe(true);
    expect(payload.action).toBe('get');
    expect(result.content[1].text).toBe('# Test Content');
  });

  it('returns error when get has no name', async () => {
    const handler = getToolHandler();
    const result = await handler({ action: 'get' });

    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0].text) as { error: string };
    expect(payload.error).toBe('MISSING_NAME');
  });

  it('returns not found when get finds nothing', async () => {
    mockGet.mockReturnValue(null);

    const handler = getToolHandler();
    const result = await handler({ action: 'get', name: 'nonexistent' });

    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0].text) as { error: string };
    expect(payload.error).toBe('NOT_FOUND');
  });

  it('deletes an entry successfully', async () => {
    mockDelete.mockReturnValue(true);

    const handler = getToolHandler();
    const result = await handler({ action: 'delete', name: 'test-skill' });

    const payload = JSON.parse(result.content[0].text) as {
      ok: boolean;
      deleted: boolean;
    };
    expect(payload.ok).toBe(true);
    expect(payload.deleted).toBe(true);
    expect(mockDelete).toHaveBeenCalledWith('test-skill');
  });

  it('returns ok with deleted=false when delete finds nothing', async () => {
    mockDelete.mockReturnValue(false);

    const handler = getToolHandler();
    const result = await handler({ action: 'delete', name: 'nonexistent' });

    const payload = JSON.parse(result.content[0].text) as {
      ok: boolean;
      deleted: boolean;
    };
    expect(payload.ok).toBe(true);
    expect(payload.deleted).toBe(false);
  });

  it('returns error when delete has no name', async () => {
    const handler = getToolHandler();
    const result = await handler({ action: 'delete' });

    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0].text) as { error: string };
    expect(payload.error).toBe('MISSING_NAME');
  });

  it('broadcasts a skills-changed reminder to opencode sessions on register', async () => {
    mockGet.mockReturnValue(null); // not pre-existing → action label "registered"
    mockUpsert.mockReturnValue({
      id: 1,
      name: 'new-skill',
      type: 'skill',
      description: 'desc',
      content: 'body',
      createdAt: '2025-01-01',
      updatedAt: '2025-01-01',
    });
    mockGetByProvider.mockReturnValue([
      {
        providerType: 'opencode',
        providerSessionId: 'ses_aaa',
        connectionId: null,
        channelName: 'A',
        projectName: 'P',
      },
      {
        providerType: 'opencode',
        providerSessionId: 'ses_bbb',
        connectionId: null,
        channelName: 'B',
        projectName: 'P',
      },
    ]);

    const handler = getToolHandler();
    await handler({
      action: 'register',
      name: 'new-skill',
      type: 'skill',
      description: 'desc',
      content: 'body',
    });

    // Allow microtasks (fire-and-forget) to settle
    await new Promise((r) => setImmediate(r));

    expect(mockGetByProvider).toHaveBeenCalledWith('opencode');
    expect(mockInject).toHaveBeenCalledTimes(2);
    const sessionIds = mockInject.mock.calls.map((c) => c[0]);
    expect(sessionIds).toContain('ses_aaa');
    expect(sessionIds).toContain('ses_bbb');
    // Reminder MUST land in the user-message slot (arg index 1) as a noReply
    // message, NOT systemMessage (arg index 7). OpenCode's per-call `system`
    // only persists while the injected message is `lastUser`; storing the
    // reminder in the message body persists it in `messages[]` so it is
    // replayed on every step.
    const userMsg = mockInject.mock.calls[0][1] as string;
    expect(userMsg).toContain('<system-reminder>');
    expect(userMsg).toContain('registered');
    expect(userMsg).toContain('new-skill');
    const noReply = mockInject.mock.calls[0][5] as boolean;
    expect(noReply).toBe(true);
    const systemMsg = mockInject.mock.calls[0][7] as string | undefined;
    expect(systemMsg).toBeUndefined();
  });

  it('uses "updated" action label when register overwrites an existing entry', async () => {
    mockGet.mockReturnValue({
      id: 1,
      name: 'existing',
      type: 'skill',
      description: 'old',
      content: 'old',
      createdAt: '2025-01-01',
      updatedAt: '2025-01-01',
    });
    mockUpsert.mockReturnValue({
      id: 1,
      name: 'existing',
      type: 'skill',
      description: 'new',
      content: 'new',
      createdAt: '2025-01-01',
      updatedAt: '2025-01-02',
    });
    mockGetByProvider.mockReturnValue([
      {
        providerType: 'opencode',
        providerSessionId: 'ses_aaa',
        connectionId: null,
        channelName: 'A',
        projectName: 'P',
      },
    ]);

    const handler = getToolHandler();
    await handler({
      action: 'register',
      name: 'existing',
      type: 'skill',
      description: 'new',
      content: 'new',
    });
    await new Promise((r) => setImmediate(r));

    const userMsg = mockInject.mock.calls[0][1] as string;
    expect(userMsg).toContain('updated');
    expect(userMsg).toContain('existing');
    expect(mockInject.mock.calls[0][7]).toBeUndefined();
  });

  it('broadcasts a "deleted" reminder on successful delete', async () => {
    mockGet.mockReturnValue({
      id: 1,
      name: 'gone',
      type: 'skill',
      description: 'd',
      content: 'c',
      createdAt: '2025-01-01',
      updatedAt: '2025-01-01',
    });
    mockDelete.mockReturnValue(true);
    mockGetByProvider.mockReturnValue([
      {
        providerType: 'opencode',
        providerSessionId: 'ses_aaa',
        connectionId: null,
        channelName: 'A',
        projectName: 'P',
      },
    ]);

    const handler = getToolHandler();
    await handler({ action: 'delete', name: 'gone' });
    await new Promise((r) => setImmediate(r));

    expect(mockInject).toHaveBeenCalledTimes(1);
    const userMsg = mockInject.mock.calls[0][1] as string;
    expect(userMsg).toContain('deleted');
    expect(userMsg).toContain('gone');
    expect(mockInject.mock.calls[0][7]).toBeUndefined();
  });

  it('does NOT broadcast when delete finds nothing', async () => {
    mockDelete.mockReturnValue(false);
    mockGetByProvider.mockReturnValue([
      {
        providerType: 'opencode',
        providerSessionId: 'ses_aaa',
        connectionId: null,
        channelName: 'A',
        projectName: 'P',
      },
    ]);

    const handler = getToolHandler();
    await handler({ action: 'delete', name: 'nonexistent' });
    await new Promise((r) => setImmediate(r));

    expect(mockInject).not.toHaveBeenCalled();
  });
});
