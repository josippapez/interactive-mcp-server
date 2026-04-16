# IPC API — `window.api` Reference

**Source:** `desktop/src/preload/index.ts`

---

## Overview

The Interactive MCP Desktop app uses Electron's [`contextBridge`](https://www.electronjs.org/docs/latest/api/context-bridge) to expose a controlled API surface to the renderer process. The bridge is configured in the preload script, which runs in an isolated context before the renderer page loads.

### Security model

Electron's `contextBridge.exposeInMainWorld('api', api)` makes the `api` object available as `window.api` in the renderer. The preload script runs with Node.js access (to `ipcRenderer`), but the renderer itself does not — `nodeIntegration` is disabled. This separation means:

- The renderer can only call the explicit methods exposed on `window.api`.
- The renderer cannot access `ipcRenderer` directly.
- Raw Electron/Node APIs are never reachable from renderer code.

All two-way calls (where the renderer expects a response from main) use `ipcRenderer.invoke`, which returns a `Promise`. One-way events fired from the main process use `ipcRenderer.on` listeners registered via the `on*` callback methods. Fire-and-forget messages from the renderer use `ipcRenderer.send`.

---

## Type Definitions

```ts
type PromptRequest = {
  id: string;
  message: string;
  projectName: string;
  predefinedOptions?: string[];
  sessionId?: string;
  connectionId: string;
  connectionName: string;
  timeoutSeconds: number;
  baseDirectory?: string;
};

type Attachment = {
  data: string;
  mimeType: string;
  name: string;
  size: number;
};

type ConversationRecord = {
  id: number;
  promptMessage: string;
  projectName: string;
  userResponse: string;
  predefinedOptions: string | null;
  attachments: string | null;
  createdAt: string;
};

type SessionChannelHistoryRecord = {
  id: number;
  sessionId: string;
  messageType: 'question' | 'answer' | 'outbound' | 'agent_message';
  messageText: string;
  attachments: string | null;
  createdAt: string;
};

type AppSettings = {
  port: number;
  soundEnabled: boolean;
  launchAtLogin: boolean;
  promptTimeoutSeconds: number;
  autoRestoreSessions: boolean;
  openCodePort: number;
  docIndexingEnabled: boolean;
  noReplyInjection: boolean;
  autoStartOpenCode: boolean;
  autoSyncOpencode: boolean;
};

type SkillOrInstructionRecord = {
  id: number;
  name: string;
  type: 'skill' | 'instruction';
  description: string;
  content: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
};
```

---

## Event Listener Pattern

Methods prefixed with `on` register a persistent listener on an IPC channel using `ipcRenderer.on`. These are **not** two-way calls — they do not return a `Promise` and receive no acknowledgment from the renderer back to main.

Because `ipcRenderer.on` does not automatically remove listeners, registering the same `on*` method multiple times will result in multiple invocations of the callback per event. The renderer is responsible for ensuring listeners are registered only once per lifecycle (e.g., once at application mount).

This pattern is used for main-to-renderer push events: connection state changes, prompt delivery, intensive chat lifecycle signals, and session channel notifications. The alternative (`ipcRenderer.invoke`) is used only when the renderer must receive a return value from main.

---

## API Reference

### Prompt Flow

Methods that manage the delivery and acknowledgment of user input prompts.

| Method               | Direction       | Signature                                                                        | Description                                                                                                                                                                                                                         |
| -------------------- | --------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `onPromptRequest`    | main → renderer | `(callback: (data: PromptRequest) => void) => void`                              | Registers a listener for incoming prompt requests. Called once for each `request_user_input` tool invocation from a connected agent. The `id` field must be echoed back in `sendPromptResponse`.                                    |
| `sendPromptResponse` | renderer → main | `(response: { id: string; answer: string; attachments?: Attachment[] }) => void` | Sends the user's answer back to the main process. The `id` must match the `id` from the originating `PromptRequest`. Attachments are optional and include file data encoded as a string. Uses `ipcRenderer.send` (fire-and-forget). |

---

### Intensive Chat Lifecycle

Methods that track the start and stop of multi-turn intensive chat sessions initiated by an agent.

| Method                 | Direction       | Signature                                                                                        | Description                                                                                                                                                              |
| ---------------------- | --------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `onIntensiveChatStart` | main → renderer | `(callback: (data: { sessionId: string; title: string; connectionId: string }) => void) => void` | Fired when an agent calls `start_intensive_chat`. `title` is the session title provided by the agent. `connectionId` identifies which agent connection owns the session. |
| `onIntensiveChatStop`  | main → renderer | `(callback: (data: { sessionId: string; connectionId: string }) => void) => void`                | Fired when an agent calls `stop_intensive_chat`. Signals the renderer to close or deactivate the intensive chat UI for the given session.                                |

---

### Connection Lifecycle

Methods that notify the renderer when agent connections are established or torn down.

| Method               | Direction       | Signature                                                                                                        | Description                                                                                                                                                                                                           |
| -------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `onConnectionOpened` | main → renderer | `(callback: (data: { connectionId: string; name: string; sessionId?: string; label?: string }) => void) => void` | Fired when a new MCP client session is initialized. `name` is the auto-assigned agent name (e.g., `Agent 1`). `sessionId` and `label` are present when the connection is associated with a persisted session channel. |
| `onConnectionClosed` | main → renderer | `(callback: (data: { connectionId: string }) => void) => void`                                                   | Fired when an MCP client session is torn down, either by the client (`DELETE /mcp`), by transport disconnection, or programmatically via `dismissSession` or `forceTerminateChat`.                                    |
| `forceTerminateChat` | renderer → main | `(connectionId: string) => Promise<void>`                                                                        | Invokes `force-terminate-chat` in the main process. Cancels any active prompt and closes the MCP session for the given connection without sending additional IPC events to the renderer.                              |
| `dismissSession`     | renderer → main | `(connectionId: string) => Promise<void>`                                                                        | Invokes `dismiss-session`. Terminates the session and causes the main process to emit a `connection-closed` event to the renderer, so the renderer can remove the session from its UI state.                          |

---

### History

Methods for reading and managing the persistent conversation history log.

| Method         | Direction       | Signature                             | Description                                                                                                                                          |
| -------------- | --------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getHistory`   | renderer → main | `() => Promise<ConversationRecord[]>` | Returns all stored conversation records from the SQLite database, ordered by creation time. Each record represents a completed prompt/response pair. |
| `clearHistory` | renderer → main | `() => Promise<boolean>`              | Deletes all conversation records from the database. Returns `true` on success.                                                                       |

#### `ConversationRecord` field notes

| Field               | Type             | Notes                                                                           |
| ------------------- | ---------------- | ------------------------------------------------------------------------------- |
| `id`                | `number`         | Auto-incremented primary key                                                    |
| `promptMessage`     | `string`         | The message text shown to the user                                              |
| `projectName`       | `string`         | Project name supplied by the agent                                              |
| `userResponse`      | `string`         | The answer submitted by the user                                                |
| `predefinedOptions` | `string \| null` | JSON-serialized array of options if provided, otherwise `null`                  |
| `attachments`       | `string \| null` | JSON-serialized array of attachment metadata if any were sent, otherwise `null` |
| `createdAt`         | `string`         | ISO 8601 timestamp                                                              |

---

### Settings

Methods for reading and persisting application settings.

| Method         | Direction       | Signature                                     | Description                                                                                                                                                                |
| -------------- | --------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getSettings`  | renderer → main | `() => Promise<AppSettings>`                  | Returns the current application settings from persistent storage.                                                                                                          |
| `saveSettings` | renderer → main | `(settings: AppSettings) => Promise<boolean>` | Persists the provided settings object. If the `port` value has changed, the main process automatically restarts the MCP server on the new port. Returns `true` on success. |

#### `AppSettings` field notes

| Field                  | Type      | Notes                                                                                                                                                                                                                                      |
| ---------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `port`                 | `number`  | TCP port the MCP HTTP server listens on                                                                                                                                                                                                    |
| `soundEnabled`         | `boolean` | Whether audio notifications play on incoming prompts                                                                                                                                                                                       |
| `launchAtLogin`        | `boolean` | Whether the app registers as a login item                                                                                                                                                                                                  |
| `promptTimeoutSeconds` | `number`  | Default timeout in seconds for unanswered prompts                                                                                                                                                                                          |
| `autoRestoreSessions`  | `boolean` | Whether persisted session channels are restored on app launch                                                                                                                                                                              |
| `openCodePort`         | `number`  | Port the local OpenCode ACP HTTP server listens on (default `4096`). Used by `register_connection` for session auto-detection and by `inject-opencode-message` for noReply injection.                                                      |
| `docIndexingEnabled`   | `boolean` | Whether background doc indexing and manifest injection run on `register_connection` (default `true`). When disabled, `find_repo_docs` falls back to keyword-only search.                                                                   |
| `noReplyInjection`     | `boolean` | When `true` (default), injected messages use `noReply: true` — the agent receives them as context only and does not respond. When `false`, injected messages trigger an agent response.                                                    |
| `autoStartOpenCode`    | `boolean` | When `true`, the app spawns `opencode serve` on the configured `openCodePort` at startup (default `false`). See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the startup sequence.                                                           |
| `autoSyncOpencode`     | `boolean` | When `true`, the app writes a `type: "remote"` MCP entry into `~/.config/opencode/opencode.json` at startup as a fallback registration method (default `false`). See [TOOLS.md — OpenCode Registration](./TOOLS.md#opencode-registration). |

---

### App Info

Methods for retrieving application metadata.

| Method                  | Direction       | Signature                                             | Description                                                                                                                                                                                                                                                                        |
| ----------------------- | --------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getAppVersion`         | renderer → main | `() => Promise<string>`                               | Returns the application version string from Electron's `app.getVersion()`. Used in `StatusBar` and `SettingsView`.                                                                                                                                                                 |
| `getProviderStatus`     | renderer → main | `() => Promise<ProviderStatus>`                       | Returns the current backend provider configuration. Used in `StatusBar`, `ChannelSidebar`, `SettingsView`, and `useProviderInjection`. See `ProviderStatus` type below.                                                                                                            |
| `detectOpenCodeSession` | renderer → main | `(baseDirectory?: string) => Promise<string \| null>` | Queries the local OpenCode ACP API to detect the most relevant active session. If `baseDirectory` is provided, sessions are filtered by directory. Returns the session ID or `null` if OpenCode is unreachable or no sessions exist.                                               |
| `syncOpencodeConfig`    | renderer → main | `() => Promise<string>`                               | Manually triggers MCP registration with OpenCode. First attempts dynamic registration via `POST /mcp`, then falls back to writing a `type: "remote"` entry into `~/.config/opencode/opencode.json`. Returns a status string (e.g., `"registered"`, `"unreachable+updated"`, etc.). |

#### `ProviderStatus` type

```ts
type ProviderStatus = {
  backend: 'standalone' | 'opencode' | 'claude_sdk';
  effectiveMode: 'standalone' | 'opencode' | 'claude_sdk' | 'standalone_compat';
  supportsSessionHierarchy: boolean;
  supportsProviderInjection: boolean;
  runtime: {
    available: boolean;
    reason?: 'module_not_installed' | 'missing_api_key' | 'init_failed';
    message: string;
  } | null;
};
```

| Field                       | Type                                                                | Notes                                                                                                                                                        |
| --------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `backend`                   | `'standalone' \| 'opencode' \| 'claude_sdk'`                        | The configured backend from settings                                                                                                                         |
| `effectiveMode`             | `'standalone' \| 'opencode' \| 'claude_sdk' \| 'standalone_compat'` | The actual operating mode. May differ from `backend` (e.g., `standalone_compat` when Claude SDK is configured but provider injection isn't supported)        |
| `supportsSessionHierarchy`  | `boolean`                                                           | Whether the backend supports parent/child session relationships                                                                                              |
| `supportsProviderInjection` | `boolean`                                                           | Whether the backend supports injecting messages into agent sessions                                                                                          |
| `runtime`                   | `object \| null`                                                    | Runtime availability info for Claude SDK backend. `null` for other backends. Contains `available`, optional `reason` for unavailability, and `message` text. |

---

### File System

Methods for file autocomplete, file selection, and reading files as attachments.

| Method                  | Direction       | Signature                                                                                                                        | Description                                                                                                                                                                                                                                                                   |
| ----------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `searchFiles`           | renderer → main | `(baseDirectory: string, query: string) => Promise<string[]>`                                                                    | Returns a list of file paths under `baseDirectory` that match `query`. Used for autocomplete in prompt input fields.                                                                                                                                                          |
| `openFileDialog`        | renderer → main | `() => Promise<string[]>`                                                                                                        | Opens a native OS file picker configured for multi-select with filters for images and text files. Returns an array of absolute file paths selected by the user, or an empty array if the dialog was cancelled.                                                                |
| `readFileForAttachment` | renderer → main | `(filePath: string) => Promise<{ type: 'image' \| 'text'; data: string; mimeType: string; name: string; size: number } \| null>` | Reads the file at the given path and returns its contents encoded as a string. `type` indicates whether the file was treated as an image or plain text. `data` is a base64-encoded string for images or UTF-8 text for text files. Returns `null` if the file cannot be read. |

Persisted image attachments are served separately via the MCP HTTP server at `GET /attachments/:filename`; this route is documented in [`MCP-SERVER.md`](./MCP-SERVER.md) and used by OpenCode injection for image references.

---

### Session Channels

Methods and events for managing named, database-backed session channels. Session channels allow agents that cannot maintain a persistent SSE connection (e.g., the VS Code extension) to communicate with the renderer asynchronously.

#### Invoke Methods

| Method                        | Direction       | Signature                                                                                                                                              | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getPersistedSessionChannels` | renderer → main | `() => Promise<{ sessionId: string; label: string \| null; createdAt: string; openCodeSessionId: string \| null; parentSessionId: string \| null }[]>` | Returns persisted session-channel rows joined with `registered_connections` metadata. Used as startup reconciliation input rather than as a standalone restored-tab model.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `getSessionChannelHistory`    | renderer → main | `(sessionId: string) => Promise<SessionChannelHistoryRecord[]>`                                                                                        | Returns all message history records for the specified session channel. Includes questions sent to the user, answers submitted by the user, and outbound messages queued by the agent.                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `clearSessionChannelMessages` | renderer → main | `(sessionId: string) => Promise<boolean>`                                                                                                              | Deletes all message history records for the specified session channel without removing the channel itself. Causes the main process to emit `session-channel-messages-cleared` to the renderer. Returns `true` on success.                                                                                                                                                                                                                                                                                                                                                                                     |
| `removeSessionChannel`        | renderer → main | `(sessionId: string) => Promise<boolean>`                                                                                                              | Fully tears down the persisted session. The main process: (1) force-terminates any active prompt, (2) closes the live MCP session if present, (3) deletes session-channel rows, (4) deletes the matching `registered_connections` row and ID file, (5) marks the `connectionId` as deleted for the stale-connection guard, (6) triggers an immediate `session-tree-updated` refresh, (7) sends `connection-closed`, and (8) sends `session-channel-deleted`. Returns `true` on success.                                                                                                                       |
| `queueSessionMessage`         | renderer → main | `(sessionId: string, message: string) => void`                                                                                                         | Enqueues a message into the session channel's outbound message queue in SQLite. Uses `ipcRenderer.send` (fire-and-forget). The message will be drained by the agent on its next `GET /api/sessions/:sessionId/messages` poll.                                                                                                                                                                                                                                                                                                                                                                                 |
| `injectOpenCodeMessage`       | renderer → main | `(openCodeSessionId: string, message: string, attachments?: Attachment[]) => Promise<{ ok: boolean; error?: string; noReply?: boolean }>`              | POSTs a message to the OpenCode ACP API at `http://localhost:{openCodePort}/session/{openCodeSessionId}/message`. When the `noReplyInjection` setting is `true` (default), sends `{ noReply: true, parts: [{ type: "text", text: fullText }] }`; when `false`, omits `noReply` so the agent responds. Image attachments are saved to the persistent attachment store and referenced in `fullText` as markdown links to `/attachments/:filename`. Text attachments are inlined as `--- File: <name> ---\n<content>`. Returns `{ ok: true, noReply }` on success or `{ ok: false, error, noReply }` on failure. |

#### Event Listeners

| Method                            | Direction       | Signature                                                                                    | Description                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------- | --------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `onSessionChannelCreated`         | main → renderer | `(callback: (data: { sessionId: string; label?: string }) => void) => void`                  | Fired when `POST /api/sessions` creates a new session channel. `label` is the optional human-readable name for the channel.                                                                                                                                                                                                                          |
| `onSessionChannelDeleted`         | main → renderer | `(callback: (data: { sessionId: string }) => void) => void`                                  | Fired when a session channel is deleted, either via `DELETE /api/sessions/:sessionId` or as part of `removeSessionChannel`.                                                                                                                                                                                                                          |
| `onSessionChannelMessagesCleared` | main → renderer | `(callback: (data: { sessionId: string }) => void) => void`                                  | Fired after `clearSessionChannelMessages` successfully deletes the message history for a session channel.                                                                                                                                                                                                                                            |
| `onSessionStatusUpdate`           | main → renderer | `(callback: (data: { connectionId: string; status: string; type: string }) => void) => void` | Fired when an agent calls the `push_session_status` tool. `status` is the message text to display and `type` is a visual indicator hint (e.g., `info`, `working`, `success`, `error`).                                                                                                                                                               |
| `onAgentMessage`                  | main → renderer | `(callback: (data: { connectionId: string; message: string }) => void) => void`              | Fired when an agent calls the `send_message` tool. `message` is the markdown text to persist and display in the channel history with teal `agent_message` styling.                                                                                                                                                                                   |
| `onSessionTreeUpdated`            | main → renderer | `(callback: (nodes: SessionTreeNode[]) => void) => void`                                     | Fired every ~2 seconds by `session-tree-manager` and immediately after `register_connection` or session removal. `nodes` is a full flat snapshot of all live OpenCode sessions enriched with MCP connection info. The renderer rebuilds topology from this snapshot and preserves runtime state separately. See [Session Tree](#session-tree) below. |

#### `SessionChannelHistoryRecord` field notes

| Field         | Type                                                      | Notes                                                                                                                                                                                                    |
| ------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`          | `number`                                                  | Auto-incremented primary key                                                                                                                                                                             |
| `sessionId`   | `string`                                                  | The session channel this record belongs to                                                                                                                                                               |
| `messageType` | `'question' \| 'answer' \| 'outbound' \| 'agent_message'` | `question`: prompt sent to the user; `answer`: user's response; `outbound`: message queued by the user for the polling client; `agent_message`: agent-initiated informational message via `send_message` |
| `messageText` | `string`                                                  | The message content                                                                                                                                                                                      |
| `attachments` | `string \| null`                                          | JSON-serialized attachment metadata if present, otherwise `null`                                                                                                                                         |
| `createdAt`   | `string`                                                  | ISO 8601 timestamp                                                                                                                                                                                       |

---

### OpenCode Injection

<a name="opencode-injection"></a>

Methods for injecting context messages into an active OpenCode session via the OpenCode ACP HTTP API.

| Method                  | Direction       | Signature                                                                                                                                 | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `injectOpenCodeMessage` | renderer → main | `(openCodeSessionId: string, message: string, attachments?: Attachment[]) => Promise<{ ok: boolean; error?: string; noReply?: boolean }>` | Handled by `inject-opencode-message` in `ipc-handlers.ts`. Reads the `noReplyInjection` setting at call time — when `true` (default), sends `{ noReply: true, parts: [...] }` so the agent receives the message as context only; when `false`, omits `noReply` so the agent responds. Builds a single text message: the user's message text, followed by markdown links to `http://localhost:{mcpPort}/attachments/:filename` for image attachments (saved to the persistent attachment store) and inlined `--- File: name ---\ncontent` blocks for text attachments. Returns `{ ok: true, noReply }` on success or `{ ok: false, error, noReply }` on failure. |

The `openCodePort` used by the handler is read from the live `currentSettings.openCodePort` value at call time, so changes to the port setting take effect immediately without an app restart. The `noReplyInjection` flag is similarly read live from `currentSettings.noReplyInjection`.

This method is called by `ChannelComposer` alongside `queueSessionMessage` whenever the active connection has a stored `openCodeSessionId`. See [`SESSION-CHANNELS.md — noReply OpenCode Injection`](./SESSION-CHANNELS.md#noreply-opencode-injection) for the full message-delivery flow.

---

Methods for querying and controlling the MCP HTTP server.

| Method               | Direction       | Signature                                           | Description                                                                                                                                                                                                                                                                                                          |
| -------------------- | --------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getServerStatus`    | renderer → main | `() => Promise<{ running: boolean; port: number }>` | Returns whether the MCP HTTP server is currently running and the port it is bound to.                                                                                                                                                                                                                                |
| `restartMcpServer`   | renderer → main | `() => Promise<boolean>`                            | Invokes `restart-mcp-server` in the main process. Stops the current server instance, clears session files, and starts a new instance on the same port. Returns `true` on success. See [`MCP-SERVER.md`](MCP-SERVER.md) for restart internals.                                                                        |
| `reconnectMcpServer` | renderer → main | `() => Promise<{ ok: boolean; cleared: number }>`   | Invokes `reconnect-mcp-server` in the main process. Performs a soft-restart: clears all in-memory MCP sessions without stopping the HTTP listener. Returns `{ ok: true, cleared: <n> }` where `cleared` is the number of sessions that were active. See [`MCP-SERVER.md`](MCP-SERVER.md) for soft-restart internals. |

> **Note on `reconnectMcpServer`:** This method was changed from an HTTP-based `fetch` call to `ipcRenderer.invoke('reconnect-mcp-server')`, consistent with other IPC methods on `window.api`.

---

### Session Tree

<a name="session-tree"></a>

The `session-tree-updated` IPC event delivers a flat array of `SessionTreeNode` objects representing all active OpenCode sessions, enriched with MCP connection metadata when available.

**Source:** `desktop/src/main/session-tree-manager.ts`

The session-tree manager subscribes to the OpenCode SSE stream (`GET /global/event`, which carries both in-process `Bus` events and versioned sync events) and maintains an in-memory session cache. On first connection it seeds the cache via the OpenCode REST API (`GET /session`). It fires `session-tree-updated` with a full snapshot whenever the cache changes (or immediately after a `register_connection` / session removal). If the SSE stream drops, it reconnects automatically after 2 s.

#### Invoke Methods

| Method               | Direction       | Signature             | Description                                                                                                                                                                                         |
| -------------------- | --------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `refreshSessionTree` | renderer → main | `() => Promise<void>` | Re-seeds the in-memory session cache from the OpenCode REST API (`GET /session`) and emits a fresh `session-tree-updated` snapshot. Called from the refresh button in the Sessions sidebar section. |

#### `SessionTreeNode` type

```ts
type SessionTreeNode = {
  openCodeSessionId: string; // OpenCode session ID
  openCodeParentId: string | null; // Parent session ID (null for root sessions)
  title: string; // Session title from OpenCode
  directory: string; // Working directory from OpenCode
  createdAt: number; // Unix timestamp (ms)
  updatedAt: number; // Unix timestamp (ms)
  depth: number; // Tree depth (0 = root)
  connectionId: string | null; // MCP connectionId if registered, null otherwise
  channelName: string | null; // Channel name from register_connection
  hasMcpChannel: boolean; // Whether this session has an active MCP channel
  baseDirectory: string | null; // Base directory from register_connection
  registeredParentSessionId: string | null; // parentSessionId stored at registration
};
```

The renderer uses `depth` and `openCodeParentId` to render the sidebar hierarchy. Sessions without a `connectionId` (not yet registered via MCP) appear as placeholder entries with a connecting animation. Renderer node identity is `openCodeSessionId ?? connectionId`, but destructive actions must resolve back to the persisted session identifier (`connectionId`).

---

### Skills & Instructions

Methods for managing persistent skills and instructions stored in the `skills_and_instructions` SQLite table. All entries are automatically injected into new agent sessions via `register_connection`.

#### Invoke Methods

| Method                      | Direction       | Signature                                                                                                                                     | Description                                                                                                                                                                                                                                                                               |
| --------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `upsertSkillOrInstruction`  | renderer → main | `(data: { name: string; type: 'skill' \| 'instruction'; description: string; content: string }) => Promise<SkillOrInstructionRecord \| null>` | Creates or updates a skill/instruction row (upsert by `name`). Returns the full saved record on success or `null` if the database is unavailable. Fires `skills-updated` to all renderer listeners after a successful write.                                                              |
| `listSkillsAndInstructions` | renderer → main | `(filterType?: 'skill' \| 'instruction') => Promise<SkillOrInstructionRecord[]>`                                                              | Returns all rows from `skills_and_instructions`, ordered by name. Pass `filterType` to restrict results to only skills or only instructions. Returns an empty array if the database is unavailable.                                                                                       |
| `getSkillOrInstruction`     | renderer → main | `(name: string) => Promise<SkillOrInstructionRecord \| null>`                                                                                 | Returns the full record for the entry with the given `name`, or `null` if not found.                                                                                                                                                                                                      |
| `deleteSkillOrInstruction`  | renderer → main | `(name: string) => Promise<boolean>`                                                                                                          | Deletes the entry with the given `name`. Returns `true` if a row was deleted, `false` if no matching entry was found. Fires `skills-updated` to all renderer listeners when a row is deleted.                                                                                             |
| `exportSkillsMarkdown`      | renderer → main | `() => Promise<{ saved: boolean; filePath?: string }>`                                                                                        | Shows a native save dialog defaulting to `skills-and-instructions.md`. If the user confirms, writes all skills and instructions as a formatted Markdown file and returns `{ saved: true, filePath }`. Returns `{ saved: false }` if the dialog is cancelled or the window is unavailable. |

#### Event Listeners

| Method            | Direction       | Signature                        | Description                                                                                                                                                                                                               |
| ----------------- | --------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `onSkillsUpdated` | main → renderer | `(callback: () => void) => void` | Fired whenever a skill or instruction is created, updated, or deleted — either via the `manage_skills_and_instructions` MCP tool or via the renderer IPC methods above. The renderer should re-fetch the list on receipt. |

#### `SkillOrInstructionRecord` field notes

| Field         | Type                       | Notes                                                                      |
| ------------- | -------------------------- | -------------------------------------------------------------------------- |
| `id`          | `number`                   | Auto-incremented primary key                                               |
| `name`        | `string`                   | Unique identifier/name for the entry                                       |
| `type`        | `'skill' \| 'instruction'` | Entry category: `"skill"` for workflows/recipes, `"instruction"` for rules |
| `description` | `string`                   | Short summary shown in listings                                            |
| `content`     | `string`                   | Full Markdown body — injected verbatim into agent sessions                 |
| `createdAt`   | `string`                   | ISO 8601 timestamp, set once on creation                                   |
| `updatedAt`   | `string`                   | ISO 8601 timestamp, refreshed on every upsert                              |

---

## Quick Reference

### All methods grouped by IPC mechanism

| Mechanism                                               | Methods                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ipcRenderer.invoke` (renderer → main, returns Promise) | `getHistory`, `clearHistory`, `getSettings`, `saveSettings`, `getServerStatus`, `getAppVersion`, `getProviderStatus`, `detectOpenCodeSession`, `searchFiles`, `openFileDialog`, `readFileForAttachment`, `forceTerminateChat`, `dismissSession`, `restartMcpServer`, `reconnectMcpServer`, `getPersistedSessionChannels`, `getSessionChannelHistory`, `clearSessionChannelMessages`, `removeSessionChannel`, `injectOpenCodeMessage`, `syncOpencodeConfig`, `upsertSkillOrInstruction`, `listSkillsAndInstructions`, `getSkillOrInstruction`, `deleteSkillOrInstruction`, `exportSkillsMarkdown`, `refreshSessionTree` |
| `ipcRenderer.send` (renderer → main, fire-and-forget)   | `sendPromptResponse`, `queueSessionMessage`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `ipcRenderer.on` (main → renderer, event listener)      | `onPromptRequest`, `onIntensiveChatStart`, `onIntensiveChatStop`, `onConnectionOpened`, `onConnectionClosed`, `onSessionChannelCreated`, `onSessionChannelDeleted`, `onSessionChannelMessagesCleared`, `onSessionStatusUpdate`, `onAgentMessage`, `onSessionTreeUpdated`, `onSkillsUpdated`                                                                                                                                                                                                                                                                                                                            |
