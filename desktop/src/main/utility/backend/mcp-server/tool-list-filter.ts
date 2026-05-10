import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

export const DISABLED_DESKTOP_TOOL_NAMES = new Set([
  'register_connection',
  'request_user_input',
  'start_intensive_chat',
  'ask_intensive_chat',
  'stop_intensive_chat',
  'push_session_status',
  'send_message',
  'poll_context_injections',
  'manage_skills_and_instructions',
]);

export const HIDDEN_TOOL_NAMES = DISABLED_DESKTOP_TOOL_NAMES;

/**
 * Override the default ListTools handler to filter out tools whose names
 * appear in HIDDEN_TOOL_NAMES. These tools remain callable but are not
 * advertised to clients that enumerate tools.
 *
 * IMPORTANT: the advertised tool list MUST preserve each tool's real
 * `inputSchema` (converted to JSON Schema) so MCP clients and subagents can
 * validate arguments before invoking the tool. Previously this handler
 * returned a bare `{ type: 'object' }` placeholder, which caused subagents
 * to see tools with no callable parameters (arguments were dropped as
 * `undefined` at the client layer).
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
        inputSchema: toJsonSchema(tool.inputSchema),
        outputSchema: toJsonSchema(tool.outputSchema),
        annotations: tool.annotations,
        execution: tool.execution,
        _meta: tool._meta,
      }));

    return { tools };
  });
}

const EMPTY_OBJECT_JSON_SCHEMA = {
  type: 'object' as const,
  properties: {},
};

/**
 * Convert a tool's registered inputSchema/outputSchema into a JSON-Schema-
 * shaped object that MCP clients can validate against.
 *
 * The MCP SDK accepts `inputSchema` as either:
 *   a) a plain JSON Schema object
 *   b) a `ZodRawShape` (a record of Zod schemas), which the SDK wraps in
 *      `z.object(...)` before conversion
 *   c) a Zod object schema
 *
 * We convert (b) and (c) to JSON Schema via Zod 4's built-in
 * `z.toJSONSchema`, and pass (a) through unchanged.
 */
function toJsonSchema(schema: unknown): Record<string, unknown> | undefined {
  if (schema == null) return undefined;

  // Case (a): already JSON-Schema-shaped.
  if (
    typeof schema === 'object' &&
    (schema as { type?: unknown }).type === 'object'
  ) {
    return schema as Record<string, unknown>;
  }

  try {
    // Case (c): a Zod schema instance.
    if (schema instanceof z.ZodType) {
      return z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>;
    }

    // Case (b): a ZodRawShape — a plain object whose values are Zod schemas.
    if (typeof schema === 'object') {
      const wrapped = z.object(schema as z.ZodRawShape);
      return z.toJSONSchema(wrapped, { io: 'input' }) as Record<
        string,
        unknown
      >;
    }
  } catch {
    // Fall through to the empty-object schema rather than crashing the
    // ListTools handler.
  }

  return EMPTY_OBJECT_JSON_SCHEMA;
}
