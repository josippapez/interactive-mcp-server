/**
 * Pure helper used by `usePromptNavigationState` to decide whether a
 * pending agent override should be persisted into `sessionAgentsAtom`
 * the moment the renderer first resolves a newly created OpenCode
 * session to its renderer-side `connectionId` (a.k.a. `nodeId`).
 *
 * Background:
 *   When the user starts a new session via `NewSessionInput` and picks a
 *   custom agent (e.g. "self-improvement"), the agent is forwarded to
 *   `createOpenCodeSession` so the first turn runs under that agent. But
 *   `sessionAgentsAtom` (in-memory selector state, keyed by `connectionId`)
 *   is never written to in that flow, so the bottom-bar selector falls
 *   back to "default" and the next message routes to OpenCode's default
 *   agent (typically "build"). This helper closes that gap by emitting a
 *   `(connectionId, agent)` payload only when the matched session is the
 *   one we have a pending agent for, and only when that agent is non-empty.
 *
 * Pure on purpose: keeps the navigation hook thin and lets us cover this
 * decision without React/Jotai test infrastructure.
 */

export interface PendingNewSessionAgent {
  sessionId: string;
  agent: string;
}

export interface ResolvePendingAgentArgs {
  matchedNodeId: string;
  matchedSessionId: string;
  pendingNewSessionAgent: PendingNewSessionAgent | null;
}

export interface PendingAgentAssignment {
  connectionId: string;
  agent: string;
}

/**
 * Returns the assignment to write into `sessionAgentsAtom`, or `null` when
 * nothing should be written. The caller is responsible for clearing
 * `pendingNewSessionAgent` after applying the assignment.
 */
export function resolvePendingAgentAssignment(
  args: ResolvePendingAgentArgs,
): PendingAgentAssignment | null {
  const { matchedNodeId, matchedSessionId, pendingNewSessionAgent } = args;
  if (!pendingNewSessionAgent) return null;
  if (pendingNewSessionAgent.sessionId !== matchedSessionId) return null;
  const trimmed = pendingNewSessionAgent.agent.trim();
  if (trimmed.length === 0) return null;
  return { connectionId: matchedNodeId, agent: trimmed };
}
