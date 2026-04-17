/**
 * Error helpers shared across the main process.
 *
 * These replace the ad-hoc `err instanceof Error ? err.message : String(err)`
 * pattern that was duplicated in handlers, config-io, mcp-inject, etc.
 */

/**
 * Coerce an unknown thrown value into a human-readable string.
 *
 * - `Error` → `error.message`
 * - anything else → `String(value)`
 */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Build a new `Error` that wraps an upstream cause.
 *
 * Equivalent to `new Error(message, { cause })` but saves callers one line
 * and documents the intent (preserve-caught-error policy).
 */
export function errWithCause(message: string, cause: unknown): Error {
  return new Error(message, { cause });
}
