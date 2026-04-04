import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { staleConnectionError } from './connection-guard';
import { getRegisteredConnection } from '../database';
import { searchDocs, formatSearchResults } from '../doc-context-injector';

export function registerFindRepoDocsTool(
  server: McpServer,
  connectionId: string,
): void {
  server.registerTool(
    'find_repo_docs',
    {
      description: `Search repository documentation files by query. Uses hybrid keyword + semantic search to find the most relevant docs. Returns file paths, scores, and snippet previews. Use the Read tool to access the full content of any returned file.

This tool is only available when the agent registered with a baseDirectory via register_connection. If no baseDirectory was provided, the tool returns an error.

The search combines:
- Keyword matching (path, content, title, directory context)
- Semantic similarity (embedding-based, available after the background indexer warms up)

Results are ranked by combined score. The first search after registration may be keyword-only while the semantic index builds in the background.`,
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
      },
    },
    async ({ query, limit }): Promise<CallToolResult> => {
      // Check for stale/deleted connection
      const staleError = staleConnectionError(connectionId);
      if (staleError) return staleError;

      // Look up the registered connection to get baseDirectory
      const connection = getRegisteredConnection(connectionId);
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
