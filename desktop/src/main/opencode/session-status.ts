/**
 * Fetch session status from the OpenCode server.
 *
 * Uses the OpenCode HTTP API at GET /session/status to get status for all sessions.
 */

import {
  buildOpenCodePortCandidates,
  fetchJsonFromAllReachable,
} from './endpoints';

export type SessionStatusType = 'busy' | 'idle' | 'error' | 'unknown';

export interface SessionStatusMap {
  [sessionId: string]: {
    type: SessionStatusType;
  };
}

/**
 * Fetch session status for all sessions from the OpenCode server.
 *
 * @param openCodePort - The port OpenCode server is running on
 * @returns Map of session IDs to their status, or null on error
 */
export async function fetchSessionStatus(
  openCodePort: number,
): Promise<SessionStatusMap | null> {
  const ports = buildOpenCodePortCandidates(openCodePort);

  try {
    const responses = await fetchJsonFromAllReachable<
      Record<string, { type?: string } | undefined>
    >(ports, '/session/status', 3000);
    if (responses.length === 0) {
      return null;
    }

    // Normalize the response to our SessionStatusMap type
    const result: SessionStatusMap = {};
    for (const { data } of responses) {
      for (const [sessionId, status] of Object.entries(data)) {
        if (status && typeof status.type === 'string') {
          result[sessionId] = {
            type: normalizeStatusType(status.type),
          };
        }
      }
    }

    return result;
  } catch {
    return null;
  }
}

/**
 * Normalize status type string to known values.
 */
function normalizeStatusType(type: string): SessionStatusType {
  switch (type.toLowerCase()) {
    case 'busy':
      return 'busy';
    case 'idle':
      return 'idle';
    case 'error':
      return 'error';
    default:
      return 'unknown';
  }
}
