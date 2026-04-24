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
before dispatching to handlers (see `desktop/src/main/session/sse-handlers.ts`).

---

## Sync events (versioned, persisted, replayable)

Defined via `SyncEvent.define(...)`. Always delivered on SSE as `<type>.<version>`.

### Session lifecycle — aggregate: `sessionID`

Source: `packages/opencode/src/session/session.ts`

| Event (versioned)   | Payload (`data`)                                   | Notes                                                                                                                                                                                                                                                                           |
| ------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session.created.1` | `{ sessionID, info }`                              | Fired when OpenCode creates a **root** session, or when a subagent session is explicitly created via `sessions.create({ parentID })` for non-Task flows. **Task-tool subagents do NOT emit this** — see workaround in `session/sse-handlers.ts` (`hydrateTaskSubagentSession`). |
| `session.updated.1` | `{ sessionID, info }` (`info` is a partial update) | Title/model/directory/etc. mutations.                                                                                                                                                                                                                                           |
| `session.deleted.1` | `{ sessionID, info }`                              | Authoritative deletion.                                                                                                                                                                                                                                                         |

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

Entry point: `desktop/src/main/utility/backend/opencode/event-stream.ts` opens the SSE
stream via `client.global.event()` and feeds every envelope through
`desktop/src/main/utility/backend/opencode/event-bridge.ts::bridgeEvent`. Both modules
live inside the **utility process** after the Phase 2/3 extraction. Session-lifecycle
events (`session.created` / `session.updated` / `session.deleted`) are intercepted in
`event-stream.ts` before `bridgeEvent` sees them and routed to
`desktop/src/main/utility/backend/session/sse-handlers.ts`.

All mapped events are coalesced and flushed to the renderer on the single
`conversation-batch` IPC channel as `ConversationEvent` variants. The wire path is:

```
utility event-stream → event-bridge (mapMessage/mapPart from src/shared/opencode-mapping.ts)
  → bridge.emit('to-renderer', { channel: 'conversation-batch', payload })
  → main supervisor forwards to focused BrowserWindow.webContents.send
  → preload → window.api.onConversationBatch
```

`mapMessage` and `mapPart` live in `src/shared/opencode-mapping.ts` and are used by both
the main-resident `conversation-handlers.ts` (for REST-driven loads) and the
utility-resident `event-bridge.ts` (for live SSE). This keeps the two pipelines
semantically in sync.

The four prompt-event-forwarder channels — `permission-asked`, `permission-replied`,
`question-asked`, `question-cleared` — travel through the same `'to-renderer'`
supervisor-forwarded path.

### Coverage matrix — canonical source of truth

| OpenCode SSE event                                                  | Where handled                              | Status                      | Renderer destination                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------- | ------------------------------------------ | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `message.updated`                                                   | `event-bridge.ts`                          | Handled                     | `ConversationEvent('message.updated')` + synthetic `context.usage`                                                                                                                                                                                                                            |
| `message.removed`                                                   | `event-bridge.ts`                          | Handled                     | `ConversationEvent('message.removed')`                                                                                                                                                                                                                                                        |
| `message.part.updated`                                              | `event-bridge.ts`                          | Handled                     | `ConversationEvent('message.part.updated')`                                                                                                                                                                                                                                                   |
| `message.part.delta` (field = `text`)                               | `event-bridge.ts`                          | Handled                     | `ConversationEvent('message.part.delta')`                                                                                                                                                                                                                                                     |
| `message.part.delta` (field = `reasoning`)                          | `event-bridge.ts`                          | Handled                     | `ConversationEvent('message.part.delta', field='reasoning')`                                                                                                                                                                                                                                  |
| `message.part.removed`                                              | `event-bridge.ts`                          | Handled (reducer no-op)     | `ConversationEvent('message.part.removed')`                                                                                                                                                                                                                                                   |
| `session.status`                                                    | `event-bridge.ts`                          | Handled                     | `ConversationEvent('session.status')`                                                                                                                                                                                                                                                         |
| `session.idle`                                                      | `event-bridge.ts`                          | Handled                     | `ConversationEvent('session.status', status='idle')`                                                                                                                                                                                                                                          |
| `session.error`                                                     | `event-bridge.ts`                          | Handled                     | `ConversationEvent('session.status', status='error')`                                                                                                                                                                                                                                         |
| `session.compacted`                                                 | `event-bridge.ts`                          | Handled                     | `ConversationEvent('session.compacted')` + synthetic `session.compaction-done`                                                                                                                                                                                                                |
| `session.created` / `session.updated` / `session.deleted`           | `event-stream.ts` → `session/sse-handlers` | Handled                     | Session-tree invalidation signal → renderer pulls via `get-session-tree`                                                                                                                                                                                                                      |
| `session.diff`                                                      | `event-bridge.ts`                          | Handled (reducer no-op)     | `ConversationEvent('session.diff')`                                                                                                                                                                                                                                                           |
| `todo.updated`                                                      | `event-bridge.ts`                          | Handled                     | `ConversationEvent('todo.updated')`                                                                                                                                                                                                                                                           |
| `vcs.branch.updated`                                                | `event-bridge.ts`                          | Handled                     | `ConversationEvent('vcs.updated')`                                                                                                                                                                                                                                                            |
| `file.edited`                                                       | `event-bridge.ts`                          | Handled                     | `ConversationEvent('file.edited')`                                                                                                                                                                                                                                                            |
| `file.watcher.updated`                                              | —                                          | **Dropped**                 | —                                                                                                                                                                                                                                                                                             |
| `permission.asked`                                                  | `event-bridge.ts`                          | Handled                     | `ConversationEvent('permission.asked')` → `usePermissionHandlers`                                                                                                                                                                                                                             |
| `permission.replied`                                                | `event-bridge.ts`                          | Handled                     | `ConversationEvent('permission.replied')` → `usePermissionHandlers`                                                                                                                                                                                                                           |
| `question.asked`                                                    | `event-bridge.ts`                          | Handled                     | `ConversationEvent('question.asked')` → `useQuestionHandlers`                                                                                                                                                                                                                                 |
| `question.replied`                                                  | `event-bridge.ts`                          | Handled                     | `ConversationEvent('question.cleared', outcome='replied')` → `useQuestionHandlers`                                                                                                                                                                                                            |
| `question.rejected`                                                 | `event-bridge.ts`                          | Handled                     | `ConversationEvent('question.cleared', outcome='rejected')` → `useQuestionHandlers`                                                                                                                                                                                                           |
| `mcp.tools.changed`                                                 | `event-bridge.ts`                          | Handled (reducer no-op)     | `ConversationEvent('mcp.tools.changed')`                                                                                                                                                                                                                                                      |
| `mcp.browser.open.failed`                                           | `event-bridge.ts`                          | Handled (reducer no-op)     | `ConversationEvent('mcp.browser.open.failed')`                                                                                                                                                                                                                                                |
| `command.executed`                                                  | —                                          | **Dropped**                 | —                                                                                                                                                                                                                                                                                             |
| `installation.updated`                                              | —                                          | **Dropped**                 | —                                                                                                                                                                                                                                                                                             |
| `installation.update-available`                                     | `event-bridge.ts`                          | Handled (reducer no-op)     | `ConversationEvent('installation.update-available')`                                                                                                                                                                                                                                          |
| `lsp.updated` / `lsp.client.diagnostics`                            | —                                          | **Dropped (signal only)**   | LSP diagnostics from edit/write tools are surfaced via `toolMetadata.diagnostics` on the tool card itself (see _Inline LSP diagnostics_ below). The SSE event is only a `{serverID, path}` notifier — consuming it would require a REST round-trip + a Problems panel, which is out of scope. |
| `project.updated`                                                   | —                                          | **Dropped**                 | —                                                                                                                                                                                                                                                                                             |
| `server.connected` / `server.instance.disposed` / `global.disposed` | —                                          | **Dropped**                 | Server lifecycle not surfaced                                                                                                                                                                                                                                                                 |
| `pty.*`                                                             | —                                          | **Dropped**                 | Desktop UI has no PTY surface                                                                                                                                                                                                                                                                 |
| `workspace.*` / `worktree.*`                                        | —                                          | **Dropped**                 | —                                                                                                                                                                                                                                                                                             |
| `tui.*`                                                             | N/A                                        | TUI-only, never reaches SSE | —                                                                                                                                                                                                                                                                                             |

### C6 channel retirement note (historical)

The following legacy IPC channels were removed and folded into the single
`conversation-batch` stream as typed `ConversationEvent` variants (see
`src/preload/api/types.ts`):

- `todos-updated`, `opencode-todo-updated` → `todo.updated`
- `opencode-vcs-updated` → `vcs.updated`
- `opencode-session-status`, `opencode-session-idle`, `opencode-session-error` → `session.status`
- `conversation-message-event` → `message.updated` / `message.removed`
- `conversation-part-event`, `conversation-part-delta` → `message.part.updated` / `message.part.delta`
- `context-usage-updated` → `context.usage` (synthesised in the main bridge)
- `session-compacted` → `session.compacted` + `session.compaction-done` (synthesised on next `message.updated`)
- `opencode-file-edited` → `file.edited`

### Permission / question prompt delivery (fixed)

Previously the renderer's `usePermissionHandlers` and `useQuestionHandlers`
subscribed to dedicated IPC channels (`permission-asked`, `permission-replied`,
`question-asked`, `question-cleared`) that no main-process code ever emitted
after the C6 streaming rewrite — live prompts never surfaced in the UI.

Permission and question prompts are now delivered end-to-end through the same
`conversation-batch` pipeline as every other live-session signal:

1. `event-bridge.ts::bridgeEvent` maps the five SDK events
   (`permission.asked`, `permission.replied`, `question.asked`,
   `question.replied`, `question.rejected`) into `ConversationEvent` variants
   (`permission.asked`, `permission.replied`, `question.asked`,
   `question.cleared`).
2. `event-stream.ts` coalesces by `requestId`, so duplicate emits collapse
   while distinct requests remain separate.
3. The renderer hooks `usePermissionHandlers` and `useQuestionHandlers` now
   subscribe to `onConversationBatch` and update the same `pendingPermissions`
   / `pendingQuestions` session-node state they always did — including the
   startup-poll buffer fallback when the session node isn't registered yet.

The legacy `onPermissionAsked` / `onPermissionReplied` / `onQuestionAsked` /
`onQuestionCleared` IPC listeners on the preload surface remain available
for potential future use but are no longer wired by the renderer.

### Inline LSP diagnostics (Edit / Write cards)

Opencode's `tool/edit.ts` and `tool/write.ts` attach the file's LSP
diagnostics directly to each tool call's `ToolPart.state.metadata.diagnostics`
— a `Record<normalizedFilepath, LSPClient.Diagnostic[]>` (VSCode
`Diagnostic` shape: `range`, `severity`, `message`, `source`, `code`).

`event-bridge.ts::mapPart` already merges `state.metadata` into the
bridged `toolMetadata`, which reaches the renderer as
`ToolCallInfo.metadata`. Two renderer components read this inline:

- `FileToolCards.tsx::EditToolRow` — shows a `DiagnosticsBadge`
  (error/warning pill) in the trigger row, and renders a
  `DiagnosticsList` (file/line/severity/message) below the diff when
  the card is expanded.
- `WriteToolCard.tsx` — identical badge + list treatment.

Both helpers (`extractDiagnosticsForFile`, `countDiagnostics`,
`DiagnosticsBadge`, `DiagnosticsList`) live in `ToolCallShared.tsx` for
reuse by future file-mutating tool cards (e.g. `apply_patch`).

This approach intentionally skips the `lsp.client.diagnostics` SSE
event because that event only carries `{serverID, path}` — surfacing
it as a global Problems panel would require a `client.lsp.diagnostics()`
REST round-trip and a new UI surface, neither of which is currently
needed since the per-tool inline presentation is sufficient.

---

## Key gotchas

1. **Task-tool subagents never emit `session.created.1`.** The only signal is
   `message.part.updated.1` with `part.tool === 'task'` and
   `part.state.metadata.sessionId` (camelCase). See
   `hydrateTaskSubagentSession` in `session/sse-handlers.ts`.
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
