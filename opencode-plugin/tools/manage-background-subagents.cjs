'use strict';

const { openCodeRequest } = require('../lib/opencode-api.cjs');

const definition = {
  name: 'manage_background_subagents',
  description:
    'Start, inspect, wait for, read output from, and cancel OpenCode background subagent sessions. State is kept in this MCP process and survives until OpenCode restarts the MCP server.',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['start', 'list', 'status', 'wait', 'output', 'cancel'],
      },
      id: { type: 'string' },
      prompt: { type: 'string' },
      title: { type: 'string' },
      agent: { type: 'string' },
      parentSessionId: { type: 'string' },
    },
    required: ['action'],
    additionalProperties: false,
  },
};

function summarizeRecord(record) {
  return {
    id: record.id,
    sessionId: record.sessionId,
    title: record.title,
    agent: record.agent,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastError: record.lastError,
  };
}

async function refreshBackgroundRecord(context, record) {
  try {
    const statuses = await openCodeRequest(context, 'GET', '/session/status');
    const status = statuses?.[record.sessionId];
    record.status = status?.type || record.status || 'unknown';
    record.updatedAt = new Date().toISOString();
    record.lastError = undefined;
  } catch (err) {
    record.lastError = err.message;
  }
  return record;
}

async function getBackgroundOutput(context, record) {
  const messages = await openCodeRequest(
    context,
    'GET',
    `/session/${encodeURIComponent(record.sessionId)}/message?limit=40`,
  );
  const lines = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    const role = message.info?.role || message.info?.type || 'message';
    const parts = Array.isArray(message.parts) ? message.parts : [];
    const text = parts
      .map((part) => (part.type === 'text' ? part.text : ''))
      .filter(Boolean)
      .join('\n');
    if (text) lines.push(`## ${role}\n${text}`);
  }
  return lines.length > 0
    ? lines.join('\n\n')
    : 'No text output available yet.';
}

async function execute(args, context) {
  const action = String(args.action || '');
  if (action === 'list')
    return JSON.stringify(
      Array.from(context.backgroundSubagents.values()).map(summarizeRecord),
      null,
      2,
    );

  if (action === 'start') {
    const prompt = String(args.prompt || '').trim();
    if (!prompt) return 'Missing required prompt for action=start.';
    const id = `bg_${context.nextBackgroundId++}`;
    const title = String(args.title || `Background subagent ${id}`).trim();
    const created = await openCodeRequest(context, 'POST', '/session', {
      title,
      parentID: args.parentSessionId || undefined,
    });
    if (!created?.id)
      return `OpenCode did not return a session id: ${JSON.stringify(created)}`;
    await openCodeRequest(
      context,
      'POST',
      `/session/${encodeURIComponent(created.id)}/prompt_async`,
      {
        agent: args.agent || undefined,
        parts: [{ type: 'text', text: prompt }],
      },
    );
    const now = new Date().toISOString();
    const record = {
      id,
      sessionId: created.id,
      title,
      agent: args.agent || undefined,
      status: 'busy',
      createdAt: now,
      updatedAt: now,
    };
    context.backgroundSubagents.set(id, record);
    return JSON.stringify(summarizeRecord(record), null, 2);
  }

  const id = String(args.id || '').trim();
  if (!id) return `Missing required id for action=${action}.`;
  const record = context.backgroundSubagents.get(id);
  if (!record) return `Unknown background subagent id: ${id}`;

  if (action === 'status')
    return JSON.stringify(
      summarizeRecord(await refreshBackgroundRecord(context, record)),
      null,
      2,
    );
  if (action === 'wait') {
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      await refreshBackgroundRecord(context, record);
      if (record.status === 'idle') break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return JSON.stringify(summarizeRecord(record), null, 2);
  }
  if (action === 'output') return getBackgroundOutput(context, record);
  if (action === 'cancel') {
    await openCodeRequest(
      context,
      'POST',
      `/session/${encodeURIComponent(record.sessionId)}/abort`,
    );
    record.status = 'cancelled';
    record.updatedAt = new Date().toISOString();
    return JSON.stringify(summarizeRecord(record), null, 2);
  }
  return `Unknown action: ${action}`;
}

module.exports = { manageBackgroundSubagentsTool: { definition, execute } };
