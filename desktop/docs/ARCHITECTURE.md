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
│    OpenCode, Copilot CLI, Claude SDK, custom CLI agent           │
└──────────────────────┬───────────────────────────────────────────┘
                       │ HTTP  POST/GET/DELETE /mcp
                       │ (MCP Streamable HTTP transport)
                       │ Header: X-IMCP-Provider: opencode|copilot-cli|claude-sdk|standalone
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
│  │   • start_intensive_chat / ask_intensive_chat           │     │
│  │     stop_intensive_chat                                 │     │
│  │   • push_session_status                                 │     │
│  │   • send_message                                        │     │
│  │   • find_repo_docs                                      │     │
│  │   • manage_skills_and_instructions                      │     │
│  │   • poll_context_injections                             │     │
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
│  │   skills_and_instructions | registered_connections      │  │  │
│  │   pending_context_injections                            │  │  │
│  └─────────────────────────────────────────────────────────┘  │  │
│                                                                │  │
│  ┌─────────────────────────────────────────────────────────┐  │  │
│  │  session-tree-manager.ts (SSE subscription)             │  │  │
│  │   Subscribes to OpenCode /global/sync-event             │  │  │
│  │   Maintains in-memory session cache                     │  │  │
│  │   Emits session-tree-updated snapshots to renderer      │  │  │
│  └─────────────────────────────────────────────────────────┘  │  │
│                                                                │  │
│  ┌─────────────────────────────────────────────────────────┐  │  │
│  │  ipc-handlers.ts  (ipcMain.handle / ipcMain.on)         │  │  │
│  └─────────────────────────────────────────────────────────┘  │  │
│                                                                │  │
│  window.ts ──► BrowserWindow          tray.ts ──► Tray         │  │
│  settings.ts ──► AppSettings JSON     file-indexer.ts          │  │
│  doc-indexer.ts ──► semantic search   doc-context-injector.ts  │  │
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
│   │    ├─ ChannelSidebar  (session tree with activity sorting)   │
│   │    ├─ ChatHistoryView (Q&A messages)                         │
│   │    ├─ ChannelComposer (text input + file attachments)        │
│   │    ├─ ChannelHeader   (session controls, abort, VCS info)    │
│   │    ├─ AgentStatusBar  (status badges)                        │
│   │    ├─ PermissionPrompt (permission request UI)               │
│   │    └─ TodoList        (agent TODO display)                   │
│   ├─ [Skills tab] SkillsView                                     │
│   │    ├─ Category/tag filtering                                 │
│   │    ├─ Enable/disable toggles                                 │
│   │    └─ Skill/instruction editor                               │
│   └─ [Settings tab] SettingsView                                 │
│                                                                  │
│  QuickSwitcher (⌘K) — global search and navigation               │
│  GlobalSearch — search across sessions, skills, settings         │
│                                                                  │
│  useConnections hook — owns all session state (Map<id, SessionNode>) │
│  useIpcListeners hook — handles all IPC events from main process │
└──────────────────────────────────────────────────────────────────┘
```

---

## Layer Details

### 1. Main Process (`desktop/src/main/`)

The main process is the application's Node.js runtime. It bootstraps in `index.ts`, which runs the following sequence on `app.whenReady`:

1. `initDatabase()` — open or create `conversations.db` in Electron's `userData` directory.
2. `loadSettings()` — read `settings.json` from `userData`; fall back to defaults if absent.
3. `seedBuiltinTemplates()` — insert built-in skill/instruction templates on first launch.
4. `registerIpcHandlers()` — install all `ipcMain.handle` and `ipcMain.on` listeners.
5. `startMcpServer()` — bind Express to the configured port (default `3100`).
6. For OpenCode backend:
   - `syncRemoteConfig()` — ensure `~/.config/opencode/opencode.json` has a `type: "remote"` MCP entry (if `autoSyncOpencode` enabled).
   - `startSessionTreeManager()` — subscribe to OpenCode SSE stream for session hierarchy updates.
   - `startBusEventSubscription()` — subscribe to OpenCode global-event bus (session.status, permission.\*).
   - `reconcileSessionConnections()` — reconcile persisted `registered_connections` against live OpenCode sessions.
   - `registerMcpWithRetry()` — re-register with OpenCode on startup (fire-and-forget with retries).
7. For Claude SDK backend: `detectClaudeSdkRuntime()` — detect Claude SDK runtime availability.
8. `createWindow()` — create the `BrowserWindow`; hide it immediately if the app was opened at login.
9. `createTray()` — create the system-tray icon.
10. If `autoStartOpenCode` is enabled, `startOpenCodeServer(openCodePort)` — spawn `opencode serve` as a managed child process.

#### `mcp-server.ts`

Owns the Express app and all HTTP routes. REST API routes have been extracted to `api-routes.ts`. Key responsibilities:

- **Session map** — an in-memory `Record<sessionId, { transport, server, connectionId, connectionName, providerType }>` tracking every live MCP session.
- **Provider detection** — detects provider type from `X-IMCP-Provider` HTTP header or falls back to global `agentBackend` setting. Supports: `opencode`, `copilot-cli`, `claude-sdk`, `standalone`.
- **Session creation** — when `POST /mcp` arrives with an `initialize` body, a new `McpServer` is created (one per connection), a `StreamableHTTPServerTransport` is instantiated with a random UUID session ID, and all tools are registered via the `register*` helpers.
- **Default channel bootstrap** — new connections are auto-registered into `registered_connections` using composite key `(providerType, providerSessionId)`, auto-bound to an OpenCode session when detectable, and given a stable session channel label.
- **Transparent session resurrection** — when a request arrives with a stale (unknown) `Mcp-Session-Id` header and a non-`initialize` body, the server silently creates a new session, runs the full MCP protocol handshake internally using synthetic request/response objects, patches the `Mcp-Session-Id` response header, and then replays the original request body.
- **Soft restart** — `softRestartMcpServer()` clears all in-memory MCP sessions without stopping the HTTP listener. Accessible via `POST /api/reconnect` and the `reconnect-mcp-server` IPC handler.
- **Session file** — on every new connection, session metadata is written to `/tmp/imcp-session.json`, `<cwd>/.imcp-session`, and `/tmp/imcp-mcp-config.json`.
- **SSE keepalive** — writes keepalive comments every 15 seconds to prevent TCP connection idle timeouts during long prompt waits.

#### `session-tree-manager.ts`

Subscribes to the OpenCode `/global/sync-event` SSE stream and maintains an in-memory cache of all known sessions. Key features:

- **SSE events consumed**: `session.created.1`, `session.updated.1`, `session.deleted.1`
- **Auto-registration**: For any session with no existing DB claim, creates a synthetic `registered_connections` record using the sessionId as the connectionId.
- **Session bootstrap injection**: For child sessions (parentID present), injects the session ID into the agent's OpenCode context via `<system-reminder>` so the agent knows its own `openCodeSessionId` before its first tool call.
- **VCS info extraction**: Extracts git branch name from OpenCode version string and change summary (additions, deletions, files).
- **Snapshot emission**: Emits `session-tree-updated` IPC events with full `SessionNodeData[]` snapshots to the renderer. Debounced to avoid flooding.
- **Tombstoning**: Sessions deleted via the Desktop app are tombstoned and excluded from all future snapshots.

#### `ipc-prompt.ts`

Implements the `promptUser()` function using a **durable prompt** design that survives HTTP transport drops.

Each call creates (or re-attaches to) a `DurablePromptState` stored in main-process memory, keyed by `connectionId`. The durable state holds the prompt data, a long-lived Promise/resolve pair, the `ipcMain` handler, expiry timer, diagnostic interval, and a `sendPromptClear()` closure.

**Lifecycle:**

1. If the MCP `AbortSignal` is already fired _before_ the prompt enters the queue (pre-queue abort), `promptUser` resolves immediately with an abort error and returns — no UI prompt is shown.
2. Once active, `AbortSignal` fires are **completely ignored**. The durable promise keeps waiting regardless of TCP drops or transport reconnects.
3. Brings the window to the foreground (`win.show()`, `win.focus()`).
4. Optionally plays a beep sound (`shell.beep()`), throttled to at most once per 2 seconds.
5. Sends `prompt-request` to the renderer via `webContents.send`, including the prompt text, predefined options, `connectionId`, `openCodeSessionId`, timeout duration, and optional file-autocomplete `baseDirectory`.
6. Simultaneously appends a `question` row to `session_channel_history` in SQLite.
7. Registers a persistent `ipcMain.on('prompt-response', handler)` listener that resolves the durable promise when the renderer sends the matching response ID.
8. Starts a per-prompt expiry timer (configured via `promptTimeoutSeconds`); the timer is **not** cancelled when the transport drops.

**Transport reconnect (retry attach):** When the MCP transport drops mid-wait and the agent retries the same tool call, a new `promptUser()` call arrives. If a live `DurablePromptState` already exists for that `connectionId`, `promptUser` attaches the new outer resolver to the existing durable promise via `.then()` — no second UI prompt is spawned.

#### `database.ts`

Uses `sql.js` (a WebAssembly SQLite build) running entirely in the main process. The database file is persisted to `<userData>/conversations.db` by serializing the in-memory `Uint8Array` to disk after every write (`persist()`).

**Schema (version 9):**

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
  message_type TEXT NOT NULL,       -- 'question' | 'answer' | 'outbound' | 'agent_message'
  message_text TEXT NOT NULL,
  attachments  TEXT,                -- JSON array or NULL
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
)

skills_and_instructions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL UNIQUE,
  type        TEXT    NOT NULL CHECK(type IN ('skill', 'instruction')),
  description TEXT    NOT NULL,
  content     TEXT    NOT NULL,
  category    TEXT,                 -- e.g. 'Code Review', 'Testing', 'Documentation'
  tags        TEXT,                 -- JSON array of strings
  enabled     INTEGER NOT NULL DEFAULT 1,
  is_builtin  INTEGER NOT NULL DEFAULT 0,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
)

registered_connections (
  provider_type        TEXT NOT NULL DEFAULT 'standalone' CHECK(provider_type IN ('opencode', 'copilot-cli', 'claude-sdk', 'standalone')),
  provider_session_id  TEXT NOT NULL,    -- OpenCode session ID or connectionId for other providers
  connection_id        TEXT,              -- MCP transport handle (UUID)
  agent_name           TEXT NOT NULL,
  project_name         TEXT NOT NULL,
  base_directory       TEXT,
  id_file_path         TEXT NOT NULL,
  parent_session_id    TEXT,              -- Parent OpenCode session ID for subagents
  created_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (provider_type, provider_session_id)
)

pending_context_injections (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  connection_id TEXT NOT NULL,
  source        TEXT NOT NULL DEFAULT 'manual',
  replace_key   TEXT,                  -- For deduplication (latest wins)
  payload       TEXT NOT NULL,
  claimed       INTEGER DEFAULT 0,
  delivered     INTEGER DEFAULT 0,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

#### `settings.ts`

Persists `AppSettings` as a JSON file at `<userData>/settings.json`. Key settings:

| Setting                 | Default        | Description                                      |
| ----------------------- | -------------- | ------------------------------------------------ |
| `port`                  | `3100`         | MCP server HTTP port                             |
| `soundEnabled`          | `true`         | Play beep on new prompts                         |
| `launchAtLogin`         | `false`        | Start app at system login                        |
| `promptTimeoutSeconds`  | `800`          | Prompt expiry timeout                            |
| `autoRestoreSessions`   | `false`        | Restore sessions on startup                      |
| `openCodePort`          | `4096`         | OpenCode API port                                |
| `docIndexingEnabled`    | `true`         | Enable semantic doc indexing                     |
| `noReplyInjection`      | `true`         | Enable noReply context injection                 |
| `autoStartOpenCode`     | `false`        | Auto-start OpenCode serve                        |
| `autoSyncOpencode`      | `false`        | Auto-sync MCP config to opencode.json            |
| `autoRegisterSubagents` | `true`         | Auto-register subagent sessions                  |
| `agentBackend`          | `'standalone'` | Default provider: opencode/claude_sdk/standalone |
| `compactMode`           | `false`        | Compact UI mode                                  |

#### `tools/` — MCP Tool Registrations

Each file exports one `register*` function called during `createMcpServerWithTools`. Tools are registered on the per-connection `McpServer` instance.

| File                                | Tool(s) registered                                                  | Description                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `register-connection.ts`            | `register_connection`                                               | Registers a named agent channel. Upserts `registered_connections` in SQLite using composite key `(providerType, providerSessionId)`, writes a `/tmp` ID file, renames the session channel, auto-detects the active OpenCode session, and triggers doc indexing if enabled. Sends `connection-registered` IPC to the renderer. |
| `request-user-input.ts`             | `request_user_input`                                                | Sends a prompt to the user and waits for the typed response. Supports predefined option chips, file attachments, and `baseDirectory` for autocomplete. **Requires `openCodeSessionId` parameter** for correct routing in multi-agent scenarios.                                                                               |
| `intensive-chat.ts`                 | `start_intensive_chat`, `ask_intensive_chat`, `stop_intensive_chat` | A three-tool lifecycle for persistent multi-question sessions. `start_intensive_chat` generates a UUID session ID and sends `intensive-chat-start` to the renderer. `ask_intensive_chat` routes through `promptUser` like a normal prompt. `stop_intensive_chat` cleans up and sends `intensive-chat-stop`.                   |
| `session-channel.ts`                | `push_session_status`, `send_message`                               | `push_session_status`: sends a non-blocking status badge update to the renderer via `webContents.send('session-status-update', ...)`. `send_message`: persists an `agent_message` row to `session_channel_history` and fires `agent-message` IPC to the renderer for live display. Both return immediately.                   |
| `find-repo-docs.ts`                 | `find_repo_docs`                                                    | Searches repository documentation using hybrid keyword + semantic search. Returns ranked file paths, scores, and snippet previews. Only available when the agent registered with a `baseDirectory`.                                                                                                                           |
| `manage-skills-and-instructions.ts` | `manage_skills_and_instructions`                                    | Register, list, retrieve, or delete persistent skills and instructions stored in the `skills_and_instructions` SQLite table. Supports categories, tags, and enable/disable. All enabled entries are automatically injected into new agent sessions at `register_connection` time.                                             |
| `poll-context-injections.ts`        | `poll_context_injections`                                           | Check for pending context messages injected by the desktop app. Returns any queued system notifications (e.g. relevant repo docs, instructions) that the desktop has prepared. Each injection is delivered exactly once and cleared on receipt.                                                                               |

---

### 2. Preload (`desktop/src/preload/index.ts`)

The preload script runs in a Node.js context with access to `ipcRenderer`, but it is isolated from the renderer's web context via Electron's context isolation. It uses `contextBridge.exposeInMainWorld('api', api)` to attach a single `window.api` object to the renderer's `window`.

`window.api` exposes two categories of calls:

**Event listeners** (`ipcRenderer.on` wrappers) — the renderer registers callbacks once; the main process fires events at any time:

| Channel                            | Direction       | Purpose                                                                                                                              |
| ---------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `prompt-request`                   | main → renderer | Deliver a new prompt to display (includes `openCodeSessionId` for routing)                                                           |
| `prompt-clear`                     | main → renderer | Clear prompt UI when prompt times out                                                                                                |
| `intensive-chat-start`             | main → renderer | Signal an intensive chat session has started                                                                                         |
| `intensive-chat-stop`              | main → renderer | Signal an intensive chat session has ended                                                                                           |
| `connection-opened`                | main → renderer | A new MCP session was established (direct connection)                                                                                |
| `connection-closed`                | main → renderer | An MCP session was torn down                                                                                                         |
| `session-tree-updated`             | main → renderer | Full snapshot of OpenCode session tree (from SSE subscription)                                                                       |
| `channel-label-updated`            | main → renderer | Session channel name was updated                                                                                                     |
| `session-channel-deleted`          | main → renderer | A session channel was deleted                                                                                                        |
| `session-channel-messages-cleared` | main → renderer | Messages for a session were cleared                                                                                                  |
| `session-status-update`            | main → renderer | Agent pushed a status badge update                                                                                                   |
| `connection-registered`            | main → renderer | `register_connection` completed; carries `connectionId`, `channelName`, `projectName`, `baseDirectory`, `label`, `openCodeSessionId` |
| `agent-message`                    | main → renderer | `send_message` called; carries `{ connectionId, openCodeSessionId, message }` for live render                                        |
| `skills-updated`                   | main → renderer | A skill/instruction was created, updated, or deleted. Renderer should re-fetch the list.                                             |
| `permission-asked`                 | main → renderer | OpenCode permission request received                                                                                                 |
| `permission-replied`               | main → renderer | OpenCode permission request was answered                                                                                             |
| `database-reset`                   | main → renderer | Database was reset; renderer should clear all state                                                                                  |

---

### 3. Renderer (`desktop/src/renderer/src/`)

A React 19 single-page app bundled by electron-vite. It uses Tailwind CSS v4 with CSS custom properties for theming. There is no client-side router; navigation between the three views is a simple `activeTab` state value in `App.tsx`.

#### `App.tsx`

The root component. Renders:

- Fixed header with three tab buttons (**Prompts**, **Skills**, **Settings**) with keyboard shortcuts (⌘1/2/3)
- The active tab's content (Prompts tab is always mounted for state preservation)
- `StatusBar` at the bottom
- `ShortcutHelpModal` for keyboard shortcuts help
- `QuickSwitcher` (⌘K) for global search and navigation

#### `useConnections` hook

This is the central state manager for the renderer. It holds a `Map<nodeId, SessionNode>` where `nodeId` is `openCodeSessionId ?? connectionId`.

**SessionNode properties:**

- `id` — map key (openCodeSessionId or connectionId)
- `openCodeSessionId` / `openCodeParentId` — OpenCode tree identity
- `connectionId` — MCP transport handle
- `providerType` — provider isolation (`opencode`, `copilot-cli`, `claude-sdk`, `standalone`)
- `title` / `directory` / `depth` — session metadata
- `prompt` / `activeSession` / `channelMessages` / `sessionStatuses` — runtime UI state
- `sessionChannel` — persisted session-channel reference `{ sessionId, label }`
- `hasPendingPrompt` / `unreadCount` / `lastReadMessageId` — sidebar badge state
- `pendingPermissions` — queued permission requests
- `docContextEnabled` — whether doc context injection is enabled
- `vcsInfo` — VCS (git) information for the session
- `isDirectConnection` — true for non-OpenCode MCP connections

On mount, the hook:

1. Registers all `window.api.on*` listeners (guarded by a `useRef` flag to prevent double-registration in React strict mode).
2. Loads persisted channel history for all sessions.
3. Reconciles topology from `session-tree-updated` full snapshots using `mergeSessionTreeSnapshot`.

#### `useIpcListeners` hook

Extracted hook that handles all IPC event registration. Key features:

- **Session tree merging**: Uses `mergeSessionTreeSnapshot` to reconcile OpenCode session tree snapshots with existing renderer state, preserving runtime state (prompts, messages, statuses).
- **Prompt routing**: Routes prompts to the correct node using `findPromptTargetKey` which looks up by `connectionId` or `openCodeSessionId`.
- **Focus management**: Only switches active channel to a new prompt if the current channel doesn't already have a pending prompt (prevents focus hijacking).
- **Descendant cleanup**: When a session is deleted, collects and removes all descendant nodes.

#### Renderer Components

| Component              | Purpose                                                                                                                                |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `PromptView`           | Root of the Prompts tab; composes all sub-components.                                                                                  |
| `ChannelSidebar`       | Lists sessions as a tree with subtree activity sorting. Parents sort by running/unread status in children. Tree-aware filtering.       |
| `ChatHistoryView`      | Scrollable message history; renders `PromptMessage` per entry.                                                                         |
| `PromptMessage`        | Renders a single Q&A message with optional attachment previews and markdown.                                                           |
| `ChannelComposer`      | Text input with autocomplete dropdown, file attachment button, and submit. Calls `searchFiles` via `window.api` for path autocomplete. |
| `ChannelHeader`        | Shows session name, VCS info (branch, changes), force-terminate, abort, and dismiss buttons.                                           |
| `AgentStatusBar`       | Renders `SessionStatus` badges from `push_session_status` calls.                                                                       |
| `PermissionPrompt`     | Displays permission request UI for OpenCode permission.\* events.                                                                      |
| `TodoList`             | Displays agent TODO items from OpenCode todo events.                                                                                   |
| `AttachmentPreview`    | Shows image thumbnail or file-name chip for queued attachments.                                                                        |
| `AutocompleteDropdown` | Dropdown overlay populated by `searchFiles` results.                                                                                   |
| `SkillsView`           | Skills/instructions management with category filtering, tags, enable/disable, and editor.                                              |
| `SettingsView`         | Form for all `AppSettings` fields; calls `saveSettings` on change.                                                                     |
| `QuickSwitcher`        | ⌘K palette for global search across sessions, skills, and actions.                                                                     |
| `GlobalSearch`         | Search component for finding content across the app.                                                                                   |
| `MarkdownContent`      | Renders markdown-formatted prompt text.                                                                                                |
| `StatusBar`            | Bottom bar showing connection count and optional client model/mode info.                                                               |
| `ShortcutHelpModal`    | Modal listing all keyboard shortcuts (⌘1/2/3 tab switching, ⌘K search).                                                                |

---

## Session Identity and Routing

### The `openCodeSessionId` Primary Key

OpenCode uses a **shared MCP client** per server name — all agents (main agent + subagents spawned via Task tool) share the same MCP transport connection and therefore receive the same `connectionId`. This creates a routing challenge: without additional context, all tool calls would route to whichever channel called `register_connection` last.

**Solution:** `openCodeSessionId` is the primary routing key for all tool calls:

| Identifier          | Purpose                               | Where stored                                                                    |
| ------------------- | ------------------------------------- | ------------------------------------------------------------------------------- |
| `connectionId`      | Internal MCP transport handle (UUID)  | In-memory session map                                                           |
| `openCodeSessionId` | OpenCode session identity (`ses_*`)   | `registered_connections` table (as `provider_session_id` for opencode provider) |
| `parentSessionId`   | Parent OpenCode session for subagents | `registered_connections` table                                                  |
| `providerType`      | Provider isolation key                | `registered_connections` table                                                  |
| `providerSessionId` | Provider-specific session ID          | `registered_connections` table (composite PK with `providerType`)               |

**Session identity flow:**

1. When OpenCode spawns a child session, the desktop app receives a `session.created.1` SSE event and proactively registers the session in the DB, keyed by `(providerType='opencode', providerSessionId=sessionId)`.
2. The desktop app injects a `<system-reminder>` into the agent's context containing its `openCodeSessionId` (format: `ses_<alphanumeric>`).
3. The agent calls `register_connection` and passes that `openCodeSessionId`. The DB row already exists — registration just updates the channel name and metadata.
4. All subsequent tool calls (`request_user_input`, `push_session_status`, `send_message`, etc.) include `openCodeSessionId` for correct routing.

**Multi-provider support:** The composite primary key `(providerType, providerSessionId)` ensures connections from different providers (OpenCode, Copilot CLI, Claude SDK, standalone) cannot overwrite each other.

### Session Tree Sorting

The sidebar sorts sessions by **subtree activity**:

- Sessions with running tasks or unread messages in their children sort higher than inactive sessions
- This bubbles up activity visibility even when child sessions are collapsed
- Root sessions sort by their own or any descendant's activity status

### Tree-aware Filtering

When filtering sessions (e.g., by running status or unread messages):

- Parent sessions are shown when any of their children pass the filter
- This ensures navigability to filtered child sessions
- Filter state is preserved across session tree updates

---

## Data Flow Walkthrough

The following traces the full lifecycle of a single `request_user_input` tool call.

```
1. Agent calls tool
   └─ HTTP POST /mcp  {method: "tools/call", params: {name: "request_user_input", arguments: {openCodeSessionId: "ses_xxx", ...}}}
      Headers: Mcp-Session-Id: <uuid>, X-IMCP-Provider: opencode

2. Express routes to existing session
   └─ sessions[sessionId].transport.handleRequest(req, res, body)
      └─ McpServer dispatches to request_user_input handler (tools/request-user-input.ts)

3. Tool handler resolves target session from openCodeSessionId
   └─ Looks up registered_connections by (providerType='opencode', providerSessionId=openCodeSessionId)
   └─ Falls back to connectionId lookup if openCodeSessionId not found

4. Tool handler calls promptUser()
   └─ ipc-prompt.ts:promptUser(win, { id, message, projectName, connectionId, openCodeSessionId, ... })
      ├─ Pre-queue abort check: if signal already fired, resolve immediately and return
      ├─ Durable-state check: if a live DurablePromptState already exists, attach to existing promise
      ├─ win.show() + win.focus()
      ├─ shell.beep()  (if soundEnabled and not rate-limited)
      ├─ Creates DurablePromptState stored in activePrompts keyed by connectionId
      ├─ ipcMain.on('prompt-response', ipcHandler)  ← persistent listener
      ├─ webContents.send('prompt-request', promptData)  — includes openCodeSessionId
      ├─ appendSessionChannelMessage({ messageType: 'question', ... })  → SQLite
      └─ setTimeout(timeoutMs) registered on durableState.timer

5. Renderer receives prompt
   └─ ipcRenderer.on('prompt-request') fires in preload
      └─ window.api.onPromptRequest callback in useIpcListeners
         ├─ Calls findPromptTargetKey(nodes, connectionId, openCodeSessionId)
         │  └─ Returns the map key for the matching SessionNode
         ├─ Updates that node: { prompt: data, hasPendingPrompt: true }
         ├─ Appends { kind: 'question', text } to channelMessages (optimistic)
         └─ setActiveId(nodeId) + activates Prompts tab (if current channel has no prompt)

6. User types answer and submits
   └─ ChannelComposer → handleSubmit(answer, attachments)
      ├─ appendAnswerMessage (optimistic UI update)
      ├─ window.api.injectDocContext?.(connectionId, openCodeSessionId, answer, baseDirectory)
      │     fire-and-forget: injects <system-reminder> doc context into OpenCode session
      └─ window.api.sendPromptResponse({ id, answer, attachments })
         └─ ipcRenderer.send('prompt-response', { id, answer, attachments })

7. Main process handler resolves
   └─ ipcMain.on('prompt-response', handler) fires
      ├─ Matches response.id === promptData.id
      ├─ saveConversation(...)        → SQLite conversations table
      ├─ appendSessionChannelMessage({ messageType: 'answer', ... }) → SQLite
      └─ promise resolves with { answer, attachments }

8. Tool returns result to agent
   └─ request_user_input returns { content: [{ type: 'text', text: 'User replied: ...' }] }
      └─ HTTP response sent back to the MCP client
```

---

## Module Dependency Map

```
index.ts
 ├─ database.ts          (initDatabase, seedBuiltinTemplates)
 ├─ builtin-templates.ts (BUILTIN_TEMPLATES)
 ├─ settings.ts          (loadSettings)
 ├─ opencode-config-sync.ts (syncRemoteConfig)
 ├─ opencode-mcp-register.ts (registerMcpWithRetry)
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
 │   ├─ database.ts      (createSessionChannel, upsertRegisteredConnection,
 │   │                    getRegisteredConnectionBySessionId, updateConnectionId)
 │   ├─ session-file.ts  (writeSessionFile, clearSessionFile, writeMcpConfigHint)
 │   ├─ api-routes.ts    (createApiRouter — extracted REST endpoints)
 │   ├─ session-registration-cleanup.ts (pickUnregisteredConnectionsForCleanup)
 │   ├─ opencode-session.ts (autoDetectOpenCodeSession)
 │   ├─ session-tree-manager.ts (triggerSessionTreeUpdate)
 │   └─ tools/
 │       ├─ register-connection.ts  (registerConnectionTool)
 │       ├─ request-user-input.ts   (registerRequestUserInput)
 │       ├─ intensive-chat.ts       (registerIntensiveChatTools)
 │       ├─ session-channel.ts      (registerSessionChannelTools, registerSendMessageTool)
 │       ├─ find-repo-docs.ts       (registerFindRepoDocsTool)
 │       ├─ manage-skills-and-instructions.ts (registerManageSkillsAndInstructionsTool)
 │       └─ poll-context-injections.ts (registerPollContextInjectionsTool)
 ├─ opencode-server.ts   (startOpenCodeServer, stopOpenCodeServer)
 ├─ session-tree-manager.ts (startSessionTreeManager, stopSessionTreeManager)
 │   ├─ database.ts      (getAllRegisteredConnections, upsertRegisteredConnection, etc.)
 │   ├─ opencode-injector.ts (injectOpenCodeMessage)
 │   └─ opencode-session.ts (fetchAllOpenCodeSessions)
 ├─ opencode-bus-events.ts (startBusEventSubscription, stopBusEventSubscription)
 ├─ session-reconnect.ts (reconcileSessionConnections)
 ├─ claude-sdk-runtime.ts (detectClaudeSdkRuntime)
 ├─ doc-indexer.ts       (warmUp, findDocs, searchDocs — worker-thread semantic indexer)
 ├─ doc-context-injector.ts (initDocContext — doc discovery + manifest injection)
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
 │   │   └─ hooks/session-tree-merge.ts (mergeSessionTreeSnapshot)
 │   ├─ hooks/useChannelHistory.ts (extracted channel history loading)
 │   ├─ hooks/useProviderInjection.ts (provider-specific message injection)
 │   └─ window.api       (all event listeners and invoke calls)
 ├─ hooks/useGlobalShortcuts.ts
 ├─ components/QuickSwitcher.tsx
 └─ pages/
     ├─ PromptView.tsx   → prompt/ChannelSidebar, ChatHistoryView,
     │                     ChannelComposer, ChannelHeader, AgentStatusBar,
     │                     PermissionPrompt, TodoList
     ├─ SkillsView.tsx   → category/tag management, enable/disable, editor
     └─ SettingsView.tsx → window.api.getSettings / saveSettings
```

---

## Key Design Decisions

### One `McpServer` instance per connection

Each incoming MCP session creates its own `McpServer` instance and `StreamableHTTPServerTransport`. This means tool registrations, in-memory intensive-chat session maps, and connection-scoped state are fully isolated between concurrent agents. There is no shared mutable state between sessions.

### `openCodeSessionId` as Primary Routing Key

The `openCodeSessionId` parameter is now required on all tool calls for correct routing in multi-agent scenarios. The database uses a composite primary key `(providerType, providerSessionId)` which provides:

- Provider isolation: different AI providers cannot overwrite each other's connections
- Session identity: stable identity across MCP transport reconnections
- Parent-child relationships: enables session tree visualization and subtree operations

### Hide-to-tray on close

`BrowserWindow.on('close')` is intercepted: if the app is not in the process of quitting (triggered only by Cmd+Q or the tray Quit menu item), the event is cancelled and the window is hidden instead. This keeps the Express/MCP server running continuously without the user having to manually restart it.

### Transparent session resurrection

When an MCP client reconnects after a server restart with a stale session ID, the server synthesises a full MCP protocol handshake internally (using no-op response objects to discard the synthetic `initialize` response), then replays the client's original tool-call request body through the newly created transport. The client sees only a `Mcp-Session-Id` header change and a successful tool result, with no error.

### sql.js instead of native SQLite

`sql.js` is a WebAssembly port of SQLite that requires no native compilation step. This keeps the build portable across platforms and Electron versions. The tradeoff is that the entire database is held in memory and serialized to disk after every write. For the expected data volumes (conversation history) this is acceptable.

### Schema versioning via PRAGMA user_version

The database uses `PRAGMA user_version` to track schema version. On startup, if the stored version doesn't match `SCHEMA_VERSION` (currently 9), all tables are dropped and recreated. This eliminates incremental migration complexity.

### Durable prompt state (transport-resilient prompts)

`promptUser()` backs each active prompt with a `DurablePromptState` held in main-process memory, independent of any HTTP connection. When the MCP transport's `AbortSignal` fires (TCP drop / agent-side timeout), the durable promise is **not** resolved — it keeps waiting. When the agent retries the tool call (via transparent session resurrection), the new `promptUser()` call detects the existing live state and attaches its outer resolver to the same durable promise. The user's reply is forwarded to the retry without spawning a second UI prompt.

### SSE-based session tree synchronization

Instead of polling, the app subscribes to OpenCode's `/global/sync-event` SSE stream for real-time session updates. This provides:

- Immediate visibility of new sessions (including subagents)
- Automatic session injection: child sessions receive `<system-reminder>` with their session ID before first tool call
- VCS info extraction from OpenCode version strings
- Tombstone support for user-deleted sessions

### Session tree sorting by subtree activity

The sidebar sorts sessions by subtree activity (running/unread in children affects parent sort order). This ensures active conversations bubble to the top even when nested in collapsed parent sessions.

### Multi-provider architecture

The app supports multiple AI providers through:

- `X-IMCP-Provider` HTTP header detection at connection time
- Composite primary key `(providerType, providerSessionId)` for connection isolation
- Provider-specific features (e.g., session injection only for OpenCode)
- Fallback to `agentBackend` setting for backwards compatibility

---

## Session ID Priority for Message Routing

In OpenCode's shared MCP client architecture, multiple agent sessions (parent and subagents) share the same `connectionId` (MCP transport UUID) but have unique `openCodeSessionId` values.

When routing messages to the correct channel, the lookup priority is:

1. **`openCodeSessionId`** — The unique identifier for each agent session (format: `ses_<alphanumeric>`)
2. **`connectionId`** — The MCP transport UUID (fallback for legacy/standalone clients)
3. **Direct map key** — Final fallback for direct connections where the map key is the connectionId

This priority ensures that:

- Subagents receive messages intended for them, not the parent
- Messages don't get stuck in "Sending" state due to incorrect node lookup
- The UI correctly displays messages in the originating agent's channel
- Doc context injection targets the correct agent's OpenCode session

### Key Functions

| Function                      | File                      | Purpose                                                                                               |
| ----------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------- |
| `findKeyByConnectionId()`     | `useIpcListeners.ts`      | Primary routing helper — all renderer-side routing uses this function                                 |
| `findPromptTargetKey()`       | `useIpcListeners.ts`      | Prompt routing — thin wrapper around `findKeyByConnectionId`                                          |
| `findNodeBySessionId()`       | `useProviderInjection.ts` | Provider injection routing — ensures injected messages reach the correct agent session                |
| `handleQueueSessionMessage()` | `useConnections.ts`       | User message routing — queues outbound messages to the correct channel (uses `findKeyByConnectionId`) |
| `handleInjectWithReply()`     | `useConnections.ts`       | Reply injection routing — injects messages with response triggers (uses `findKeyByConnectionId`)      |

**Important:** All renderer-side node lookups MUST use `findKeyByConnectionId` to ensure correct routing in multi-agent scenarios. Do not use inline `connectionId`-only lookups.

### Implementation Details

All four functions follow the same lookup priority:

```typescript
// Priority 1: Match by openCodeSessionId (direct map key or node field)
if (openCodeSessionId) {
  if (nodes.has(openCodeSessionId)) return openCodeSessionId;
  for (const [id, node] of nodes) {
    if (node.openCodeSessionId === openCodeSessionId) return id;
  }
}

// Priority 2: Match by connectionId field (fallback)
for (const [id, node] of nodes) {
  if (node.connectionId === connectionId) return id;
}

// Priority 3: Direct map key lookup by connectionId
if (nodes.has(connectionId)) return connectionId;
```

### Why This Matters

In a multi-agent scenario:

1. **Main agent** (ses_abc) spawns **Subagent** (ses_xyz) via the Task tool
2. Both agents share the same MCP transport `connectionId` (UUID)
3. When Subagent sends a message, the renderer receives both `connectionId` and `openCodeSessionId`
4. Without prioritizing `openCodeSessionId`, the message would route to whichever node last registered that `connectionId` — likely the Main agent's channel
5. With correct priority, the message routes to Subagent's channel based on `openCodeSessionId` match

This architectural decision was implemented to fix a bug where subagent messages appeared in parent channels, and user-sent messages to subagents would get stuck in "Sending" state due to incorrect node lookup.

### Known Issue: Prompt Auto-Focus Channel Switching

When a new prompt arrives and the currently active channel doesn't have a pending prompt, the UI automatically switches focus to the prompt's channel (`useIpcListeners.ts`). This can cause confusion when:

1. User is viewing parent channel
2. Child agent sends a prompt
3. Focus auto-switches to child channel
4. User sends a message thinking they're still on the parent channel
5. Message routes to the child channel (which is now active)

**Mitigation**: The code uses the global Jotai-based channel selection store (`store/channel-selection.ts`) which:

- Provides a single source of truth for channel selection across all components
- Tracks selection source (e.g., `'prompt-received'`, `'sidebar-click'`) for debugging
- Enables future improvements like visual indicators or settings to disable auto-focus

## Global State Management

The app uses **Jotai** for global reactive state that needs to be accessed from multiple components without prop drilling.

### Channel Selection Store

Located in `store/channel-selection.ts`, this store manages which channel is currently selected:

| Atom                           | Type             | Purpose                                                |
| ------------------------------ | ---------------- | ------------------------------------------------------ |
| `activeChannelIdAtom`          | `string \| null` | Currently selected channel ID                          |
| `intentionalNullSelectionAtom` | `boolean`        | Whether null selection was user-initiated              |
| `selectChannelAtom`            | write-only       | Action atom for channel selection with source tracking |

**Selection Sources** (`ChannelSelectionSource`):

- `sidebar-click` — User clicked a channel in the sidebar
- `prompt-received` — Auto-focus when a new prompt arrives
- `connection-opened` — New MCP connection was established
- `connection-closed` — MCP connection was closed
- `session-deleted` — Session was removed
- `keyboard-shortcut` — User navigated via keyboard
- `quick-switcher` — User selected via quick switcher (Cmd+K)
- `auto-select-first` — Auto-select first available when current disappears

**Hooks:**

- `useActiveChannelId()` — Read-only access to active channel ID
- `useSelectChannel()` — Write-only function to change selection
- `useChannelSelection()` — Combined read/write access

---

## Logging

The desktop app includes a persistent file-based logging system for debugging and diagnostics.

### Log File Location

Log files are stored in the platform-specific logs directory:

| Platform | Path                                      |
| -------- | ----------------------------------------- |
| macOS    | `~/Library/Logs/interactive-mcp-desktop/` |
| Windows  | `%APPDATA%\interactive-mcp-desktop\logs\` |
| Linux    | `~/.config/interactive-mcp-desktop/logs/` |

The exact path is determined by Electron's `app.getPath('logs')`.

### Log File Format

- **Naming**: `app-YYYY-MM-DD.log` (e.g., `app-2026-04-13.log`)
- **Line format**: `[YYYY-MM-DDTHH:mm:ss.sssZ] [LEVEL] [category] message`
- **Levels**: `DEBUG`, `INFO`, `WARN`, `ERROR`
- **Auto-rotation**: Files older than 7 days are automatically deleted on startup

### Logger Categories

Each subsystem uses a dedicated logger category for easy filtering:

| Category       | Subsystem                                   |
| -------------- | ------------------------------------------- |
| `app`          | Application lifecycle and startup           |
| `mcp`          | MCP server and HTTP transport               |
| `ipc`          | IPC handlers (main ↔ renderer)              |
| `session`      | Session resolution and management           |
| `sse`          | SSE bus events and subscriptions            |
| `session-tree` | Session tree manager (OpenCode integration) |
| `injector`     | Context injection into OpenCode sessions    |

### Usage in Code

```ts
import { createLogger } from './utils/logger';

const log = createLogger('mcp');
log.info('server started on port 3100');
log.error('failed to handle request');
```

### Crash-Safe Writes

The logger uses synchronous `appendFileSync` writes — every log line is flushed to disk immediately, ensuring no log data is lost on unexpected exits or crashes.

---

## Recent Changes

### Reasoning/Thinking Display Support

The app now supports models with extended thinking capabilities (e.g., Claude with thinking, o1/o3 reasoning models):

- **Reasoning content**: Messages can include `reasoning` parts that display the model's thinking process
- **Model detection**: The `reasoning` capability flag is extracted from OpenCode model metadata
- **Variant selection**: For reasoning models, the app infers default effort levels (low/medium/high) based on model type

### Extended Token Tracking

Token usage display now includes additional metrics when available:

| Metric      | Description                               |
| ----------- | ----------------------------------------- |
| `input`     | Input/prompt tokens                       |
| `output`    | Output/completion tokens                  |
| `reasoning` | Tokens used for reasoning/thinking        |
| `total`     | Total tokens (computed if not provided)   |
| `cache`     | Cache read/write tokens (when applicable) |

### UI Improvements

- **Tool call spacing**: Reduced spacing between tool calls for more compact display
- **Auto-scroll**: Edit diffs now auto-scroll to the changed section
- **Timeout errors**: Provider inject timeout errors now show a user-friendly message: "Request timed out — OpenCode may be busy or unresponsive"
- **Error logging**: Timeout errors are logged to the file logger for debugging
