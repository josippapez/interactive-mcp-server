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
        setRequestHandler: (_schema: unknown, handler: unknown) => {
          listHandler = handler as () => Promise<{
            tools: Array<{ name: string }>;
          }>;
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
        manage_memories: { inputSchema: {} },
        manage_background_subagents: { inputSchema: {} },
        message_background_subagent: { inputSchema: {} },
      },
    } as unknown as McpServer;

    applyHiddenToolListFilter(server);

    const result = await (
      listHandler as (() => Promise<{ tools: Array<{ name: string }> }>) | null
    )?.();
    expect(result?.tools.map((tool: { name: string }) => tool.name)).toEqual([
      'find_docs',
      'read_doc',
      'list_docs',
      'find_libs',
      'find_repo_docs',
      'manage_skills_and_instructions',
      'manage_memories',
      'manage_background_subagents',
      'message_background_subagent',
    ]);
  });

  it('reuses the advertised tool list across repeated registry requests', async () => {
    let listHandler:
      | (() => Promise<{ tools: Array<{ name: string }> }>)
      | null = null;
    const server = {
      server: {
        setRequestHandler: (_schema: unknown, handler: unknown) => {
          listHandler = handler as () => Promise<{
            tools: Array<{ name: string }>;
          }>;
        },
      },
      _registeredTools: {
        find_docs: { inputSchema: {} },
        read_doc: { inputSchema: {} },
      },
    } as unknown as McpServer;

    applyHiddenToolListFilter(server);

    const first = await (
      listHandler as (() => Promise<{ tools: Array<{ name: string }> }>) | null
    )?.();
    const second = await (
      listHandler as (() => Promise<{ tools: Array<{ name: string }> }>) | null
    )?.();
    expect(second?.tools).toBe(first?.tools);
  });

  it('rebuilds the advertised tool list when a registered tool changes', async () => {
    let listHandler:
      | (() => Promise<{ tools: Array<{ name: string }> }>)
      | null = null;
    const server = {
      server: {
        setRequestHandler: (_schema: unknown, handler: unknown) => {
          listHandler = handler as () => Promise<{
            tools: Array<{ name: string }>;
          }>;
        },
      },
      _registeredTools: {
        find_docs: { inputSchema: {} },
      },
    } as unknown as McpServer;

    applyHiddenToolListFilter(server);

    const first = await (
      listHandler as (() => Promise<{ tools: Array<{ name: string }> }>) | null
    )?.();
    (
      server as unknown as {
        _registeredTools: Record<string, { inputSchema: unknown }>;
      }
    )._registeredTools.find_docs = { inputSchema: {} };
    const second = await (
      listHandler as (() => Promise<{ tools: Array<{ name: string }> }>) | null
    )?.();
    expect(second?.tools).not.toBe(first?.tools);
  });
});
