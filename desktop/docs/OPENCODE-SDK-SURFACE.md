# OpenCode SDK — Surface & Utilization Map

Pinned version: **`@opencode-ai/sdk@^1.14.18`** (desktop/package.json).
Import path used throughout the codebase: **`@opencode-ai/sdk/v2`** and **`@opencode-ai/sdk/v2/client`**.

This document enumerates every namespace exposed by `OpencodeClient` (the v2 SDK), what we currently use, and which methods could unlock new features.

---

## 1. Delta since `^1.4.9` (what's new)

Full diff between published `1.4.9` and `1.14.18` tarballs shows only **two meaningful changes** to the v2 SDK surface:

| Change                   | Where                        | Notes                                                                                                               |
| ------------------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **`sync.start()` added** | `Sync` class                 | Starts sync loops for workspaces in the current project that have active sessions. Complements existing `replay()`. |
| `ConsoleState` extracted | `types.gen.d.ts` refactor    | Internal type cleanup. No behavioral change.                                                                        |
| (v1 legacy SDK)          | `dist/gen/` (non-v2 exports) | **Byte-identical** — no changes to the legacy surface.                                                              |

> Everything else below was already present in `1.4.9`. The v2 surface has been stable; the main value of upgrading has been bugfixes / server-side changes, not new client methods.

---

## 2. Namespaces we already use

Used in `desktop/src/main/opencode/`:

| Namespace        | Methods we call                                                                                                                                                                                                                                        | File                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| **`global`**     | `event()`                                                                                                                                                                                                                                              | `bus-events.ts`                                     |
| **`session`**    | `list`, `get`, `create`, `delete`, `children`, `messages`, `message`, `prompt`, `promptAsync`, `abort`, `update`, `share`, `unshare`, `fork`, `init`, `revert`, `unrevert`, `summarize`, `shell`, `command`, `diff`, `status`, `todo`, `deleteMessage` | `session-api.ts`                                    |
| **`command`**    | `list`                                                                                                                                                                                                                                                 | `command.ts`                                        |
| **`mcp`**        | `add`, `connect`, `disconnect`, `status`                                                                                                                                                                                                               | `mcp-inject.ts`, `mcp-register.ts`, `mcp-status.ts` |
| **`permission`** | `reply`                                                                                                                                                                                                                                                | `permission-reply.ts`                               |
| **`provider`**   | `auth`, `list`                                                                                                                                                                                                                                         | `provider.ts`                                       |
| **`question`**   | `list`, `reply`, `reject`                                                                                                                                                                                                                              | `question-list.ts`                                  |
| **`vcs`**        | `get`                                                                                                                                                                                                                                                  | `vcs.ts`                                            |
| **`auth`**       | `set` (via `provider.ts`)                                                                                                                                                                                                                              | `provider.ts`                                       |

> `permission.respond()` is **deprecated** in favor of `permission.reply()`. We're already on the correct one.

---

## 3. Unused namespaces — potential wins

Every namespace below exists on `OpencodeClient` but is never touched in our codebase.

### 3.1 `project` — **HIGH leverage**

```ts
client.project.list({ directory?, workspace? });   // Project[]
client.project.current({ directory?, workspace? }); // ProjectInfo
client.project.initGit({ ... });                    // init VCS for a project
client.project.update({ ... });                     // rename / mutate
```

**Where we need it**: the sidebar currently groups channels by `baseDirectory`, but OpenCode has its own project identity. Using `project.current()` at session register-time would give us the canonical project ID and let us merge auto-registered sessions with user-registered channels under one real project node.

### 3.2 `config` — **HIGH leverage**

```ts
client.config.get({ directory?, workspace? });       // current opencode.json
client.config.update({ config: Partial<Config3> });  // server-side merge
client.config.providers({ ... });                    // configured AI providers
```

**Where we need it**: `config-io.ts` + `config-sync.ts` read/write `opencode.json` directly on disk. Using the SDK eliminates TOCTOU races and validates against the server's schema. Useful for setting `mcp.remote.<ours>.timeout` reliably without restarting the server.

### 3.3 `find` — **MEDIUM leverage**

```ts
client.find.text({ pattern });                       // ripgrep across project
client.find.files({ query, type?, limit? });         // fuzzy filename search
client.find.symbols({ query });                      // LSP workspace symbols
```

**Where we need it**: repo-doc search (`find_repo_docs` MCP tool + renderer autocomplete) currently relies on our own limited scan. `find.text` = real ripgrep; `find.symbols` would enable jump-to-symbol in skill authoring.

### 3.4 `file` — **MEDIUM leverage**

```ts
client.file.list({ path }); // ls
client.file.read({ path }); // cat (respects project root)
client.file.status(); // git status (replaces shelling out)
```

**Where we need it**: renderer-side file preview without round-tripping through Electron IPC + Node fs. Safer (server sandboxes path resolution to the project root).

### 3.5 `experimental.workspace` — **MEDIUM (feature-dependent)**

```ts
client.experimental.workspace.list();
client.experimental.workspace.create({ id?, type?, branch? });
client.experimental.workspace.status();
client.experimental.workspace.remove({ id });
client.experimental.workspace.sessionRestore({ id });
```

**Where we need it**: multi-workspace UI. Currently we treat every session as living in one workspace; this namespace lets us split sessions across named workspaces (e.g. `main`, `feature-branch`). Adaptor via `client.adaptor` + `experimental.workspace.adaptorList`.

### 3.6 `experimental.resource`

```ts
client.experimental.resource.list(); // MCP resources from all connected servers
```

**Where we need it**: surface MCP resources (not just tools) from other servers in our UI. Low priority unless we want to expose this.

### 3.7 `experimental.console`

```ts
client.experimental.console.get();
client.experimental.console.listOrgs();
client.experimental.console.switchOrg();
```

**Where we need it**: Console / org switching. Only relevant if we want to integrate with OpenCode Cloud / console orgs.

### 3.8 `experimental.session.list`

```ts
client.experimental.session.list({ archived?, search?, cursor?, limit? });
```

**Where we need it**: currently we use the non-experimental `session.list`. The experimental version supports **cursor pagination** and **archived flag**, which we'd want for a full session history view.

### 3.9 `tool`

```ts
client.tool.ids(); // all registered tool IDs
client.tool.list({ provider, model }); // JSON-schema per provider/model
```

**Where we need it**: debug UI / agent self-introspection — show "which tools can this model call right now?". Also useful for skill authors to see registered tools.

### 3.10 `worktree`

```ts
client.worktree.list();
client.worktree.create({ ... });
client.worktree.remove({ ... });
client.worktree.reset({ ... });
```

**Where we need it**: first-class git worktree management in the UI. Currently we never touch worktrees.

### 3.11 `pty`

```ts
client.pty.list();
client.pty.create({ ... });
client.pty.connect({ ptyID });
client.pty.get({ ptyID });
client.pty.update({ ptyID, rows, cols });
client.pty.remove({ ptyID });
```

**Where we need it**: embedded terminal in the desktop app (shell sessions live across reloads). Large scope — separate feature.

### 3.12 `part`

```ts
client.part.update({ sessionID, messageID, partID, part? });
client.part.delete({ sessionID, messageID, partID });
```

**Where we need it**: editing/deleting individual message parts in channel history (e.g. "undo last image", "redact a tool output").

### 3.13 `tui`

```ts
client.tui.appendPrompt({ text });
client.tui.submitPrompt();
client.tui.clearPrompt();
client.tui.openHelp / openSessions / openThemes / openModels();
client.tui.selectSession({ sessionID });
client.tui.executeCommand({ ... });
client.tui.publish({ ... });
client.tui.showToast({ ... });
client.tui.controlNext();
client.tui.controlResponse();
```

**Where we need it**: control an OpenCode TUI session from the desktop app (send prompt to TUI, open dialogs). Useful if user runs TUI side-by-side.

### 3.14 `event`

```ts
client.event.subscribe(); // SSE stream — typed wrapper around `global.event`
```

**Where we need it**: we already use `global.event()` directly. `event.subscribe()` is the newer typed helper. Migration would reduce cast noise in `bus-events.ts`.

### 3.15 `sync` — **NEW in ≥ 1.14.x**

```ts
client.sync.start();                            // NEW
client.sync.replay({ events });
client.sync.history.list({ ... });
```

**Where we need it**: kick off workspace sync loops (useful when reconnecting after desktop app wakes from sleep). Pair with `sync.history.list` for offline replay.

### 3.16 `instance`

```ts
client.instance.dispose(); // clean shutdown of current server instance
```

**Where we need it**: call on app quit to release OpenCode resources cleanly rather than relying on process kill.

### 3.17 `path`

```ts
client.path.get(); // cwd + data paths for current instance
```

**Where we need it**: source of truth for the OpenCode process's cwd / data dir. Today we infer this from spawn args.

### 3.18 `lsp`, `formatter`

```ts
client.lsp.status();
client.formatter.status();
```

**Where we need it**: debug UI showing LSP / formatter health per session.

### 3.19 `app`

```ts
client.app.agents();     // registered agents
client.app.skills();     // **skills known to OpenCode server**
client.app.log({ ... });
```

**Where we need it**: `app.skills()` is interesting — OpenCode itself tracks agent skills. Worth comparing against our own `skills` table to see whether we should mirror / dedupe. `app.agents()` would show all registered agent kinds (primary, sub-agents).

### 3.20 `oauth` (MCP / provider)

```ts
client.mcp.authStart / authCallback / authenticate / authRemove();
client.provider.oauthAuthorize / oauthCallback();
```

**Where we need it**: if we ever surface OAuth-based MCP servers or providers in the UI, this is the hookup.

### 3.21 `adaptor`, `global.config`, `global.health`, `global.dispose`, `global.upgrade`

Small utilities:

- `global.health()` — server liveness probe (useful for `health.ts` instead of raw `fetch`).
- `global.upgrade()` — trigger in-place OpenCode server upgrade.
- `global.config.get/update()` — global (non-project) config.
- `global.dispose()` — shut down the whole server.

---

## 4. Recommended short list (highest ROI)

| Priority | Namespace / method                 | Why                                                         |
| -------- | ---------------------------------- | ----------------------------------------------------------- |
| 1        | `project.current` + `project.list` | Fix channel grouping to use real OpenCode project identity. |
| 2        | `config.get` + `config.update`     | Replace manual `opencode.json` disk IO; eliminates drift.   |
| 3        | `find.text` / `find.files`         | Better repo-doc search; replaces custom scan.               |
| 4        | `global.health`                    | Cleaner health check than raw fetch.                        |
| 5        | `sync.start` (**new in 1.14.x**)   | Useful for reconnect-after-sleep reliability.               |
| 6        | `app.skills`                       | Compare with our `skills` table for dedup/awareness.        |
| 7        | `instance.dispose`                 | Clean shutdown on app quit.                                 |
| 8        | `tool.list`                        | Debug/introspection UI.                                     |

---

## 5. Upgrade considerations

- **No breaking changes** between `1.4.9` and `1.14.18`. Only additions.
- The v2 SDK surface was effectively frozen at the 1.4.x series; 1.14.x adds only `sync.start`.
- Server-side behavior may still differ between versions (event payload schemas, tool contracts). Always cross-check with `desktop/docs/OPENCODE-EVENTS.md`.
- Keep using `@opencode-ai/sdk/v2/client` — never mix with the legacy `@opencode-ai/sdk` root import (different class shape).

---

## 6. Where this doc lives

- Update this doc whenever we bump the SDK version in `desktop/package.json`.
- Cross-links: `desktop/docs/ARCHITECTURE.md` (opencode integration section), `desktop/docs/OPENCODE-EVENTS.md` (event-bus specifics).
