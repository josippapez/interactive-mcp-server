# Session Hierarchy — Interactive MCP Desktop

This document describes exactly how sessions are created, stored, bound, and
displayed from app startup through subagent spawning. A Mermaid diagram is
included for each major phase.

---

## Glossary

| Term                           | Meaning                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------ |
| `connectionId`                 | UUID generated per MCP transport connection (changes on every reconnect)                         |
| `openCodeSessionId`            | Stable ID of an OpenCode session (e.g. `ses_abc123`). Survives reconnects.                       |
| `parentSessionId`              | The `openCodeSessionId` of the parent OpenCode session (from the OpenCode API)                   |
| `session_channels`             | SQLite table — one row per active MCP transport session                                          |
| `registered_connections`       | SQLite table — the durable identity record binding `connectionId` → `openCodeSessionId`          |
| `DEFAULT_MAIN_CHANNEL_NAME`    | `"OpenCode - Main Channel"` — the hard-coded name for the first connection per server lifetime   |
| `mainChannelAssignedInRuntime` | Boolean flag in the `startMcpServer` closure — resets to `false` on every `softRestartMcpServer` |

---

## Phase 1 — App Startup

```mermaid
sequenceDiagram
    participant Electron as Electron main (index.ts)
    participant DB as SQLite DB (database.ts)
    participant FS as Filesystem (/tmp)
    participant HTTP as HTTP MCP Server (mcp-server.ts)
    participant OpenCode as OpenCode HTTP API

    Electron->>DB: initDatabase() — load or create conversations.db
    note over DB: Schema version check.<br/>Wipe + recreate if version mismatch.
    Electron->>FS: writeSessionFile(sessionId, port)<br/>→ /tmp/imcp-session.json + .imcp-session (CWD)
    Electron->>FS: writeMcpConfigHint(port)<br/>→ /tmp/imcp-mcp-config.json
    Electron->>HTTP: startMcpServer(port, ...)<br/>Express HTTP listener starts
    note over HTTP: mainChannelAssignedInRuntime = false<br/>connectionCounter = 0<br/>sessions = {}
    Electron->>HTTP: reconcileSessionConnections()<br/>(session-reconnect.ts)
    HTTP->>DB: getAllRegisteredConnections()
    HTTP-->>Electron: stale DB rows cleaned up

    alt agentBackend === 'opencode'
        Electron->>OpenCode: registerMcpWithRetry(port)<br/>(opencode-mcp-register.ts)
        note over OpenCode: Registers the MCP server with<br/>OpenCode so agents can use tools.
        OpenCode-->>Electron: registered ✓
    end

    Electron->>HTTP: startSessionTreeManager(getWindow, getOpenCodePort)
    HTTP->>OpenCode: GET /global/sync-event (SSE stream)
    note over HTTP,OpenCode: Persistent SSE subscription.<br/>OpenCode emits versioned SyncEvents:<br/>  session.created.1<br/>  session.updated.1<br/>  session.deleted.1<br/>  server.heartbeat (every 10s)
    OpenCode-->>HTTP: server.connected event
    note over HTTP: In-memory _sessionCache populated<br/>from incoming events.<br/>Auto-reconnects on disconnect.
```

---

## Phase 2 — First MCP Client Connection (Main Agent)

```mermaid
sequenceDiagram
    participant Agent as OpenCode Agent (main)
    participant HTTP as HTTP MCP Server
    participant DB as SQLite DB
    participant OpenCode as OpenCode HTTP API

    Agent->>HTTP: POST /mcp (initialize)
    note over HTTP: connectionCounter++ → 1<br/>connectionId = randomUUID()<br/>resolveConnectionName():<br/>  mainChannelAssignedInRuntime=false<br/>  → returns "OpenCode - Main Channel"<br/>  → sets mainChannelAssignedInRuntime=true
    HTTP->>HTTP: autoRegisterDefaultConnection(connectionId,<br/>"OpenCode - Main Channel")

    note over HTTP: isMainChannel = true (name matches DEFAULT)
    HTTP->>OpenCode: autoDetectOpenCodeSession(port, cwd)
    note over OpenCode: 1. GET /session?directory=<cwd><br/>2. fallback: GET /session<br/>3. Prefer roots (no parentID)<br/>4. Sort newest-first<br/>→ returns { id, parentId }
    OpenCode-->>HTTP: detected = { id: "ses_abc", parentId: null }
    HTTP->>DB: isOpenCodeSessionClaimed("ses_abc", connectionId)
    DB-->>HTTP: false (not yet claimed)
    HTTP->>DB: upsertRegisteredConnection({<br/>  connectionId,<br/>  channelName: "OpenCode - Main Channel",<br/>  openCodeSessionId: "ses_abc",<br/>  parentSessionId: null<br/>})
    HTTP->>DB: createSessionChannel(connectionId, "OpenCode - Main Channel")
    HTTP->>HTTP: triggerSessionTreeUpdate() → renderer

    Agent->>HTTP: register_connection tool call<br/>{ channelName: "Main Agent",<br/>  openCodeSessionId: "ses_abc",<br/>  baseDirectory: "/path/to/project" }
    note over HTTP: explicitSessionId = "ses_abc" (provided)<br/>→ skips auto-detect<br/>Fetches parentID from /session API → null
    HTTP->>DB: upsertRegisteredConnection({<br/>  connectionId,<br/>  channelName: "Main Agent",<br/>  openCodeSessionId: "ses_abc",<br/>  parentSessionId: null<br/>})
    note over DB: Deduplication: old row with same<br/>(channelName, openCodeSessionId)<br/>is re-keyed to new connectionId
    HTTP->>DB: createSessionChannel(connectionId, "Main Agent")
    HTTP->>OpenCode: injectOpenCodeMessage("ses_abc", startupContext)
    note over OpenCode: System reminder injected into<br/>the agent's session transcript
    HTTP-->>Agent: { ok: true, connectionId, channelName: "Main Agent", ... }
```

---

## Phase 3 — Subagent Spawning

```mermaid
sequenceDiagram
    participant Parent as Main Agent (ses_abc)
    participant TaskTool as Task Tool (OpenCode)
    participant Child as Subagent Process (ses_xyz)
    participant HTTP as HTTP MCP Server
    participant DB as SQLite DB
    participant OpenCode as OpenCode HTTP API

    Parent->>TaskTool: spawn subagent (Task tool)
    note over TaskTool: OpenCode creates a new child session<br/>ses_xyz with parentID = "ses_abc"
    TaskTool->>Child: start subagent with session ses_xyz

    Child->>HTTP: POST /mcp (initialize)
    note over HTTP: connectionCounter++ → 2<br/>connectionId = randomUUID() (new UUID)<br/>resolveConnectionName():<br/>  mainChannelAssignedInRuntime=true<br/>  → returns "Agent 2"
    HTTP->>HTTP: autoRegisterDefaultConnection(connectionId, "Agent 2")
    note over HTTP: isMainChannel = false (name != DEFAULT)<br/>→ SKIP auto-detection of OpenCode session<br/>→ openCodeSessionId = undefined
    HTTP->>DB: upsertRegisteredConnection({<br/>  connectionId,<br/>  channelName: "Agent 2",<br/>  openCodeSessionId: undefined  ← NO BINDING YET<br/>})
    HTTP->>DB: createSessionChannel(connectionId, "Agent 2")

    Child->>HTTP: register_connection tool call<br/>{ channelName: "My Subagent Task",<br/>  openCodeSessionId: "ses_xyz",  ← MUST pass own session ID<br/>  baseDirectory: "/path/to/project" }
    note over HTTP: explicitSessionId = "ses_xyz" (provided)<br/>→ fetches parentID from /session API → "ses_abc"
    HTTP->>DB: upsertRegisteredConnection({<br/>  connectionId,<br/>  channelName: "My Subagent Task",<br/>  openCodeSessionId: "ses_xyz",<br/>  parentSessionId: "ses_abc"  ← hierarchy established<br/>})
    HTTP->>OpenCode: injectOpenCodeMessage("ses_xyz", startupContext)
    note over OpenCode: System reminder injected into<br/>ses_xyz (the subagent's own transcript)
    HTTP-->>Child: { ok: true, connectionId, channelName: "My Subagent Task",<br/>  openCodeSessionId: "ses_xyz", parentSessionId: "ses_abc" }
```

---

## Phase 4 — Session Tree Rendering

```mermaid
flowchart TD
    OC[OpenCode SSE stream<br/>/global/sync-event] -->|session.created.1\nsession.updated.1\nsession.deleted.1| STM
    STM[session-tree-manager.ts<br/>_sessionCache + buildSnapshot]
    DB[registered_connections<br/>SQLite table] -->|getAllRegisteredConnections| STM

    STM -->|index by openCodeSessionId| MAP{Match RC to session}
    MAP -->|match found| NODE_WITH["SessionNodeData<br/>hasMcpChannel: true<br/>channelName: 'My Subagent Task'<br/>connectionId: UUID<br/>depth: 1"]
    MAP -->|no match| NODE_WITHOUT["SessionNodeData<br/>hasMcpChannel: false<br/>channelName: null<br/>depth: computed from parentID chain"]

    STM -->|session-tree-updated IPC| Renderer
    Renderer -->|builds tree view| Sidebar["Sidebar\n├── ses_abc (Main Agent, depth 0)\n└── ses_xyz (My Subagent Task, depth 1)"]
```

---

## Phase 5 — Prompt Routing (Tool Call → Correct Channel)

```mermaid
sequenceDiagram
    participant Agent as Agent (any)
    participant HTTP as HTTP MCP Server
    participant DB as SQLite DB
    participant Renderer as Renderer (sidebar)
    participant User as User

    Agent->>HTTP: request_user_input tool call<br/>{ message: "...", baseDirectory: "..." }
    note over HTTP: Tool handler has connectionId in closure<br/>(captured at server creation time)
    HTTP->>DB: getRegisteredConnection(connectionId)
    DB-->>HTTP: { connectionId, channelName, openCodeSessionId }
    HTTP->>Renderer: session-prompt IPC<br/>{ connectionId, message, ... }
    Renderer->>Renderer: find channel by connectionId<br/>→ display prompt in correct sidebar channel
    Renderer->>User: show prompt in "My Subagent Task" channel
    User->>Renderer: type response
    Renderer->>HTTP: prompt-response IPC
    HTTP-->>Agent: tool result with user's answer
    HTTP->>DB: appendSessionChannelMessage(connectionId, 'answer', ...)
```

---

## The Subagent Session Collision Bug

### What goes wrong when `openCodeSessionId` is NOT passed

```mermaid
flowchart TD
    subgraph "❌ BUG PATH — subagent omits openCodeSessionId"
        A["Subagent calls register_connection\nwithout openCodeSessionId"] --> B

        B{"baseDirectory\nprovided?"} -->|yes| C
        B -->|no| G["openCodeSessionId = null\nNo injection target\nStartup context included in tool result only"]

        C["autoDetectOpenCodeSession(port, baseDirectory)\n↳ prefers ROOT sessions (no parentID)\n↳ sorts by newest-first"] --> D

        D{"Is detected session\nalready claimed?"} -->|no — root was already registered\nbut dedup logic ran with OLD connectionId\nSO it appears unclaimed to the new UUID| E
        D -->|yes| G

        E["openCodeSessionId = 'ses_abc'\n← ROOT session, NOT subagent's own ses_xyz"] --> F

        F["injectOpenCodeMessage('ses_abc', startupContext)\n↳ context injected into PARENT's session\n↳ prompts from THIS subagent also land\n   in 'Main Agent' channel\n↳ COLLISION ✗"]
    end

    subgraph "✅ CORRECT PATH — subagent passes own openCodeSessionId"
        H["Subagent calls register_connection\nwith openCodeSessionId: 'ses_xyz'"] --> I
        I["Skip auto-detect\nFetch parentID for ses_xyz → ses_abc"] --> J
        J["openCodeSessionId = 'ses_xyz'\nparentSessionId = 'ses_abc'"] --> K
        K["injectOpenCodeMessage('ses_xyz', startupContext)\n↳ correct session targeted\n↳ prompts appear in subagent's own channel ✓"]
    end
```

### Root cause summary

The collision has **two contributing factors**:

1. **`autoDetectOpenCodeSession` prefers root sessions** (`opencode-session.ts:131`).
   When a subagent omits `openCodeSessionId` but provides `baseDirectory`, the
   auto-detect logic intentionally returns the root session — not the subagent's
   own freshly-spawned session. This means ALL context injection and prompt
   routing is bound to the parent's `openCodeSessionId`.

2. **`isOpenCodeSessionClaimed` check uses the new `connectionId`** as the
   exclusion key (`register-connection.ts:253`, `database.ts:685`).
   After a soft restart or reconnect, a new `connectionId` UUID is generated.
   The deduplication logic therefore sees the root session as "unclaimed" from
   the perspective of this new UUID and allows the binding — even though it was
   previously owned by the root agent's old connection.

### Fix — implemented via SSE auto-bind

The collision is prevented by the SSE-based auto-bind mechanism in
`session-tree-manager.ts`:

1. **`recordPendingConnection(connectionId)`** — called from
   `register_connection` immediately after the DB upsert when no
   `openCodeSessionId` was provided. The connection is placed in a
   `_pendingConnections` ring buffer with a 3-second TTL.

2. **`tryAutoBindSession(info)`** — called every time a
   `session.created.1` SSE event arrives with a `parentID`. It scans
   `_pendingConnections` for the most recently registered unbound connection
   and calls `updateConnectionOpenCodeSession(connectionId, sessionId)` to
   persist the binding.

```mermaid
sequenceDiagram
    participant OC as OpenCode SSE stream
    participant STM as session-tree-manager.ts
    participant DB as SQLite DB

    note over STM: Subagent calls register_connection<br/>without openCodeSessionId
    STM->>DB: upsertRegisteredConnection(connId, openCodeSessionId=null)
    STM->>STM: recordPendingConnection(connId)<br/>→ _pendingConnections.set(connId, Date.now())

    OC->>STM: session.created.1 { sessionID: "ses_xyz", info: { parentID: "ses_abc" } }
    STM->>STM: tryAutoBindSession(info)<br/>info.parentID ≠ null → child session<br/>find bestConnId from _pendingConnections (within 3s)
    STM->>DB: updateConnectionOpenCodeSession(connId, "ses_xyz")
    note over DB: registered_connections row updated<br/>openCodeSessionId = "ses_xyz" ✓
    STM->>STM: scheduleSnapshot() → session-tree-updated IPC
```

---

## Storage Layers Summary

| Layer                           | Location                                   | Key                 | Contents                                                                          | Lifetime                                         |
| ------------------------------- | ------------------------------------------ | ------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------ |
| In-memory `sessions` map        | `mcp-server.ts`                            | MCP transport UUID  | `{ connectionId, server, transport }`                                             | Until disconnect / soft restart                  |
| In-memory `_sessionCache`       | `session-tree-manager.ts`                  | `openCodeSessionId` | `SessionInfo` from SSE events (id, parentID, title, directory, timestamps)        | Until app quit or session.deleted.1 event        |
| `session_channels` SQLite       | `conversations.db`                         | `connectionId`      | Channel label, timestamps                                                         | Until `deleteSessionChannel()`                   |
| `registered_connections` SQLite | `conversations.db`                         | `connectionId`      | Full identity record: channelName, openCodeSessionId, parentSessionId, idFilePath | Until `deleteRegisteredConnection()` or DB reset |
| ID file                         | `/tmp/imcp-agent-<name>-<sessionId>.json`  | filename            | connectionId + metadata                                                           | Until `deleteRegisteredConnection()` or DB reset |
| Session file                    | `/tmp/imcp-session.json` + `.imcp-session` | —                   | `{ sessionId, port }` for OpenCode to discover the MCP server                     | Until `clearSessionFile()` (app quit)            |
| MCP config hint                 | `/tmp/imcp-mcp-config.json`                | —                   | Ready-to-paste MCP config                                                         | Until `clearSessionFile()` (app quit)            |
