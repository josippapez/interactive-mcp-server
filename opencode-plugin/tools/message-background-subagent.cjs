'use strict';

const { openCodeRequest } = require('../lib/opencode-api.cjs');

const definition = {
  name: 'message_background_subagent',
  description:
    'Send a no-reply message to a known OpenCode session or to a subagent started through manage_background_subagents.',
  inputSchema: {
    type: 'object',
    properties: {
      backgroundId: { type: 'string' },
      targetSessionId: { type: 'string' },
      message: { type: 'string' },
    },
    required: ['message'],
    additionalProperties: false,
  },
};

async function execute(args, context) {
  const message = String(args.message || '').trim();
  if (!message) return 'Missing required message.';
  const record = args.backgroundId
    ? context.backgroundSubagents.get(String(args.backgroundId))
    : null;
  const targetSessionId = String(
    args.targetSessionId || record?.sessionId || '',
  ).trim();
  if (!targetSessionId)
    return 'Provide either backgroundId for a managed subagent or targetSessionId.';
  await openCodeRequest(
    context,
    'POST',
    `/session/${encodeURIComponent(targetSessionId)}/prompt_async`,
    {
      noReply: true,
      parts: [{ type: 'text', text: message }],
    },
  );
  return `Message sent to ${targetSessionId}.`;
}

module.exports = { messageBackgroundSubagentTool: { definition, execute } };
