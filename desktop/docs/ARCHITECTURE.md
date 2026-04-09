# Interactive MCP Desktop — Architecture

## Overview

Interactive MCP Desktop is an Electron application that acts as a desktop UI for the Interactive MCP Server. It exposes an HTTP endpoint (`POST /mcp`) that speaks the [MCP Streamable HTTP transport](https://modelcontextprotocol.io) protocol, allowing AI agents (MCP clients) to send tool calls that surface as interactive prompts in a native desktop window. The user types a response; the answer is returned to the agent as the tool result. The app also persists all conversation history and session state in an embedded SQLite database, and provides a system tray icon so it can run continuously in the background.

**Tech stack:**

| Layer        | Technology                                                                      |
| ------------ | ------------------------------------------------------------------------------- |
| Build system | electron-vite 5                                                                 |
| Main process | Node.js (Electron 41), Express 5, MCP SDK (`@modelcontextprotocol/sdk`), sql.js |
| Preload      | TypeScript, Electron `contextBridge`                                            |
| Renderer     | React 19, Tailwind CSS v4                                                       |
| Language     | TypeScript throughout                                                           |

---

## Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                        AI Agent (MCP client)                     │
│         e.g. Claude, Cursor, OpenCode, custom CLI agent          │
└──────────────────────┬───────────────────────────────────────────┘
                       │ HTTP  POST/GET/DELETE /mcp
                       │ (MCP Streamable HTTP transport)
┌──────────────────────▼───────────────────────────────────────────┐
│                    MAIN PROCESS  (Node.js)                       │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │  Express 5 HTTP server  (default port 3100)             │     │
│  │                                                         │     │
│  │  POST /mcp  ──► StreamableHTTPServerTransport           │     │
│  │  GET  /mcp  ──► SSE stream (server-initiated messages)  │     │
│  │  DELETE /mcp ──► session teardown                       │     │
│  │                                                         │     │
│  │  POST /api/sessions          REST session-channel API   │     │
│  │  GET  /api/sessions/:id/messages                        │     │
│  │  GET  /api/sessions/:id/messages/count                  │     │
│  │  DELETE /api/sessions/:id                               │     │
│  │  GET  /health                                           │     │
│  └────────────────────────┬────────────────────────────────┘     │
│                           │ one McpServer per connection          │
│  ┌────────────────────────▼────────────────────────────────┐     │
│  │  McpServer + tools (per-connection)                     │     │
│  │   • register_connection                                 │     │
│  │   • request_user_input                                  │     │
│  │   • message_complete_notification                       │     │
│  │   • start_intensive_chat / ask_intensive_chat           │     │
│  │     stop_intensive_chat                                 │     │
│  │   • push_session_status                                 │     │
│  │   • send_message                                        │     │
│  │   • find_repo_docs                                      │     │
│  │   • manage_skills_and_instructions                      │     │
│  └──────────────┬──────────────────────────────────────────┘     │
│                 │ promptUser()                                    │
│  ┌──────────────▼──────────────────────────────────────────┐     │
│  │  ipc-prompt.ts                                          │     │
│  │   webContents.send('prompt-request', data)  ──────────►│──┐  │
│  │   ipcMain.on('prompt-response', handler)    ◄──────────│  │  │
│  └─────────────────────────────────────────────────────────┘  │  │
│                                                                │  │
│  ┌─────────────────────────────────────────────────────────┐  │  │
│  │  database.ts  (sql.js / SQLite)                         │  │  │
│  │   conversations | session_channels                      │  │  │
│  │   session_messages | session_channel_history            │  │  │
│  └─────────────────────────────────────────────────────────┘  │  │
│                                                                │  │
│  ┌─────────────────────────────────────────────────────────┐  │  │
│  │  ipc-handlers.ts  (ipcMain.handle / ipcMain.on)         │  │  │
│  └─────────────────────────────────────────────────────────┘  │  │
│                                                                │  │
│  window.ts ──► BrowserWindow          tray.ts ──► Tray         │  │
│  settings.ts ──► AppSettings JSON     file-indexer.ts          │  │
└────────────────────────────────────────────────────────────────┼──┘
                                                                 │
               ┌─────────────────────────────────────────────────┘
               │  contextBridge  (window.api)
┌──────────────▼──────────────────────────────────────────────────┐
│                    PRELOAD  (preload/index.ts)                   │
│  Exposes window.api — a typed bridge of ipcRenderer.invoke /    │
│  ipcRenderer.send / ipcRenderer.on calls.                       │
│  No Node.js APIs leak into the renderer.                        │
└──────────────┬──────────────────────────────────────────────────┘
               │  window.api.*
┌──────────────▼──────────────────────────────────────────────────┐
│                    RENDERER  (React 19)                          │
│                                                                  │
│  App.tsx                                                         │
│   ├─ [Prompts tab]  PromptView                                   │
│   │    ├─ ChannelSidebar  (connection list)                      │
│   │    ├─ ChatHistoryView (Q&A messages)                         │
│   │    ├─ ChannelComposer (text input + file attachments)        │
│   │    ├─ ChannelHeader   (session controls)                     │
│   │    └─ AgentStatusBar  (status badges)                        │
│   └─ [Settings tab] SettingsView                                 │
│                                                                  │
│  useConnections hook — owns all connection state (Map)           │
└──────────────────────────────────────────────────────────────────┘
```

---

## Layer Details

### 1. Main Process (`desktop/src/main/`)

The main process is the application's Node.js runtime. It bootstraps in `index.ts`, which runs the following sequence on `app.whenReady`:

1. `initDatabase()` — open or create `conversations.db` in Electron's `userData` directory.
2. `loadSettings()` — read `settings.json` from `userData`; fall back to defaults if absent.
3. `registerMcpWithOpenCode()` — dynamically register the desktop app as a remote MCP server with OpenCode via `POST /mcp` (primary method). See [TOOLS.md — OpenCode Registration](./TOOLS.md#opencode-registration).
4. If `autoSyncOpencode` is enabled, `syncRemoteConfig()` — ensure `~/.config/opencode/opencode.json` has a `type: "remote"` MCP entry for `interactive-desktop` (fallback method).
5. `registerIpcHandlers()` — install all `ipcMain.handle` and `ipcMain.on` listeners.
6. `startMcpServer()` — bind Express to the configured port (default `3100`).
7. `createWindow()` — create the `BrowserWindow`; hide it immediately if the app was opened at login.
8. `createTray()` — create the system-tray icon.
9. If `autoStartOpenCode` is enabled, `startOpenCodeServer(openCodePort)` — spawn `opencode serve` as a managed child process. The process is always spawned with `cwd` set to `process.env.HOME ?? process.env.USERPROFILE ?? '/'` so it does not inherit `/` when the Electron app is launched from the macOS Dock or as a login item (which would otherwise trigger a filesystem-root scan and a flood of permission-denied errors).
10. Start the session-tree manager poller — polls OpenCode API every 2 seconds for session hierarchy updates.
11. Reconcile persisted `registered_connections` against live OpenCode sessions and clean stale registrations before the first steady-state snapshot.

#### `mcp-server.ts`

Owns the Express app and all HTTP routes. REST API routes have been extracted to `api-routes.ts`. Key responsibilities:

- **Session map** — an in-memory `Record<sessionId, { transport, server, connectionId, connectionName }>` tracking every live MCP session.
- **Session creation** — when `POST /mcp` arrives with an `initialize` body, a new `McpServer` is created (one per connection), a `StreamableHTTPServerTransport` is instantiated with a random UUID session ID, and all tools are registered via the `register*` helpers.
- **Default channel bootstrap** — new connections are auto-registered into `registered_connections`, auto-bound to an OpenCode session when detectable, and given a stable session channel label before the first user-facing activity. The `baseDirectory` for the auto-registration is derived from `process.cwd()` but guarded: if `process.cwd()` returns `/` or an empty string (which happens when the app is launched from the macOS Dock or as a login item), it falls back to `process.env.HOME ?? process.env.USERPROFILE` to prevent the doc indexer from traversing the entire filesystem.
- **Transparent session resurrection** — when a request arrives with a stale (unknown) `Mcp-Session-Id` header and a non-`initialize` body (e.g. a tool call from a reconnecting agent), the server silently creates a new session, runs the full MCP protocol handshake internally using synthetic request/response objects, patches the `Mcp-Session-Id` response header, and then replays the original request body. The client never receives an error.
- **Soft restart** — `softRestartMcpServer()` clears all in-memory MCP sessions (transports, servers, active prompts) without stopping the HTTP listener. The next client request triggers a fresh initialize handshake or transparent reinit. Accessible via `POST /api/reconnect` and the `reconnect-mcp-server` IPC handler.
- **Session file** — on every new connection, session metadata is written to `/tmp/imcp-session.json`, `<cwd>/.imcp-session`, and `/tmp/imcp-mcp-config.json` (MCP config hint with remote HTTP entry). See `session-file.ts`.
- **Session teardown** — `transport.onclose` fires when a transport closes, which cancels any pending prompt (via `cancelActivePrompt`), deletes the session channel from SQLite, removes the session file, and sends both `connection-closed` and `session-channel-deleted` to the renderer.
- **Attachment serving** — image attachments are persisted under `<userData>/attachments` and exposed locally via `GET /attachments/:filename`.
- **REST API** (`/api/sessions/*`, `/api/reconnect`) — extracted to `api-routes.ts`. A separate set of endpoints that let external processes create, poll, and delete session channels. The `/api/reconnect` endpoint triggers the soft restart.
- **`/health`** — returns active client count and the list of registered tool names.
- **`restartMcpServer()`** — closes the HTTP server and re-creates it with the same parameters; used when the port is changed in Settings.
- **`softRestartMcpServer()`** — clears all sessions without stopping the listener; preferred for in-app reconnect operations.

#### `ipc-prompt.ts`

Implements the `promptUser()` function using a **durable prompt** design that survives HTTP transport drops.

Each call creates (or re-attaches to) a `DurablePromptState` stored in main-process memory, keyed by `connectionId`. The durable state holds the prompt data, a long-lived Promise/resolve pair, the `ipcMain` handler, expiry timer, diagnostic interval, and a `sendPromptClear()` closure.

**Lifecycle:**

1. If the MCP `AbortSignal` is already fired _before_ the prompt enters the queue (pre-queue abort), `promptUser` resolves immediately with an abort error and returns — no UI prompt is shown.
2. Once active, `AbortSignal` fires are **completely ignored**. The durable promise keeps waiting regardless of TCP drops or transport reconnects.
3. Brings the window to the foreground (`win.show()`, `win.focus()`).
4. Optionally plays a beep sound (`shell.beep()`), throttled to at most once per 2 seconds.
5. Sends `prompt-request` to the renderer via `webContents.send`, including the prompt text, predefined options, `connectionId`, timeout duration, and optional file-autocomplete `baseDirectory`.
6. Simultaneously appends a `question` row to `session_channel_history` in SQLite.
7. Registers a persistent `ipcMain.on('prompt-response', handler)` listener that resolves the durable promise when the renderer sends the matching response ID.
8. Starts a per-prompt expiry timer (configured via `promptTimeoutSeconds`); the timer is **not** cancelled when the transport drops.

**Transport reconnect (retry attach):** When the MCP transport drops mid-wait and the agent retries the same tool call, a new `promptUser()` call arrives. If a live `DurablePromptState` already exists for that `connectionId`, `promptUser` attaches the new outer resolver to the existing durable promise via `.then()` — no second UI prompt is spawned. The user's eventual reply is forwarded to whichever `promptUser` invocation is currently awaiting.

**Settlement:** All cleanup (clear timers, remove IPC listener, delete from `activePrompts`, call `resolve()`) runs through the internal `_settlePrompt()` helper. `cancelActivePrompt()` calls `state.sendPromptClear()` before settling so the renderer always receives a `prompt-clear` event. `forceTerminateChat()` also goes through `_settlePrompt()`.

On resolution, `promptUser` saves the conversation to the `conversations` table and appends an `answer` row to `session_channel_history`.

Public exports: `promptUser`, `cancelActivePrompt`, `forceTerminateChat`, `getActivePromptData`, `setSoundEnabled`, `setPromptTimeout`, `getPromptTimeoutSeconds`.

#### `ipc-handlers.ts`

Registers all `ipcMain.handle` (request/response) and `ipcMain.on` (fire-and-forget) channels that `window.api` calls from the renderer. Key handlers:

| IPC channel                      | Action                                                                                                                       |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `get-history`                    | Query `conversations` table (last 100 rows)                                                                                  |
| `clear-history`                  | Delete all rows from `conversations`                                                                                         |
| `get-settings` / `save-settings` | Read/write `settings.json`; restart server if port changed                                                                   |
| `get-server-status`              | Return `{ running: true, port }`                                                                                             |
| `search-files`                   | Run `indexFiles` + `rankFileSuggestions` for autocomplete                                                                    |
| `open-file-dialog`               | Open native Electron file picker                                                                                             |
| `read-file-for-attachment`       | Read a file from disk; return base64 (images) or UTF-8 text                                                                  |
| `force-terminate-chat`           | Call `forceTerminateChat(connectionId)` to unblock pending prompt                                                            |
| `dismiss-session`                | Terminate prompt + send `connection-closed` to renderer                                                                      |
| `restart-mcp-server`             | Delegate to `restartMcpServer()`                                                                                             |
| `get-persisted-session-channels` | Return active session rows from SQLite                                                                                       |
| `get-session-channel-history`    | Return `session_channel_history` for a session                                                                               |
| `clear-session-channel-messages` | Delete messages; notify renderer                                                                                             |
| `remove-session-channel`         | Terminate + close session; delete channel + registration; mark stale-connection guard; refresh session tree; notify renderer |
| `queue-session-message` (on)     | Persist a user-typed outbound message to `session_messages`                                                                  |
| `inject-opencode-message`        | POST noReply message to OpenCode ACP `http://localhost:{openCodePort}/session/{id}/message`                                  |
| `sync-opencode-config`           | Re-register with OpenCode and update fallback config file                                                                    |
| `upsert-skill-or-instruction`    | Upsert a skill/instruction row in `skills_and_instructions`; fires `skills-updated` to renderer on success                   |
| `list-skills-and-instructions`   | Return all rows from `skills_and_instructions`, optionally filtered by type                                                  |
| `get-skill-or-instruction`       | Return a single row from `skills_and_instructions` by `name`                                                                 |
| `delete-skill-or-instruction`    | Delete a row from `skills_and_instructions` by `name`; fires `skills-updated` to renderer if a row was deleted               |
| `export-skills-markdown`         | Show a native save dialog; write all skills/instructions as a formatted Markdown file; return `{ saved, filePath? }`         |

#### `database.ts`

Uses `sql.js` (a WebAssembly SQLite build) running entirely in the main process. The database file is persisted to `<userData>/conversations.db` by serializing the in-memory `Uint8Array` to disk after every write (`persist()`).

**Schema:**

```sql
conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prompt_message TEXT NOT NULL,
  project_name  TEXT NOT NULL,
  user_response TEXT NOT NULL,
  predefined_options TEXT,          -- JSON array or NULL
  attachments        TEXT,          -- JSON array of {data,mimeType,name,size} or NULL
  created_at TEXT DEFAULT (datetime('now'))
)

session_channels (
  session_id TEXT PRIMARY KEY,
  label      TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)

session_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  message    TEXT NOT NULL,
  sent       INTEGER DEFAULT 0,     -- 0 = unsent, 1 = consumed by polling client
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)

session_channel_history (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id   TEXT NOT NULL,
  message_type TEXT NOT NULL,       -- 'question' | 'answer' | 'outbound'
  message_text TEXT NOT NULL,
  attachments  TEXT,                -- JSON array or NULL
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
)

skills_and_instructions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL UNIQUE,
  type        TEXT    NOT NULL,     -- 'skill' | 'instruction'
  description TEXT    NOT NULL,
  content     TEXT    NOT NULL,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
)

registered_connections (
  connection_id        TEXT PRIMARY KEY,
  agent_name           TEXT NOT NULL,
  project_name         TEXT NOT NULL,
  base_directory       TEXT,        -- NULL if not supplied
  open_code_session_id TEXT,        -- auto-detected OpenCode session ID, or NULL
  parent_session_id    TEXT,        -- parent OpenCode session ID, or NULL
  created_at           DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

#### `settings.ts`

Persists `AppSettings` as a JSON file at `<userData>/settings.json`. Defaults:

| Setting                | Default |
| ---------------------- | ------- |
| `port`                 | `3100`  |
| `soundEnabled`         | `true`  |
| `launchAtLogin`        | `false` |
| `promptTimeoutSeconds` | `800`   |
| `autoRestoreSessions`  | `false` |
| `openCodePort`         | `4096`  |
| `docIndexingEnabled`   | `true`  |
| `noReplyInjection`     | `true`  |
| `autoStartOpenCode`    | `false` |
| `autoSyncOpencode`     | `false` |

#### `file-indexer.ts`

Provides file-path autocomplete for the `baseDirectory` parameter. `indexFiles(baseDirectory)` recursively walks the directory tree, skipping common non-source directories (`.git`, `node_modules`, `dist`, `.next`, etc.) and capping at 50,000 files. Results are cached per-directory for 30 seconds. `rankFileSuggestions(files, query, limit)` scores matches using a combination of substring matching (with path-segment boundary bonuses) and fuzzy character matching.

#### `window.ts`

Creates the single `BrowserWindow` with:

- Size: 900×700 (minimum 600×500).
- `titleBarStyle: 'hiddenInset'` — native macOS hidden-inset title bar with traffic-light controls at position (15, 15).
- `autoHideMenuBar: true` — hides the Windows/Linux menu bar.
- Close event intercepted: if `isQuitting` is false, the window is hidden rather than destroyed (hide-to-tray behaviour).

#### `tray.ts`

Creates a system tray icon using a 16×16 chat-bubble PNG encoded as a data URL. On macOS the image is marked as a template image for automatic dark/light mode adaptation. The context menu has two items: **Show Window** and **Quit**. Clicking the tray icon directly also shows the window.

#### `tools/` — MCP Tool Registrations

Each file exports one `register*` function called during `createMcpServerWithTools`. Tools are registered on the per-connection `McpServer` instance.

| File                                | Tool(s) registered                                                  | Description                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `register-connection.ts`            | `register_connection`                                               | Registers a named agent channel. Upserts `registered_connections` in SQLite, writes a `/tmp` ID file, renames the session channel, auto-detects the active OpenCode session, and triggers doc indexing if enabled. Sends `connection-registered` IPC to the renderer.                                                                                                       |
| `request-user-input.ts`             | `request_user_input`                                                | Sends a prompt to the user and waits for the typed response. Supports predefined option chips, file attachments, and `baseDirectory` for autocomplete.                                                                                                                                                                                                                      |
| `notification.ts`                   | `message_complete_notification`                                     | Fires a native OS notification (Electron `Notification` API). Non-blocking.                                                                                                                                                                                                                                                                                                 |
| `intensive-chat.ts`                 | `start_intensive_chat`, `ask_intensive_chat`, `stop_intensive_chat` | A three-tool lifecycle for persistent multi-question sessions. `start_intensive_chat` generates a UUID session ID and sends `intensive-chat-start` to the renderer. `ask_intensive_chat` routes through `promptUser` like a normal prompt. `stop_intensive_chat` cleans up and sends `intensive-chat-stop`.                                                                 |
| `session-channel.ts`                | `push_session_status`, `send_message`                               | `push_session_status`: sends a non-blocking status badge update to the renderer via `webContents.send('session-status-update', ...)`. `send_message`: persists an `agent_message` row to `session_channel_history` and fires `agent-message` IPC to the renderer for live display. Both return immediately.                                                                 |
| `find-repo-docs.ts`                 | `find_repo_docs`                                                    | Searches repository documentation using hybrid keyword + semantic search. Returns ranked file paths, scores, and snippet previews. Only available when the agent registered with a `baseDirectory`. See [`TOOLS.md`](./TOOLS.md#find_repo_docs).                                                                                                                            |
| `manage-skills-and-instructions.ts` | `manage_skills_and_instructions`                                    | Register, list, retrieve, or delete persistent skills and instructions stored in the `skills_and_instructions` SQLite table. All entries are automatically injected into new agent sessions at `register_connection` time. Fires `skills-updated` IPC to the renderer after successful `register` or `delete`. See [`TOOLS.md`](./TOOLS.md#manage_skills_and_instructions). |

---

### 2. Preload (`desktop/src/preload/index.ts`)

The preload script runs in a Node.js context with access to `ipcRenderer`, but it is isolated from the renderer's web context via Electron's context isolation. It uses `contextBridge.exposeInMainWorld('api', api)` to attach a single `window.api` object to the renderer's `window`.

`window.api` exposes two categories of calls:

**Event listeners** (`ipcRenderer.on` wrappers) — the renderer registers callbacks once; the main process fires events at any time:

| Channel                            | Direction       | Purpose                                                                                                                              |
| ---------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `prompt-request`                   | main → renderer | Deliver a new prompt to display                                                                                                      |
| `intensive-chat-start`             | main → renderer | Signal an intensive chat session has started                                                                                         |
| `intensive-chat-stop`              | main → renderer | Signal an intensive chat session has ended                                                                                           |
| `connection-opened`                | main → renderer | A new MCP session was established                                                                                                    |
| `connection-closed`                | main → renderer | An MCP session was torn down                                                                                                         |
| `session-channel-created`          | main → renderer | A session channel was created via REST API                                                                                           |
| `session-channel-deleted`          | main → renderer | A session channel was deleted                                                                                                        |
| `session-channel-messages-cleared` | main → renderer | Messages for a session were cleared                                                                                                  |
| `session-status-update`            | main → renderer | Agent pushed a status badge update                                                                                                   |
| `connection-registered`            | main → renderer | `register_connection` completed; carries `connectionId`, `channelName`, `projectName`, `baseDirectory`, `label`, `openCodeSessionId` |
| `agent-message`                    | main → renderer | `send_message` called; carries `{ connectionId, message }` for live render and persistence                                           |
| `skills-updated`                   | main → renderer | A skill/instruction was created, updated, or deleted (by the MCP tool or renderer IPC). Renderer should re-fetch the list.           |

**IPC invocations and sends** (`ipcRenderer.invoke` / `ipcRenderer.send` wrappers) — the renderer initiates these calls:

| Method                         | IPC mechanism                        | Purpose                                                                        |
| ------------------------------ | ------------------------------------ | ------------------------------------------------------------------------------ |
| `sendPromptResponse`           | `send('prompt-response')`            | Deliver the user's typed answer back to `promptUser()`                         |
| `queueSessionMessage`          | `send('queue-session-message')`      | Persist an outbound message for the agent                                      |
| `getHistory`                   | `invoke('get-history')`              | Fetch conversation history                                                     |
| `clearHistory`                 | `invoke('clear-history')`            | Delete all history                                                             |
| `getSettings` / `saveSettings` | `invoke`                             | Read/write settings                                                            |
| `getServerStatus`              | `invoke('get-server-status')`        | Check if server is running and on which port                                   |
| `searchFiles`                  | `invoke('search-files')`             | File autocomplete query                                                        |
| `openFileDialog`               | `invoke('open-file-dialog')`         | Open native file picker                                                        |
| `readFileForAttachment`        | `invoke('read-file-for-attachment')` | Read file contents for attachment                                              |
| `forceTerminateChat`           | `invoke('force-terminate-chat')`     | Terminate a connection's pending prompt                                        |
| `dismissSession`               | `invoke('dismiss-session')`          | Terminate + remove a session from the UI                                       |
| `restartMcpServer`             | `invoke('restart-mcp-server')`       | Restart the HTTP server                                                        |
| `reconnectMcpServer`           | `invoke('reconnect-mcp-server')`     | Soft-restart via IPC                                                           |
| `getPersistedSessionChannels`  | `invoke`                             | Restore sessions on startup                                                    |
| `getSessionChannelHistory`     | `invoke`                             | Load per-session message history                                               |
| `clearSessionChannelMessages`  | `invoke`                             | Clear messages for a session                                                   |
| `removeSessionChannel`         | `invoke`                             | Remove session channel entirely                                                |
| `injectOpenCodeMessage`        | `invoke('inject-opencode-message')`  | POST a noReply context message to OpenCode ACP endpoint                        |
| `onConnectionRegistered`       | `ipcRenderer.on` wrapper             | Listen for `connection-registered` fired after `register_connection` completes |
| `onAgentMessage`               | `ipcRenderer.on` wrapper             | Listen for `agent-message` fired when an agent calls `send_message`            |

---

### 3. Renderer (`desktop/src/renderer/src/`)

A React 19 single-page app bundled by electron-vite. It uses Tailwind CSS v4 with CSS custom properties for theming (`--color-bg`, `--color-text`, `--color-agent`, etc.). There is no client-side router; navigation between the two views is a simple `activeTab` state value in `App.tsx`.

#### `App.tsx`

The root component. Renders a fixed header with two tab buttons (**Prompts**, **Settings**), the active tab's content, and a `StatusBar` at the bottom. The Prompts tab renders as `display: block` at all times (so React state is not lost when switching tabs); the Settings tab mounts only when active.

The `useConnections` hook is instantiated here and provides all connection-related state and handlers to `PromptView`.

#### `useConnections` hook

This is the central state manager for the renderer. It holds a `Map<nodeId, SessionNode>` where `nodeId` is `openCodeSessionId ?? connectionId`.

- `openCodeSessionId` / `openCodeParentId` — OpenCode tree identity.
- `connectionId` — persisted MCP/session-channel identity.
- `prompt` / `activeSession` / `channelMessages` / `sessionStatuses` — runtime UI state.
- `sessionChannel` — persisted session-channel reference `{ sessionId, label }`.
- `hasPendingPrompt` / `unreadCount` — sidebar badge state.

On mount, the hook:

1. Registers all `window.api.on*` listeners (guarded by a `useRef` flag to prevent double-registration in React strict mode).
2. Reconciles topology from `session-tree-updated` full snapshots, absorbing direct connections into OpenCode-keyed nodes when they claim the same `connectionId`.
3. Loads history once per `connectionId` for any node that owns a persisted session channel.

**Response submission flow:**

- `handleSubmit(answer, attachments)` calls `window.api.sendPromptResponse`, which fires `ipcRenderer.send('prompt-response')`. It also optimistically appends an `answer` message to the local channel history. Before sending the prompt response, it fires a fire-and-forget `window.api.injectDocContext?.(connectionId, openCodeSessionId, answer, baseDirectory)` call (using `resolveInjectionSessionId` for correct parent-session routing) so that relevant repository documentation is injected as a `<system-reminder>` into the agent's context window ahead of the reply.
- `handleSelectOption(option)` is equivalent for predefined option chips, and likewise calls `window.api.injectDocContext?.(...)` before sending the prompt response.
- `handleQueueSessionMessage(sessionId, message)` calls `window.api.queueSessionMessage` (which persists to SQLite via `queue-session-message` IPC) and optimistically appends an `outbound` message.

#### Renderer Components

| Component              | Purpose                                                                                                                                |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `PromptView`           | Root of the Prompts tab; composes all sub-components.                                                                                  |
| `ChannelSidebar`       | Lists OpenCode-backed session nodes and direct MCP connections with unread badges.                                                     |
| `ChatHistoryView`      | Scrollable message history; renders `PromptMessage` per entry.                                                                         |
| `PromptMessage`        | Renders a single Q&A message with optional attachment previews and markdown.                                                           |
| `ChannelComposer`      | Text input with autocomplete dropdown, file attachment button, and submit. Calls `searchFiles` via `window.api` for path autocomplete. |
| `ChannelHeader`        | Shows session name, force-terminate and dismiss buttons.                                                                               |
| `AgentStatusBar`       | Renders `SessionStatus` badges from `push_session_status` calls. (Previously `SessionChannelBar`.)                                     |
| `AttachmentPreview`    | Shows image thumbnail or file-name chip for queued attachments.                                                                        |
| `AutocompleteDropdown` | Dropdown overlay populated by `searchFiles` results.                                                                                   |
| `SettingsView`         | Form for all `AppSettings` fields; calls `saveSettings` on change.                                                                     |
| `MarkdownContent`      | Renders markdown-formatted prompt text.                                                                                                |
| `StatusBar`            | Bottom bar showing connection count and optional client model/mode info.                                                               |
| `ShortcutHelpModal`    | Modal listing all keyboard shortcuts (⌘1/2/3 tab switching).                                                                           |

---

## Data Flow Walkthrough

The following traces the full lifecycle of a single `request_user_input` tool call.

```
1. Agent calls tool
   └─ HTTP POST /mcp  {method: "tools/call", params: {name: "request_user_input", ...}}
      Headers: Mcp-Session-Id: <uuid>

2. Express routes to existing session
   └─ sessions[sessionId].transport.handleRequest(req, res, body)
      └─ McpServer dispatches to request_user_input handler (tools/request-user-input.ts)

3. Tool handler calls promptUser()
   └─ ipc-prompt.ts:promptUser(win, { id, message, projectName, connectionId, ... })
      ├─ Pre-queue abort check: if signal already fired, resolve immediately and return
      ├─ Durable-state check: if a live DurablePromptState already exists for this
      │  connectionId (e.g. transport reconnect / agent retry), attach the new outer
      │  resolver to the existing durable promise and return — no new UI prompt shown
      ├─ win.show() + win.focus()
      ├─ shell.beep()  (if soundEnabled and not rate-limited)
      ├─ Creates DurablePromptState { promise, resolve, ipcHandler, timer,
      │  diagInterval, sendPromptClear } stored in activePrompts keyed by connectionId
      ├─ ipcMain.on('prompt-response', ipcHandler)  ← persistent listener
      ├─ webContents.send('prompt-request', promptData)
      ├─ appendSessionChannelMessage({ messageType: 'question', ... })  → SQLite
      └─ setTimeout(timeoutMs) registered on durableState.timer
         NOTE: timer is NOT cancelled when the MCP AbortSignal fires.
         The prompt remains alive across transport drops and reconnects.

4. Renderer receives prompt
   └─ ipcRenderer.on('prompt-request') fires in preload
      └─ window.api.onPromptRequest callback in useConnections
         ├─ Finds the owning `SessionNode` by `connectionId`
         ├─ Updates that node: { prompt: data, hasPendingPrompt: true }
         ├─ Appends { kind: 'question', text } to channelMessages (optimistic)
         └─ setActiveConnectionId + activates Prompts tab

5. User types answer and submits
   └─ ChannelComposer → handleSubmit(answer, attachments)
      ├─ appendAnswerMessage (optimistic UI update)
      ├─ window.api.injectDocContext?.(connectionId, openCodeSessionId, answer, baseDirectory)
      │     fire-and-forget: injects <system-reminder> doc context into OpenCode session
      └─ window.api.sendPromptResponse({ id, answer, attachments })
         └─ ipcRenderer.send('prompt-response', { id, answer, attachments })

6. Main process handler resolves
   └─ ipcMain.on('prompt-response', handler) fires
      ├─ Matches response.id === promptData.id
      ├─ saveConversation(...)        → SQLite conversations table
      ├─ appendSessionChannelMessage({ messageType: 'answer', ... }) → SQLite
      └─ promise resolves with { answer, attachments }

7. Tool returns result to agent
   └─ request_user_input returns { content: [{ type: 'text', text: 'User replied: ...' }] }
      └─ HTTP response sent back to the MCP client
```

---

## Module Dependency Map

```
index.ts
 ├─ database.ts          (initDatabase)
 ├─ settings.ts          (loadSettings)
 ├─ opencode-config-sync.ts (syncRemoteConfig)
 ├─ opencode-mcp-register.ts (registerMcpWithOpenCode)
 ├─ ipc-handlers.ts      (registerIpcHandlers)
 │   ├─ database.ts
 │   ├─ settings.ts
 │   ├─ mcp-server.ts    (startMcpServer, stopMcpServer, restartMcpServer,
 │   │                    softRestartMcpServer, closeSessionByConnectionId)
 │   ├─ file-indexer.ts  (indexFiles, rankFileSuggestions)
 │   └─ ipc-prompt.ts    (forceTerminateChat)
 ├─ mcp-server.ts        (startMcpServer)
 │   ├─ ipc-prompt.ts    (promptUser, setSoundEnabled, setPromptTimeout,
 │   │                    cancelActivePrompt)
 │   ├─ database.ts      (createSessionChannel, getUnsentMessages,
 │   │                    getUnsentCount, markMessagesSent, deleteSessionChannel)
 │   ├─ session-file.ts  (writeSessionFile, clearSessionFile, writeMcpConfigHint)
 │   ├─ api-routes.ts    (createApiRouter — extracted REST endpoints)
 │   └─ tools/
 │       ├─ register-connection.ts  (registerConnectionTool)
 │       ├─ request-user-input.ts  (registerRequestUserInput)
 │       ├─ notification.ts        (registerNotificationTool)
 │       ├─ intensive-chat.ts      (registerIntensiveChatTools)
│       ├─ session-channel.ts     (registerSessionChannelTools, registerSendMessageTool)
│       ├─ find-repo-docs.ts      (registerFindRepoDocsTool)
│       └─ manage-skills-and-instructions.ts (registerManageSkillsAndInstructionsTool)
 ├─ opencode-server.ts   (startOpenCodeServer, stopOpenCodeServer)
  ├─ session-tree-manager.ts (startSessionTreeManager, stopSessionTreeManager)
  ├─ session-reconnect.ts   (startup reconciliation for persisted registrations)
 ├─ doc-indexer.ts        (warmUp, findDocs, searchDocs — worker-thread semantic indexer)
 ├─ doc-context-injector.ts (initDocContext — doc discovery + manifest injection)
 ├─ window.ts            (createWindow)
 └─ tray.ts              (createTray)
 ├─ window.ts            (createWindow)
 └─ tray.ts              (createTray)

ipc-prompt.ts
 ├─ database.ts          (saveConversation, appendSessionChannelMessage)
 └─ electron             (ipcMain, shell)

preload/index.ts
 └─ electron             (contextBridge, ipcRenderer)

renderer/src/App.tsx
 ├─ hooks/useConnections.ts
 │   ├─ hooks/useIpcListeners.ts   (extracted IPC event handler registration)
 │   ├─ hooks/useChannelHistory.ts (extracted channel history loading)
 │   ├─ hooks/useOpenCodeInjection.ts (extracted OpenCode message injection)
 │   └─ window.api       (all event listeners and invoke calls)
 ├─ hooks/useGlobalShortcuts.ts
 └─ pages/
     ├─ PromptView.tsx   → prompt/ChannelSidebar, ChatHistoryView,
     │                     ChannelComposer, ChannelHeader, AgentStatusBar
     └─ SettingsView.tsx → window.api.getSettings / saveSettings
```

---

## Key Design Decisions

### One `McpServer` instance per connection

Each incoming MCP session creates its own `McpServer` instance and `StreamableHTTPServerTransport`. This means tool registrations, in-memory intensive-chat session maps, and connection-scoped state are fully isolated between concurrent agents. There is no shared mutable state between sessions.

### Hide-to-tray on close

`BrowserWindow.on('close')` is intercepted: if the app is not in the process of quitting (triggered only by Cmd+Q or the tray Quit menu item), the event is cancelled and the window is hidden instead. This keeps the Express/MCP server running continuously without the user having to manually restart it. On non-macOS platforms the app quits normally when all windows are closed.

### Transparent session resurrection

When an MCP client reconnects after a server restart with a stale session ID, the server synthesises a full MCP protocol handshake internally (using no-op response objects to discard the synthetic `initialize` response), then replays the client's original tool-call request body through the newly created transport. The client sees only a `Mcp-Session-Id` header change and a successful tool result, with no error.

### sql.js instead of native SQLite

`sql.js` is a WebAssembly port of SQLite that requires no native compilation step. This keeps the build portable across platforms and Electron versions. The tradeoff is that the entire database is held in memory and serialized to disk (`Buffer.from(db.export())`) after every write. For the expected data volumes (conversation history) this is acceptable.

### Schema migration via try/catch

Existing databases that predate the `attachments` column are migrated at startup by attempting a `SELECT attachments FROM conversations LIMIT 0` and running `ALTER TABLE` if it throws. This avoids a versioned migration system for a single-column addition.

### Beep throttle

`shell.beep()` is rate-limited to at most once every 2 seconds (`BEEP_COOLDOWN_MS = 2000`). Without this, agents that call `request_user_input` in rapid succession (e.g. inside a tight tool loop) would produce a flood of notification sounds.

### Durable prompt state (transport-resilient prompts)

`promptUser()` backs each active prompt with a `DurablePromptState` held in main-process memory, independent of any HTTP connection. When the MCP transport's `AbortSignal` fires (TCP drop / agent-side timeout), the durable promise is **not** resolved — it keeps waiting. When the agent retries the tool call (via transparent session resurrection), the new `promptUser()` call detects the existing live state and attaches its outer resolver to the same durable promise. The user's reply is forwarded to the retry without spawning a second UI prompt.

This breaks the coupling between "HTTP connection alive" and "prompt active" that previously caused `-32000 Connection closed` errors during long user-think times.

### Prompt FIFO queue

If a new `promptUser` call arrives for the same `connectionId` while a previous prompt is still waiting, the new prompt is placed in a per-connection FIFO queue and displayed only after the active prompt settles. If the connection drops before a queued prompt ever becomes active, `cancelActivePrompt` drains the queue and resolves each entry with a cancellation error string, preventing listener accumulation.

### Session file for external discovery

Writing `{ sessionId, port }` to `/tmp/imcp-session.json` and `<cwd>/.imcp-session` is a low-overhead mechanism for external tooling (e.g. VS Code extensions, shell scripts) to locate the active session without requiring a separate service registry. The files are deleted when the session closes.

### Startup reconciliation over restore placeholders

The app no longer relies on a standalone restored-tab model. Instead, startup reconciliation removes stale `registered_connections`, then the session-tree manager emits full snapshots that the renderer merges into `SessionNode`s keyed by `openCodeSessionId ?? connectionId`. Persisted message history is then loaded by `connectionId` and preserved across later topology refreshes.
