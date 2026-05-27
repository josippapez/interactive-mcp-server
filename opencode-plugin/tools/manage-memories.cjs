'use strict';

const fs = require('node:fs');
const path = require('node:path');

const definition = {
  name: 'manage_memories',
  description:
    'Manage repo-local standalone memories stored in .opencode/interactive-mcp-memories.json.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['create', 'list', 'update', 'delete'] },
      id: { type: 'string' },
      content: { type: 'string' },
      scope: {
        type: 'string',
        enum: ['global', 'project'],
        default: 'project',
      },
    },
    required: ['action'],
    additionalProperties: false,
  },
};

function readMemories(context) {
  try {
    const parsed = JSON.parse(fs.readFileSync(context.memoriesPath, 'utf8'));
    return Array.isArray(parsed.memories) ? parsed.memories : [];
  } catch {
    return [];
  }
}

function writeMemories(context, memories) {
  fs.mkdirSync(path.dirname(context.memoriesPath), { recursive: true });
  fs.writeFileSync(
    context.memoriesPath,
    `${JSON.stringify({ memories }, null, 2)}\n`,
    'utf8',
  );
}

function execute(args, context) {
  const action = String(args.action || '');
  const memories = readMemories(context);
  if (action === 'list') return JSON.stringify(memories, null, 2);

  if (action === 'create') {
    const content = String(args.content || '').trim();
    if (!content) return 'Missing required content for action=create.';
    const memory = {
      id: `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      scope: args.scope || 'project',
      content,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    memories.push(memory);
    writeMemories(context, memories);
    return JSON.stringify(memory, null, 2);
  }

  const id = String(args.id || '').trim();
  if (!id) return `Missing required id for action=${action}.`;
  const index = memories.findIndex((memory) => memory.id === id);
  if (index < 0) return `Unknown memory id: ${id}`;
  if (action === 'update') {
    const content = String(args.content || '').trim();
    if (!content) return 'Missing required content for action=update.';
    memories[index] = {
      ...memories[index],
      content,
      scope: args.scope || memories[index].scope,
      updatedAt: new Date().toISOString(),
    };
    writeMemories(context, memories);
    return JSON.stringify(memories[index], null, 2);
  }
  if (action === 'delete') {
    const [deleted] = memories.splice(index, 1);
    writeMemories(context, memories);
    return JSON.stringify(deleted, null, 2);
  }
  return `Unknown action: ${action}`;
}

module.exports = { manageMemoriesTool: { definition, execute } };
