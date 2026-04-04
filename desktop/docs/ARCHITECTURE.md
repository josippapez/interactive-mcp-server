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
│   ├─ [History tab]  HistoryView                                  │
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
3. `syncBridgeConfig()` — ensure `~/.config/opencode/opencode.json` has the correct `interactive-desktop` MCP entry pointing to the bridge script (see [OpenCode Config Sync](#opencode-config-sync)).
4. `registerIpcHandlers()` — install all `ipcMain.handle` and `ipcMain.on` listeners.
5. `startMcpServer()` — bind Express to the configured port (default `3100`).
6. `createWindow()` — create the `BrowserWindow`; hide it immediately if the app was opened at login.
7. `createTray()` — create the system-tray icon.
8. If `autoStartOpenCode` is enabled, `startOpenCodeServer(openCodePort)` — spawn `opencode serve` as a managed child process.
9. Start the session-tree manager poller — polls OpenCode API every 2 seconds for session hierarchy updates.

#### `mcp-server.ts`

Owns the Express app and all HTTP routes. REST API routes have been extracted to `api-routes.ts`. Key responsibilities:

- **Session map** — an in-memory `Record<sessionId, { transport, server, connectionId }>` tracking every live MCP session.
- **Session creation** — when `POST /mcp` arrives with an `initialize` body, a new `McpServer` is created (one per connection), a `StreamableHTTPServerTransport` is instantiated with a random UUID session ID, and all tools are registered via the `register*` helpers.
- **Transparent session resurrection** — when a request arrives with a stale (unknown) `Mcp-Session-Id` header and a non-`initialize` body (e.g. a tool call from a reconnecting agent), the server silently creates a new session, runs the full MCP protocol handshake internally using synthetic request/response objects, patches the `Mcp-Session-Id` response header, and then replays the original request body. The client never receives an error.
- **Soft restart** — `softRestartMcpServer()` clears all in-memory MCP sessions (transports, servers, active prompts) without stopping the HTTP listener. The next client request triggers a fresh initialize handshake or transparent reinit. Accessible via `POST /api/reconnect` and the `reconnect-mcp-server` IPC handler.
- **Session file** — on every new connection, session metadata is written to `/tmp/imcp-session.json`, `<cwd>/.imcp-session`, and `/tmp/imcp-mcp-config.json` (MCP config hint with bridge path). See `session-file.ts`.
- **Session teardown** — `transport.onclose` fires when a transport closes, which cancels any pending prompt (via `cancelActivePrompt`), deletes the session channel from SQLite, removes the session file, and sends `connection-closed` to the renderer.
- **REST API** (`/api/sessions/*`, `/api/reconnect`) — extracted to `api-routes.ts`. A separate set of endpoints that let external processes create, poll, and delete session channels. The `/api/reconnect` endpoint triggers the soft restart.
- **`/health`** — returns active client count and the list of registered tool names.
- **`restartMcpServer()`** — closes the HTTP server and re-creates it with the same parameters; used when the port is changed in Settings.
- **`softRestartMcpServer()`** — clears all sessions without stopping the listener; preferred for in-app reconnect operations.

#### `ipc-prompt.ts`

Implements the `promptUser()` function, which is the bridge between the MCP tool layer and the renderer UI:

1. Brings the window to the foreground (`win.show()`, `win.focus()`).
2. Optionally plays a beep sound (`shell.beep()`), throttled to at most once per 2 seconds.
3. Sends `prompt-request` to the renderer via `webContents.send`, including the prompt text, predefined options, `connectionId`, timeout duration, and optional file-autocomplete `baseDirectory`.
4. Simultaneously appends a `question` row to `session_channel_history` in SQLite.
5. Registers a one-shot `ipcMain.on('prompt-response', handler)` listener that resolves the promise when the renderer sends the matching response ID.
6. Stores a cancel/terminate handle in `activePrompts` (keyed by `connectionId`) so that connection drop or force-terminate can unblock the waiting promise immediately.
7. Resolves with a timeout error string after `promptTimeoutSeconds` if no response arrives.

On resolution, `promptUser` saves the conversation to the `conversations` table and appends an `answer` row to `session_channel_history`.

#### `ipc-handlers.ts`

Registers all `ipcMain.handle` (request/response) and `ipcMain.on` (fire-and-forget) channels that `window.api` calls from the renderer. Key handlers:

| IPC channel                      | Action                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------- |
| `get-history`                    | Query `conversations` table (last 100 rows)                                                 |
| `clear-history`                  | Delete all rows from `conversations`                                                        |
| `get-settings` / `save-settings` | Read/write `settings.json`; restart server if port changed                                  |
| `get-server-status`              | Return `{ running: true, port }`                                                            |
| `search-files`                   | Run `indexFiles` + `rankFileSuggestions` for autocomplete                                   |
| `open-file-dialog`               | Open native Electron file picker                                                            |
| `read-file-for-attachment`       | Read a file from disk; return base64 (images) or UTF-8 text                                 |
| `force-terminate-chat`           | Call `forceTerminateChat(connectionId)` to unblock pending prompt                           |
| `dismiss-session`                | Terminate prompt + send `connection-closed` to renderer                                     |
| `restart-mcp-server`             | Delegate to `restartMcpServer()`                                                            |
| `get-persisted-session-channels` | Return active session rows from SQLite                                                      |
| `get-session-channel-history`    | Return `session_channel_history` for a session                                              |
| `clear-session-channel-messages` | Delete messages; notify renderer                                                            |
| `remove-session-channel`         | Terminate + close session; delete from DB; notify renderer                                  |
| `queue-session-message` (on)     | Persist a user-typed outbound message to `session_messages`                                 |
| `inject-opencode-message`        | POST noReply message to OpenCode ACP `http://localhost:{openCodePort}/session/{id}/message` |

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

registered_connections (
  connection_id        TEXT PRIMARY KEY,
  agent_name           TEXT NOT NULL,
  project_name         TEXT NOT NULL,
  base_directory       TEXT,        -- NULL if not supplied
  open_code_session_id TEXT,        -- auto-detected OpenCode session ID, or NULL
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

| File                     | Tool(s) registered                                                  | Description                                                                                                                                                                                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `register-connection.ts` | `register_connection`                                               | Registers a named agent channel. Upserts `registered_connections` in SQLite, writes a `/tmp` ID file, renames the session channel, auto-detects the active OpenCode session, and triggers doc indexing if enabled. Sends `connection-registered` IPC to the renderer.                                       |
| `request-user-input.ts`  | `request_user_input`                                                | Sends a prompt to the user and waits for the typed response. Supports predefined option chips, file attachments, and `baseDirectory` for autocomplete.                                                                                                                                                      |
| `notification.ts`        | `message_complete_notification`                                     | Fires a native OS notification (Electron `Notification` API). Non-blocking.                                                                                                                                                                                                                                 |
| `intensive-chat.ts`      | `start_intensive_chat`, `ask_intensive_chat`, `stop_intensive_chat` | A three-tool lifecycle for persistent multi-question sessions. `start_intensive_chat` generates a UUID session ID and sends `intensive-chat-start` to the renderer. `ask_intensive_chat` routes through `promptUser` like a normal prompt. `stop_intensive_chat` cleans up and sends `intensive-chat-stop`. |
| `session-channel.ts`     | `push_session_status`, `send_message`                               | `push_session_status`: sends a non-blocking status badge update to the renderer via `webContents.send('session-status-update', ...)`. `send_message`: persists an `agent_message` row to `session_channel_history` and fires `agent-message` IPC to the renderer for live display. Both return immediately. |
| `find-repo-docs.ts`      | `find_repo_docs`                                                    | Searches repository documentation using hybrid keyword + semantic search. Returns ranked file paths, scores, and snippet previews. Only available when the agent registered with a `baseDirectory`. See [`TOOLS.md`](./TOOLS.md#find_repo_docs).                                                            |

---

### 2. Preload (`desktop/src/preload/index.ts`)

The preload script runs in a Node.js context with access to `ipcRenderer`, but it is isolated from the renderer's web context via Electron's context isolation. It uses `contextBridge.exposeInMainWorld('api', api)` to attach a single `window.api` object to the renderer's `window`.

`window.api` exposes two categories of calls:

**Event listeners** (`ipcRenderer.on` wrappers) — the renderer registers callbacks once; the main process fires events at any time:

| Channel                            | Direction       | Purpose                                                                                                                            |
| ---------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `prompt-request`                   | main → renderer | Deliver a new prompt to display                                                                                                    |
| `intensive-chat-start`             | main → renderer | Signal an intensive chat session has started                                                                                       |
| `intensive-chat-stop`              | main → renderer | Signal an intensive chat session has ended                                                                                         |
| `connection-opened`                | main → renderer | A new MCP session was established                                                                                                  |
| `connection-closed`                | main → renderer | An MCP session was torn down                                                                                                       |
| `session-channel-created`          | main → renderer | A session channel was created via REST API                                                                                         |
| `session-channel-deleted`          | main → renderer | A session channel was deleted                                                                                                      |
| `session-channel-messages-cleared` | main → renderer | Messages for a session were cleared                                                                                                |
| `session-status-update`            | main → renderer | Agent pushed a status badge update                                                                                                 |
| `connection-registered`            | main → renderer | `register_connection` completed; carries `connectionId`, `agentName`, `projectName`, `baseDirectory`, `label`, `openCodeSessionId` |
| `agent-message`                    | main → renderer | `send_message` called; carries `{ connectionId, message }` for live render and persistence                                         |

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
| `reconnectMcpServer`           | `fetch('/api/reconnect')`            | Direct HTTP call (not IPC)                                                     |
| `getPersistedSessionChannels`  | `invoke`                             | Restore sessions on startup                                                    |
| `getSessionChannelHistory`     | `invoke`                             | Load per-session message history                                               |
| `clearSessionChannelMessages`  | `invoke`                             | Clear messages for a session                                                   |
| `removeSessionChannel`         | `invoke`                             | Remove session channel entirely                                                |
| `injectOpenCodeMessage`        | `invoke('inject-opencode-message')`  | POST a noReply context message to OpenCode ACP endpoint                        |
| `onConnectionRegistered`       | `ipcRenderer.on` wrapper             | Listen for `connection-registered` fired after `register_connection` completes |
| `onAgentMessage`               | `ipcRenderer.on` wrapper             | Listen for `agent-message` fired when an agent calls `send_message`            |

---

### 3. Renderer (`desktop/src/renderer/src/`)

A React 19 single-page app bundled by electron-vite. It uses Tailwind CSS v4 with CSS custom properties for theming (`--color-bg`, `--color-text`, `--color-agent`, etc.). There is no client-side router; navigation between the three views is a simple `activeTab` state value in `App.tsx`.

#### `App.tsx`

The root component. Renders a fixed header with three tab buttons (**Prompts**, **History**, **Settings**), the active tab's content, and a `StatusBar` at the bottom. The Prompts tab renders as `display: block` at all times (so React state is not lost when switching tabs); the other two tabs mount only when active.

The `useConnections` hook is instantiated here and provides all connection-related state and handlers to `PromptView`.

#### `useConnections` hook

This is the central state manager for the renderer. It holds a `Map<connectionId, ConnectionState>` where each `ConnectionState` contains:

- `prompt` — the currently pending `PromptData` (or `null`).
- `activeSession` — the active intensive chat session ID and title (or `null`).
- `channelMessages` — the chat history array (`ChannelMessage[]`).
- `sessionChannel` — the session channel reference `{ sessionId, label }` (or `null`).
- `sessionStatuses` — array of live status badge updates from `push_session_status`.
- `hasPendingPrompt` — boolean used to show the badge dot on the Prompts tab.
- `unreadCount` — count of messages in non-active connections.
- `isRestored` — `true` for sessions re-hydrated from SQLite on startup (no live transport).

On mount, the hook:

1. Checks `autoRestoreSessions` from settings. If enabled, calls `getPersistedSessionChannels` and loads history for each, creating `ConnectionState` entries marked `isRestored: true`.
2. Registers all `window.api.on*` listeners (guarded by a `useRef` flag to prevent double-registration in React strict mode).

**Response submission flow:**

- `handleSubmit(answer, attachments)` calls `window.api.sendPromptResponse`, which fires `ipcRenderer.send('prompt-response')`. It also optimistically appends an `answer` message to the local channel history.
- `handleSelectOption(option)` is equivalent for predefined option chips.
- `handleQueueSessionMessage(sessionId, message)` calls `window.api.queueSessionMessage` (which persists to SQLite via `queue-session-message` IPC) and optimistically appends an `outbound` message.

#### Renderer Components

| Component              | Purpose                                                                                                                                |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `PromptView`           | Root of the Prompts tab; composes all sub-components.                                                                                  |
| `ChannelSidebar`       | Lists all active connections with unread badges.                                                                                       |
| `ChatHistoryView`      | Scrollable message history; renders `PromptMessage` per entry.                                                                         |
| `PromptMessage`        | Renders a single Q&A message with optional attachment previews and markdown.                                                           |
| `ChannelComposer`      | Text input with autocomplete dropdown, file attachment button, and submit. Calls `searchFiles` via `window.api` for path autocomplete. |
| `ChannelHeader`        | Shows session name, force-terminate and dismiss buttons.                                                                               |
| `AgentStatusBar`       | Renders `SessionStatus` badges from `push_session_status` calls. (Previously `SessionChannelBar`.)                                     |
| `AttachmentPreview`    | Shows image thumbnail or file-name chip for queued attachments.                                                                        |
| `AutocompleteDropdown` | Dropdown overlay populated by `searchFiles` results.                                                                                   |
| `HistoryView`          | Displays `conversations` table records fetched via `getHistory`.                                                                       |
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
      ├─ win.show() + win.focus()
      ├─ shell.beep()  (if soundEnabled and not rate-limited)
      ├─ webContents.send('prompt-request', promptData)
      ├─ appendSessionChannelMessage({ messageType: 'question', ... })  → SQLite
      ├─ ipcMain.on('prompt-response', handler)  ← registers listener
      └─ activePrompts.set(connectionId, { promptId, cancel, terminate })
         └─ setTimeout(timeoutMs) registered

4. Renderer receives prompt
   └─ ipcRenderer.on('prompt-request') fires in preload
      └─ window.api.onPromptRequest callback in useConnections
         ├─ Updates ConnectionState: { prompt: data, hasPendingPrompt: true }
         ├─ Appends { kind: 'question', text } to channelMessages (optimistic)
         └─ setActiveConnectionId + activates Prompts tab

5. User types answer and submits
   └─ ChannelComposer → handleSubmit(answer, attachments)
      ├─ appendAnswerMessage (optimistic UI update)
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
 ├─ opencode-config-sync.ts (syncBridgeConfig)
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
 │   ├─ session-file.ts  (writeSessionFile, clearSessionFile, writeMcpConfigHint,
 │   │                    resolveBridgePath)
 │   ├─ api-routes.ts    (createApiRouter — extracted REST endpoints)
 │   └─ tools/
 │       ├─ register-connection.ts  (registerConnectionTool)
 │       ├─ request-user-input.ts  (registerRequestUserInput)
 │       ├─ notification.ts        (registerNotificationTool)
 │       ├─ intensive-chat.ts      (registerIntensiveChatTools)
 │       ├─ session-channel.ts     (registerSessionChannelTools, registerSendMessageTool)
 │       └─ find-repo-docs.ts      (registerFindRepoDocsTool)
 ├─ opencode-server.ts   (startOpenCodeServer, stopOpenCodeServer)
 ├─ session-tree-manager.ts (startSessionTreePoller, stopSessionTreePoller)
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
     ├─ HistoryView.tsx  → window.api.getHistory
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

### Prompt supersession

If a new `promptUser` call arrives for the same `connectionId` while a previous prompt is still waiting, the old promise is immediately resolved with an error string (`'Error: Prompt superseded by a newer prompt.'`) and its `ipcMain` listener is removed. This prevents listener accumulation and ensures the renderer always shows only the most recent prompt.

### Session file for external discovery

Writing `{ sessionId, port }` to `/tmp/imcp-session.json` and `<cwd>/.imcp-session` is a low-overhead mechanism for external tooling (e.g. VS Code extensions, shell scripts) to locate the active session without requiring a separate service registry. The files are deleted when the session closes.

### `autoRestoreSessions` flag

When this setting is enabled, the renderer queries `getPersistedSessionChannels` on startup and re-creates `ConnectionState` entries marked `isRestored: true` for every session channel still in SQLite. These show their persisted message history immediately. When a new live MCP connection arrives with a matching name, the restored placeholder is replaced transparently by the live connection.
