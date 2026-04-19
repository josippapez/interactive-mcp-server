import { atom } from 'jotai';
import type { Atom } from 'jotai';

/**
 * Sticky-in-session OpenCode agent override map, keyed by `connectionId`.
 *
 * - Lifetime: in-memory only. The map is cleared on app restart so the user
 *   always starts a fresh app with the OpenCode session's default agent.
 * - Scope: the agent stays selected across multiple prompts inside the same
 *   channel (connectionId) until the user changes it or starts a new
 *   session. Other channels' selections are isolated.
 * - Empty/whitespace agent names are normalised to "no override" and the
 *   key is removed so the wire-level `agent` field stays absent (OpenCode
 *   then falls back to the session's default agent).
 */
export const sessionAgentsAtom = atom<Map<string, string>>(new Map());

type SetSessionAgentPayload = {
  connectionId: string;
  agent: string | null;
};

/**
 * Setter atom: record (or clear) the per-channel agent override.
 * Trims whitespace; whitespace-only or empty strings remove the entry so
 * the override is treated as absent.
 */
export const setSessionAgentAtom = atom(
  null,
  (get, set, payload: SetSessionAgentPayload) => {
    const next = new Map(get(sessionAgentsAtom));
    const trimmed = payload.agent?.trim();
    if (!trimmed) {
      next.delete(payload.connectionId);
    } else {
      next.set(payload.connectionId, trimmed);
    }
    set(sessionAgentsAtom, next);
  },
);

/**
 * Setter atom: explicitly clear the recorded agent for one connectionId.
 * No-op when the connectionId has no entry.
 */
export const clearSessionAgentAtom = atom(
  null,
  (get, set, connectionId: string) => {
    const current = get(sessionAgentsAtom);
    if (!current.has(connectionId)) return;
    const next = new Map(current);
    next.delete(connectionId);
    set(sessionAgentsAtom, next);
  },
);

/**
 * Snapshot helper for non-React callers (e.g. message-dispatch wiring).
 *
 * Returns the recorded agent override for a connectionId, or `null` when
 * no override is recorded or the input is nullish/whitespace-only.
 *
 * Accepts a minimal store shape (`{ get(atom) }`) so this stays compatible
 * with both the default jotai store and `createStore()`-based test stores
 * without importing react.
 */
type StoreLike = { get<T>(atom: Atom<T>): T };

export function getSessionAgent(
  store: StoreLike,
  connectionId: string | null | undefined,
): string | null {
  if (!connectionId) return null;
  const recorded = store.get(sessionAgentsAtom).get(connectionId);
  const trimmed = recorded?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}
