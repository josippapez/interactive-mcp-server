import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { staleConnectionError } from './connection-guard';
import {
  upsertSkillOrInstruction,
  listSkillsAndInstructions,
  getSkillOrInstructionByName,
  deleteSkillOrInstruction,
} from '../database';
import type { BrowserWindow } from 'electron';

export function registerManageSkillsAndInstructionsTool(
  server: McpServer,
  getWindow: () => BrowserWindow | null,
  connectionId: string,
): void {
  server.registerTool(
    'manage_skills_and_instructions',
    {
      description: `<description>
Manage skills and instructions stored in the Interactive MCP Desktop app.
Skills and instructions are persistent knowledge entries that are automatically injected into every new agent session on registration, making the MCP server self-documenting.
Use this tool to register, list, retrieve, or delete skills and instructions.
</description>

<importantNotes>
- (!important!) Skills and instructions are persisted across app restarts — they are stored in the local database.
- (!important!) ALL registered skills and instructions are automatically injected into agent sessions when they call register_connection, so agents always have access to them.
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
      filterType,
      filterCategory,
    }): Promise<CallToolResult> => {
      const staleErr = staleConnectionError(connectionId);
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

          const record = upsertSkillOrInstruction({
            name,
            type,
            description,
            content,
            category,
            tags,
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
          getWindow()?.webContents.send('skills-updated');

          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  ok: true,
                  action: 'registered',
                  entry: {
                    name: record.name,
                    type: record.type,
                    description: record.description,
                    category: record.category,
                    tags: record.tags,
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
          const entries = listSkillsAndInstructions(filterType, filterCategory);
          const summary = entries.map((e) => ({
            name: e.name,
            type: e.type,
            description: e.description,
            category: e.category,
            tags: e.tags,
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

          const entry = getSkillOrInstructionByName(name);
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

          const deleted = deleteSkillOrInstruction(name);

          if (deleted) {
            // Notify the renderer so the UI can update live
            getWindow()?.webContents.send('skills-updated');
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
