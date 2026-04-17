# Patterns & Conventions

Human-facing catalog of the conventions used in the Interactive MCP Desktop
codebase. Pair this document with [ADDING-A-FEATURE.md](./ADDING-A-FEATURE.md)
for a step-by-step walkthrough, and with the agent skills under
[`.agents/skills/`](../../.agents/skills/) for task-specific, agent-oriented
versions of the same workflows.

This file is the authoritative catalog. If you introduce a new pattern, add
it here first; then update the matching skill.

---

## 1. IPC handler pattern

**Where:** `desktop/src/main/ipc/handlers/*-handlers.ts`,
registered from `desktop/src/main/ipc/handlers.ts`.

### Wire shape

All renderer-callable handlers use the shared envelope defined in
`src/main/ipc/handlers/ipc-result.ts`:

```ts
type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string };
```

Thrown errors become `{ ok: false, error }`; successful returns become
`{ ok: true, data }`. Renderer code checks `result.ok` before reading `data`.

### Writing a new handler

Every new handler module exports a single `registerXHandlers()` function. All
handlers inside it wrap their implementation with `withIpcResult` so they
don't need individual try/catch blocks. Example (from
`src/main/ipc/handlers/agents-handlers.ts`):

```ts
import { ipcMain } from 'electron';
import { withIpcResult } from './ipc-result';
import { logIpcInfo } from './shared';

export function registerAgentsHandlers(): void {
  ipcMain.handle(
    'list-agents',
    withIpcResult(async (_event, baseDirectory?: string) => {
      logIpcInfo(`list-agents: baseDirectory=${baseDirectory ?? '<none>'}`);
      return listAgents(baseDirectory);
    }),
  );
}
```

### Registration

Add a `register...Handlers` call in `src/main/ipc/handlers.ts`:

```ts
import { registerAgentsHandlers } from './handlers/agents-handlers';

export function registerIpcHandlers(deps: IpcHandlerDeps): void {
  // …
  registerAgentsHandlers();
}
```

Handlers that need main-process singletons take a typed `IpcHandlerDeps` arg;
handlers that only delegate to pure modules (like agents) take nothing.

### Error preservation

When rethrowing a caught error, preserve the original as `cause` so stack
traces are not lost (see `src/main/opencode/config-io.ts:205`,
`src/main/ipc/handlers/opencode-core-handlers.ts:46`):

```ts
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  throw new Error(`Failed to read ${filePath}: ${msg}`, { cause: err });
}
```

Matches the ESLint `preserve-caught-error` rule.

---

## 2. Preload surface pattern

**Where:** `desktop/src/preload/index.ts` (central), with modular split under
`desktop/src/preload/api/*.ts` (e.g. `agents.ts`, `opencode-config.ts`,
`opencode-sessions.ts`).

The bridge exposes one `window.api.*` endpoint per IPC channel. Types are
co-located in `src/preload/api/types.ts` and re-exported from `index.ts`.

### Adding a new endpoint

1. If the feature has ≥2 related methods, add a new module under
   `src/preload/api/<feature>.ts` exporting `createXApi()`.
2. Import and spread it into the `api` object in `src/preload/index.ts`.
3. Update the `ElectronAPI` type export (automatic — it's `typeof api`).

Existing single-off endpoints (e.g. `getSettings`, `getServerStatus`) still
live inline in `src/preload/index.ts`. Prefer the split module form for new
multi-endpoint features.

See `src/preload/api/agents.ts` for a reference implementation.

---

## 3. Renderer IPC consumption pattern

**Where:** `desktop/src/renderer/src/hooks/useIpcQuery.ts`,
`useIpcMutation.ts`.

Two styles coexist in the tree:

### Current ad-hoc style

Still prevalent in older hooks. Renderer calls `window.api.X()`, checks
`if (!result.ok)`, reads `result.data` or `result.error`. Works but
duplicates state-machine code across hooks.

### Preferred: `useIpcQuery` primitive

Use `useIpcQuery<T>(fetcher, deps)` for fetch-on-mount/refetch flows. It
wraps the `IpcResult<T>` envelope and returns
`{ data, error, loading, refetch }`. Internally uses `runIpcQuery` (a pure
helper) so transport crashes look identical to `{ ok: false, error }`.

```ts
const {
  data: agents,
  error,
  loading,
  refetch,
} = useIpcQuery(() => window.api.listAgents(baseDirectory), [baseDirectory]);
```

### Preferred: `useIpcMutation` primitive

For imperative writes, use `useIpcMutation` (same module family). It ensures
the renderer never calls `setState` after unmount and handles the reduce-step
the same way as `useIpcQuery`.

### Inline status

`src/renderer/src/components/ui/InlineStatus.tsx` exposes a small
`InlineStatusState = 'idle' | 'saving' | 'saved' | 'error'` component for
mutation feedback next to buttons/inputs. Prefer this over ad-hoc
`{saving && <Spinner />}` fragments in new code.

---

## 4. Settings section pattern

**Where:** `desktop/src/renderer/src/pages/settings/section-registry.tsx`.

Settings sections are registered in `SETTINGS_SECTIONS` as a module-level
array of `SettingsSectionDefinition`:

```ts
type SettingsSectionDefinition = {
  id: SettingsSection;
  label: string;
  icon: string;
  component: React.ComponentType<{ state: SettingsStateShape }>;
};
```

Each entry points at a module-level **adapter** that pulls what it needs off
the shared `SettingsStateShape` (returned by `useSettingsState`). Adapters
are module-scoped (never nested in another component) per the
`react-perf-patterns: rerender-no-inline-components` rule.

### Adding a section

1. Create `SettingsSection<Name>.tsx` (or extend an existing grouping file).
2. Add a module-level `NameAdapter({ state })` that extracts the subset it
   needs from `SettingsStateShape`.
3. Append an entry to `SETTINGS_SECTIONS`.
4. Add the `id` to the `SettingsSection` union in `settings-types.ts`.
5. Add an i18n key if the label is user-facing.

Tests: `src/renderer/src/pages/settings/section-registry.test.ts` enforces
uniqueness of ids and that every entry has a rendering component.

---

## 5. Custom agents & OpenCode config pattern

**Where:** `desktop/src/main/opencode/agents.ts`,
`desktop/src/main/opencode/config-sync.ts`,
`desktop/src/main/opencode/config-io.ts`.

### Scope resolution

Agents live in two directories:

- **Global:** `~/.config/opencode/agent/*.md`
- **Project:** `<baseDirectory>/.opencode/agent/*.md`

`listAgents(baseDirectory?)` returns project-scoped agents first, then
globals. Any global whose name also exists at project scope is marked
`overridden: true` (UI uses this to show a shadow badge).

### Managed-key preservation

`config-sync.ts` manages the `mcp["interactive-desktop"]` entry in the
user's OpenCode config — everything else in the file is owned by the user
and must round-trip unchanged. When editing OpenCode configs:

- Read with `readConfig` (`config-io.ts`), which strips JSONC comments.
- Mutate only the keys you own.
- Never replace `config.mcp` wholesale; only set/delete specific keys.
- Legacy managed entries (e.g. `interactive-bridge`) are pruned on write.

The `interactive-desktop` entry always takes the shape
`{ type: 'remote', url, timeout }` — any leftover `command` array from older
local installs is rewritten to the remote form.

---

## 6. Testing conventions

- **Runner:** vitest, configured in `desktop/vitest.config.ts`.
- **Environment:** `node` (not jsdom). This is deliberate — we don't test
  React components directly; we test pure helpers.
- **Co-location:** `foo.ts` ↔ `foo.test.ts` next to each other.
- **Electron mock:** `src/__mocks__/electron.ts` (wired via `vitest.config.ts`).

### Extract pure helpers, test those

Prefer extracting logic out of hooks/IPC handlers into pure `.ts` modules
and unit-testing them — no React test utilities needed. Reference
extractions:

- `src/renderer/src/hooks/session-tree-merge.ts` + `.test.ts` (merge logic
  pulled out of `useIpcListeners`).
- `src/renderer/src/hooks/delta-batcher-core.ts` + `.test.ts` (scheduling
  logic pulled out of a streaming hook).
- `src/renderer/src/hooks/remove-session-target.ts` + `.test.ts`.
- `src/main/opencode/agents.ts` + `.test.ts` (pure frontmatter parsing
  alongside fs-backed CRUD).

### Running tests

```sh
npm test -- --run          # one-shot, all tests
npm run test:watch         # watch mode
```

All tests (currently 427+) must pass before any PR. Root type-check runs in
the `src/` package via `npm run check-types`.

---

## 7. Error preservation (`preserve-caught-error`)

Always pass caught errors through `new Error(msg, { cause: err })` when
wrapping. Never swallow the original, and never stringify-and-forget. This
preserves stack chains across async boundaries and across the IPC boundary
(`errorMessage()` in `ipc-result.ts` extracts `.message` but the `cause`
remains visible on the main-process log).

The codebase enforces this via lint; see existing examples in
`src/main/opencode/config-io.ts` and
`src/main/ipc/handlers/opencode-core-handlers.ts`.

---

## Cross-references

| Doc                                                 | Skill                                                                                               |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| [ADDING-A-FEATURE.md](./ADDING-A-FEATURE.md) (flow) | —                                                                                                   |
| `§1 IPC handler pattern`                            | [`.agents/skills/add-ipc-handler`](../../.agents/skills/add-ipc-handler/SKILL.md)                   |
| `§4 Settings section pattern`                       | [`.agents/skills/add-settings-section`](../../.agents/skills/add-settings-section/SKILL.md)         |
| `§3 Renderer IPC consumption`                       | [`.agents/skills/add-renderer-hook`](../../.agents/skills/add-renderer-hook/SKILL.md)               |
| `§5 Custom agents & OpenCode config`                | [`.agents/skills/add-custom-agent-or-tool`](../../.agents/skills/add-custom-agent-or-tool/SKILL.md) |
