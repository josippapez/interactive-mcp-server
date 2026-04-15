/**
 * localStorage persistence for per-session model overrides.
 *
 * Stores the user's model selection (provider, model, variant) per OpenCode
 * session so it survives page refreshes and Electron renderer reloads.
 */

/** Shape of a persisted model override (same fields as ModelOverride). */
export interface PersistedModelOverride {
  providerId: string;
  modelId: string;
  variant?: string;
}

/** localStorage key used for model overrides. */
export const STORAGE_KEY = 'imcp-model-overrides';

/**
 * Load model overrides from localStorage.
 *
 * @returns Map of openCodeSessionId → PersistedModelOverride
 */
export function loadModelOverrides(): Map<string, PersistedModelOverride> {
  const result = new Map<string, PersistedModelOverride>();

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return result;

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
      return result;

    const entries = parsed as Record<string, unknown>;
    for (const [key, value] of Object.entries(entries)) {
      if (typeof value !== 'object' || value === null) continue;

      const entry = value as Record<string, unknown>;
      if (typeof entry.providerId !== 'string') continue;
      if (typeof entry.modelId !== 'string') continue;

      const override: PersistedModelOverride = {
        providerId: entry.providerId,
        modelId: entry.modelId,
      };
      if (typeof entry.variant === 'string') {
        override.variant = entry.variant;
      }
      result.set(key, override);
    }
  } catch {
    // Invalid data — return empty map
  }

  return result;
}

/**
 * Save model overrides to localStorage.
 *
 * @param overrides - Map of openCodeSessionId → PersistedModelOverride
 */
export function saveModelOverrides(
  overrides: Map<string, PersistedModelOverride>,
): void {
  try {
    const obj: Record<string, PersistedModelOverride> = {};
    for (const [key, value] of overrides) {
      obj[key] = value;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch {
    // localStorage quota exceeded or unavailable — silently ignore
  }
}
