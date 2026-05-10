# OpenCode Event Catalog

Complete reference of every event OpenCode emits on its event buses, the payload shape,
the SSE stream it reaches us on, and what (if anything) the desktop app does with it today.

Sources of truth in the OpenCode repo:

- `packages/opencode/src/bus/bus.ts` — in-process `Bus` (per-instance PubSub).
- `packages/opencode/src/bus/global.ts` — `GlobalBus` (process-wide EventEmitter).
- `packages/opencode/src/sync/index.ts` — versioned, persisted sync events that are
  also re-published on the in-process `Bus` as their un-versioned type.
- `packages/opencode/src/v2/session-event.ts` — `session.next.*` event definitions
  generated into `@opencode-ai/sdk` `^1.14.39`.
- `packages/opencode/src/v2/event.ts` — experimental V2 event runner; `EventV2.run`
  returns early unless `Flag.OPENCODE_EXPERIMENTAL_EVENT_SYSTEM` is enabled.
- `packages/opencode/src/server/routes/instance/httpapi/groups/global.ts` and
  `handlers/global.ts` — HTTP/SSE endpoint `GET /global/event` the desktop app
  subscribes to. The stream carries **both** in-process `Bus` events and
  versioned sync events in a single unified schema.

Versioned sync events (the ones with `.1`, `.2`, …) are the authoritative replayable
log. When published, OpenCode also republishes an un-versioned bus payload
(e.g. `session.created`) through the same global SSE stream. Consumers can
therefore see both the live un-versioned event and the replayable sync envelope
for the same underlying mutation.

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
- `{ directory, project, workspace, payload: { type: 'sync', name: '<event>.<version>', id, seq, aggregateID, data } }` — generated SDK sync envelope shape

OpenCode currently uses both sync envelope shapes in runtime/control-plane code.
The desktop normalizes selected `session.next.*` sync frames from both
`payload.syncEvent.{type,data}` and direct `payload.{name,data}` forms. Legacy
sync `message.*` frames remain skipped to avoid duplicate chat events.

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

For tool parts, `part.type === 'tool'` and `part.state` is one of:

- `pending`: `{ status, input }`
- `running`: `{ status, input, metadata?, time.start }`
- `completed`: `{ status, input, output, metadata?, title?, time.start, time.end }`
- `error`: `{ status, input, error, metadata?, time.start, time.end }`

Desktop mapping source: `desktop/src/shared/opencode-mapping.ts::mapPart`. It merges
`part.state.metadata` and `part.metadata` into renderer `ToolCallInfo.metadata`. Completed
tool `attachments` are merged into metadata as `attachments`, and image/PDF/file parts may also
arrive as separate `MessageV2.FilePart` siblings.

### Session next stream — aggregate: `sessionID`

Sources:

- `packages/opencode/src/v2/session-event.ts` — event definitions.
- `packages/opencode/src/v2/event.ts` — experimental gate; no-op unless
  `Flag.OPENCODE_EXPERIMENTAL_EVENT_SYSTEM` is enabled.
- `packages/opencode/src/session/prompt.ts`, `session/processor.ts`,
  `session/compaction.ts` — producers.
- `packages/opencode/src/session/projectors-next.ts` — V2 persistence/projection.
- `packages/opencode/src/cli/cmd/tui/context/sync-v2.tsx` — experimental TUI/debug
  consumer.

Present in the generated types for desktop's `@opencode-ai/sdk` `^1.14.39`.
When a V2 sync event publishes, `SyncEvent.process` emits an unversioned bus
payload via `ProjectBus.publish(...)` and also emits a sync payload via
`GlobalBus.emit(...)`. Consumers may therefore see both:

- unversioned bus payloads such as
  `{ payload: { id, type: 'session.next.agent.switched', properties: ... } }`
- sync payloads such as generated SDK
  `{ type: 'sync', name: 'session.next.agent.switched.1', id, seq, aggregateID, data }`
  or current runtime/control-plane
  `{ type: 'sync', syncEvent: { type: 'session.next.agent.switched.1', id, seq, aggregateID, data } }`

The desktop app consumes a narrow side-channel subset of these events. It does
not map V2 content events into chat, because legacy `message.*` / `message.part.*`
remain the current renderer's source of truth.

| Event (versioned)                   | Payload (`data`) summary                            | Notes                                                                                                                                                                                                                                                        |
| ----------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `session.next.agent.switched.1`     | Active agent changed for the next step.             | Not consumed directly. OpenCode also projects this into `Session`, and desktop already derives session agent selection from the message/session data it consumes today.                                                                                      |
| `session.next.model.switched.1`     | Active model/provider/variant changed.              | Handled as side-channel state and reflected in composer model selection. Also projected into `Session`; direct handling is mostly for immediacy.                                                                                                             |
| `session.next.prompted.1`           | User/provider prompt entered the next session flow. | V2 message-model content event. Do not render into current chat stream.                                                                                                                                                                                      |
| `session.next.synthetic.1`          | Synthetic next-session event emitted by OpenCode.   | V2 message-model content event. Do not render into current chat stream.                                                                                                                                                                                      |
| `session.next.shell.started.1`      | Shell command execution started.                    | V2 message-model content event. Do not render into current chat stream.                                                                                                                                                                                      |
| `session.next.shell.ended.1`        | Shell command execution ended.                      | V2 message-model content event. Do not render into current chat stream.                                                                                                                                                                                      |
| `session.next.step.started.1`       | Reasoning/execution step started.                   | V2 message-model content event. Do not render into current chat stream.                                                                                                                                                                                      |
| `session.next.step.ended.1`         | Reasoning/execution step ended.                     | V2 message-model content event. Do not render into current chat stream.                                                                                                                                                                                      |
| `session.next.step.failed.1`        | Reasoning/execution step failed.                    | V2 message-model content event. Do not render into current chat stream.                                                                                                                                                                                      |
| `session.next.text.started.1`       | Assistant text output started.                      | Alternate stream/model; lacks legacy message/part IDs. Do not map unless renderer migrates to V2 session-message model.                                                                                                                                      |
| `session.next.text.delta.1`         | Assistant text output delta.                        | Would duplicate legacy `message.*` chat content today.                                                                                                                                                                                                       |
| `session.next.text.ended.1`         | Assistant text output ended.                        | Alternate stream/model; do not map into current chat renderer.                                                                                                                                                                                               |
| `session.next.reasoning.started.1`  | Assistant reasoning output started.                 | Alternate stream/model; lacks legacy message/part IDs. Do not map unless renderer migrates to V2 session-message model.                                                                                                                                      |
| `session.next.reasoning.delta.1`    | Assistant reasoning output delta.                   | Would duplicate legacy `message.*` chat content today.                                                                                                                                                                                                       |
| `session.next.reasoning.ended.1`    | Assistant reasoning output ended.                   | Alternate stream/model; do not map into current chat renderer.                                                                                                                                                                                               |
| `session.next.tool.input.started.1` | Tool input streaming started.                       | V2 message-model content event. Do not render into current chat stream.                                                                                                                                                                                      |
| `session.next.tool.input.delta.1`   | Tool input streaming delta.                         | V2 message-model content event. Do not render into current chat stream.                                                                                                                                                                                      |
| `session.next.tool.input.ended.1`   | Tool input streaming ended.                         | V2 message-model content event. Do not render into current chat stream.                                                                                                                                                                                      |
| `session.next.tool.called.1`        | Tool call was issued.                               | Existing desktop consumes legacy tool parts; do not duplicate tool cards.                                                                                                                                                                                    |
| `session.next.tool.progress.1`      | Tool execution progress update keyed by call ID.    | Handled as metadata-only side-channel state keyed by `(sessionId, callID)`. If a matching legacy tool part exists, desktop copies progress metadata onto that part and uses text progress as temporary tool output; it does not create duplicate tool cards. |
| `session.next.tool.success.1`       | Tool call completed successfully.                   | Existing desktop consumes legacy tool parts; do not duplicate tool cards.                                                                                                                                                                                    |
| `session.next.tool.failed.1`        | Tool call failed.                                   | Existing desktop consumes legacy tool parts; do not duplicate tool cards.                                                                                                                                                                                    |
| `session.next.retried.1`            | Retry occurred in the next session flow.            | Handled as side-channel state and transient sidebar/status notice; not represented in legacy `message.*`.                                                                                                                                                    |
| `session.next.compaction.started.1` | Compaction output started.                          | Handled as side-channel state and transient compaction status. Existing desktop still consumes `session.compacted` for post-compaction reconciliation and context re-injection.                                                                              |
| `session.next.compaction.delta.1`   | Compaction output delta.                            | Do not render text into chat unless using the V2 compaction-message model.                                                                                                                                                                                   |
| `session.next.compaction.ended.1`   | Compaction output ended.                            | Handled as side-channel state and transient compaction-complete status. Existing desktop still consumes `session.compacted`.                                                                                                                                 |

#### Implemented approach for `session.next.*`

1. `event-stream.ts` normalizes direct and sync `session.next.*` envelopes, including
   both `payload.syncEvent.{type,data}` and generated SDK `payload.{name,data}` sync
   shapes. Legacy sync `message.*` frames stay skipped to avoid duplicate chat events.
2. `event-bridge.ts` maps only selected side-channel events:
   `session.next.model.switched`, `session.next.retried`,
   `session.next.compaction.started`, `session.next.compaction.ended`, and
   `session.next.tool.progress`.
3. `event-coalesce.ts` coalesces the selected side-channel events by session to avoid
   stale status/model flashes inside one flush tick.
4. The renderer stores only the model switch in `ConversationState.sessionSideChannels`
   because the composer reads it as current session state. Retry/compaction events feed
   transient sidebar/status notices directly, and tool progress is reconciled onto
   existing running legacy tool parts by `toolCallId` when possible.
5. Chat rendering remains backed by existing legacy `message.*` / `message.part.*`
   events until a full V2 session-message migration is deliberate.

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

| Event              | Payload            |
| ------------------ | ------------------ |
| `workspace.ready`  | `{ ... }`          |
| `workspace.failed` | `{ ..., error }`   |
| `workspace.status` | `ConnectionStatus` |

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

Entry point: `desktop/src/main/utility/backend/event-stream.ts` opens the SSE
stream via `client.global.event()` and feeds every envelope through
`desktop/src/main/utility/backend/event-bridge.ts::bridgeEvent`. Both modules
live inside the **utility process** after the Phase 2/3 extraction. Session-lifecycle
events (`session.created` / `session.updated` / `session.deleted`) are intercepted in
`event-stream.ts` before `bridgeEvent` sees them and routed to
`desktop/src/main/utility/backend/sse-handlers.ts`.

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
| selected `session.next.*` side-channel events                       | `event-stream.ts` → `event-bridge.ts`      | Handled                     | `ConversationEvent('session.next.model.switched' / 'session.next.retried' / 'session.next.compaction.started' / 'session.next.compaction.ended' / 'session.next.tool.progress')` → composer model selection, transient status notices, and running tool-part progress reconciliation.         |
| `session.next.*` V2 content/tool events                             | —                                          | **Dropped / ignored**       | Not consumed today. These are alternate V2 message-model events and would duplicate or conflict with current legacy `message.*` chat rendering.                                                                                                                                               |
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

### Tool metadata and permission metadata sources

OpenCode exposes tool-related data through two different channels that are easy
to confuse:

1. **Tool result metadata** travels on `message.part.updated.1` as
   `MessageV2.ToolPart.state.metadata`. This is the canonical source for
   renderable tool-card details after or during execution. The desktop mapper
   forwards it to `ToolCallInfo.metadata`.
2. **Permission metadata** travels on `permission.asked` as
   `Permission.Request.metadata`. It is for approval UI before execution. It can
   contain useful previews (for example edit diffs), but it should not be the
   primary source for completed tool cards when the later tool part metadata is
   available.

Native OpenCode TUI uses the tool result metadata for tool cards. Notable source
files in OpenCode:

- `packages/opencode/src/tool/tool.ts` — `ExecuteResult.metadata`, `ctx.metadata(...)`,
  truncation wrapper adding `truncated` and `outputPath`.
- `packages/opencode/src/session/message-v2.ts` — `ToolPart.state.metadata` schema.
- `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` — native TUI reads
  `props.metadata` for tool-card rendering.

#### Built-in tool result metadata

| Tool                | OpenCode source       | Result metadata keys                                                             | Desktop use / notes                                                                                                                                                                                                                                 |
| ------------------- | --------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bash`              | `tool/bash.ts`        | `output`, `exit`, `description`, `truncated`, optional `outputPath`              | `output` updates while running for live preview/autoscroll; `outputPath` points to full saved output when truncated.                                                                                                                                |
| `edit`              | `tool/edit.ts`        | `diff`, `filediff`, `diagnostics`, plus wrapper `truncated`/`outputPath`         | `diff` is generated with `createTwoFilesPatch(...)` from real old/new file contents; `filediff` mirrors `Snapshot.FileDiff`; diagnostics are inline LSP details.                                                                                    |
| `write`             | `tool/write.ts`       | `diagnostics`, `filepath`, `exists`, plus wrapper `truncated`/`outputPath`       | Permission metadata has the pre-write `diff`; result metadata currently keeps diagnostics and existence state.                                                                                                                                      |
| `apply_patch`       | `tool/apply_patch.ts` | `diff`, `files`, `diagnostics`, plus wrapper `truncated`/`outputPath`            | `files[].patch` is the native TUI's source for real line numbers. It is generated with `createTwoFilesPatch(...)` after resolving raw `patchText` chunks against current file contents. Desktop should prefer this over raw `tool.input.patchText`. |
| `read`              | `tool/read.ts`        | `preview`, `truncated`, `loaded`, plus wrapper `outputPath` if wrapper truncates | Image/PDF reads return `attachments` in addition to metadata; `loaded` lists instruction/context files injected as reminders.                                                                                                                       |
| `grep`              | `tool/grep.ts`        | `matches`, `truncated`                                                           | Search count and truncation state.                                                                                                                                                                                                                  |
| `glob`              | `tool/glob.ts`        | `count`, `truncated`                                                             | File count and truncation state.                                                                                                                                                                                                                    |
| `task`              | `tool/task.ts`        | `sessionId`, `model`, plus wrapper `truncated`/`outputPath`                      | `sessionId` is the spawned/resumed subagent session; desktop also pairs sibling `subtask` parts when present.                                                                                                                                       |
| `lsp`               | `tool/lsp.ts`         | `result`                                                                         | Raw LSP operation result.                                                                                                                                                                                                                           |
| `skill`             | `tool/skill.ts`       | `name`, `dir`                                                                    | Skill identity and base directory.                                                                                                                                                                                                                  |
| `webfetch`          | `tool/webfetch.ts`    | usually `{}`; image fetches also return `attachments`                            | Content type appears in `title`, not metadata.                                                                                                                                                                                                      |
| `websearch`         | `tool/websearch.ts`   | `{}`                                                                             | Permission metadata contains the query/options; result metadata is empty.                                                                                                                                                                           |
| `codesearch`        | `tool/codesearch.ts`  | `{}`                                                                             | Permission metadata contains the query/options; result metadata is empty.                                                                                                                                                                           |
| `plan_exit`         | `tool/plan.ts`        | `{}`                                                                             | Uses `question.asked` rather than permission metadata for user confirmation.                                                                                                                                                                        |
| plugin/custom tools | `tool/registry.ts`    | plugin-defined keys, plus wrapper `truncated`/`outputPath`                       | Desktop must treat metadata as open-ended.                                                                                                                                                                                                          |

#### Permission metadata previews

OpenCode also places pre-execution details on permission requests. These arrive
via `permission.asked`, not `message.part.updated.1`.

| Permission source                         | OpenCode source              | Permission metadata keys                                                                                                 | Notes                                                                              |
| ----------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `edit` permission from `edit` tool        | `tool/edit.ts`               | `filepath`, `diff`                                                                                                       | Preview before applying edit.                                                      |
| `edit` permission from `write` tool       | `tool/write.ts`              | `filepath`, `diff`                                                                                                       | Preview before writing full file.                                                  |
| `edit` permission from `apply_patch` tool | `tool/apply_patch.ts`        | `filepath`, `diff`, `files`                                                                                              | `files[].patch` matches native TUI preview shape.                                  |
| `read`                                    | `tool/read.ts`               | `{}`                                                                                                                     | File path is in permission patterns.                                               |
| `grep`                                    | `tool/grep.ts`               | `pattern`, `path`, `include`                                                                                             | Search approval context.                                                           |
| `glob`                                    | `tool/glob.ts`               | `pattern`, `path`                                                                                                        | File-search approval context.                                                      |
| `bash`                                    | `tool/bash.ts`               | command-derived metadata can include external-directory approval details; running result metadata carries output preview | Bash also calls `ctx.metadata(...)` during execution for streaming output preview. |
| `task`                                    | `tool/task.ts`               | `description`, `subagent_type`                                                                                           | Approval context for subagent spawn.                                               |
| `webfetch`                                | `tool/webfetch.ts`           | `url`, `format`, `timeout`                                                                                               | Web fetch approval context.                                                        |
| `websearch`                               | `tool/websearch.ts`          | `query`, `numResults`, `livecrawl`, `type`, `contextMaxCharacters`                                                       | Web search approval context.                                                       |
| `codesearch`                              | `tool/codesearch.ts`         | `query`, `tokensNum`                                                                                                     | Code search approval context.                                                      |
| `skill`                                   | `tool/skill.ts`              | `{}`                                                                                                                     | Skill name is in permission patterns.                                              |
| external directory guard                  | `tool/external-directory.ts` | `filepath`, `parentDir`                                                                                                  | Emitted when a tool touches a path outside the current project/worktree.           |

When both channels exist, prefer `ToolPart.state.metadata` for completed tool
rendering and use permission metadata only for permission/prompt UI.

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
2. **Sync-backed mutations may appear twice.** OpenCode can emit an
   un-versioned bus payload (`session.created`) and a replayable sync envelope
   (`session.created.1`) for the same mutation on the global SSE stream. Avoid
   consuming both paths for chat content unless there is explicit dedupe logic.
3. **Field naming is inconsistent.** Most sync payloads use `sessionID` (uppercase
   ID), but Task-tool metadata uses `sessionId` (camelCase). Do not assume one
   casing.
4. **SSE envelope differs per event class.** Non-sync: `payload.properties`.
   Sync can be `payload.syncEvent.data` or generated SDK-style `payload.data`
   with `payload.name`. The desktop app currently skips sync frames except for
   separately intercepted lifecycle handling.
5. **`global.disposed` is defined twice** (in `server/event.ts` and
   `server/instance/global.ts`) with the same type string. Treat as one event.
