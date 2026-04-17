/**
 * JSONC (JSON with comments) helpers shared across the main process.
 *
 * `stripJsonComments` removes `//` line comments and `/* ... *\/` block
 * comments while respecting string literals. It is a best-effort parser
 * — it does not understand every JS5 edge case, but is sufficient for the
 * simple `opencode.jsonc` style used throughout this app.
 */

import { errorMessage, errWithCause } from './errors';

/**
 * Strip `//` line comments and `/* ... *\/` block comments from a
 * JSON-with-comments string. Respects string literals (does not strip inside
 * a double-quoted string).
 */
export function stripJsonComments(text: string): string {
  let result = '';
  let inString = false;
  let escaped = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];

    if (escaped) {
      result += ch;
      escaped = false;
      i++;
      continue;
    }

    if (ch === '\\' && inString) {
      result += ch;
      escaped = true;
      i++;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      result += ch;
      i++;
      continue;
    }

    if (!inString) {
      if (ch === '/' && next === '/') {
        while (i < text.length && text[i] !== '\n') i++;
        continue;
      }
      if (ch === '/' && next === '*') {
        i += 2;
        while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
          i++;
        }
        i += 2;
        continue;
      }
    }

    result += ch;
    i++;
  }

  return result;
}

/**
 * Strip comments and parse a JSONC string into `T`.
 *
 * On parse failure, throws a single wrapped `Error` whose `message` includes
 * the underlying parser error, and whose `cause` is the original `SyntaxError`.
 * This keeps one clear failure surface for callers.
 */
export function parseJsonc<T>(raw: string): T {
  const stripped = stripJsonComments(raw);
  try {
    return JSON.parse(stripped) as T;
  } catch (err) {
    throw errWithCause(`Failed to parse JSONC: ${errorMessage(err)}`, err);
  }
}
