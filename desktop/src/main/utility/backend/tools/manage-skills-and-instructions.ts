import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { staleSessionError } from './connection-guard';
import { resolveProviderSessionId } from '../resolver';
import {
  upsertSkillOrInstruction,
  listSkillsAndInstructions,
  getSkillOrInstructionByName,
  deleteSkillOrInstruction,
  type InstructionDeliveryMode,
} from '../database';
import type { BrowserWindow } from 'electron';
import { broadcastSkillsChanged } from './skills-broadcast';
import { emitToRenderer } from '../renderer-emit';

export function registerManageSkillsAndInstructionsTool(
  server: McpServer,
  getWindow: () => BrowserWindow | null,
  connectionId: string,
  getOpenCodePort: () => number,
): void {
  server.registerTool(
    'manage_skills_and_instructions',
    {
      description: `<description>
Manage skills and instructions stored in the Interactive MCP Desktop app.
Skills and instructions are persistent knowledge entries that can be injected into OpenCode session bootstrap reminders, making the MCP server self-documenting.
Use this tool to register, list, retrieve, or delete skills and instructions.
</description>

<importantNotes>
- (!important!) Skills and instructions are persisted across app restarts — they are stored in the local database.
- (!important!) Injection is not limited to register_connection — bootstrap reminders can also be sent for auto-detected OpenCode sessions, MCP reconnect/auto-register, and post-compaction re-injection.
- (!important!) Injection is filtered by entry state and session context. Enabled entries participate; session-scoped entries require a per-session opt-in; session-muted globals are excluded from bootstrap reminders when the session's mute set is resolved.
- (!important!) Use "skill" type for reusable workflows, patterns, or automation recipes.
- (!important!) Use "instruction" type for behavioral rules, policies, or guidelines that agents should follow.
- (!important!) Names must be unique. Registering with an existing name will update that entry.
- (!important!) Content supports full Markdown formatting.
</importantNotes>

<whenToUseThisTool>
- When you want to store reusable knowledge that should be available to all agent sessions
- When you want to register the MCP server's own usage instructions as a plugin
- When you need to embed workflow recipes, coding standards, or project-specific instructions
- When you want to list or retrieve previously registered skills and instructions
- When you want to remove outdated skills or instructions
</whenToUseThisTool>

<actions>
- "register": Create or update a skill/instruction. Requires: name, type, description, content.
- "list": List all registered skills and instructions (optionally filtered by type). Returns names, types, and descriptions.
- "get": Retrieve the full content of a specific skill or instruction by name. Requires: name.
- "delete": Remove a skill or instruction by name. Requires: name.
</actions>

<parameters>
- action: The operation to perform — "register", "list", "get", or "delete"
- name: Name/identifier for the skill or instruction (required for register, get, delete)
- type: Either "skill" or "instruction" (required for register)
- description: Short summary of what the skill/instruction does (required for register)
- content: Full Markdown content body (required for register)
- filterType: Optional filter for list action — "skill" or "instruction"
</parameters>

<examples>
- Register a skill: { "action": "register", "name": "code-review", "type": "skill", "description": "Step-by-step code review workflow", "content": "# Code Review\\n\\n1. Check for..." }
- Register an instruction: { "action": "register", "name": "typescript-rules", "type": "instruction", "description": "TypeScript coding standards", "content": "# TypeScript Rules\\n\\n- No any types..." }
- List all: { "action": "list" }
- List only skills: { "action": "list", "filterType": "skill" }
- Get one: { "action": "get", "name": "code-review" }
- Delete one: { "action": "delete", "name": "code-review" }
</examples>`,
      title: 'Manage persistent skills and instructions',
      inputSchema: {
        action: z
          .enum(['register', 'list', 'get', 'delete'])
          .describe('The operation to perform: register, list, get, or delete'),
        name: z
          .string()
          .optional()
          .describe(
            'Name/identifier for the skill or instruction (required for register, get, delete)',
          ),
        type: z
          .enum(['skill', 'instruction'])
          .optional()
          .describe(
            'Type of entry — "skill" or "instruction" (required for register)',
          ),
        description: z
          .string()
          .optional()
          .describe(
            'Short summary of what the skill/instruction does (required for register)',
          ),
        content: z
          .string()
          .optional()
          .describe('Full Markdown content body (required for register)'),
        category: z
          .string()
          .optional()
          .describe(
            'Category for organizing skills/instructions (e.g., "Code Review", "Testing", "Documentation")',
          ),
        tags: z
          .array(z.string())
          .optional()
          .describe(
            'Tags for categorizing the entry (e.g., ["typescript", "react"])',
          ),
        injectionMode: z
          .enum(['always', 'catalog'])
          .optional()
          .describe(
            'Instruction delivery mode. "always" inlines bootstrap content; "catalog" exposes discoverable instruction entries only.',
          ),
        filterType: z
          .enum(['skill', 'instruction'])
          .optional()
          .describe(
            'Optional filter for list action — show only "skill" or "instruction" entries',
          ),
        filterCategory: z
          .string()
          .optional()
          .describe('Optional category filter for list action'),
      },
    },
    async ({
      action,
      name,
      type,
      description,
      content,
      category,
      tags,
      injectionMode,
      filterType,
      filterCategory,
    }): Promise<CallToolResult> => {
      const providerSessionId = await resolveProviderSessionId(connectionId);
      const staleErr = providerSessionId
        ? staleSessionError(providerSessionId)
        : null;
      if (staleErr) return staleErr;

      switch (action) {
        case 'register': {
          if (!name || !type || !description || !content) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    error: 'MISSING_FIELDS',
                    message:
                      'The "register" action requires: name, type, description, and content.',
                  }),
                },
              ],
            };
          }

          // Detect whether this is a fresh registration or an overwrite of
          // an existing entry, so the broadcast reminder uses the right verb.
          const preExisting = await getSkillOrInstructionByName(name);

          const record = await upsertSkillOrInstruction({
            name,
            type,
            description,
            content,
            category,
            tags,
            deliveryMode:
              type === 'instruction'
                ? ((injectionMode ?? 'always') as InstructionDeliveryMode)
                : undefined,
          });

          if (!record) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    error: 'DB_ERROR',
                    message:
                      'Failed to save the skill/instruction. Database may not be initialized.',
                  }),
                },
              ],
            };
          }

          // Notify the renderer so the UI can update live
          emitToRenderer('skills-updated', undefined);

          // Notify all active OpenCode sessions so agents know to re-fetch.
          broadcastSkillsChanged(
            preExisting ? 'updated' : 'registered',
            record.type,
            record.name,
            getOpenCodePort(),
            record.type === 'instruction' ? record.deliveryMode : undefined,
          );

          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  ok: true,
                  action: preExisting ? 'updated' : 'registered',
                  entry: {
                    name: record.name,
                    type: record.type,
                    description: record.description,
                    category: record.category,
                    tags: record.tags,
                    injectionMode:
                      record.type === 'instruction'
                        ? (record.deliveryMode ?? 'always')
                        : null,
                    alwaysModeWarning: record.alwaysModeWarning ?? null,
                    createdAt: record.createdAt,
                    updatedAt: record.updatedAt,
                  },
                  message: `Successfully registered ${record.type} "${record.name}". It will be automatically injected into all new agent sessions.`,
                }),
              },
            ],
          };
        }

        case 'list': {
          const entries = await listSkillsAndInstructions(
            filterType,
            filterCategory,
          );
          const summary = entries.map((e: (typeof entries)[number]) => ({
            name: e.name,
            type: e.type,
            description: e.description,
            category: e.category,
            tags: e.tags,
            injectionMode:
              e.type === 'instruction' ? (e.deliveryMode ?? 'always') : null,
            alwaysModeWarning: e.alwaysModeWarning ?? null,
            updatedAt: e.updatedAt,
          }));

          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  ok: true,
                  action: 'list',
                  count: entries.length,
                  entries: summary,
                  filter: filterType ?? null,
                }),
              },
            ],
          };
        }

        case 'get': {
          if (!name) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    error: 'MISSING_NAME',
                    message: 'The "get" action requires a "name" parameter.',
                  }),
                },
              ],
            };
          }

          const entry = await getSkillOrInstructionByName(name);
          if (!entry) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    error: 'NOT_FOUND',
                    message: `No skill or instruction found with name "${name}".`,
                  }),
                },
              ],
            };
          }

          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  ok: true,
                  action: 'get',
                  entry: {
                    name: entry.name,
                    type: entry.type,
                    description: entry.description,
                    injectionMode:
                      entry.type === 'instruction'
                        ? (entry.deliveryMode ?? 'always')
                        : null,
                    alwaysModeWarning: entry.alwaysModeWarning ?? null,
                    createdAt: entry.createdAt,
                    updatedAt: entry.updatedAt,
                  },
                }),
              },
              {
                type: 'text' as const,
                text: entry.content,
              },
            ],
          };
        }

        case 'delete': {
          if (!name) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    error: 'MISSING_NAME',
                    message: 'The "delete" action requires a "name" parameter.',
                  }),
                },
              ],
            };
          }

          const existing = await getSkillOrInstructionByName(name);
          const deleted = await deleteSkillOrInstruction(name);

          if (deleted) {
            // Notify the renderer so the UI can update live
            emitToRenderer('skills-updated', undefined);
            // Broadcast to active OpenCode sessions
            if (existing) {
              broadcastSkillsChanged(
                'deleted',
                existing.type,
                name,
                getOpenCodePort(),
                existing.type === 'instruction'
                  ? existing.deliveryMode
                  : undefined,
              );
            }
          }

          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  ok: true,
                  action: 'delete',
                  name,
                  deleted,
                  message: deleted
                    ? `Successfully deleted "${name}".`
                    : `No entry found with name "${name}" — nothing was deleted.`,
                }),
              },
            ],
          };
        }

        default: {
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  error: 'INVALID_ACTION',
                  message: `Unknown action "${String(action)}". Use one of: register, list, get, delete.`,
                }),
              },
            ],
          };
        }
      }
    },
  );
}
