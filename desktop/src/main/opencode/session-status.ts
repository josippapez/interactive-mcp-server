/**
 * Fetch session status from the OpenCode server.
 *
 * Uses the OpenCode SDK's session.status() to get status for all sessions.
 */

import { getClient } from './sdk-client';

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
  try {
    const client = getClient(openCodePort);
    const response = await client.session.status({
      signal: AbortSignal.timeout(3000),
    });

    if (response.error) return null;

    const data = response.data;
    if (!data || typeof data !== 'object') return null;

    // Normalize the response to our SessionStatusMap type
    const result: SessionStatusMap = {};
    for (const [sessionId, status] of Object.entries(
      data as Record<string, { type?: string } | undefined>,
    )) {
      if (status && typeof status.type === 'string') {
        result[sessionId] = {
          type: normalizeStatusType(status.type),
        };
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
