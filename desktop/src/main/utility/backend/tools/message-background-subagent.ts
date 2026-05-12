import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { staleSessionError } from './connection-guard';
import { resolveProviderSessionId } from '../resolver';
import { injectOpenCodeMessage } from '../injector';
import { getOpenCodePort } from '../session-tree-service';
import { getBackgroundSubagentById } from './manage-background-subagents';

type MessageDirection = 'to_parent' | 'to_subagent';

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

export function buildBackgroundSubagentMessage(input: {
  direction: MessageDirection;
  fromSessionId: string;
  toSessionId: string;
  message: string;
  reason?: string;
}): string {
  const lines = [
    '<background-subagent-message>',
    `- Direction: ${input.direction}`,
    `- From session: ${input.fromSessionId}`,
    `- To session: ${input.toSessionId}`,
  ];
  const reason = input.reason?.trim();
  if (reason) lines.push(`- Reason: ${reason}`);
  lines.push('', '<message>', input.message.trim(), '</message>');
  lines.push('</background-subagent-message>');
  return lines.join('\n');
}

export function resolveMessageTarget(input: {
  direction: MessageDirection;
  currentSessionId: string;
  backgroundSubagent?: {
    sessionId: string;
    parentSessionId: string;
  } | null;
  targetSessionId?: string;
}): { fromSessionId: string; toSessionId: string } | null {
  const explicitTarget = input.targetSessionId?.trim();
  if (explicitTarget) {
    return {
      fromSessionId: input.currentSessionId,
      toSessionId: explicitTarget,
    };
  }
  const record = input.backgroundSubagent;
  if (!record) return null;
  if (input.direction === 'to_parent') {
    return {
      fromSessionId: record.sessionId,
      toSessionId: record.parentSessionId,
    };
  }
  return {
    fromSessionId: input.currentSessionId,
    toSessionId: record.sessionId,
  };
}

export function registerMessageBackgroundSubagentTool(
  server: McpServer,
  connectionId: string,
): void {
  server.registerTool(
    'message_background_subagent',
    {
      title: 'Message background subagent',
      description: `<description>
Send a no-reply coordination message between a parent OpenCode session and a background subagent session.
Use this for real-time coordination such as pausing work before merging a worktree, asking another subagent to wait, or reporting cross-agent handoff state.
</description>

<importantNotes>
- (!important!) Messages are injected with noReply=true, so they notify the target session without asking it to immediately respond.
- (!important!) Prefer backgroundId for sessions created by manage_background_subagents. Use targetSessionId only when you already know the exact OpenCode session id.
- (!important!) Pass openCodeSessionId for the current caller session so routing stays correct with shared MCP clients.
- (!important!) Use direction="to_subagent" when the parent is messaging a child. Use direction="to_parent" when a background child is reporting to the parent.
</importantNotes>`,
      inputSchema: {
        direction: z.enum(['to_parent', 'to_subagent']),
        message: z.string().describe('Message text to inject into the target.'),
        backgroundId: z
          .string()
          .optional()
          .describe(
            'Background id returned by manage_background_subagents start.',
          ),
        targetSessionId: z
          .string()
          .optional()
          .describe('Explicit OpenCode target session id.'),
        reason: z.string().optional().describe('Short coordination reason.'),
        openCodeSessionId: z
          .string()
          .optional()
          .describe('Current OpenCode session id for routing.'),
      },
    },
    async ({
      direction,
      message,
      backgroundId,
      targetSessionId,
      reason,
      openCodeSessionId,
    }): Promise<CallToolResult> => {
      const currentSessionId = await resolveProviderSessionId(
        connectionId,
        openCodeSessionId,
      );
      const staleErr = currentSessionId
        ? staleSessionError(currentSessionId)
        : null;
      if (staleErr) return staleErr;
      if (!currentSessionId) {
        return jsonError(
          'MISSING_SESSION_ID',
          'Pass openCodeSessionId so the message can be routed from the current OpenCode session.',
        );
      }
      if (!message.trim()) {
        return jsonError('MISSING_MESSAGE', 'The message cannot be empty.');
      }
      const openCodePort = getOpenCodePort();
      if (openCodePort === null) {
        return jsonError(
          'OPENCODE_UNAVAILABLE',
          'OpenCode port is unavailable.',
        );
      }
      const backgroundSubagent = backgroundId
        ? getBackgroundSubagentById(backgroundId)
        : null;
      if (backgroundId && !backgroundSubagent) {
        return jsonError(
          'NOT_FOUND',
          `No background subagent found for id ${backgroundId}.`,
        );
      }
      const target = resolveMessageTarget({
        direction,
        currentSessionId,
        backgroundSubagent,
        targetSessionId,
      });
      if (!target) {
        return jsonError(
          'MISSING_TARGET',
          'Pass backgroundId or targetSessionId so the target session can be resolved.',
        );
      }
      const injected = await injectOpenCodeMessage(
        target.toSessionId,
        buildBackgroundSubagentMessage({
          direction,
          fromSessionId: target.fromSessionId,
          toSessionId: target.toSessionId,
          message,
          reason,
        }),
        undefined,
        openCodePort,
        undefined,
        true,
      );
      if (!injected.ok) {
        return jsonError(
          'INJECT_FAILED',
          injected.error ?? 'Failed to inject message into target session.',
        );
      }
      return jsonResult({
        ok: true,
        direction,
        fromSessionId: target.fromSessionId,
        toSessionId: target.toSessionId,
        noReply: true,
      });
    },
  );
}
