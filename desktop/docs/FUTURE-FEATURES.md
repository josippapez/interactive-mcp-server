# Future Features & Design Notes

---

## ✅ Completed: `register_connection` — Named Agent Channels

> **Status: Shipped.** All items below are implemented. See [`TOOLS.md`](./TOOLS.md#register_connection) for the full tool reference.

### What was built

1. **`register_connection` tool** — agents call it at session start with `agentName`, `projectName`, and optionally `baseDirectory`.
2. **`registered_connections` SQLite table** — persists agent identity across app restarts, including the auto-detected `open_code_session_id`.
3. **OpenCode session auto-detection** — `autoDetectOpenCodeSession()` queries `GET /session?directory={baseDirectory}` (with fallback to `GET /session`) and stores the most recently updated session ID in the DB row.
4. **ID file** — written to `/tmp/imcp-agent-<safe-name>.json` for agent recovery after restart.
5. **`connection-registered` IPC event** — sent to the renderer on registration; `useConnections.ts` listens and updates the sidebar label and `openCodeSessionId` in React state.
6. **`remove-session-channel` IPC handler** — fully wired: cancels prompt, closes transport, deletes DB records, deletes ID file, marks connection deleted.
7. **Stale-session guard** — `staleConnectionError()` returns a structured `SESSION_REMOVED` error on every tool call after the session is deleted, directing the agent to re-register.
8. **`openCodePort` setting** (default `4096`) — configurable in Settings UI.

### Implementation files

| File                                               | Role                                                                                   |
| -------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `desktop/src/main/tools/register-connection.ts`    | Tool implementation + `autoDetectOpenCodeSession`                                      |
| `desktop/src/main/tools/connection-guard.ts`       | `markConnectionDeleted` + `staleConnectionError` helpers                               |
| `desktop/src/main/database.ts`                     | `upsertRegisteredConnection`, `deleteRegisteredConnection`, `getRegisteredConnection`  |
| `desktop/src/main/ipc-handlers.ts`                 | `remove-session-channel` + `inject-opencode-message` handlers                          |
| `desktop/src/main/mcp-server.ts`                   | Registers the tool via `registerConnectionTool` in `createMcpServerWithTools`          |
| `desktop/src/preload/index.ts`                     | `onConnectionRegistered`, `injectOpenCodeMessage` exposed on `window.api`              |
| `desktop/src/renderer/src/hooks/useConnections.ts` | Handles `connection-registered` IPC, OpenCode injection in `handleQueueSessionMessage` |

---

## ✅ Completed: noReply OpenCode Injection

> **Status: Shipped.** See [`SESSION-CHANNELS.md`](./SESSION-CHANNELS.md#noreply-opencode-injection) and [`IPC-API.md`](./IPC-API.md#opencode-injection) for full reference.

When the user sends a message from `ChannelComposer`, the desktop app now delivers it via two parallel paths:

1. **Queue path** — `queueSessionMessage` persists to SQLite for VS Code extension polling.
2. **Injection path** — `injectOpenCodeMessage` POSTs `{ noReply: true, parts: [{ type: "text", text }] }` to `http://localhost:{openCodePort}/session/{openCodeSessionId}/message`.

Injection failure is non-fatal: an error status badge is shown in `AgentStatusBar` and the queue path always completes regardless.

### Commits

| Hash      | Description                                                        |
| --------- | ------------------------------------------------------------------ |
| `3259dda` | `feat: add noReply OpenCode injection support`                     |
| `42c3c68` | `feat: auto-detect OpenCode session on register_connection`        |
| `446631d` | `fix: use agent baseDirectory for OpenCode session auto-detection` |

---

## ✅ Completed: `send_message` — Agent-to-User Direct Messages

> **Status: Shipped.** See [`TOOLS.md`](./TOOLS.md#send_message) for the full tool reference.

### Overview

A new non-blocking MCP tool that lets the agent push a visible message directly into the desktop app channel history — without needing an active `request_user_input` prompt open. Think of it as a one-way "informational reply" the agent can send at any time.

### Motivation

Currently the agent can only communicate with the user in two ways:

- `request_user_input` / `ask_intensive_chat` — blocks until the user replies.
- `push_session_status` — shows a transient status badge, not a persistent chat message.

There is no way to send a persistent, visible message into the channel without demanding a response. `send_message` fills that gap.

### Proposed behavior

- **Non-blocking** — returns `{ ok: true }` immediately, like `push_session_status`.
- **Persisted** — the message is written to `session_channel_history` with a new `message_type` of `'agent_message'`, so it survives app restarts and appears when history is restored.
- **Distinct visual style** — rendered in `ChatHistoryView` with an "informational" appearance (different from the blue `question` border used for prompts). Suggested: a teal/cyan left border, or a subtle info-box style.
- **Markdown supported** — content rendered via `MarkdownContent` like other messages.

### Proposed tool signature

```ts
send_message({
  message: string;   // Required. The message text to display (markdown supported).
})
```

### Implementation plan

#### 1. New `message_type` value in the database

Add `'agent_message'` as a valid value for `session_channel_history.message_type`. No schema migration needed — it is a TEXT column with no constraint. Update `appendSessionChannelMessage` to accept it.

#### 2. New MCP tool — `desktop/src/main/tools/session-channel.ts`

Add `registerSendMessageTool` alongside the existing `registerSessionChannelTools`. The handler:

1. Calls `staleConnectionError` guard.
2. Calls `appendSessionChannelMessage({ sessionId: connectionId, messageType: 'agent_message', messageText: message })` to persist.
3. Fires `webContents.send('agent-message', { connectionId, message })` to push to the renderer live.
4. Returns `{ ok: true }`.

#### 3. New IPC channel — `agent-message`

| Channel         | Direction       | Payload                                     |
| --------------- | --------------- | ------------------------------------------- |
| `agent-message` | main → renderer | `{ connectionId: string, message: string }` |

Expose `onAgentMessage` in `desktop/src/preload/index.ts`.

#### 4. Renderer — `useConnections.ts`

Add `'agent_message'` to the `MessageKind` union in `types.ts`. Register an `onAgentMessage` listener in `useConnections` that calls `pushMessage` with `kind: 'agent_message'`. Update `toChannelMessage` to handle `messageType: 'agent_message'` from DB history records.

#### 5. Renderer — `ChatHistoryView` / `PromptMessage`

Add a visual branch for `kind === 'agent_message'` in the message rendering. Suggested style:

```css
/* Add to main.css */
.msg-agent-info {
  border-left: 3px solid var(--color-agent-info); /* new token, e.g. #2dd4bf teal */
}
```

Or use an inline Tailwind variant if preferred. The message should look clearly "informational" — not a question waiting for input.

#### 6. Update `SessionChannelHistoryRecord` type in preload

Add `'agent_message'` to the `messageType` union.

### Files to touch

| File                                                                             | Change                                                                    |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `desktop/src/main/tools/session-channel.ts`                                      | Add `registerSendMessageTool`                                             |
| `desktop/src/main/mcp-server.ts`                                                 | Call `registerSendMessageTool` in `createMcpServerWithTools`              |
| `desktop/src/main/database.ts`                                                   | Accept `'agent_message'` in `appendSessionChannelMessage`                 |
| `desktop/src/main/ipc-handlers.ts`                                               | No change needed (tool handles persistence directly)                      |
| `desktop/src/preload/index.ts`                                                   | Add `onAgentMessage` listener + update `SessionChannelHistoryRecord` type |
| `desktop/src/renderer/src/types.ts`                                              | Add `'agent_message'` to `MessageKind`                                    |
| `desktop/src/renderer/src/hooks/useConnections.ts`                               | Handle `agent-message` IPC + `toChannelMessage`                           |
| `desktop/src/renderer/src/components/prompt/ChatHistoryView.tsx` (or equivalent) | Render `agent_message` kind with distinct style                           |
| `desktop/src/renderer/src/assets/main.css`                                       | Add `--color-agent-info` token + `.msg-agent-info` class                  |
| `desktop/docs/TOOLS.md`                                                          | Document `send_message` tool                                              |
| `desktop/docs/IPC-API.md`                                                        | Document `agent-message` IPC channel + `onAgentMessage`                   |
| `desktop/docs/DATABASE.md`                                                       | Note `'agent_message'` message type                                       |
| `desktop/docs/SESSION-CHANNELS.md`                                               | Add `agent_message` to message types table                                |

---

## Open: Remaining housekeeping

### Unit tests

No automated tests exist yet for:

- `register_connection` tool: DB upsert, ID file creation, UI event emission.
- `deleteRegisteredConnection`: ID file deletion + DB record removal.
- `staleConnectionError`: returns error after `markConnectionDeleted`, null before.
- `autoDetectOpenCodeSession`: correct session picked, graceful timeout handling.
- `inject-opencode-message` IPC: success path, failure path, error status propagation.

### Health endpoint — add missing tools to list

The `/health` endpoint in `desktop/src/main/mcp-server.ts` returns a hardcoded `tools` array. Add `register_connection` and (once implemented) `send_message` to keep it consistent with the actual registered tools.
