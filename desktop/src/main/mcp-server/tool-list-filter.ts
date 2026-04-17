import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

export const HIDDEN_TOOL_NAMES = new Set([
  'register_connection',
  'poll_context_injections',
]);

/**
 * Override the default ListTools handler to filter out tools whose names
 * appear in HIDDEN_TOOL_NAMES. These tools remain callable but are not
 * advertised to clients that enumerate tools.
 */
export function applyHiddenToolListFilter(server: McpServer): void {
  const rawServer = (
    server as unknown as {
      server?: {
        setRequestHandler?: (
          schema: unknown,
          handler: () => Promise<{ tools: unknown[] }> | { tools: unknown[] },
        ) => void;
      };
    }
  ).server;

  if (!rawServer?.setRequestHandler) {
    return;
  }

  server.server.setRequestHandler(ListToolsRequestSchema, async () => {
    const internalServer = server as unknown as {
      _registeredTools?: Record<
        string,
        {
          enabled?: boolean;
          title?: string;
          description?: string;
          inputSchema?: unknown;
          outputSchema?: unknown;
          annotations?: unknown;
          execution?: unknown;
          _meta?: Record<string, unknown>;
        }
      >;
    };

    const registeredTools = internalServer._registeredTools ?? {};
    const tools = Object.entries(registeredTools)
      .filter(
        ([name, tool]) =>
          tool.enabled !== false && !HIDDEN_TOOL_NAMES.has(name),
      )
      .map(([name, tool]) => ({
        name,
        title: tool.title,
        description: tool.description,
        inputSchema: { type: 'object' },
        annotations: tool.annotations,
        execution: tool.execution,
        _meta: tool._meta,
      }));

    return { tools };
  });
}
