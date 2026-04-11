# Refactor: OpenCode Session ID as Primary Key

**Status:** Proposed  
**Scope:** `desktop/` — main process, preload, renderer  
**Motivation:** Support multiple simultaneous OpenCode instances, each with their own session tree, all connecting to the same MCP server. Eliminate the dependency on agents passing `openCodeSessionId` by making the system own the identity of every session proactively from the SSE feed.

---

## Problem Statement

Today, every tool call is routed via an internal `connectionId` — a UUID generated server-side at MCP `initialize` time, completely invisible to the agent. The system works correctly when there is exactly one OpenCode instance and its agent calls `register_connection` with the right `openCodeSessionId`. It breaks in two ways:

1. **Multiple OpenCode instances:** Each OpenCode process spawns agents that share the same MCP endpoint. Because `connectionId` is generated per HTTP connection and has no relation to the OpenCode session identity, the system cannot distinguish which OpenCode tree a connection belongs to without the agent explicitly telling it.

2. **Race condition on register_connection:** Subagents spawned via the Task tool all auto-detect the same parent `openCodeSessionId` before any of them has written a DB claim. Even with the `tryClaimOpenCodeSession` atomic fix, the race window exists because the DB write happens after async gaps.

3. **Agent must know its own session ID:** The `SESSION_ALREADY_CLAIMED` error currently asks the agent to retry with its own `openCodeSessionId`. But subagents don't reliably know their own session ID unless we inject it first.

---

## Core Insight

We already receive `session.created.1` SSE events from every OpenCode instance. At that moment we know:

- `sessionId` — the child session's ID
- `parentID` — its parent session's ID (the spawning agent)
- `directory` — the working directory
- `title` — a human-readable label

We know this **before the agent ever connects to MCP**. We have everything needed to own the identity of every session proactively, without relying on the agent to tell us.

The MCP `connectionId` is an internal transport artifact. It has value for:

- Routing IPC events to the right `McpServer` closure
- Keying `activePrompts` in `ipc-prompt.ts`
- The stale-connection guard in `connection-guard.ts`

It has **no value** as a persistent identity that spans reconnects, multiple OpenCode instances, or session hierarchy.

---

## Proposed Architecture

### Primary Key: `openCodeSessionId`

All persistent storage, routing, and renderer state uses `openCodeSessionId` as the canonical identity for a session. The MCP `connectionId` remains an internal transport handle but is never exposed to the agent and never used as a DB primary key.

### New Session Lifecycle

```
OpenCode spawns child session
  │
  ▼ SSE: session.created.1 { sessionId: "ses_child", parentID: "ses_root" }
  │
  ├─ session-tree-manager:
  │    upsertRegisteredConnection({
  │      connectionId:        "ses_child",   ← use sessionId as connectionId directly
  │      openCodeSessionId:   "ses_child",
  │      parentSessionId:     "ses_root",
  │      channelName:         session title,
  │      ...
  │    })
  │
  ├─ injectOpenCodeMessage("ses_child",
  │    "<system-reminder>
  │     Your OpenCode session ID is: ses_child
  │     Use this as openCodeSessionId when calling register_connection.
  │     </system-reminder>")
  │
  └─ scheduleSnapshot() → renderer shows channel immediately

Agent connects to MCP (POST /mcp initialize)
  │
  ├─ connectionId = randomUUID()  [internal transport handle — never leaves server]
  │
  └─ autoRegisterDefaultConnection:
       look up registered_connections WHERE open_code_session_id = detectedSessionId
       if found → the session is already owned by this DB row
       update connectionId in the in-memory sessions map only (no DB change needed)

Agent calls register_connection(openCodeSessionId: "ses_child", channelName: "...")
  │
  └─ upsertRegisteredConnection dedup finds existing row for "ses_child"
     updates channelName, projectName, baseDirectory
     no session-ID race — the row already exists, owned by "ses_child"

Agent calls request_user_input
  │
  └─ tool handler uses connectionId from closure (internal)
     ipc-prompt.ts looks up: getRegisteredConnectionBySessionId("ses_child")
     prompt keyed on openCodeSessionId in activePrompts
     renderer finds channel by openCodeSessionId → shows prompt in correct channel
```

---

## Detailed Changes

### 1. `database.ts` — Schema change

Change `registered_connections` primary key from `connection_id` to `open_code_session_id`:

```sql
registered_connections (
  open_code_session_id TEXT     PRIMARY KEY,   -- ← new PK (was connection_id)
  connection_id        TEXT,                   -- transport handle, nullable, updated at connect time
  agent_name           TEXT     NOT NULL,
  project_name         TEXT     NOT NULL,
  base_directory       TEXT,
  id_file_path         TEXT,
  parent_session_id    TEXT,
  created_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

**New/changed functions:**

| Function                                              | Change                                                                                                    |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `upsertRegisteredConnection`                          | Primary key is now `openCodeSessionId`. `connectionId` is a nullable column updated separately.           |
| `getRegisteredConnection(connectionId)`               | Now looks up by `connection_id` column (secondary lookup).                                                |
| `getRegisteredConnectionBySessionId(sessionId)`       | New — primary lookup by `open_code_session_id`.                                                           |
| `updateConnectionId(openCodeSessionId, connectionId)` | New — called at MCP initialize time to bind the transport handle.                                         |
| `tryClaimOpenCodeSession`                             | Removed — no longer needed. Session identity is established at SSE time, not at register_connection time. |
| `getConnectionClaimingSession`                        | Removed (was already dead code after the atomic fix).                                                     |
| `clearConnectionOpenCodeSession`                      | Removed (was already dead code after the atomic fix).                                                     |

**Schema version:** bump to `3` — triggers automatic wipe-and-recreate on first launch.

---

### 2. `session-tree-manager.ts` — Proactive session registration + injection

`autoRegisterSession(info: SessionInfo)` changes:

```ts
// Before
function autoRegisterSession(info: SessionInfo): void {
  const autoConnectionId = `auto-${info.id}`;
  if (isOpenCodeSessionClaimed(info.id, autoConnectionId)) return;
  upsertRegisteredConnection({ connectionId: autoConnectionId, openCodeSessionId: info.id, ... });
}

// After
function autoRegisterSession(info: SessionInfo): void {
  if (isOpenCodeSessionClaimed(info.id)) return;  // already registered

  upsertRegisteredConnection({
    openCodeSessionId: info.id,     // ← primary key
    connectionId: null,             // ← filled in when agent connects
    channelName: info.title ?? `Session ${info.id.slice(0, 8)}`,
    parentSessionId: info.parentID ?? null,
    ...
  });

  // Inject session ID into agent context so it knows what to pass to register_connection
  if (info.parentID) {
    // Only inject for child sessions — root sessions are handled by mcp-server.ts
    const port = _getOpenCodePort?.() ?? 4096;
    void injectOpenCodeMessage(info.id,
      buildSessionBootstrapMessage(info.id, info.parentID),
      undefined,
      port,
    );
  }
}
```

`startSessionTreeManager` gains an optional `injectMessage` callback or directly imports `injectOpenCodeMessage` (already in the codebase, no new dependency needed — just a new import in the file).

`_pendingConnections` and `tryAutoBindSession` are **removed** — they are superseded by the proactive registration approach. The DB row exists before the agent connects; when the agent connects, `autoRegisterDefaultConnection` finds the existing row and updates `connection_id`.

---

### 3. `mcp-server.ts` — Bind connectionId to existing row at initialize time

`autoRegisterDefaultConnection` changes:

```ts
// Before: detect session → write full new row
// After: detect session → find existing row (written by SSE) → update connectionId column only

const autoRegisterDefaultConnection = async (connectionId, channelName) => {
  const detected = openCodeEnabled ? await autoDetectOpenCodeSession(...) : null;

  if (detected) {
    const existing = getRegisteredConnectionBySessionId(detected.id);
    if (existing) {
      // Row already exists (written by autoRegisterSession on SSE).
      // Just bind this MCP connection's transport UUID to it.
      updateConnectionId(detected.id, connectionId);
      return;
    }
  }

  // Fallback: no SSE row yet (race or non-OpenCode client) — write full row.
  upsertRegisteredConnection({ connectionId, openCodeSessionId: detected?.id, ... });
};
```

`tryClaimOpenCodeSession` call removed — no longer needed.

---

### 4. `ipc-prompt.ts` — Key activePrompts on openCodeSessionId

`activePrompts` map changes from `Map<connectionId, DurablePromptState>` to `Map<openCodeSessionId | connectionId, DurablePromptState>`.

**Lookup order in `promptUser`:**

```ts
// Resolve the stable key for this prompt:
// 1. Try openCodeSessionId from DB (stable across reconnects)
// 2. Fall back to connectionId (for non-OpenCode / standalone clients)
const rc = getRegisteredConnection(connectionId);
const promptKey = rc?.openCodeSessionId ?? connectionId;
```

All internal uses of `connectionId` as the `activePrompts` key are replaced with `promptKey`. The IPC events sent to the renderer carry both `connectionId` and `openCodeSessionId` so the renderer can find the right node.

**Why this matters for multiple OpenCode instances:** Each agent's `openCodeSessionId` is globally unique. Keying on it means a reconnecting agent (new MCP transport UUID, same `openCodeSessionId`) automatically re-attaches to the existing durable prompt state without any special logic.

---

### 5. `tools/register-connection.ts` — Simplified

`register_connection` no longer needs to detect, claim, or race over session IDs:

```ts
// Before:
// 1. autoDetectOpenCodeSession (async)
// 2. upsertRegisteredConnection (pre-register without sessionId)
// 3. tryClaimOpenCodeSession (atomic write)
// 4. Return SESSION_ALREADY_CLAIMED if contested

// After:
// 1. If openCodeSessionId explicitly provided → update row (row already exists from SSE)
// 2. If not provided + baseDirectory → autoDetect → update row if found
// 3. Either way: upsert with provided metadata (channelName, projectName, etc.)
// No claiming, no race, no SESSION_ALREADY_CLAIMED error
```

The `SESSION_ALREADY_CLAIMED` error is removed. The `isConnectionLive` predicate is removed.

---

### 6. `tools/connection-guard.ts` — Key on openCodeSessionId

`markConnectionDeleted` and `staleConnectionError` change from `connectionId` to `openCodeSessionId` as the lookup key. The renderer IPC `remove-session-channel` handler passes `openCodeSessionId` instead of `connectionId`.

---

### 7. `tools/session-channel.ts`, `request-user-input.ts`, etc. — DB lookup change

All tools that call `getRegisteredConnection(connectionId)` add a fallback:

```ts
const rc =
  getRegisteredConnection(connectionId) ??
  getRegisteredConnectionBySessionId(/* from closure if available */);
```

Or, since `connectionId` is now stored as a column in the row, `getRegisteredConnection(connectionId)` can continue to work unchanged — it just does a secondary-index lookup on the `connection_id` column instead of the primary key.

This is the **lowest-risk change** to all tool files — they don't need to change at all if `getRegisteredConnection(connectionId)` correctly looks up by the `connection_id` column.

---

### 8. Renderer (`useConnections`, `useIpcListeners`) — Node keyed on openCodeSessionId

The renderer already uses `openCodeSessionId ?? connectionId` as its `nodeId`. With this refactor, all nodes for OpenCode-backed sessions will have `openCodeSessionId` set from the moment the SSE fires — before any MCP connection exists. The renderer can render the channel immediately.

`connection-opened` and `connection-closed` IPC events continue to carry `connectionId` for transport lifecycle tracking. The renderer maps them to nodes via `openCodeSessionId` lookup.

---

### 9. `startup-context.ts` — Include openCodeSessionId in bootstrap message

`buildStartupContextMessage` gains an `openCodeSessionId` parameter:

```ts
if (openCodeSessionId) {
  lines.push(`- OpenCode session ID: ${openCodeSessionId}`);
  lines.push(
    '- Pass this as openCodeSessionId when calling register_connection.',
  );
}
```

This is the belt-and-suspenders for subagents: even if the SSE injection races with the agent's first turn, the startup context message (injected at register_connection time or via SSE) will contain the session ID.

---

## Migration Path

### Phase 1 — SSE proactive registration (low risk, backward compatible)

- Change `autoRegisterSession` to use `sessionId` as the `connectionId` value (instead of `"auto-{sessionId}"`).
- Add `injectOpenCodeMessage` call on `session.created.1` for child sessions.
- No schema change needed yet — `connection_id` stays as a nullable column alongside the existing PK.

### Phase 2 — Schema change: openCodeSessionId as PK (requires DB wipe)

- Bump `SCHEMA_VERSION` to `3`.
- Add `getRegisteredConnectionBySessionId` to `database.ts`.
- Update `updateConnectionId` function.
- Update `autoRegisterDefaultConnection` in `mcp-server.ts`.
- Update `ipc-prompt.ts` key to `openCodeSessionId ?? connectionId`.

### Phase 3 — Cleanup (remove dead code)

- Remove `tryClaimOpenCodeSession`, `getConnectionClaimingSession`, `clearConnectionOpenCodeSession`.
- Remove `SESSION_ALREADY_CLAIMED` error path from `register-connection.ts`.
- Remove `_pendingConnections` and `tryAutoBindSession` from `session-tree-manager.ts`.
- Remove `isConnectionLive` predicate from `register-connection.ts` and `mcp-server.ts`.

---

## Files Affected

| File                                                 | Change Type                                                                 |
| ---------------------------------------------------- | --------------------------------------------------------------------------- |
| `desktop/src/main/database.ts`                       | Schema change, new/removed functions                                        |
| `desktop/src/main/session-tree-manager.ts`           | `autoRegisterSession` rewrite, injection added, pending-connections removed |
| `desktop/src/main/mcp-server.ts`                     | `autoRegisterDefaultConnection` simplified                                  |
| `desktop/src/main/ipc-prompt.ts`                     | `activePrompts` key changed                                                 |
| `desktop/src/main/tools/register-connection.ts`      | Simplified — no claim/race logic                                            |
| `desktop/src/main/tools/connection-guard.ts`         | Key changed to openCodeSessionId                                            |
| `desktop/src/main/tools/startup-context.ts`          | Add openCodeSessionId to bootstrap message                                  |
| `desktop/src/renderer/src/hooks/useIpcListeners.ts`  | IPC event shape updated                                                     |
| `desktop/src/renderer/src/hooks/useConnections.ts`   | Node creation on SSE (no MCP connect needed)                                |
| `desktop/src/main/database-dedup.test.ts`            | Tests rewritten for new PK                                                  |
| `desktop/src/main/tools/register-connection.test.ts` | Tests simplified                                                            |
| `desktop/src/main/session-tree-manager.test.ts`      | New tests for injection                                                     |

---

## What Does NOT Change

- The MCP HTTP protocol (`POST/GET/DELETE /mcp`) — unchanged.
- The `connectionId` UUID — still generated, still used as an internal transport handle in `sessions` map and tool closures. Just not used as a DB primary key or renderer node identity.
- Tool signatures — no agent-facing parameters change.
- `activePrompts` durable-prompt semantics — still survive transport reconnects; just keyed differently.
- Non-OpenCode clients (standalone CLI, Claude Desktop, etc.) — they have no `openCodeSessionId`; the system falls back to `connectionId` as before.

---

## Open Questions

1. **Multiple OpenCode instances on different ports:** Currently `_getOpenCodePort` is a single value. With multiple instances, we'd need a registry of ports. This refactor does not solve that — it's a separate concern.

2. **Standalone (non-OpenCode) clients:** These have no `openCodeSessionId`. The `connection_id` column as secondary key and the `??` fallback throughout ensures they continue to work unchanged.

3. **Session bootstrap injection timing:** `injectOpenCodeMessage` is fire-and-forget. If the SSE fires and injection succeeds before the agent's first tool call, the agent sees its session ID. If it races (rare), the agent can still call `register_connection` without `openCodeSessionId` — in that case `autoDetectOpenCodeSession` finds the session and the DB row already exists (no race needed, just update the `connection_id` column).
