/**
 * Pure helpers for detecting Task-tool-spawned subagent sessions from
 * `message.part.updated.1` SSE events.
 *
 * OpenCode's `/global/event` stream does NOT emit `session.created.1` for
 * child sessions spawned by the Task tool. The only compensating signal is
 * a `message.part.updated.1` event whose `part.tool` is (case-insensitively)
 * `"task"` and whose `part.state.metadata` carries the child session ID
 * under one of a few possible keys (`sessionId`, `sessionID`,
 * `childSessionID`).
 *
 * These helpers are pure — no side effects, no I/O — so they can be unit
 * tested directly without mocking the SSE stream.
 */

/**
 * Returns true if the given message part represents a Task-tool invocation,
 * matching the tool name case-insensitively (so `"task"`, `"Task"`, `"TASK"`
 * all match).
 */
export function isTaskToolPart(part: Record<string, unknown>): boolean {
  const tool = part['tool'];
  if (typeof tool !== 'string') return false;
  return tool.toLowerCase() === 'task';
}

/**
 * Resolve the child (subagent) session ID from a `message.part.updated.1`
 * part payload. Checks multiple metadata key names that OpenCode has used
 * or may use in the future:
 *
 *   - `metadata.sessionId`      (original lowercase form)
 *   - `metadata.sessionID`      (uppercase ID — matches OpenCode's
 *                                 `sessionID` convention elsewhere)
 *   - `metadata.childSessionID` (explicit "child" naming)
 *
 * Returns `null` if this is not a Task tool part or no usable child session
 * ID can be found.
 */
export function resolveChildSessionIdFromTaskPart(
  part: Record<string, unknown>,
): string | null {
  if (!isTaskToolPart(part)) return null;

  const partState = part['state'] as Record<string, unknown> | undefined;
  const metadata = partState?.['metadata'] as
    | Record<string, unknown>
    | undefined;
  if (!metadata) return null;

  const candidate =
    metadata['sessionId'] ??
    metadata['sessionID'] ??
    metadata['childSessionID'];

  if (typeof candidate !== 'string' || candidate.length === 0) return null;
  return candidate;
}
