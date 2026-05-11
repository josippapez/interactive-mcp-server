# SDK v2 → Desktop Custom Code Migration Matrix

**Purpose**: Identify which desktop custom modules can be replaced/wrapped by SDK v2 calls, and which must remain custom.

**Date**: May 2026  
**SDK Version**: v2 (from node_modules/@opencode-ai/sdk)

---

## Migration Priority Tiers

### Tier 1: High-Value Migrations (Direct SDK Replacement)

| Desktop Module                                  | SDK Equivalent                                              | Status   | Notes                                      |
| ----------------------------------------------- | ----------------------------------------------------------- | -------- | ------------------------------------------ |
| `session-manager` (list, create, get, delete)   | `client.session.list()`, `create()`, `get()`, `delete()`    | ✅ Ready | Wrap SDK calls; keep DB for local caching  |
| `session-messages` (fetch, display)             | `client.session.messages()`, `message()`                    | ✅ Ready | Use SDK; sync to SQLite for offline access |
| `session-prompt` (send message)                 | `client.session.prompt()` (SSE) or `promptAsync()`          | ✅ Ready | Stream SSE responses directly to renderer  |
| `config-manager` (read project config)          | `client.config.get()`                                       | ✅ Ready | Wrap SDK; cache locally                    |
| `mcp-registry` (list, add, connect servers)     | `client.mcp.status()`, `add()`, `connect()`, `disconnect()` | ✅ Ready | Replace custom MCP discovery with SDK      |
| `permission-handler` (list, reply, respond)     | `client.permission.list()`, `reply()`, `respond()`          | ✅ Ready | Integrate with IPC permission flow         |
| `file-operations` (list, read)                  | `client.file.list()`, `read()`                              | ✅ Ready | Use SDK for file access                    |
| `search-operations` (find files, text, symbols) | `client.find.files()`, `text()`, `symbols()`                | ✅ Ready | Replace custom search with SDK             |

### Tier 2: Medium-Value Migrations (Wrapper + Custom Logic)

| Desktop Module                              | SDK Equivalent                                    | Status     | Notes                                                |
| ------------------------------------------- | ------------------------------------------------- | ---------- | ---------------------------------------------------- |
| `project-manager` (current, list, init git) | `client.project.current()`, `list()`, `initGit()` | ⚠️ Partial | SDK provides basics; keep custom git logic           |
| `vcs-operations` (diff, status)             | `client.vcs.get()`, `diff()`                      | ⚠️ Partial | SDK provides diff; keep custom git blame/log         |
| `pty-manager` (create, list, connect)       | `client.pty.create()`, `list()`, `connect()`      | ⚠️ Partial | SDK provides PTY lifecycle; keep Electron PTY bridge |
| `question-handler` (list, reply, reject)    | `client.question.list()`, `reply()`, `reject()`   | ⚠️ Partial | SDK handles Q&A; keep TUI integration                |
| `auth-manager` (set, remove credentials)    | `client.auth.set()`, `remove()` or `auth2.*`      | ⚠️ Partial | SDK handles OAuth; keep credential storage           |
| `event-stream` (subscribe to SSE)           | `client.event.subscribe()` or `global.event()`    | ⚠️ Partial | SDK provides SSE; keep Electron event bridge         |

### Tier 3: Low-Value Migrations (Keep Custom)

| Desktop Module                                | SDK Gap                          | Status    | Reason                                    |
| --------------------------------------------- | -------------------------------- | --------- | ----------------------------------------- |
| `ipc-handlers` (main ↔ renderer)              | No IPC namespace                 | ❌ Custom | Electron-specific; no SDK equivalent      |
| `window-manager` (create, focus, close)       | No window namespace              | ❌ Custom | Electron-specific; no SDK equivalent      |
| `sqlite-persistence` (session history, cache) | No persistence namespace         | ❌ Custom | Desktop-specific; SDK is stateless        |
| `settings-store` (user preferences)           | No settings namespace            | ❌ Custom | Desktop-specific; use Electron store      |
| `tray-manager` (system tray)                  | No tray namespace                | ❌ Custom | Electron-specific; no SDK equivalent      |
| `auto-updater` (check, download, install)     | No updater namespace             | ❌ Custom | Electron-specific; use electron-updater   |
| `config-file-preservation` (JSONC comments)   | `config.update()` loses comments | ❌ Custom | SDK limitation; parse/preserve manually   |
| `mode-detection` (CLI vs TUI vs desktop)      | No mode namespace                | ❌ Custom | Use SSE events to detect mode changes     |
| `file-writing` (create, edit files)           | No `file.write()` method         | ❌ Custom | Use `session.shell()` or direct FS access |

---

## Detailed Migration Roadmap

### Phase 1: Session & Config (Weeks 1-2)

**Goal**: Replace session and config management with SDK calls.

**Tasks**:

1. Wrap `client.session.list()`, `create()`, `get()`, `delete()` in desktop session manager
2. Wrap `client.config.get()`, `update()` in desktop config manager
3. Sync session list to SQLite for offline access
4. Update IPC handlers to call SDK wrappers
5. Test session CRUD operations end-to-end

**Files to modify**:

- `desktop/src/main/tools/session-manager.ts` → wrap SDK calls
- `desktop/src/main/ipc/session.ts` → call wrapped SDK
- `desktop/src/renderer/hooks/useSession.ts` → consume IPC

**Validation**:

- ✅ Session list loads from SDK
- ✅ New sessions created via SDK
- ✅ Session deletion works
- ✅ Config updates persist

---

### Phase 2: Messages & Prompts (Weeks 2-3)

**Goal**: Replace message fetching and prompt sending with SDK calls.

**Tasks**:

1. Wrap `client.session.messages()`, `message()` in message manager
2. Wrap `client.session.prompt()` (SSE) for streaming responses
3. Stream SSE responses directly to renderer via IPC
4. Sync messages to SQLite for offline access
5. Test message streaming end-to-end

**Files to modify**:

- `desktop/src/main/tools/message-manager.ts` → wrap SDK calls
- `desktop/src/main/ipc/message.ts` → stream SSE to renderer
- `desktop/src/renderer/hooks/useMessages.ts` → consume streamed messages

**Validation**:

- ✅ Messages load from SDK
- ✅ Prompts stream in real-time
- ✅ Message history persists locally
- ✅ Offline access works

---

### Phase 3: MCP & Permissions (Weeks 3-4)

**Goal**: Replace MCP registry and permission handling with SDK calls.

**Tasks**:

1. Wrap `client.mcp.status()`, `add()`, `connect()`, `disconnect()` in MCP manager
2. Wrap `client.permission.list()`, `reply()`, `respond()` in permission handler
3. Update IPC handlers to call SDK wrappers
4. Test MCP server lifecycle end-to-end
5. Test permission request/response flow

**Files to modify**:

- `desktop/src/main/tools/mcp-registry.ts` → wrap SDK calls
- `desktop/src/main/tools/permission-handler.ts` → wrap SDK calls
- `desktop/src/main/ipc/mcp.ts` → call wrapped SDK
- `desktop/src/main/ipc/permission.ts` → call wrapped SDK

**Validation**:

- ✅ MCP servers list from SDK
- ✅ New MCP servers added via SDK
- ✅ MCP servers connect/disconnect
- ✅ Permissions requested and replied

---

### Phase 4: File & Search (Weeks 4-5)

**Goal**: Replace file and search operations with SDK calls.

**Tasks**:

1. Wrap `client.file.list()`, `read()`, `status()` in file manager
2. Wrap `client.find.files()`, `text()`, `symbols()` in search manager
3. Update IPC handlers to call SDK wrappers
4. Test file operations end-to-end
5. Test search operations end-to-end

**Files to modify**:

- `desktop/src/main/tools/file-manager.ts` → wrap SDK calls
- `desktop/src/main/tools/search-manager.ts` → wrap SDK calls
- `desktop/src/main/ipc/file.ts` → call wrapped SDK
- `desktop/src/main/ipc/search.ts` → call wrapped SDK

**Validation**:

- ✅ Files list from SDK
- ✅ File content reads from SDK
- ✅ Search finds files, text, symbols
- ✅ Search results are accurate

---

### Phase 5: Events & Streaming (Weeks 5-6)

**Goal**: Replace event subscription with SDK SSE stream.

**Tasks**:

1. Wrap `client.event.subscribe()` in event manager
2. Stream SSE events to renderer via IPC
3. Update renderer to consume streamed events
4. Test event streaming end-to-end
5. Validate all event types are received

**Files to modify**:

- `desktop/src/main/tools/event-manager.ts` → wrap SDK calls
- `desktop/src/main/ipc/event.ts` → stream SSE to renderer
- `desktop/src/renderer/hooks/useEvents.ts` → consume streamed events

**Validation**:

- ✅ Events stream in real-time
- ✅ All event types received
- ✅ Renderer updates on events
- ✅ No event loss

---

### Phase 6: Cleanup & Optimization (Weeks 6-7)

**Goal**: Remove redundant custom code and optimize SDK integration.

**Tasks**:

1. Remove custom session/config/MCP discovery code
2. Remove custom message fetching code
3. Remove custom file/search code
4. Consolidate SDK wrappers into unified client
5. Add caching layer for frequently accessed data
6. Run full test suite
7. Performance profiling and optimization

**Files to delete/consolidate**:

- Remove custom session discovery logic
- Remove custom config parsing logic
- Remove custom MCP registry logic
- Remove custom file/search logic

**Validation**:

- ✅ All tests pass
- ✅ No performance regression
- ✅ Code coverage maintained
- ✅ Desktop app starts and runs normally

---

## SDK Integration Patterns

### Pattern 1: Wrapping SDK Calls

```typescript
// desktop/src/main/tools/session-manager.ts
import { createOpencodeClient } from '@opencode-ai/sdk';

const client = createOpencodeClient({
  baseUrl: 'http://localhost:8080',
  directory: process.cwd(),
});

export async function listSessions() {
  const result = await client.session.list();
  // Sync to SQLite
  await db.sessions.insertMany(result.data);
  return result.data;
}

export async function createSession(title: string) {
  const result = await client.session.create({ title });
  // Sync to SQLite
  await db.sessions.insert(result.data);
  return result.data;
}
```

### Pattern 2: Streaming SSE Responses

```typescript
// desktop/src/main/ipc/message.ts
import { ipcMain } from 'electron';

ipcMain.handle('message:prompt', async (event, { sessionID, text }) => {
  const stream = await client.session.prompt({
    sessionID,
    // ... parts
  });

  for await (const chunk of stream) {
    event.sender.send('message:prompt:chunk', chunk);
  }
});
```

### Pattern 3: Caching & Offline Access

```typescript
// desktop/src/main/tools/session-manager.ts
export async function getSession(sessionID: string) {
  // Try cache first
  const cached = await db.sessions.findOne({ id: sessionID });
  if (cached && !isStale(cached)) {
    return cached;
  }

  // Fetch from SDK
  const result = await client.session.get({ sessionID });

  // Update cache
  await db.sessions.upsert({ id: sessionID }, result.data);

  return result.data;
}
```

---

## Risk Assessment

### High Risk

- **SSE streaming**: Ensure stream cleanup on disconnect
- **Config updates**: Preserve JSONC comments manually
- **Permission flow**: Ensure IPC integration doesn't break

### Medium Risk

- **MCP lifecycle**: Ensure connect/disconnect state is consistent
- **Message sync**: Ensure SQLite cache stays in sync with SDK
- **Event ordering**: Ensure events are processed in order

### Low Risk

- **File operations**: Read-only; no state changes
- **Search operations**: Read-only; no state changes
- **Project info**: Read-only; no state changes

---

## Success Criteria

- ✅ All SDK calls wrapped and tested
- ✅ IPC handlers call SDK wrappers
- ✅ SSE streams work end-to-end
- ✅ SQLite cache stays in sync
- ✅ No performance regression
- ✅ All 427 tests pass
- ✅ Desktop app starts and runs normally
- ✅ Session CRUD works
- ✅ Message streaming works
- ✅ MCP server lifecycle works
- ✅ Permission flow works
- ✅ File/search operations work
- ✅ Events stream in real-time
