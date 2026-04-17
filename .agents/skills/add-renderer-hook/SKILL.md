---
name: add-renderer-hook
description: Add a new React hook in the renderer, following TDD by extracting pure helpers and co-locating tests. Covers naming, useIpcQuery/useIpcMutation integration, and extraction conventions.
when_to_use:
  - Adding a new React hook under `src/renderer/src/hooks/`.
  - Refactoring logic out of a component or another hook into a testable pure helper.
  - Wrapping a `window.api.*` call for ergonomic renderer consumption.
---

# Skill: add-renderer-hook

Creates a new renderer hook with pure-helper extraction + co-located tests,
following the repo's TDD-friendly structure.

Pair with: [`desktop/docs/PATTERNS.md §3`](../../desktop/docs/PATTERNS.md#3-renderer-ipc-consumption-pattern)
and [`desktop/docs/PATTERNS.md §6`](../../desktop/docs/PATTERNS.md#6-testing-conventions).

---

## Critical rules

1. **Hook files use the `useX` prefix.** E.g. `useNotifications.ts`.
2. **Pure helpers have no prefix.** E.g. `notifications-merge.ts` contains
   the pure function, `useNotifications.ts` is the thin React wrapper.
3. **Co-locate tests.** `notifications-merge.ts` ↔ `notifications-merge.test.ts`.
4. **Test env is `node`.** Tests run against pure helpers, not React
   components. Do not import React in `.test.ts` files.
5. **Never `useMemo` for side effects.** Use `useEffect` for setter calls
   or singleton mutations.
6. **Never add a hook after an early `return`.** React throws on
   conditional hook order.
7. **Prefer `useIpcQuery` / `useIpcMutation`** over hand-rolling
   `if (!result.ok)` in every hook.

---

## Steps

### 1. Red — write the failing test first

Path: `desktop/src/renderer/src/hooks/<feature>-<aspect>.test.ts`

Write a test asserting the behaviour of a pure helper that does not yet
exist. Example:

```ts
import { describe, it, expect } from 'vitest';
import { mergePreferences } from './notifications-merge';

describe('mergePreferences', () => {
  it('overlays user prefs on top of defaults', () => {
    expect(
      mergePreferences({ soundEnabled: true }, { soundEnabled: false }),
    ).toEqual({ soundEnabled: false });
  });
});
```

### 2. Green — implement the pure helper

Path: `desktop/src/renderer/src/hooks/<feature>-<aspect>.ts`

Export one or more named functions. No React imports. No side effects.

### 3. Wrap in a thin hook

Path: `desktop/src/renderer/src/hooks/use<Feature>.ts`

```ts
import { useIpcQuery } from './useIpcQuery';
import { mergePreferences } from './notifications-merge';

export function useNotifications(baseDirectory?: string) {
  const { data, error, loading, refetch } = useIpcQuery(
    () => window.api.sendTestNotification('ping'),
    [baseDirectory],
  );

  return { data, error, loading, refetch };
}
```

The hook should be thin — any interesting logic belongs in the pure helper
so it can be unit-tested.

### 4. Good extraction examples

- `session-tree-merge.ts` + `.test.ts` — merge logic pulled out of
  `useIpcListeners`.
- `delta-batcher-core.ts` + `.test.ts` — streaming-delta scheduler pulled
  out of `useConversation`.
- `remove-session-target.ts` + `.test.ts`.
- `model-override-persistence.ts` + `.test.ts`.

### 5. Validate

```sh
cd desktop
npm test -- --run
```

---

## Anti-patterns

- Putting all the logic inside the hook body, then needing React test utils
  to cover it — extract first.
- Using `useMemo(() => { setSomething(x); return y; }, [x])` — this is a
  side effect; use `useEffect`.
- Adding a `useEffect` after `if (!data) return null;` — hook order rule
  violation.
- Copy-pasting `if (!result.ok) return ...` patterns into new hooks —
  switch to `useIpcQuery`.
- Using `Array.includes()` / `.find()` in a hot render path — prefer
  `Set` / `Map` for O(1) lookups.

---

## Reference files

- Primitive: `src/renderer/src/hooks/useIpcQuery.ts`
- Mutation primitive: `src/renderer/src/hooks/useIpcMutation.ts`
- Inline status UI: `src/renderer/src/components/ui/InlineStatus.tsx`
- Example extraction: `src/renderer/src/hooks/session-tree-merge.ts`
- Vitest config: `desktop/vitest.config.ts`
- Pattern doc: `desktop/docs/PATTERNS.md`
