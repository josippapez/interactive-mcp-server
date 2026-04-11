/**
 * Abort a running OpenCode session.
 *
 * Uses the OpenCode HTTP API at POST /session/:id/abort to stop
 * a running agent session.
 */

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
  const url = `http://localhost:${openCodePort}/session/${sessionId}/abort`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
      headers: { Accept: 'application/json' },
    });

    if (!res.ok) {
      console.warn(
        `[opencode-abort] Failed to abort session ${sessionId}: ${res.status}`,
      );
      return false;
    }

    const data = (await res.json()) as unknown;
    // The API returns boolean
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
