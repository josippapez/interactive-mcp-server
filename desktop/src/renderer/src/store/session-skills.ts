/**
 * Per-session skills/instructions injection state.
 *
 * Tracks which DB-stored skills/instructions are **active for the current
 * session** — i.e. will be injected into the agent context on the next
 * bootstrap. The active set is defined as:
 *
 *   (scope === 'global' && !muted.has(name)) ||
 *   (scope === 'session-scoped' && optedIn.has(name))
 *
 * Source of truth is the main-process DB (two tables:
 * `session_scoped_entries` for session-scoped opt-ins, `session_muted_entries`
 * for per-session mutes on global entries). This module holds an in-memory
 * cache per `(providerType, providerSessionId)` and invalidates it on the
 * `onSkillsUpdated` IPC event.
 *
 * Distinct from `channel-preferences.ts` in two ways:
 * - DB-backed (not localStorage).
 * - Two parallel name-sets (opt-ins + mutes) per session, loaded together.
 */

import { atom, useAtomValue, useSetAtom } from 'jotai';
import { useCallback, useMemo } from 'react';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface SessionSkillsSelection {
  /** Names of session-scoped entries this session opted into. */
  optedIn: Set<string>;
  /** Names of global entries this session muted. */
  muted: Set<string>;
  /** Whether the cache has been loaded from the DB at least once. */
  loaded: boolean;
}

/** Composite cache key: `${providerType}:${providerSessionId}`. */
export type SessionSkillsKey = string;

export function makeSessionSkillsKey(
  providerType: string,
  providerSessionId: string,
): SessionSkillsKey {
  return `${providerType}:${providerSessionId}`;
}

function emptySelection(): SessionSkillsSelection {
  return { optedIn: new Set(), muted: new Set(), loaded: false };
}

// -----------------------------------------------------------------------------
// Base atom — Map<key, selection>
// -----------------------------------------------------------------------------

export const sessionSkillsMapAtom = atom<
  Map<SessionSkillsKey, SessionSkillsSelection>
>(new Map());

// -----------------------------------------------------------------------------
// Action atoms
// -----------------------------------------------------------------------------

/**
 * Load (or reload) opt-ins + mutes for a session from the main-process DB.
 * Idempotent — overwrites any cached selection for the key.
 */
export const loadSessionSkillsAtom = atom(
  null,
  async (
    get,
    set,
    action: { providerType: string; providerSessionId: string },
  ) => {
    const { providerType, providerSessionId } = action;
    const key = makeSessionSkillsKey(providerType, providerSessionId);
    const [optedInList, mutedList] = await Promise.all([
      window.api.listSessionScopedEntries(providerType, providerSessionId),
      window.api.listSessionMutedEntries(providerType, providerSessionId),
    ]);
    const next = new Map(get(sessionSkillsMapAtom));
    next.set(key, {
      optedIn: new Set(optedInList),
      muted: new Set(mutedList),
      loaded: true,
    });
    set(sessionSkillsMapAtom, next);
  },
);

/**
 * Toggle whether a session-scoped entry is opted in for the session.
 * Optimistically updates the cache, then persists via IPC.
 */
export const toggleSessionOptInAtom = atom(
  null,
  async (
    get,
    set,
    action: {
      providerType: string;
      providerSessionId: string;
      entryName: string;
    },
  ) => {
    const { providerType, providerSessionId, entryName } = action;
    const key = makeSessionSkillsKey(providerType, providerSessionId);
    const current = get(sessionSkillsMapAtom).get(key) ?? emptySelection();
    const nextOptedIn = new Set(current.optedIn);
    if (nextOptedIn.has(entryName)) nextOptedIn.delete(entryName);
    else nextOptedIn.add(entryName);
    const next = new Map(get(sessionSkillsMapAtom));
    next.set(key, { ...current, optedIn: nextOptedIn, loaded: true });
    set(sessionSkillsMapAtom, next);
    await window.api.setSessionScopedEntries(
      providerType,
      providerSessionId,
      Array.from(nextOptedIn),
    );
  },
);

/**
 * Toggle whether a global entry is muted for the session.
 * Optimistically updates the cache, then persists via IPC.
 */
export const toggleSessionMuteAtom = atom(
  null,
  async (
    get,
    set,
    action: {
      providerType: string;
      providerSessionId: string;
      entryName: string;
    },
  ) => {
    const { providerType, providerSessionId, entryName } = action;
    const key = makeSessionSkillsKey(providerType, providerSessionId);
    const current = get(sessionSkillsMapAtom).get(key) ?? emptySelection();
    const nextMuted = new Set(current.muted);
    if (nextMuted.has(entryName)) nextMuted.delete(entryName);
    else nextMuted.add(entryName);
    const next = new Map(get(sessionSkillsMapAtom));
    next.set(key, { ...current, muted: nextMuted, loaded: true });
    set(sessionSkillsMapAtom, next);
    await window.api.setSessionMutedEntries(
      providerType,
      providerSessionId,
      Array.from(nextMuted),
    );
  },
);

/** Invalidate the cache for all sessions — used on `onSkillsUpdated`. */
export const invalidateSessionSkillsAtom = atom(null, (_get, set) => {
  set(sessionSkillsMapAtom, new Map());
});

// -----------------------------------------------------------------------------
// Derived selection for a single session
// -----------------------------------------------------------------------------

export function sessionSkillsSelectionAtom(
  providerType: string | null,
  providerSessionId: string | null,
) {
  return atom((get): SessionSkillsSelection => {
    if (!providerType || !providerSessionId) return emptySelection();
    const key = makeSessionSkillsKey(providerType, providerSessionId);
    return get(sessionSkillsMapAtom).get(key) ?? emptySelection();
  });
}

// -----------------------------------------------------------------------------
// Pure decision: is an entry active for this session?
// -----------------------------------------------------------------------------

/**
 * Returns true if the entry will be injected into the session based on its
 * scope and the session's opt-in/mute sets. Pure — exported for unit tests
 * and reuse from the renderer panel.
 */
export function isEntryActiveForSession(
  entry: { name: string; scope: 'global' | 'session-scoped' },
  selection: Pick<SessionSkillsSelection, 'optedIn' | 'muted'>,
): boolean {
  if (entry.scope === 'global') return !selection.muted.has(entry.name);
  return selection.optedIn.has(entry.name);
}

// -----------------------------------------------------------------------------
// Hooks
// -----------------------------------------------------------------------------

export function useSessionSkillsSelection(
  providerType: string | null,
  providerSessionId: string | null,
): SessionSkillsSelection {
  const selectionAtom = useMemo(
    () => sessionSkillsSelectionAtom(providerType, providerSessionId),
    [providerType, providerSessionId],
  );
  return useAtomValue(selectionAtom);
}

export function useLoadSessionSkills(): (
  providerType: string,
  providerSessionId: string,
) => Promise<void> {
  const load = useSetAtom(loadSessionSkillsAtom);
  return useCallback(
    (providerType, providerSessionId) =>
      load({ providerType, providerSessionId }),
    [load],
  );
}

export function useToggleSessionOptIn(): (
  providerType: string,
  providerSessionId: string,
  entryName: string,
) => Promise<void> {
  const toggle = useSetAtom(toggleSessionOptInAtom);
  return useCallback(
    (providerType, providerSessionId, entryName) =>
      toggle({ providerType, providerSessionId, entryName }),
    [toggle],
  );
}

export function useToggleSessionMute(): (
  providerType: string,
  providerSessionId: string,
  entryName: string,
) => Promise<void> {
  const toggle = useSetAtom(toggleSessionMuteAtom);
  return useCallback(
    (providerType, providerSessionId, entryName) =>
      toggle({ providerType, providerSessionId, entryName }),
    [toggle],
  );
}

export function useInvalidateSessionSkills(): () => void {
  return useSetAtom(invalidateSessionSkillsAtom);
}
