import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import {
  staleSessionError,
  requireProviderSessionId,
} from './connection-guard';
import { resolveProviderSessionId } from '../resolver';
import {
  getRegisteredConnection,
  getRegisteredConnectionBySessionId,
} from '../database';
import {
  searchDocs,
  formatSearchResults,
} from '../../../docs/context-injector';

export function registerFindRepoDocsTool(
  server: McpServer,
  connectionId: string,
  requireSessionId = false,
): void {
  server.registerTool(
    'find_repo_docs',
    {
      description: `Search repository documentation files by query. Uses keyword search to find the most relevant docs. Returns file paths, scores, and snippet previews. Use the Read tool to access the full content of any returned file.

This tool is only available when the agent registered with a baseDirectory via register_connection. If no baseDirectory was provided, the tool returns an error.

The search matches on path, content, title, and directory context, and ranks results by combined score.

IMPORTANT: You MUST pass your openCodeSessionId (format: ses_<alphanumeric>) with every call for correct routing.`,
      title: 'Search repository documentation',
      inputSchema: {
        query: z
          .string()
          .describe('Search query for repository docs and markdown files.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .default(8)
          .describe('Maximum number of matches to return (1-20, default 8).'),
        openCodeSessionId: z
          .string()
          .optional()
          .describe(
            'Your OpenCode session ID (format: ses_<alphanumeric>). Required for correct routing in multi-agent scenarios.',
          ),
      },
    },
    async ({ query, limit, openCodeSessionId }): Promise<CallToolResult> => {
      const providerSessionId = await resolveProviderSessionId(
        connectionId,
        openCodeSessionId,
      );

      // Check for stale/deleted session
      const staleError = providerSessionId
        ? staleSessionError(providerSessionId)
        : null;
      if (staleError) return staleError;

      // Check for missing provider session ID (required in OpenCode mode)
      const missingParamErr = requireProviderSessionId(
        providerSessionId,
        requireSessionId,
      );
      if (missingParamErr) return missingParamErr;

      // Look up the registered connection - prefer providerSessionId for lookup
      const connection = providerSessionId
        ? await getRegisteredConnectionBySessionId(providerSessionId)
        : await getRegisteredConnection(connectionId);
      if (!connection?.baseDirectory) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Error: No baseDirectory registered for this connection. Call register_connection with a baseDirectory first.',
            },
          ],
        };
      }

      const results = await searchDocs(
        query,
        connection.baseDirectory,
        limit ?? 8,
      );
      const text = formatSearchResults(results, query);

      return {
        content: [{ type: 'text' as const, text }],
      };
    },
  );
}
