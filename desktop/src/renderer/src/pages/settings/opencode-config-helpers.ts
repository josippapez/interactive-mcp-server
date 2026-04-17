/**
 * Pure helpers for the OpenCode Config settings section.
 * Extracted from the React component so they can be unit-tested without a DOM.
 */

export type ParseResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string };

/**
 * Parse a JSON string and require the root to be a plain object.
 * Returns a discriminated union so the caller can show the parse error inline.
 */
export function safeParseJson(text: string): ParseResult {
  try {
    const parsed: unknown = JSON.parse(text);
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed)
    ) {
      return { ok: false, error: 'Root must be a JSON object.' };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Invalid JSON',
    };
  }
}

/**
 * Read a string-typed field from a config object, coercing any non-string
 * value (missing, null, number, nested object) to an empty string.
 */
export function getStringField(
  config: Record<string, unknown> | null | undefined,
  key: string,
): string {
  if (!config) return '';
  const v = config[key];
  return typeof v === 'string' ? v : '';
}

export type CommonFields = {
  model: string;
  theme: string;
  provider: string;
};

/**
 * Merge the common-fields form values back into the parsed config object.
 * Empty/blank values remove the corresponding key so users can clear a field.
 */
export function mergeCommonFields(
  base: Record<string, unknown>,
  fields: CommonFields,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...base };
  (Object.keys(fields) as Array<keyof CommonFields>).forEach((k) => {
    const trimmed = fields[k].trim();
    if (trimmed.length > 0) {
      next[k] = trimmed;
    } else {
      delete next[k];
    }
  });
  return next;
}

/**
 * Detect whether the loaded config contains the managed
 * `mcp["interactive-desktop"]` entry so the UI can show the read-only notice.
 */
export function hasManagedInteractiveDesktopKey(
  config: Record<string, unknown> | null,
): boolean {
  if (!config) return false;
  const mcp = config.mcp;
  if (!mcp || typeof mcp !== 'object' || Array.isArray(mcp)) return false;
  return 'interactive-desktop' in (mcp as Record<string, unknown>);
}

export function stringifyConfigPretty(
  config: Record<string, unknown> | null,
): string {
  if (!config) return '{}';
  return JSON.stringify(config, null, 2);
}
