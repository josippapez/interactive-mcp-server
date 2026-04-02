# Future Features & Design Notes

## `register_connection` — Named Agent Channels

### Overview

Agents can call the `register_connection` tool at the start of every session to
establish a persistent, human-readable channel in the Interactive MCP Desktop
app sidebar. This creates a stable identity for the agent across app restarts.

### How it works

1. **Agent calls `register_connection`** with `agentName`, `projectName`, and
   optionally `baseDirectory`.
2. The server:
   - Upserts a record in the `registered_connections` SQLite table.
   - Writes a JSON ID file to `/tmp/imcp-agent-<safe-name>.json` so the agent
     can recover its `connectionId` after a restart without re-registering.
   - Renames the channel in the `session_channels` table to the `agentName`.
   - Sends a `connection-registered` IPC event so the UI sidebar updates
     immediately.
3. The tool returns `{ ok: true, connectionId, idFilePath, ... }`.

### ID file format (`/tmp/imcp-agent-<name>.json`)

```json
{
  "connectionId": "<uuid>",
  "agentName": "Claude Code",
  "projectName": "my-project",
  "baseDirectory": "/Users/me/projects/my-project"
}
```

### Session deletion semantics

When the user removes a session from the UI (via the sidebar delete button):

1. The IPC handler `remove-session-channel` is called with the `sessionId`.
2. It calls:
   - `forceTerminateChat(sessionId)` — cancels any pending prompt.
   - `closeSessionByConnectionId(sessionId)` — closes the MCP transport.
   - `deleteSessionChannel(sessionId)` — removes DB channel + message records.
   - `deleteRegisteredConnection(sessionId)` — removes the `registered_connections`
     DB record **and** deletes the `/tmp` ID file from disk.
   - `markConnectionDeleted(sessionId)` — adds the connectionId to an in-memory
     set so subsequent tool calls on that connectionId return an actionable error.
3. The UI receives `connection-closed` and `session-channel-deleted` events and
   removes the channel from the sidebar.

### Stale-session error behavior

If an agent continues to call tools after its session was removed by the user,
every tool (except `register_connection` itself) will return:

```json
{
  "error": "SESSION_REMOVED",
  "message": "Your session was removed from the Interactive MCP Desktop app by the user. You must re-register before using any other tools.",
  "action": "Call the register_connection tool with your agentName, projectName, and baseDirectory to re-establish your channel.",
  "example": {
    "tool": "register_connection",
    "arguments": {
      "agentName": "<your agent name>",
      "projectName": "<your project name>",
      "baseDirectory": "<absolute path to your working directory>"
    }
  }
}
```

The agent should react to this error by calling `register_connection` again.

### Recovery flow after app restart

After the desktop app restarts:

- The in-memory deleted-connections set is cleared (it is not persisted).
- The `registered_connections` table survives because it is in SQLite.
- An agent whose `/tmp` ID file exists can read it to recover its `connectionId`
  and resume without re-registering, provided the MCP session itself reconnects.
- If the MCP transport session is gone (new HTTP session), the agent must call
  `register_connection` again to get a fresh `connectionId` and re-establish its
  channel.

### Implementation files

| File                                            | Role                                                                                  |
| ----------------------------------------------- | ------------------------------------------------------------------------------------- |
| `desktop/src/main/tools/register-connection.ts` | Tool implementation                                                                   |
| `desktop/src/main/tools/connection-guard.ts`    | `markConnectionDeleted` + `staleConnectionError` helpers                              |
| `desktop/src/main/database.ts`                  | `upsertRegisteredConnection`, `deleteRegisteredConnection`, `getRegisteredConnection` |
| `desktop/src/main/ipc-handlers.ts`              | `remove-session-channel` handler wires everything together                            |
| `desktop/src/main/mcp-server.ts`                | Registers the tool via `registerConnectionTool` in `createMcpServerWithTools`         |

---

## Remaining work

The following items are not yet implemented and should be completed before
the feature is considered fully shipped.

### 1. UI: React to `connection-registered` IPC event (user-visible)

**Problem:** When an agent calls `register_connection`, the server sends a
`connection-registered` IPC event with `{ connectionId, agentName, label }`.
The renderer does not currently listen for this event, so the sidebar continues
to show the old auto-generated `Agent N` name until the app is restarted.

**What to do:** In `desktop/src/renderer/src/hooks/useConnections.ts` (or
wherever `connection-opened` is handled), add a listener for
`connection-registered` that updates the channel label in local React state.

### 2. UI: Sidebar delete button must call `remove-session-channel` (user-visible)

**Problem:** The IPC handler `remove-session-channel` is fully wired on the
main-process side, but it is only useful if the renderer actually calls it when
the user confirms a channel deletion. Without this call the cleanup logic
(DB record, ID file, in-memory guard) never runs.

**What to do:**

- Confirm that `removeSessionChannel` is exposed through the preload API in
  `desktop/src/preload/index.ts`.
- In the channel sidebar component (`ChannelSidebar.tsx` or equivalent), wire
  the delete confirmation action to call `window.api.removeSessionChannel(sessionId)`.

### 3. Unit tests

No automated tests exist yet for:

- `register_connection` tool: DB upsert, ID file creation, UI event emission.
- `deleteRegisteredConnection`: ID file deletion + DB record removal.
- `staleConnectionError`: returns an error after `markConnectionDeleted` is called,
  returns `null` before.

### 4. Health endpoint — add `register_connection` to tool list (cosmetic)

The `/health` endpoint at `desktop/src/main/mcp-server.ts` returns a hardcoded
`tools` array that does not include `register_connection`. Update the array to
keep it consistent with the actual registered tools.
