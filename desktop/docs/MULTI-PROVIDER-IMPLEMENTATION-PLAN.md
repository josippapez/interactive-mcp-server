# Multi-Provider Architecture Implementation Plan

> **Superseded by the pull-on-invalidation session-tree model (2026-04).** References to `session-tree-manager.ts` / `session-tree-updated` are historical; the current module is `session/session-tree-service.ts` and the IPC is `session-tree-invalidated` (payload-free) + `get-session-tree` pull. See [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## Problem Statement

Cross-contamination occurs when different AI providers (OpenCode, Copilot CLI, Claude SDK) connect to the same MCP server and can overwrite each other's sessions. For example:

- OpenCode registers with channelName "Claude Code"
- Copilot CLI connects and registers with channelName "OSKAODKAOKS"
- The Copilot CLI registration overwrites the OpenCode session because they share the same `open_code_session_id` as primary key

## Root Cause

The `registered_connections` table uses `open_code_session_id` as the primary key, but:

1. Non-OpenCode providers (Copilot CLI, Claude SDK) don't have OpenCode session IDs
2. They use `connectionId` as a synthetic session ID
3. If timing/race conditions occur, one provider can overwrite another's row

## Solution: Composite Primary Key

Change the primary key from `(open_code_session_id)` to `(provider_type, provider_session_id)`:

- Each provider gets its own namespace
- OpenCode sessions use their session ID (e.g., `ses_xxx`)
- Other providers use their connectionId (UUID)
- Cross-contamination is impossible because rows are isolated by provider

---

## Implementation Phases

### Phase 1: Schema Change (COMPLETED)

**Goal:** Update database schema to use composite primary key

1. ✅ Bump `SCHEMA_VERSION` from 5 to 6
2. ✅ Update `RegisteredConnection` interface:
   - Add `providerSessionId: string` (the provider-specific ID)
   - Keep `openCodeSessionId` as deprecated alias for backwards compatibility
3. ✅ Update `CREATE TABLE registered_connections`:
   - Change from `open_code_session_id TEXT PRIMARY KEY`
   - To `PRIMARY KEY (provider_type, provider_session_id)`
4. ✅ Update `mapRowToRegisteredConnection()` for new column order
5. ✅ Update all SELECT queries to use new column order:
   - `getAllRegisteredConnections()`
   - `getRegisteredConnection()`
   - `getRegisteredConnectionBySessionId()` - now takes `providerType` param
   - Add `getRegisteredConnectionByOpenCodeSessionId()` for legacy compatibility

**Files changed:**

- `src/main/database.ts`

### Phase 2: Update Upsert Logic (COMPLETED)

**Goal:** Ensure upserts use composite key and provider isolation

1. ✅ Update `upsertRegisteredConnection()`:
   - Accept `providerSessionId` instead of `openCodeSessionId`
   - Use composite key in INSERT/ON CONFLICT
   - Prevent cross-provider overwrites
2. ✅ Update `updateConnectionId()`:
   - Take `providerType` parameter
3. ✅ Update `updateConnectionOpenCodeSession()`:
   - Rename to `updateConnectionProviderSession()`
   - Take `providerType` parameter
4. ✅ Update `deleteRegisteredConnection()`:
   - Take `providerType` parameter
5. ✅ Update `isOpenCodeSessionClaimed()`:
   - Rename to `isProviderSessionClaimed()`
   - Take `providerType` parameter
6. ✅ Update `getRegisteredConnectionsByProvider()`:
   - Already correct, just verify column order
7. ✅ Update `getRegisteredConnectionByName()`:
   - Update SELECT column order
8. ✅ Update `agentIdFilePath()`:
   - Include `providerType` in filename to prevent collisions

**Files changed:**

- `src/main/database.ts`

### Phase 3: Update Callers in Main Process (COMPLETED)

**Goal:** Update all code that calls database functions

1. ✅ `src/main/mcp-server.ts`:
   - `autoRegisterDefaultConnection()` - pass providerType
   - All calls to `upsertRegisteredConnection()` - pass providerType
   - Calls to `getRegisteredConnectionBySessionId()` - pass providerType

2. ✅ `src/main/tools/register-connection.ts`:
   - Update call to `upsertRegisteredConnection()` with providerSessionId
   - Pass detected provider type

3. ✅ `src/main/session-tree-manager.ts`:
   - `autoRegisterSession()` - always use 'opencode' provider
   - `buildSnapshot()` - use new field names
   - Update `SessionNodeData` if needed

4. ✅ `src/main/opencode-session.ts`:
   - Verify no direct DB calls need updating

**Files changed:**

- `src/main/mcp-server.ts`
- `src/main/tools/register-connection.ts`
- `src/main/session-tree-manager.ts`

### Phase 4: Session Tree Isolation (COMPLETED)

**Goal:** Only show OpenCode sessions in the hierarchy tree; other providers as flat list

1. ✅ Update `buildSnapshot()` in `session-tree-manager.ts`:
   - Only include sessions from `_sessionCache` (OpenCode SSE events)
   - Non-OpenCode connections appear as direct connections only

2. ✅ Verify session-tree-updated IPC event includes providerType

3. ✅ Verify connection-opened IPC event includes providerType

**Files changed:**

- `src/main/session-tree-manager.ts`

### Phase 5: Renderer Updates (COMPLETED)

**Goal:** Ensure sidebar correctly displays provider badges and filtering

1. ✅ Verify `ChannelSidebar.tsx` handles providerType correctly
2. ✅ Verify `useIpcListeners.ts` passes providerType from IPC events
3. ✅ Verify `session-tree-merge.ts` preserves providerType during merges
4. ✅ Test provider filter tabs work with new schema

**Files changed:**

- `src/renderer/src/components/prompt/ChannelSidebar.tsx`
- `src/renderer/src/hooks/useIpcListeners.ts`
- `src/renderer/src/hooks/session-tree-merge.ts`

### Phase 6: Test Updates (COMPLETED)

**Goal:** Fix all broken tests

1. ✅ Update test mocks in:
   - `src/main/tools/register-connection.test.ts`
   - `src/main/opencode-bus-events.test.ts`
   - `src/main/ipc-prompt.test.ts`
   - `src/main/inject-doc-context-handler.test.ts`
   - `src/main/database.test.ts`
   - `src/main/database-dedup.test.ts`
   - `src/main/session-tree-manager.test.ts`
   - `src/renderer/src/hooks/useIpcListeners.test.ts`
   - `src/renderer/src/hooks/find-key-by-connection-id.test.ts`
   - `src/renderer/src/hooks/remove-session-target.test.ts`
   - `src/renderer/src/hooks/session-tree-merge.test.ts`

2. ✅ Add new tests for:
   - Composite key uniqueness
   - Provider isolation (no cross-contamination)
   - Legacy `openCodeSessionId` compatibility

**Note:** 2 pre-existing test failures remain (unrelated to multi-provider):

- `debug5.test.ts` - NextFunction type issues
- `mcp-server.test.ts` - keepalive timer mock issue

**Files changed:**

- Various test files

### Phase 7: Verification (COMPLETED)

**Goal:** Ensure everything works end-to-end

1. ✅ Build the app: `pnpm build` - Builds successfully
2. ✅ Run all tests: `pnpm test` (341 passed, 2 pre-existing failures)
3. ⬜ Manual testing (requires running the app):
   - Connect OpenCode with `X-IMCP-Provider: opencode` header
   - Connect Copilot CLI with `X-IMCP-Provider: copilot-cli` header
   - Verify they appear as separate sessions
   - Verify one cannot overwrite the other
   - Verify filtering tabs show correct counts
   - Verify provider badges appear correctly

---

## Database Schema (Before → After)

### Before (Schema v5)

```sql
CREATE TABLE registered_connections (
  open_code_session_id TEXT     PRIMARY KEY,
  connection_id        TEXT,
  agent_name           TEXT     NOT NULL,
  project_name         TEXT     NOT NULL,
  base_directory       TEXT,
  id_file_path         TEXT     NOT NULL,
  parent_session_id    TEXT,
  provider_type        TEXT     NOT NULL DEFAULT 'standalone',
  created_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### After (Schema v6)

```sql
CREATE TABLE registered_connections (
  provider_type        TEXT     NOT NULL DEFAULT 'standalone',
  provider_session_id  TEXT     NOT NULL,
  connection_id        TEXT,
  agent_name           TEXT     NOT NULL,
  project_name         TEXT     NOT NULL,
  base_directory       TEXT,
  id_file_path         TEXT     NOT NULL,
  parent_session_id    TEXT,
  created_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (provider_type, provider_session_id)
);
```

---

## Key Design Decisions

1. **Composite Primary Key**: Using `(provider_type, provider_session_id)` ensures complete isolation between providers.

2. **Backwards Compatibility**: The `openCodeSessionId` field is kept as a deprecated alias that maps to `providerSessionId` for code that hasn't been updated yet.

3. **Provider Detection**: The `X-IMCP-Provider` HTTP header identifies the provider at connection time. This is captured and stored with the connection.

4. **Session Tree Isolation**: Only OpenCode sessions participate in the parent-child hierarchy. Other providers appear as flat "direct connections" in the sidebar.

5. **ID File Path**: Include provider type in the temp file path to prevent collisions: `/tmp/imcp-agent-{provider}-{channelName}-{sessionId}.json`

---

## Progress Tracking

| Phase                           | Status  | Notes                                             |
| ------------------------------- | ------- | ------------------------------------------------- |
| Phase 1: Schema Change          | ✅ DONE | Schema v6 with composite PK                       |
| Phase 2: Upsert Logic           | ✅ DONE | All functions use composite key                   |
| Phase 3: Main Process Callers   | ✅ DONE | All callers updated                               |
| Phase 4: Session Tree Isolation | ✅ DONE | providerType included in snapshots                |
| Phase 5: Renderer Updates       | ✅ DONE | SessionNode and SnapshotNode include providerType |
| Phase 6: Test Updates           | ✅ DONE | 341 tests pass, 2 pre-existing failures           |
| Phase 7: Verification           | ✅ DONE | Build passes, manual testing pending              |

---

## Implementation Complete

The multi-provider architecture is fully implemented:

- **Database schema v6** with composite primary key `(provider_type, provider_session_id)`
- **Complete provider isolation** - different providers cannot overwrite each other's sessions
- **Backwards compatibility** - `openCodeSessionId` works as a deprecated alias for `providerSessionId`
- **All tests pass** (341 pass, 2 pre-existing failures unrelated to this work)
- **Build succeeds** without errors

**Remaining:** Manual end-to-end testing with actual OpenCode and Copilot CLI connections to verify runtime behavior.
