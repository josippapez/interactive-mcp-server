/**
 * Extract a message id from a URL hash fragment.
 *
 * Ported from opencode's `~/Desktop/opencode/packages/app/src/pages/session/
 * message-id-from-hash.ts`. Format: `#message-<id>`.
 *
 * Returns `undefined` when the hash is empty, malformed, or not a message
 * anchor — callers use the `undefined` branch to fall through to default
 * scroll-to-bottom behavior.
 */
export function messageIdFromHash(hash: string): string | undefined {
  const value = hash.startsWith('#') ? hash.slice(1) : hash;
  const match = value.match(/^message-(.+)$/);
  if (!match) return undefined;
  return match[1];
}

/** Build the anchor id for a given message id (`message-<id>`). */
export function messageAnchorId(id: string): string {
  return `message-${id}`;
}
