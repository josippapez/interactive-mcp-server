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
  messageType: 'question' | 'answer' | 'outbound';
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

| Field                  | Type      | Notes                                                         |
| ---------------------- | --------- | ------------------------------------------------------------- |
| `port`                 | `number`  | TCP port the MCP HTTP server listens on                       |
| `soundEnabled`         | `boolean` | Whether audio notifications play on incoming prompts          |
| `launchAtLogin`        | `boolean` | Whether the app registers as a login item                     |
| `promptTimeoutSeconds` | `number`  | Default timeout in seconds for unanswered prompts             |
| `autoRestoreSessions`  | `boolean` | Whether persisted session channels are restored on app launch |

---

### File System

Methods for file autocomplete, file selection, and reading files as attachments.

| Method                  | Direction       | Signature                                                                                                                        | Description                                                                                                                                                                                                                                                                   |
| ----------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `searchFiles`           | renderer → main | `(baseDirectory: string, query: string) => Promise<string[]>`                                                                    | Returns a list of file paths under `baseDirectory` that match `query`. Used for autocomplete in prompt input fields.                                                                                                                                                          |
| `openFileDialog`        | renderer → main | `() => Promise<string[]>`                                                                                                        | Opens a native OS file picker configured for multi-select with filters for images and text files. Returns an array of absolute file paths selected by the user, or an empty array if the dialog was cancelled.                                                                |
| `readFileForAttachment` | renderer → main | `(filePath: string) => Promise<{ type: 'image' \| 'text'; data: string; mimeType: string; name: string; size: number } \| null>` | Reads the file at the given path and returns its contents encoded as a string. `type` indicates whether the file was treated as an image or plain text. `data` is a base64-encoded string for images or UTF-8 text for text files. Returns `null` if the file cannot be read. |

---

### Session Channels

Methods and events for managing named, database-backed session channels. Session channels allow agents that cannot maintain a persistent SSE connection (e.g., the VS Code extension) to communicate with the renderer asynchronously.

#### Invoke Methods

| Method                        | Direction       | Signature                                                                          | Description                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------- | --------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getPersistedSessionChannels` | renderer → main | `() => Promise<{ sessionId: string; label: string \| null; createdAt: string }[]>` | Returns all session channels currently stored in the database. Used to restore session state on app launch when `autoRestoreSessions` is enabled.                                                                                                                                                                                                                            |
| `getSessionChannelHistory`    | renderer → main | `(sessionId: string) => Promise<SessionChannelHistoryRecord[]>`                    | Returns all message history records for the specified session channel. Includes questions sent to the user, answers submitted by the user, and outbound messages queued by the agent.                                                                                                                                                                                        |
| `clearSessionChannelMessages` | renderer → main | `(sessionId: string) => Promise<boolean>`                                          | Deletes all message history records for the specified session channel without removing the channel itself. Causes the main process to emit `session-channel-messages-cleared` to the renderer. Returns `true` on success.                                                                                                                                                    |
| `removeSessionChannel`        | renderer → main | `(sessionId: string) => Promise<boolean>`                                          | Fully tears down the session channel. The main process performs the following steps in order: (1) calls `forceTerminateChat` on the associated connection, (2) calls `closeSessionByConnectionId`, (3) deletes the channel from the database, (4) sends `connection-closed` to the renderer, (5) sends `session-channel-deleted` to the renderer. Returns `true` on success. |
| `queueSessionMessage`         | renderer → main | `(sessionId: string, message: string) => void`                                     | Enqueues a message into the session channel's outbound message queue in SQLite. Uses `ipcRenderer.send` (fire-and-forget). The message will be drained by the agent on its next `GET /api/sessions/:sessionId/messages` poll.                                                                                                                                                |

#### Event Listeners

| Method                            | Direction       | Signature                                                                                    | Description                                                                                                                                                                            |
| --------------------------------- | --------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `onSessionChannelCreated`         | main → renderer | `(callback: (data: { sessionId: string; label?: string }) => void) => void`                  | Fired when `POST /api/sessions` creates a new session channel. `label` is the optional human-readable name for the channel.                                                            |
| `onSessionChannelDeleted`         | main → renderer | `(callback: (data: { sessionId: string }) => void) => void`                                  | Fired when a session channel is deleted, either via `DELETE /api/sessions/:sessionId` or as part of `removeSessionChannel`.                                                            |
| `onSessionChannelMessagesCleared` | main → renderer | `(callback: (data: { sessionId: string }) => void) => void`                                  | Fired after `clearSessionChannelMessages` successfully deletes the message history for a session channel.                                                                              |
| `onSessionStatusUpdate`           | main → renderer | `(callback: (data: { connectionId: string; status: string; type: string }) => void) => void` | Fired when an agent calls the `push_session_status` tool. `status` is the message text to display and `type` is a visual indicator hint (e.g., `info`, `working`, `success`, `error`). |

#### `SessionChannelHistoryRecord` field notes

| Field         | Type                                   | Notes                                                                                                                          |
| ------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `id`          | `number`                               | Auto-incremented primary key                                                                                                   |
| `sessionId`   | `string`                               | The session channel this record belongs to                                                                                     |
| `messageType` | `'question' \| 'answer' \| 'outbound'` | `question`: prompt sent to the user; `answer`: user's response; `outbound`: message queued by the agent for the polling client |
| `messageText` | `string`                               | The message content                                                                                                            |
| `attachments` | `string \| null`                       | JSON-serialized attachment metadata if present, otherwise `null`                                                               |
| `createdAt`   | `string`                               | ISO 8601 timestamp                                                                                                             |

---

### Server Management

Methods for querying and controlling the MCP HTTP server.

| Method               | Direction       | Signature                                           | Description                                                                                                                                                                                                                                                                                  |
| -------------------- | --------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getServerStatus`    | renderer → main | `() => Promise<{ running: boolean; port: number }>` | Returns whether the MCP HTTP server is currently running and the port it is bound to.                                                                                                                                                                                                        |
| `restartMcpServer`   | renderer → main | `() => Promise<boolean>`                            | Invokes `restart-mcp-server` in the main process. Stops the current server instance, clears session files, and starts a new instance on the same port. Returns `true` on success. See [`MCP-SERVER.md`](MCP-SERVER.md) for restart internals.                                                |
| `reconnectMcpServer` | renderer → main | `() => Promise<{ ok: boolean; cleared: number }>`   | Calls `POST http://localhost:3100/api/reconnect` directly from the renderer via `fetch`. This is a no-op acknowledgement endpoint that always returns `{ ok: true, cleared: 0 }`. Note: this is the only `window.api` method that bypasses `ipcRenderer` and communicates over HTTP instead. |

> **Note on `reconnectMcpServer`:** Unlike every other method on `window.api`, this call does not use `ipcRenderer.invoke` or `ipcRenderer.send`. It issues an HTTP `POST` to the MCP server's `/api/reconnect` endpoint directly. The renderer must be able to reach `localhost:3100` (or the configured port) for this call to succeed.

---

## Quick Reference

### All methods grouped by IPC mechanism

| Mechanism                                               | Methods                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ipcRenderer.invoke` (renderer → main, returns Promise) | `getHistory`, `clearHistory`, `getSettings`, `saveSettings`, `getServerStatus`, `searchFiles`, `openFileDialog`, `readFileForAttachment`, `forceTerminateChat`, `dismissSession`, `restartMcpServer`, `getPersistedSessionChannels`, `getSessionChannelHistory`, `clearSessionChannelMessages`, `removeSessionChannel` |
| `ipcRenderer.send` (renderer → main, fire-and-forget)   | `sendPromptResponse`, `queueSessionMessage`                                                                                                                                                                                                                                                                            |
| `ipcRenderer.on` (main → renderer, event listener)      | `onPromptRequest`, `onIntensiveChatStart`, `onIntensiveChatStop`, `onConnectionOpened`, `onConnectionClosed`, `onSessionChannelCreated`, `onSessionChannelDeleted`, `onSessionChannelMessagesCleared`, `onSessionStatusUpdate`                                                                                         |
| `fetch` (renderer → HTTP, bypasses IPC)                 | `reconnectMcpServer`                                                                                                                                                                                                                                                                                                   |
