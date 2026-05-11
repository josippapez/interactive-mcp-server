import { describe, expect, it } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  applyHiddenToolListFilter,
  DISABLED_DESKTOP_TOOL_NAMES,
  HIDDEN_TOOL_NAMES,
} from './tool-list-filter';

describe('HIDDEN_TOOL_NAMES', () => {
  it('hides all interactive desktop MCP tools from agent discovery', () => {
    expect(HIDDEN_TOOL_NAMES).toEqual(DISABLED_DESKTOP_TOOL_NAMES);
  });

  it('tracks every disabled desktop MCP tool name', () => {
    expect(DISABLED_DESKTOP_TOOL_NAMES).toEqual(
      new Set([
        'register_connection',
        'request_user_input',
        'start_intensive_chat',
        'ask_intensive_chat',
        'stop_intensive_chat',
        'push_session_status',
        'send_message',
        'poll_context_injections',
      ]),
    );
  });

  it('keeps docs and libs tools discoverable while hiding prompt and channel tools', async () => {
    let listHandler:
      | (() => Promise<{ tools: Array<{ name: string }> }>)
      | null = null;
    const server = {
      server: {
        setRequestHandler: (
          _schema: unknown,
          handler: () => Promise<{ tools: Array<{ name: string }> }>,
        ) => {
          listHandler = handler;
        },
      },
      _registeredTools: {
        register_connection: { inputSchema: {} },
        request_user_input: { inputSchema: {} },
        send_message: { inputSchema: {} },
        find_docs: { inputSchema: {} },
        read_doc: { inputSchema: {} },
        list_docs: { inputSchema: {} },
        find_libs: { inputSchema: {} },
        find_repo_docs: { inputSchema: {} },
        manage_skills_and_instructions: { inputSchema: {} },
      },
    } as unknown as McpServer;

    applyHiddenToolListFilter(server);

    const result = await listHandler?.();
    expect(result?.tools.map((tool) => tool.name)).toEqual([
      'find_docs',
      'read_doc',
      'list_docs',
      'find_libs',
      'find_repo_docs',
      'manage_skills_and_instructions',
    ]);
  });
});
