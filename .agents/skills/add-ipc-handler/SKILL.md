---
name: add-ipc-handler
description: Add a new main-process IPC handler end-to-end — handler module, registration, preload endpoint, and validation. Use whenever the renderer needs a new window.api.* call.
when_to_use:
  - Adding a new `window.api.*` method that invokes main-process logic.
  - Exposing a pure-module function (e.g. under `src/main/opencode/`) to the renderer.
  - Adding a new event emitter from main to renderer (pair with a listener-registration endpoint).
---

# Skill: add-ipc-handler

Adds a new IPC handler to the Interactive MCP Desktop app using the
established `withIpcResult` pattern.

Pair with: [`desktop/docs/PATTERNS.md §1`](../../desktop/docs/PATTERNS.md#1-ipc-handler-pattern)
and [`desktop/docs/ADDING-A-FEATURE.md`](../../desktop/docs/ADDING-A-FEATURE.md).

---

## Critical rules

1. **Always wrap with `withIpcResult`.** Do not write bare `ipcMain.handle`
   bodies with try/catch — that pattern is deprecated in this repo.
2. **Wire shape is `{ ok, data } | { ok, error }`.** Do not invent another
   envelope for a single handler; renderer consumers expect this shape.
3. **Throw `new Error(msg, { cause: err })` when rewrapping.** Never
   stringify-and-forget a caught error.
4. **One `register<Feature>Handlers()` function per module.** Called once
   from `src/main/ipc/handlers.ts`.
5. **Co-locate a `.test.ts`** for any non-trivial pure helper extracted from
   the handler body.

---

## Steps

### 1. Create the handler module

Path: `desktop/src/main/ipc/handlers/<feature>-handlers.ts`

Template:

```ts
import { ipcMain } from 'electron';
import { withIpcResult } from './ipc-result';
import { logIpcInfo } from './shared';

export function register<Feature>Handlers(): void {
  ipcMain.handle(
    '<channel-name>',
    withIpcResult(async (_event, arg1: string) => {
      logIpcInfo(`<channel-name>: ${arg1}`);
      // Delegate to a pure module under src/main/<domain>/
      return doTheThing(arg1);
    }),
  );
}
```

If the handler needs main-process singletons (database, server, etc.), pull
them via the `IpcHandlerDeps` parameter (see `src/main/ipc/handlers/types.ts`).

Reference impl: `src/main/ipc/handlers/agents-handlers.ts`.

### 2. Register in the dispatcher

Edit `desktop/src/main/ipc/handlers.ts`:

```ts
import { register<Feature>Handlers } from './handlers/<feature>-handlers';

export function registerIpcHandlers(deps: IpcHandlerDeps): void {
  // …
  register<Feature>Handlers();
}
```

### 3. Add the preload endpoint

For a **multi-method feature**, create
`desktop/src/preload/api/<feature>.ts`:

```ts
import { ipcRenderer } from 'electron';

export function create<Feature>Api() {
  return {
    doTheThing: (
      arg1: string,
    ): Promise<
      { ok: true; data: ReturnShape } | { ok: false; error: string }
    > => ipcRenderer.invoke('<channel-name>', arg1),
  };
}
```

Then spread `create<Feature>Api()` into the `api` object in
`desktop/src/preload/index.ts`.

For a **single endpoint**, inline it in `src/preload/index.ts`.

Reference impl: `src/preload/api/agents.ts`.

### 4. Renderer consumption

Use `useIpcQuery` for read paths, `useIpcMutation` for writes. See the
[add-renderer-hook](../add-renderer-hook/SKILL.md) skill.

### 5. Validate

```sh
cd desktop
npm test -- --run
npm run build
```

---

## Anti-patterns

- Catching an error inside a handler and returning a plain `{ error }` —
  use `withIpcResult` instead.
- Defining multiple `register` functions in one `-handlers.ts` file —
  create one file per feature.
- Leaking Electron types into the pure-module layer — handlers do the
  electron binding; business logic lives in pure modules under
  `src/main/<domain>/`.

---

## Reference files

- Shape: `src/main/ipc/handlers/ipc-result.ts`
- Dispatcher: `src/main/ipc/handlers.ts`
- Example handler: `src/main/ipc/handlers/agents-handlers.ts`
- Example preload module: `src/preload/api/agents.ts`
- Pattern doc: `desktop/docs/PATTERNS.md`
