# @opencode-ai/sdk v2 — Quick Reference

**TL;DR**: SDK v2 exposes 40+ namespaces with 150+ methods covering sessions, messages, files, permissions, MCP, auth, and real-time SSE events. **Desktop-specific features (IPC, window management, SQLite persistence) must remain custom.**

---

## 40 Namespaces at a Glance

| Namespace          | Methods | Purpose                                                                                                                                                  |
| ------------------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Session2**       | 18      | Session lifecycle (create, list, get, delete, prompt, command, shell, revert, fork, share, abort)                                                        |
| **Part**           | 2       | Message part operations (delete, update)                                                                                                                 |
| **File**           | 3       | File operations (list, read, status)                                                                                                                     |
| **Find**           | 3       | Search (files, text, symbols)                                                                                                                            |
| **Permission**     | 3       | Permission handling (list, reply, respond)                                                                                                               |
| **Auth**           | 2       | Auth credentials (set, remove)                                                                                                                           |
| **Auth2**          | 4       | OAuth flow (start, callback, authenticate, remove)                                                                                                       |
| **Config**         | 2       | Global config (get, update)                                                                                                                              |
| **Config2**        | 3       | Project config (get, update, providers)                                                                                                                  |
| **Provider**       | 3       | Model providers (list, auth, oauth)                                                                                                                      |
| **Project**        | 3       | Project info (current, list, initGit)                                                                                                                    |
| **Path**           | 1       | Path resolution (get)                                                                                                                                    |
| **VCS**            | 2       | Version control (get, diff)                                                                                                                              |
| **Mcp**            | 5       | MCP servers (status, connect, disconnect, add, auth)                                                                                                     |
| **Tool**           | 2       | Tool enumeration (list, ids)                                                                                                                             |
| **Tui**            | 11      | Terminal UI (publish, appendPrompt, clearPrompt, submitPrompt, showToast, executeCommand, selectSession, openSessions, openModels, openThemes, openHelp) |
| **Question**       | 3       | Prompts (list, reply, reject)                                                                                                                            |
| **Workspace**      | 5       | Workspaces (list, create, status, remove, warp)                                                                                                          |
| **Worktree**       | 4       | Git worktrees (list, create, remove, reset)                                                                                                              |
| **Pty**            | 8       | Pseudo-terminals (list, create, get, update, remove, shells, connect, connectToken)                                                                      |
| **Sync**           | 4       | Session sync (start, history, replay, steal)                                                                                                             |
| **Lsp**            | 1       | LSP status (status)                                                                                                                                      |
| **Formatter**      | 1       | Formatter status (status)                                                                                                                                |
| **App**            | 3       | App info (log, agents, skills)                                                                                                                           |
| **Command**        | 1       | Commands (list)                                                                                                                                          |
| **Event**          | 1       | Event subscription (subscribe)                                                                                                                           |
| **Global**         | 5       | Server operations (health, event, dispose, upgrade, config)                                                                                              |
| **Instance**       | 1       | Instance management (dispose)                                                                                                                            |
| **Experimental**   | 4       | Experimental features (console, resource, session, workspace)                                                                                            |
| **Console**        | 3       | Console operations (get, listOrgs, switchOrg)                                                                                                            |
| **Resource**       | 1       | MCP resources (list)                                                                                                                                     |
| **Adapter**        | 1       | Workspace adapters (list)                                                                                                                                |
| **Control**        | 2       | TUI control (next, response)                                                                                                                             |
| **Oauth**          | 2       | OAuth (authorize, callback)                                                                                                                              |
| **History**        | 1       | History (list)                                                                                                                                           |
| **V2**             | 1       | V2 namespace (session)                                                                                                                                   |
| **OpencodeClient** | 24      | Main client (all namespaces)                                                                                                                             |

---

## Top 10 Most-Used Methods

1. **`client.session.list()`** — List all sessions
2. **`client.session.create()`** — Create new session
3. **`client.session.prompt()`** — Send prompt (streams SSE events)
4. **`client.session.command()`** — Send command (streams SSE events)
5. **`client.session.get()`** — Get session details
6. **`client.session.delete()`** — Delete session
7. **`client.session.message()`** — Get message
8. **`client.session.messages()`** — List messages
9. **`client.permission.list()`** — List pending permissions
10. **`client.permission.reply()`** — Grant/deny permission

---

## Event Stream Highlights

**Total SSE topics**: 70+

**Key event families**:

- `session.*` (8 events) — Session lifecycle
- `session.next.*` (24 events) — Streaming during prompt/command
- `message.*` (5 events) — Message changes
- `permission.*` (2 events) — Permission requests
- `question.*` (3 events) — Question prompts
- `tui.*` (4 events) — TUI interactions
- `workspace.*` (3 events) — Workspace changes
- `worktree.*` (2 events) — Worktree changes
- `pty.*` (4 events) — PTY events
- `file.*` (2 events) — File changes
- `lsp.*` (2 events) — LSP diagnostics
- `mcp.*` (2 events) — MCP changes
- `project.*` (1 event) — Project changes
- `vcs.*` (1 event) — VCS changes
- `server.*` (3 events) — Server lifecycle
- `command.*` (1 event) — Command execution
- `todo.*` (1 event) — Todo updates
- `installation.*` (2 events) — Installation updates

---

## Migration Priority Matrix

### 🔴 High Priority (Replace First)

- Session management (list, create, delete, update)
- Message operations (list, delete, revert)
- Prompt/command sending (with SSE streaming)
- Permission handling

### 🟡 Medium Priority (Replace Next)

- File operations (list, read)
- Search (files, text, symbols)
- MCP management (connect, disconnect, add)
- Auth (OAuth, API key)

### 🟢 Low Priority (Replace Last)

- Project info (current, list)
- VCS info (get, diff)
- Workspace management
- Worktree management
- PTY operations

### ⚫ Keep Custom (Don't Replace)

- IPC handlers (window management, tray, notifications)
- Electron auto-update
- SQLite session persistence
- UI state (sidebar, panels, theme)
- Native dialogs

---

## Code Example: Basic Session Flow

```typescript
import { createOpencodeClient } from '@opencode-ai/sdk';

const client = createOpencodeClient({
  baseUrl: 'http://localhost:8080',
  directory: '/path/to/project',
});

// 1. List sessions
const sessions = await client.session.list();

// 2. Create new session
const newSession = await client.session.create({
  title: 'Debug auth flow',
  agent: 'claude',
  model: { id: 'claude-3-5-sonnet', providerID: 'anthropic' },
});

// 3. Send prompt (streams SSE events)
const stream = await client.session.prompt({
  sessionID: newSession.id,
  parts: [{ type: 'text', content: 'Fix the login bug' }],
});

// 4. Listen to streaming events
stream.on('session.next.text_delta', (event) => {
  console.log('Text:', event.data.delta);
});

// 5. Handle permissions
const permissions = await client.permission.list();
for (const perm of permissions) {
  await client.permission.reply({
    permissionID: perm.id,
    allow: true,
  });
}

// 6. Get messages
const messages = await client.session.messages({ sessionID: newSession.id });

// 7. Delete session
await client.session.delete({ sessionID: newSession.id });
```

---

## SDK v2 vs Custom Eden Code

| Feature              | SDK v2  | Custom     | Recommendation     |
| -------------------- | ------- | ---------- | ------------------ |
| Session CRUD         | ✅ Full | ✅ Partial | **Migrate to SDK** |
| Message ops          | ✅ Full | ✅ Partial | **Migrate to SDK** |
| Streaming prompts    | ✅ SSE  | ✅ Custom  | **Migrate to SDK** |
| Permission handling  | ✅ Full | ✅ Custom  | **Migrate to SDK** |
| File operations      | ✅ Full | ✅ Custom  | **Migrate to SDK** |
| Search               | ✅ Full | ✅ Custom  | **Migrate to SDK** |
| MCP management       | ✅ Full | ❌ None    | **Migrate to SDK** |
| Auth (OAuth)         | ✅ Full | ✅ Custom  | **Migrate to SDK** |
| Window management    | ❌ None | ✅ Custom  | **Keep custom**    |
| SQLite persistence   | ❌ None | ✅ Custom  | **Keep custom**    |
| UI state             | ❌ None | ✅ Custom  | **Keep custom**    |
| Native notifications | ❌ None | ✅ Custom  | **Keep custom**    |
| Auto-update          | ❌ None | ✅ Custom  | **Keep custom**    |

---

## Known Limitations

1. **No offline mode** — SDK requires active server connection
2. **No local caching** — All data fetched from server
3. **No session export** — Can't export sessions to file
4. **No custom metadata** — Limited session metadata support
5. **No batch operations** — Must call methods individually
6. **No webhooks** — Only SSE for real-time updates
7. **No rate limiting** — Client must implement own throttling
8. **No request cancellation** — No built-in abort support

---

## Next Steps

1. **Read full spec**: `SDK_v2_CAPABILITY_MAP.md`
2. **Identify custom modules** to replace (session, message, permission, auth, file, search)
3. **Create migration plan** with phases (see full spec)
4. **Start with Phase 1** (session management)
5. **Wire SSE event handlers** for streaming
6. **Keep desktop-specific code** (IPC, persistence, UI state)
