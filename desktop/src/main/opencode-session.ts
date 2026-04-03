/**
 * Shared utility for detecting the active OpenCode session via its HTTP API.
 *
 * Strategy:
 * 1. Query /session?directory=<dir> for directory-scoped sessions.
 * 2. If that returns nothing, fall back to /session (all sessions).
 * 3. Return the most-recently-updated session ID, or null on any failure.
 */
export async function autoDetectOpenCodeSession(
  openCodePort: number,
  baseDirectory?: string,
): Promise<string | null> {
  try {
    const dir = baseDirectory ?? process.cwd();
    const url = `http://localhost:${openCodePort}/session?directory=${encodeURIComponent(dir)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return null;
    let sessions = (await res.json()) as Array<{
      id: string;
      time?: { updated?: number };
    }>;
    // If directory-scoped query returned nothing, fall back to all sessions
    if (!Array.isArray(sessions) || sessions.length === 0) {
      const fallback = await fetch(`http://localhost:${openCodePort}/session`, {
        signal: AbortSignal.timeout(2000),
      });
      if (!fallback.ok) return null;
      sessions = (await fallback.json()) as Array<{
        id: string;
        time?: { updated?: number };
      }>;
    }
    if (!Array.isArray(sessions) || sessions.length === 0) return null;
    // Sort by most recently updated and take the first
    const sorted = [...sessions].sort(
      (a, b) => (b.time?.updated ?? 0) - (a.time?.updated ?? 0),
    );
    return sorted[0].id ?? null;
  } catch {
    return null;
  }
}
