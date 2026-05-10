/**
 * Build the `Authorization: Basic …` header value used by the OpenCode
 * binary (Mode C) when launched with `OPENCODE_SERVER_PASSWORD`.
 *
 * Lives here (not inside the SDK cache) because:
 *   - The SDK cache's interceptor only fires for SDK-routed requests.
 *   - Our health probe and managed-process readiness probe both bypass
 *     the SDK and use raw `node:http` / `fetch` (see comments in
 *     `health.ts` for the undici-vs-loopback rationale).
 *   - Both paths still need auth in Mode C, so they import this helper.
 *
 * Returns `null` when no password has been published yet — callers
 * should simply omit the header in that case (Mode A serves
 * unauthenticated; the binary in Mode B/C will return 401 if it does
 * have a password set, which is the desired feedback).
 */

import { Buffer } from 'node:buffer';

import { getOpenCodePassword } from '../../shared/opencode-password-source';

/** Returns `Basic <base64>` or `null` if no password is currently set. */
export function buildOpenCodeBasicAuthHeader(): string | null {
  const pwd = getOpenCodePassword();
  if (!pwd) return null;
  // OpenCode binary fixes the username at `opencode`; only the password
  // varies per spawn.
  const encoded = Buffer.from(`opencode:${pwd}`, 'utf8').toString('base64');
  return `Basic ${encoded}`;
}
