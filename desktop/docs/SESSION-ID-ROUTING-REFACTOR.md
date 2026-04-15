# Multi-Agent Session ID Routing Refactor

## Problem Statement

When multiple agents (main agent + subagents spawned via Task tool) are running concurrently, all messages route to whichever channel called `register_connection` last. This breaks multi-agent workflows where each agent should have its own isolated channel.

### Root Cause

OpenCode uses a **single shared MCP client** per MCP server name across all sessions. The MCP transport `connectionId` is bound at `McpServer.connect()` time and captured in tool closures. Since all agents share the same transport connection, they all get the same `connectionId`.

**Current (broken) flow:**

1. Main agent calls `register_connection` → gets `connectionId: "uuid-A"`
2. Subagent A calls `register_connection` → gets same `connectionId: "uuid-A"` (shared transport)
3. Subagent B calls `register_connection` → gets same `connectionId: "uuid-A"` (shared transport)
4. All three agents' prompts route to whichever channel was registered last

### Evidence

From OpenCode source (`~/Desktop/opencode/packages/opencode/src/mcp/index.ts`):

```typescript
interface State {
  status: Record<string, Status>;
  clients: Record<string, MCPClient>; // ONE client per MCP server name
  defs: Record<string, MCPToolDef[]>;
}
```

The `clients` map is keyed by server name, not session ID. All sessions share the same `MCPClient` instance.

---

## Solution Design

### Core Change

Use `openCodeSessionId` as the primary routing key instead of relying on `connectionId` closures. Each agent must pass its `openCodeSessionId` with every tool call.

### Phase 1: Schema Changes

Add `openCodeSessionId` as a parameter to all routing tools. The parameter is technically optional for backwards compatibility, but tool descriptions strongly instruct agents to pass it.

**Tools to update:**

| Tool                      | File                         | Changes                                                    |
| ------------------------- | ---------------------------- | ---------------------------------------------------------- |
| `register_connection`     | `register-connection.ts`     | Already accepts `openCodeSessionId`, make routing explicit |
| `request_user_input`      | `request-user-input.ts`      | Add `openCodeSessionId` param, use for prompt routing      |
| `push_session_status`     | `session-channel.ts`         | Add `openCodeSessionId` param, use for IPC routing         |
| `send_message`            | `session-channel.ts`         | Add `openCodeSessionId` param, use for channel routing     |
| `start_intensive_chat`    | `intensive-chat.ts`          | Add `openCodeSessionId` param                              |
| `ask_intensive_chat`      | `intensive-chat.ts`          | Add `openCodeSessionId` param                              |
| `stop_intensive_chat`     | `intensive-chat.ts`          | Add `openCodeSessionId` param                              |
| `poll_context_injections` | `poll-context-injections.ts` | Add `openCodeSessionId` param                              |
| `find_repo_docs`          | `find-repo-docs.ts`          | Add `openCodeSessionId` param                              |

### Phase 2: Routing Logic Changes

Update internal routing to prefer `openCodeSessionId` over `connectionId`:

1. **`ipc-prompt.ts`**: Already keys on `openCodeSessionId` when available (good!)
2. **`connection-guard.ts`**: Update `missingSessionIdError` to validate `openCodeSessionId` presence
3. **`database.ts`**: `getRegisteredConnectionBySessionId()` is already the primary lookup

### Phase 3: System-Reminder Re-injection

When an agent calls `register_connection` (reconnect scenario), re-inject the system-reminder with session context. This ensures agents always have their `openCodeSessionId` available.

**Implementation:**

- In `register-connection.ts`, after successful registration, inject a `<system-reminder>` via `injectOpenCodeMessage()` with the session ID and other context
- This mirrors what happens for subagents when they are spawned

### Phase 4: CLI Tool Definitions Sync

Update tool definitions in `src/tool-definitions/` to match the desktop app tools. These are used by the CLI package.

### Phase 5: Documentation Updates

- Update `AGENTS.md` with new requirements
- Update `desktop/docs/TOOLS.md` with parameter changes
- Update `desktop/docs/ARCHITECTURE.md` with routing explanation

---

## Implementation Checklist

### Phase 1: Tool Schema Updates

- [x] `request-user-input.ts` - Add `openCodeSessionId` parameter
- [x] `session-channel.ts` (`push_session_status`) - Add `openCodeSessionId` parameter
- [x] `session-channel.ts` (`send_message`) - Add `openCodeSessionId` parameter
- [x] `intensive-chat.ts` (`start_intensive_chat`) - Add `openCodeSessionId` parameter
- [x] `intensive-chat.ts` (`ask_intensive_chat`) - Add `openCodeSessionId` parameter
- [x] `intensive-chat.ts` (`stop_intensive_chat`) - Add `openCodeSessionId` parameter
- [x] `poll-context-injections.ts` - Add `openCodeSessionId` parameter
- [x] `find-repo-docs.ts` - Add `openCodeSessionId` parameter

### Phase 2: Routing Logic

- [x] Update `request-user-input.ts` to resolve session by `openCodeSessionId` parameter
- [x] Update `session-channel.ts` to resolve session by `openCodeSessionId` parameter
- [x] Update `intensive-chat.ts` to resolve session by `openCodeSessionId` parameter
- [x] Update `poll-context-injections.ts` to resolve session by `openCodeSessionId` parameter
- [x] Update `find-repo-docs.ts` to resolve session by `openCodeSessionId` parameter
- [x] Update `connection-guard.ts` to accept `openCodeSessionId` for validation

### Phase 3: System-Reminder Re-injection

- [x] Add re-injection logic to `register-connection.ts` for reconnect scenarios
- [x] Ensure system-reminder includes `openCodeSessionId`, `channelName`, `baseDirectory`

### Phase 4: CLI Tool Definitions

- [x] Update `src/tool-definitions/request-user-input.ts`
- [x] Update `src/tool-definitions/intensive-chat.ts`
- [x] Add any missing tool definitions

### Phase 5: Documentation

- [x] Update `AGENTS.md` - Add `openCodeSessionId` requirement to all tool calls
- [x] Update `desktop/docs/TOOLS.md` - Document new parameters
- [x] Update `desktop/docs/ARCHITECTURE.md` - Explain session-based routing

### Phase 6: Testing

- [x] Run `npm test -- --run` in `desktop/` - All tests must pass
- [x] Run `npm run check-types` in root
- [x] Manual test with main agent + subagent workflow

---

## Migration Notes

### Breaking Change

Agents must now pass `openCodeSessionId` on every tool call (except `register_connection` where it's optional for auto-detection).

### Backwards Compatibility

- Tools will still work if `openCodeSessionId` is omitted, falling back to `connectionId`-based lookup
- However, multi-agent scenarios will continue to have routing issues without the parameter
- Tool descriptions strongly instruct agents to pass the parameter

### Agent Context Injection

The `openCodeSessionId` is injected into agent context via:

1. **Subagents**: `<system-reminder>` message injected before first tool call (existing behavior)
2. **Main agent**: Startup context injection in `register_connection` response
3. **Reconnect**: Re-injection of system-reminder on `register_connection`

---

## File Change Summary

| File                                                | Type   | Changes                                       |
| --------------------------------------------------- | ------ | --------------------------------------------- |
| `desktop/src/main/tools/request-user-input.ts`      | Modify | Add `openCodeSessionId` param, update routing |
| `desktop/src/main/tools/session-channel.ts`         | Modify | Add `openCodeSessionId` param to both tools   |
| `desktop/src/main/tools/intensive-chat.ts`          | Modify | Add `openCodeSessionId` param to all 3 tools  |
| `desktop/src/main/tools/poll-context-injections.ts` | Modify | Add `openCodeSessionId` param                 |
| `desktop/src/main/tools/find-repo-docs.ts`          | Modify | Add `openCodeSessionId` param                 |
| `desktop/src/main/tools/connection-guard.ts`        | Modify | Accept `openCodeSessionId` for validation     |
| `desktop/src/main/tools/register-connection.ts`     | Modify | Add system-reminder re-injection              |
| `src/tool-definitions/request-user-input.ts`        | Modify | Sync with desktop                             |
| `src/tool-definitions/intensive-chat.ts`            | Modify | Sync with desktop                             |
| `AGENTS.md`                                         | Modify | Document new requirements                     |
| `desktop/docs/TOOLS.md`                             | Modify | Document parameter changes                    |
| `desktop/docs/ARCHITECTURE.md`                      | Modify | Document routing model                        |

---

## Execution Log

### 2024-XX-XX: Initial Analysis

- Confirmed OpenCode uses shared MCP client per server name
- Identified all tools that need modification
- Created this planning document

### 2026-04-11: Implementation Complete

**Phase 1-4 (Tool & Code Changes):**

- Added `openCodeSessionId` parameter to all routing tools
- Updated routing logic to prefer `openCodeSessionId` over `connectionId`
- Implemented system-reminder re-injection on `register_connection`
- Synced CLI tool definitions with desktop app

**Phase 5 (Documentation Updates):**

- Updated `AGENTS.md` with session-ID requirements and tool call examples
- Updated `desktop/docs/ARCHITECTURE.md` with "Session-Based Routing" subsection explaining:
  - OpenCode shared MCP client architecture
  - Composite key design `(providerType, providerSessionId)`
  - Session identity flow from SSE events to tool calls
  - Key identifiers table (`connectionId`, `openCodeSessionId`, `parentSessionId`)
- Updated `desktop/docs/TOOLS.md` with:
  - New "Required Parameters for Multi-Agent Support" section
  - `openCodeSessionId` parameter added to all tool parameter tables

**Phase 6 (Testing):**

- All 185 desktop tests passing
- Type-checking passing in root and desktop packages
- Multi-agent workflow verified with main agent + subagent scenarios

### 2026-04-13: Renderer-Side Routing Fix

**Problem Identified:**

After the main-process routing refactor was complete, a subtle bug remained in the renderer-side state updates. When a user sent a message or when outbound messages were queued, the inline node lookup in `handleQueueSessionMessage` and `handleInjectWithReply` (in `useConnections.ts`) only checked `node.connectionId` — not `node.openCodeSessionId`.

In OpenCode's shared MCP client architecture, parent and child sessions (subagents) share the same `connectionId` but have unique `openCodeSessionId` values. This caused messages to route to the wrong channel (typically the parent's channel) in multi-agent scenarios.

**Root Cause:**

The inline lookup in `useConnections.ts` used a simple iteration:

```typescript
// WRONG: Only checked connectionId
for (const [id, node] of nodes) {
  if (node.connectionId === sessionId) return id;
}
```

This ignored the `openCodeSessionId` parameter, causing incorrect routing when multiple sessions shared the same `connectionId`.

**Fix Applied:**

Changed both `handleQueueSessionMessage` (lines 594-627) and `handleInjectWithReply` (lines 636-690) to use the shared `findKeyByConnectionId` helper from `useIpcListeners.ts`:

```typescript
// CORRECT: Uses priority-based lookup
const key = findKeyByConnectionId(prev, sessionId, sessionId);
```

The `findKeyByConnectionId` helper implements the correct lookup priority:

1. **`openCodeSessionId`** — Match by unique agent session ID (direct map key or node field)
2. **`connectionId`** — Match by MCP transport UUID (fallback)
3. **Direct map key** — Final fallback for direct connections

**Files Changed:**

| File                                       | Lines   | Change                                                       |
| ------------------------------------------ | ------- | ------------------------------------------------------------ |
| `src/renderer/src/hooks/useConnections.ts` | 594-627 | `handleQueueSessionMessage` now uses `findKeyByConnectionId` |
| `src/renderer/src/hooks/useConnections.ts` | 636-690 | `handleInjectWithReply` now uses `findKeyByConnectionId`     |

**Why This Was Missed:**

The main-process routing (tool handlers in `src/main/tools/`) was fixed in the original refactor, but the renderer-side state update logic in `useConnections.ts` had its own inline node lookups that weren't updated to use the shared helper. The helper `findKeyByConnectionId` already existed in `useIpcListeners.ts` and was correctly used for prompt routing, but the message-sending functions in `useConnections.ts` predated the refactor and used their own lookup logic.

**Impact:**

- Subagent messages now correctly appear in the subagent's channel, not the parent's
- User-sent messages to subagents no longer get stuck in "Sending" state
- Doc context injection reaches the correct agent's OpenCode session

---

### Status: COMPLETE

The session-ID routing refactor is fully implemented. Agents must now pass `openCodeSessionId` on every tool call for correct multi-agent routing.
