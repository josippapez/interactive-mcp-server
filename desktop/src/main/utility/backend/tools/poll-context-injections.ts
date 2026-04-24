import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { claimContextInjections } from '../database';
import {
  staleSessionError,
  requireProviderSessionId,
} from './connection-guard';
import { resolveProviderSessionId } from '../resolver';

/**
 * Register the `poll_context_injections` MCP tool.
 *
 * This tool is the noReply equivalent for Copilot CLI / standalone mode. The
 * desktop app can queue context injections (e.g. relevant repo docs) that the
 * agent claims by calling this tool. Each injection is delivered exactly once.
 *
 * The tool description instructs the agent to call it at the start of each
 * new user task so injected context arrives before the agent starts acting on
 * the request.
 */
export function registerPollContextInjectionsTool(
  server: McpServer,
  connectionId: string,
  requireSessionId = false,
): void {
  server.registerTool(
    'poll_context_injections',
    {
      description: `<description>
Check for pending context messages injected by the desktop app into this agent session.
Returns any queued system notifications (e.g. relevant repo docs, instructions) that the
desktop has prepared for you. Each injection is delivered exactly once and cleared on receipt.
</description>

<importantNotes>
- (!important!) Call this tool at the **start of every new user task** before acting on the request.
- (!important!) If any injections are returned, process them as system notifications before proceeding.
- (!important!) Injections are also auto-prepended to request_user_input responses — calling this
  tool explicitly ensures you have context before performing tool calls or producing output.
- (!important!) Returns an empty result immediately when no injections are pending — always safe to call.
- (!important!) You MUST pass your openCodeSessionId (format: ses_<alphanumeric>) with every call. It was injected into your context at session start.
</importantNotes>

<whenToUseThisTool>
- At the start of each new user task or request
- Before making decisions that may depend on repository-specific context
- After calling register_connection, to receive any startup context that was queued
</whenToUseThisTool>`,
      inputSchema: {
        openCodeSessionId: z
          .string()
          .optional()
          .describe(
            'Your OpenCode session ID (format: ses_<alphanumeric>). Required for correct routing in multi-agent scenarios.',
          ),
      },
    },
    async ({ openCodeSessionId }): Promise<CallToolResult> => {
      // Resolve providerSessionId at the tool boundary.
      const providerSessionId = await resolveProviderSessionId(
        connectionId,
        openCodeSessionId,
      );

      const staleErr = providerSessionId
        ? staleSessionError(providerSessionId)
        : null;
      if (staleErr) return staleErr;

      const missingParamErr = requireProviderSessionId(
        providerSessionId,
        requireSessionId,
      );
      if (missingParamErr) return missingParamErr;

      // When requireSessionId is true we have a non-null providerSessionId
      // (guard above). For standalone/non-OpenCode callers that don't supply
      // one, fall back to connectionId for keying.
      const injectionKey = providerSessionId ?? connectionId;
      const providerType = requireSessionId ? 'opencode' : 'standalone';
      const items = await claimContextInjections(injectionKey, providerType);
      if (items.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                injections: [],
                message: 'No pending context injections.',
              }),
            },
          ],
        };
      }

      const notifications = items
        .map(
          (item: { payload: string }) =>
            `<system_notification>\n${item.payload}\n</system_notification>`,
        )
        .join('\n\n');

      return {
        content: [
          {
            type: 'text' as const,
            text: notifications,
          },
        ],
      };
    },
  );
}
