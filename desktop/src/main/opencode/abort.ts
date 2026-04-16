/**
 * Abort a running OpenCode session.
 *
 * Uses the OpenCode SDK to stop a running agent session.
 */

import { sessionAbort } from './session-api';

/**
 * Abort an OpenCode session by ID.
 *
 * @param openCodePort - The port OpenCode server is running on
 * @param sessionId - The OpenCode session ID to abort
 * @returns true if abort succeeded, false otherwise
 */
export async function abortOpenCodeSession(
  openCodePort: number,
  sessionId: string,
): Promise<boolean> {
  try {
    console.info(`[opencode-abort] Attempting to abort session ${sessionId}`);
    const response = await sessionAbort(openCodePort, sessionId, {
      signal: AbortSignal.timeout(5000),
    });

    console.info(
      `[opencode-abort] Abort response for ${sessionId}:`,
      JSON.stringify({ data: response.data, error: response.error }),
    );

    if (response.error) {
      console.warn(
        `[opencode-abort] Failed to abort session ${sessionId}: ${JSON.stringify(response.error)}`,
      );
      return false;
    }

    // The SDK returns the boolean directly in response.data
    const data = response.data;
    if (typeof data === 'boolean') {
      return data;
    }

    console.warn(
      `[opencode-abort] Unexpected response format for session ${sessionId}:`,
      data,
    );
    return false;
  } catch (err) {
    // Don't log AbortError (timeout) as it's expected when server is unavailable
    if ((err as { name?: string }).name !== 'AbortError') {
      console.warn(`[opencode-abort] Error aborting session:`, err);
    }
    return false;
  }
}
