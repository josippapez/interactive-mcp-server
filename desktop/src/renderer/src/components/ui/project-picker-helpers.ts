/**
 * Pure helpers for `<ProjectPicker>`.
 *
 * Extracted so they can be unit tested under the node-based vitest environment
 * (no DOM / @testing-library/react available).
 */

export type PinnedProject = {
  path: string;
  name: string;
  createdAt: string;
};

export type ProjectOption = {
  /** Filesystem path – used both as option value and key. */
  path: string;
  /** Human-readable display name. */
  label: string;
};

export const OTHER_OPTION_VALUE = '__other__';

/**
 * Normalise pinned-project entries into stable, deduplicated options.
 *
 * - Drops entries with empty paths.
 * - Falls back to the trailing path segment when `name` is empty / whitespace.
 * - Deduplicates by `path`, preferring the first occurrence (the API already
 *   returns projects in the user's desired order).
 */
export function toProjectOptions(
  pinned: readonly PinnedProject[],
): ProjectOption[] {
  const seen = new Set<string>();
  const out: ProjectOption[] = [];
  for (const p of pinned) {
    const path = p?.path?.trim();
    if (!path) continue;
    if (seen.has(path)) continue;
    seen.add(path);
    const rawName = p?.name?.trim();
    const fallback = path.split('/').filter(Boolean).pop() ?? path;
    out.push({
      path,
      label: rawName && rawName.length > 0 ? rawName : fallback,
    });
  }
  return out;
}

/**
 * Determine which `<select>` value should be rendered given the current
 * free-form value and the pinned options.
 *
 * - Empty value -> empty string (renders the placeholder option).
 * - Matching pinned path -> that path.
 * - Anything else -> the sentinel `OTHER_OPTION_VALUE` so the free-text input
 *   is revealed.
 */
export function resolveSelectValue(
  value: string,
  options: readonly ProjectOption[],
): string {
  if (!value) return '';
  return options.some((o) => o.path === value) ? value : OTHER_OPTION_VALUE;
}
