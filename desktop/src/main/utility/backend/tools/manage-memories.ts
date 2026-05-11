import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { staleSessionError } from './connection-guard';
import { resolveProviderSessionId } from '../resolver';
import {
  createMemory,
  deleteMemory,
  getMemoryById,
  getRegisteredConnectionBySessionId,
  listMemories,
  updateMemory,
  type Memory,
  type MemoryScope,
} from '../database';
import { emitToRenderer } from '../renderer-emit';
import { injectOpenCodeMessage } from '../injector';
import { getOpenCodePort } from '../session-tree-service';
import { createLogger } from '../../../utils/logger';

const log = createLogger('manage-memories');

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildMemoriesReminder(memories: readonly Memory[]): string {
  const lines = ['<system-reminder>', '<memories source="db">'];
  for (const m of memories) {
    if (m.scope === 'project' && m.projectPath) {
      lines.push(
        `  <memory scope="project" project="${escapeXml(m.projectPath)}">${escapeXml(m.content)}</memory>`,
      );
    } else {
      lines.push(`  <memory scope="global">${escapeXml(m.content)}</memory>`);
    }
  }
  lines.push('</memories>');
  lines.push(
    'The above memories were just updated and re-injected. They reflect the current memory state visible to this session.',
  );
  lines.push('</system-reminder>');
  return lines.join('\n');
}

function reinjectMemoriesReminder(
  providerSessionId: string,
  baseDirectory: string | null,
): void {
  const port = getOpenCodePort();
  if (port === null) {
    log.warn(
      `cannot re-inject memories: OpenCode port unavailable (session=${providerSessionId})`,
    );
    return;
  }
  const memories = baseDirectory
    ? listMemories({ projectPath: baseDirectory })
    : listMemories({ scope: 'global' });
  const message = buildMemoriesReminder(memories);
  void injectOpenCodeMessage(
    providerSessionId,
    message,
    undefined,
    port,
    undefined,
    true,
  ).catch((err: unknown) => {
    log.warn(
      `failed to re-inject memories into session ${providerSessionId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  });
}

function jsonResult(payload: unknown): CallToolResult {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
  };
}

function jsonError(error: string, message: string): CallToolResult {
  return {
    isError: true,
    content: [
      { type: 'text' as const, text: JSON.stringify({ error, message }) },
    ],
  };
}

function serializeMemory(memory: Memory) {
  return {
    id: memory.id,
    scope: memory.scope,
    projectPath: memory.projectPath,
    content: memory.content,
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt,
  };
}

export function registerManageMemoriesTool(
  server: McpServer,
  connectionId: string,
): void {
  server.registerTool(
    'manage_memories',
    {
      description: `<description>
Manage persistent memories stored in the Interactive MCP Desktop app.
Memories are short Markdown notes that get injected into every agent session bootstrap reminder so the agent "remembers" them across restarts.
This is the equivalent of Claude Code's CLAUDE.md memory feature.
</description>

<importantNotes>
- (!important!) Memories persist across app restarts and survive schema migrations.
- (!important!) Two scopes are supported:
  - "global": injected into every session bootstrap reminder.
  - "project": injected only when the session's base directory matches the memory's projectPath.
- (!important!) For "create" with scope="project", the projectPath is resolved automatically from the calling session's registered base directory unless you pass an explicit projectPath.
- (!important!) Memories are plain Markdown text. There is no name/title field — keep them short and self-contained.
- (!important!) Prefer one fact per memory. List operations return them in scope+creation order.
</importantNotes>

<whenToUseThisTool>
- When the user shares a stable preference, convention, or fact you should remember next session ("always use yarn", "the API base URL is X", "I prefer two-space indentation").
- When you want to record a project-specific decision that future sessions in the same project should know about.
- When the user asks you to forget or update a previously stored memory.
- When the user asks to see all stored memories.
</whenToUseThisTool>

<actions>
- "create": Add a new memory. Requires: content. Optional: scope (default "global"), projectPath (required for scope="project" if no calling session base directory).
- "list": List memories. Optional: scope filter, projectPath filter. With no filter, returns all memories. With projectPath alone, returns globals plus project memories matching that path (the typical "what would inject for this project" set).
- "update": Update a memory by id. Requires: id. Optional: content, scope, projectPath.
- "delete": Delete a memory by id. Requires: id.
</actions>

<examples>
- Save a global memory: { "action": "create", "content": "User prefers Vitest for testing." }
- Save a project memory (auto path): { "action": "create", "scope": "project", "content": "This repo uses better-sqlite3, not sql.js." }
- Save a project memory (explicit path): { "action": "create", "scope": "project", "projectPath": "/Users/me/code/foo", "content": "Use yarn here." }
- List globals: { "action": "list", "scope": "global" }
- List for a project: { "action": "list", "projectPath": "/Users/me/code/foo" }
- Update content: { "action": "update", "id": 3, "content": "Updated note" }
- Delete: { "action": "delete", "id": 3 }
</examples>`,
      title: 'Manage persistent memories',
      inputSchema: {
        action: z
          .enum(['create', 'list', 'update', 'delete'])
          .describe('Operation: create, list, update, or delete'),
        id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Memory id (required for update and delete)'),
        scope: z
          .enum(['global', 'project'])
          .optional()
          .describe('Memory scope (defaults to "global" on create)'),
        projectPath: z
          .string()
          .optional()
          .describe(
            'Absolute project base directory. Required for scope="project" when no calling session base directory is registered. Used as filter on list.',
          ),
        content: z
          .string()
          .optional()
          .describe('Markdown content (required for create)'),
      },
    },
    async ({
      action,
      id,
      scope,
      projectPath,
      content,
    }): Promise<CallToolResult> => {
      const providerSessionId = await resolveProviderSessionId(connectionId);
      const staleErr = providerSessionId
        ? staleSessionError(providerSessionId)
        : null;
      if (staleErr) return staleErr;

      const callerBaseDirectory = providerSessionId
        ? ((getRegisteredConnectionBySessionId(providerSessionId) ?? null)
            ?.baseDirectory ?? null)
        : null;

      switch (action) {
        case 'create': {
          if (!content || !content.trim()) {
            return jsonError(
              'MISSING_CONTENT',
              'The "create" action requires a non-empty "content" field.',
            );
          }
          const effectiveScope: MemoryScope = scope ?? 'global';
          let effectiveProjectPath: string | null = null;
          if (effectiveScope === 'project') {
            effectiveProjectPath = projectPath ?? callerBaseDirectory;
            if (!effectiveProjectPath) {
              return jsonError(
                'MISSING_PROJECT_PATH',
                'scope="project" requires either an explicit projectPath or a registered session base directory.',
              );
            }
          }
          const created = createMemory({
            scope: effectiveScope,
            projectPath: effectiveProjectPath,
            content,
          });
          if (!created) {
            return jsonError('CREATE_FAILED', 'Failed to create memory.');
          }
          emitToRenderer('memories-updated', undefined);
          if (providerSessionId) {
            reinjectMemoriesReminder(providerSessionId, callerBaseDirectory);
          }
          return jsonResult({
            ok: true,
            action: 'create',
            memory: serializeMemory(created),
          });
        }

        case 'list': {
          const filter: { scope?: MemoryScope; projectPath?: string } = {};
          if (scope) filter.scope = scope;
          if (projectPath) filter.projectPath = projectPath;
          const memories = listMemories(filter);
          return jsonResult({
            ok: true,
            action: 'list',
            count: memories.length,
            memories: memories.map(serializeMemory),
          });
        }

        case 'update': {
          if (!id) {
            return jsonError(
              'MISSING_ID',
              'The "update" action requires an "id" field.',
            );
          }
          if (!getMemoryById(id)) {
            return jsonError('NOT_FOUND', `No memory found with id ${id}.`);
          }
          const patch: {
            content?: string;
            scope?: MemoryScope;
            projectPath?: string | null;
          } = {};
          if (content !== undefined) patch.content = content;
          if (scope !== undefined) patch.scope = scope;
          if (projectPath !== undefined) patch.projectPath = projectPath;
          const updated = updateMemory(id, patch);
          if (!updated) {
            return jsonError('UPDATE_FAILED', `Failed to update memory ${id}.`);
          }
          emitToRenderer('memories-updated', undefined);
          if (providerSessionId) {
            reinjectMemoriesReminder(providerSessionId, callerBaseDirectory);
          }
          return jsonResult({
            ok: true,
            action: 'update',
            memory: serializeMemory(updated),
          });
        }

        case 'delete': {
          if (!id) {
            return jsonError(
              'MISSING_ID',
              'The "delete" action requires an "id" field.',
            );
          }
          const deleted = deleteMemory(id);
          if (!deleted) {
            return jsonError('NOT_FOUND', `No memory found with id ${id}.`);
          }
          emitToRenderer('memories-updated', undefined);
          if (providerSessionId) {
            reinjectMemoriesReminder(providerSessionId, callerBaseDirectory);
          }
          return jsonResult({ ok: true, action: 'delete', id });
        }
      }
    },
  );
}
