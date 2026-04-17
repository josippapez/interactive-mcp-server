# OpenCode Event Catalog

Complete reference of every event OpenCode emits on its event buses, the payload shape,
the SSE stream it reaches us on, and what (if anything) the desktop app does with it today.

Sources of truth in the OpenCode repo:

- `packages/opencode/src/bus/bus.ts` — in-process `Bus` (per-instance PubSub).
- `packages/opencode/src/bus/global.ts` — `GlobalBus` (process-wide EventEmitter).
- `packages/opencode/src/sync/sync-event.ts` — versioned, persisted sync events that are
  also re-published on the in-process `Bus` as their un-versioned type.
- `packages/opencode/src/server/instance/global.ts` — HTTP/SSE endpoint
  `GET /global/event` the desktop app subscribes to. The stream carries **both**
  in-process `Bus` events and versioned sync events in a single unified schema.

Versioned sync events (the ones with `.1`, `.2`, …) are the authoritative replayable
log. They are emitted on `GlobalBus` with the versioned type (e.g. `session.created.1`)
**and** on the in-process `Bus` with the un-versioned type (e.g. `session.created`). The
SSE stream the desktop app consumes delivers the versioned names.

Non-sync events are fired via `Bus.publish` / `GlobalBus.emit` directly; they are not
persisted and not replayable.

---

## How to subscribe

### From inside OpenCode (plugin / internal code)

```ts
import { Bus } from '@/bus';
import { Session } from '@/session/session';

// Typed, single-event subscription
Bus.subscribe(Session.Event.Created, (ev) => {
  // ev.type === 'session.created'
  // ev.properties is the schema payload
});

// Wildcard subscription
Bus.subscribeAll((ev) => {
  /* ev.type, ev.properties */
});
```

### From outside (SDK / desktop app)

```ts
// Long-lived SSE stream of everything flowing through GlobalBus (both
// non-sync Bus events and versioned sync events share this one endpoint).
GET http://<host>:<port>/global/event
```

Payloads on the SSE stream are either:

- `{ directory, project, workspace, payload: { type: '<event>', properties: {...} } }` — non-sync events
- `{ directory, project, workspace, payload: { type: 'sync', syncEvent: { type: '<event>.<version>', id, seq, aggregateID, data } } }` — sync events

The desktop app normalizes both into a flat `{ type, properties | data, ... }` record
before dispatching to handlers (see `desktop/src/main/session/tree-manager.ts`).

---

## Sync events (versioned, persisted, replayable)

Defined via `SyncEvent.define(...)`. Always delivered on SSE as `<type>.<version>`.

### Session lifecycle — aggregate: `sessionID`

Source: `packages/opencode/src/session/session.ts`

| Event (versioned)   | Payload (`data`)                                   | Notes                                                                                                                                                                                                                                                                   |
| ------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session.created.1` | `{ sessionID, info }`                              | Fired when OpenCode creates a **root** session, or when a subagent session is explicitly created via `sessions.create({ parentID })` for non-Task flows. **Task-tool subagents do NOT emit this** — see workaround in `tree-manager.ts` (`hydrateTaskSubagentSession`). |
| `session.updated.1` | `{ sessionID, info }` (`info` is a partial update) | Title/model/directory/etc. mutations.                                                                                                                                                                                                                                   |
| `session.deleted.1` | `{ sessionID, info }`                              | Authoritative deletion.                                                                                                                                                                                                                                                 |

### Messages — aggregate: `sessionID`

Source: `packages/opencode/src/session/message-v2.ts`

| Event (versioned)        | Payload (`data`)                         | Notes                                                                                                                                      |
| ------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `message.updated.1`      | `{ sessionID, info }` (`MessageV2.Info`) | Full message record whenever it is created OR updated. Carries token/cost/model metadata for assistant messages.                           |
| `message.removed.1`      | `{ sessionID, messageID }`               | Message deleted.                                                                                                                           |
| `message.part.updated.1` | `{ sessionID, part }` (`MessageV2.Part`) | Covers both "part added" and "part updated". The Task tool's child session ID leaks through this event on `part.state.metadata.sessionId`. |
| `message.part.removed.1` | `{ sessionID, messageID, partID }`       | Part deleted.                                                                                                                              |

---

## Bus (non-sync) events — in-process + SSE passthrough

Defined via `BusEvent.define(...)`. Emitted unversioned on `Bus.publish`; the bus forwards
every publish to `GlobalBus.emit('event', …)`, so they also land on the SSE stream.

### Session runtime

Source: `packages/opencode/src/session/session.ts`, `status.ts`, `compaction.ts`

| Event               | Payload                 | Notes                                       |
| ------------------- | ----------------------- | ------------------------------------------- |
| `session.diff`      | `{ sessionID, diff }`   | Git-style diff artifact for a session turn. |
| `session.error`     | `{ sessionID?, error }` | Error surfaced on a session.                |
| `session.status`    | `{ sessionID, status }` | Busy/idle/streaming indicator.              |
| `session.idle`      | `{ sessionID }`         | Session finished streaming.                 |
| `session.compacted` | `{ sessionID, ... }`    | Context was auto-compacted.                 |

### Message runtime

Source: `packages/opencode/src/session/message-v2.ts`

| Event                | Payload                                          | Notes                                                                |
| -------------------- | ------------------------------------------------ | -------------------------------------------------------------------- |
| `message.part.delta` | `{ sessionID, messageID, partID, field, value }` | Streaming token deltas. Higher volume than `message.part.updated.1`. |

### Todos (OpenCode's built-in todo tool)

Source: `packages/opencode/src/session/todo.ts`

| Event          | Payload                |
| -------------- | ---------------------- |
| `todo.updated` | `{ sessionID, todos }` |

### Permissions

Source: `packages/opencode/src/permission/permission.ts`

| Event                | Payload                                          |
| -------------------- | ------------------------------------------------ |
| `permission.asked`   | `Request` — tool permission prompt shown to user |
| `permission.replied` | `{ ..., response }` — user's decision            |

### Questions (provider prompts)

Source: `packages/opencode/src/question/index.ts`

| Event               | Payload    |
| ------------------- | ---------- |
| `question.asked`    | `Request`  |
| `question.replied`  | `Replied`  |
| `question.rejected` | `Rejected` |

### Files

Source: `packages/opencode/src/file/file.ts`, `file/watcher.ts`

| Event                  | Payload                                 |
| ---------------------- | --------------------------------------- |
| `file.edited`          | `{ path, ... }` — OpenCode wrote a file |
| `file.watcher.updated` | `{ path, event }` — FS watcher tick     |

### Project & VCS

Source: `packages/opencode/src/project/project.ts`, `project/vcs.ts`

| Event                | Payload                           |
| -------------------- | --------------------------------- |
| `project.updated`    | `Info` — project metadata changed |
| `vcs.branch.updated` | `{ directory, branch, ... }`      |

### Worktree

Source: `packages/opencode/src/worktree/worktree.ts`

| Event             | Payload          |
| ----------------- | ---------------- |
| `worktree.ready`  | `{ ... }`        |
| `worktree.failed` | `{ ..., error }` |

### Workspace (control plane)

Source: `packages/opencode/src/control-plane/workspace.ts`

| Event               | Payload            |
| ------------------- | ------------------ |
| `workspace.ready`   | `{ ... }`          |
| `workspace.failed`  | `{ ..., error }`   |
| `workspace.restore` | `Restore`          |
| `workspace.status`  | `ConnectionStatus` |

### Commands

Source: `packages/opencode/src/command/command.ts`

| Event              | Payload   |
| ------------------ | --------- |
| `command.executed` | `{ ... }` |

### MCP

Source: `packages/opencode/src/mcp/mcp.ts`

| Event                     | Payload   | Notes                                                  |
| ------------------------- | --------- | ------------------------------------------------------ |
| `mcp.tools.changed`       | `{ ... }` | Fired when a connected MCP server's tool list changes. |
| `mcp.browser.open.failed` | `{ ... }` | An MCP-initiated browser open failed.                  |

### LSP

Source: `packages/opencode/src/lsp/lsp.ts`, `lsp/client.ts`

| Event                    | Payload                           |
| ------------------------ | --------------------------------- |
| `lsp.updated`            | `{}`                              |
| `lsp.client.diagnostics` | `{ serverID, path, diagnostics }` |

### IDE

Source: `packages/opencode/src/ide/ide.ts`

| Event           | Payload   |
| --------------- | --------- |
| `ide.installed` | `{ ... }` |

### Installation

Source: `packages/opencode/src/installation/installation.ts`

| Event                           | Payload   |
| ------------------------------- | --------- |
| `installation.updated`          | `{ ... }` |
| `installation.update-available` | `{ ... }` |

### PTY (interactive terminal)

Source: `packages/opencode/src/pty/service.ts`

| Event         | Payload            |
| ------------- | ------------------ |
| `pty.created` | `{ info }`         |
| `pty.updated` | `{ info }`         |
| `pty.exited`  | `{ id, exitCode }` |
| `pty.deleted` | `{ id }`           |

### Server / instance lifecycle

Source: `packages/opencode/src/server/event.ts`, `server/instance/global.ts`, `bus/bus.ts`

| Event                      | Payload         | Notes                                               |
| -------------------------- | --------------- | --------------------------------------------------- |
| `server.connected`         | `{}`            | Server is ready.                                    |
| `server.instance.disposed` | `{ directory }` | A per-directory instance was torn down.             |
| `global.disposed`          | `{}`            | The whole OpenCode global process is shutting down. |

### TUI-only (not on SSE)

Source: `packages/opencode/src/cli/cmd/tui/event.ts` — emitted only inside the
interactive `opencode` TUI. Listed for completeness; the desktop app never sees these.

| Event                 | Payload    |
| --------------------- | ---------- |
| `tui.prompt.append`   | `{ text }` |
| `tui.command.execute` | `{ ... }`  |
| `tui.toast.show`      | `{ ... }`  |
| `tui.session.select`  | `{ ... }`  |

---

## What the desktop app currently subscribes to

Entry point: `desktop/src/main/opencode/bus-events.ts` opens the SSE stream; the
dispatcher in `desktop/src/main/session/tree-manager.ts:handleSyncEvent` routes events.

| Versioned event          | Handler action                                                                                                                                                                                              |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session.created.1`      | Cache session, auto-bind to channel, emit optimistic child, schedule snapshot.                                                                                                                              |
| `session.updated.1`      | Update cached session record, schedule snapshot.                                                                                                                                                            |
| `session.deleted.1`      | Remove from cache, schedule snapshot.                                                                                                                                                                       |
| `message.updated.1`      | Forward to context/token tracking (`context-tracking.ts`) and conversation provider.                                                                                                                        |
| `message.part.updated.1` | Forward tool part to renderer. **Special case**: if `part.tool === 'task'` and `part.state.metadata.sessionId` is present, hydrate the child subagent session (workaround for missing `session.created.1`). |
| `message.part.removed.1` | Forward to conversation provider.                                                                                                                                                                           |

Non-sync events consumed (forwarded from `bus-event-forwarders.ts`):

| Event                | IPC channel              | Consumer status                                                                                                                                                       |
| -------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `permission.asked`   | `permission-asked`       | Fully wired — maps OpenCode `sessionID` → desktop `connectionId`, surfaces tool permission prompt in the renderer.                                                    |
| `permission.replied` | `permission-replied`     | Fully wired — updates prompt state when user answers.                                                                                                                 |
| `session.idle`       | `opencode-session-idle`  | **Foundation only** — forwarded with `sessionID` payload. No renderer consumer yet. Intended for "turn finished" UX (hide spinners, play a sound).                    |
| `session.error`      | `opencode-session-error` | **Foundation only** — forwards the full error object. Consumer should branch on `error.name` (v2 discriminated union: ProviderAuthError, ContextOverflowError, etc.). |
| `file.edited`        | `opencode-file-edited`   | **Foundation only** — payload `{ directory, file }`. Useful for "files changed this turn" indicators or cache invalidation.                                           |

Events we explicitly do **not** consume yet (candidates for future wiring):

- `session.status`, `session.compacted`
- `message.part.delta` (streaming tokens)
- `question.*`
- `todo.updated`
- `file.watcher.updated`
- `vcs.branch.updated`, `project.updated`
- `mcp.tools.changed`, `mcp.browser.open.failed`
- `pty.*`
- `worktree.*`, `workspace.*`
- `server.connected`, `server.instance.disposed`, `global.disposed`

---

## Key gotchas

1. **Task-tool subagents never emit `session.created.1`.** The only signal is
   `message.part.updated.1` with `part.tool === 'task'` and
   `part.state.metadata.sessionId` (camelCase). See
   `hydrateTaskSubagentSession` in `tree-manager.ts`.
2. **Sync events are double-delivered.** Internally they appear on the in-process
   `Bus` as un-versioned (`session.created`) and on `GlobalBus` / SSE as versioned
   (`session.created.1`). Always match on the versioned type on the SSE side.
3. **Field naming is inconsistent.** Most sync payloads use `sessionID` (uppercase
   ID), but Task-tool metadata uses `sessionId` (camelCase). Do not assume one
   casing.
4. **SSE envelope differs per event class.** Non-sync: `payload.properties`. Sync:
   `payload.syncEvent.data`. The desktop app flattens both before dispatch.
5. **`global.disposed` is defined twice** (in `server/event.ts` and
   `server/instance/global.ts`) with the same type string. Treat as one event.
