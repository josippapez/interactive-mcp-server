---
applyTo: '**'
name: test-driven-development
description: Enforce a test-first workflow for all non-trivial code changes.
---

# Test-Driven Development (TDD)

Follow the Red-Green-Refactor cycle for all non-trivial code changes.

## Required workflow

1. **Red** — Write a failing test that describes the expected behavior before writing any implementation code.
2. **Green** — Write the minimum implementation to make the test pass.
3. **Refactor** — Clean up the implementation while keeping all tests green.

## When TDD is mandatory

- Bug fixes — write a test that reproduces the bug before fixing it.
- New features — write tests that describe the feature's contract before implementing.
- Behavioral changes — write tests that assert the new behavior before changing code.
- Refactors that change public API — write tests for the new API shape first.

## When TDD can be skipped

- Pure formatting/style changes with no behavioral impact.
- Single-line typo fixes.
- Documentation-only changes.
- Exploratory prototyping (but tests must be added before merging).

## Test organization

- Co-locate unit tests next to the module: `foo.ts` → `foo.test.ts`.
- Use descriptive test names that document the expected behavior.
- Each test should assert one behavior.
- Extract testable pure functions from side-effectful code (hooks, IPC handlers, etc.) so they can be unit tested without mocking the world.

## Extracting testable logic

When logic is embedded in a React hook, IPC handler, or framework callback:

1. Extract the core logic into a **pure function** in a separate module (e.g., `session-tree-merge.ts`).
2. The hook/handler calls the pure function.
3. Tests import and test the pure function directly — no need to mock React, Electron, or IPC.

Example:

```
// Bad — logic buried in a hook, untestable without React test utils
useEffect(() => {
  // 40 lines of merge logic
}, []);

// Good — logic extracted, hook is thin
// session-tree-merge.ts (pure, tested)
export function mergeSnapshot(prev, snapshot) { ... }

// useIpcListeners.ts (thin wrapper)
window.api.onSessionTreeUpdated((snap) => {
  setNodes((prev) => mergeSnapshot(prev, snap));
});
```

## Running tests

```sh
# Run all tests from the desktop directory
npm test

# Watch mode during development
npm run test:watch
```

## Pre-commit / pre-push

All tests must pass before committing. The existing lint-staged + pre-commit hook enforces linting and type-checking. Tests should be run manually before committing code changes.

## Test infrastructure

- Test runner: **vitest** (configured in `desktop/vitest.config.ts`)
- Electron mock: `desktop/src/__mocks__/electron.ts`
- Test files: `desktop/src/**/*.test.ts`
