import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerManageSkillsAndInstructionsTool } from './manage-skills-and-instructions';

vi.mock('../database', () => ({
  upsertSkillOrInstruction: vi.fn(),
  listSkillsAndInstructions: vi.fn(),
  getSkillOrInstructionByName: vi.fn(),
  deleteSkillOrInstruction: vi.fn(),
}));

vi.mock('./connection-guard', () => ({
  staleConnectionError: vi.fn().mockReturnValue(null),
}));

import {
  upsertSkillOrInstruction,
  listSkillsAndInstructions,
  getSkillOrInstructionByName,
  deleteSkillOrInstruction,
} from '../database';

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
  );

  const toolCall = (server.registerTool as Mock).mock.calls[0];
  return toolCall[2] as ToolHandler;
}

describe('manage_skills_and_instructions tool', () => {
  const mockUpsert = upsertSkillOrInstruction as Mock;
  const mockList = listSkillsAndInstructions as Mock;
  const mockGet = getSkillOrInstructionByName as Mock;
  const mockDelete = deleteSkillOrInstruction as Mock;

  beforeEach(() => {
    mockUpsert.mockReset();
    mockList.mockReset();
    mockGet.mockReset();
    mockDelete.mockReset();
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
    expect(mockList).toHaveBeenCalledWith(undefined);
  });

  it('lists with filter', async () => {
    mockList.mockReturnValue([]);

    const handler = getToolHandler();
    await handler({ action: 'list', filterType: 'skill' });

    expect(mockList).toHaveBeenCalledWith('skill');
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
});
