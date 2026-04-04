# Interactive MCP Desktop — Tool Reference

This document is the authoritative reference for all MCP tools registered by the Interactive MCP Desktop app. Each tool is registered once per MCP connection and is scoped to that connection's `connectionId` and `connectionName`.

---

## Overview

| Tool                                            | Purpose                                                    | Blocking                            |
| ----------------------------------------------- | ---------------------------------------------------------- | ----------------------------------- |
| [`register_connection`](#register_connection)   | Establish a named, persistent agent channel in the sidebar | No — returns immediately            |
| [`request_user_input`](#request_user_input)     | Ask the user a question; await their reply                 | Yes — awaits user response          |
| [`start_intensive_chat`](#start_intensive_chat) | Open a named multi-turn chat session                       | No — returns session ID immediately |
| [`ask_intensive_chat`](#ask_intensive_chat)     | Ask a question inside an intensive chat session            | Yes — awaits user response          |
| [`stop_intensive_chat`](#stop_intensive_chat)   | Close an active intensive chat session                     | No — returns immediately            |
| [`push_session_status`](#push_session_status)   | Display a live status indicator in the UI                  | No — returns immediately            |
| [`send_message`](#send_message)                 | Send a persistent informational message into the channel   | No — returns immediately            |
| [`find_repo_docs`](#find_repo_docs)             | Search repository documentation by query                   | No — returns immediately            |

---

## API Reference

---

### `register_connection`

**File:** `desktop/src/main/tools/register-connection.ts`

**Description:** Register this agent as a named connection in the Interactive MCP Desktop app. Call once at the start of every session to establish a persistent, human-readable channel. After registration the channel appears in the app sidebar with the given name. The tool also auto-detects the active OpenCode session (if OpenCode is running) so that messages sent from the desktop app are injected directly into that session via the OpenCode ACP API.

#### Parameters

| Parameter           | Type     | Required | Description                                                                                                                                                                                                                         |
| ------------------- | -------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agentName`         | `string` | Yes      | Human-readable name for this agent (e.g. `"Claude Code - my-project"`). Shown in the channel sidebar.                                                                                                                               |
| `projectName`       | `string` | Yes      | Name of the project or workspace this agent is working in.                                                                                                                                                                          |
| `baseDirectory`     | `string` | No       | Absolute path to the working directory / repository root. Used for file autocomplete and for OpenCode session auto-detection.                                                                                                       |
| `openCodeSessionId` | `string` | No       | Explicit OpenCode ACP session ID for this agent. When provided, takes precedence over auto-detection entirely. Subagents spawned via the Task tool should pass their own session ID explicitly to ensure correct context injection. |

#### Return Value

| Scenario | Content                                                                                                                                                                       |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Always   | `[{ type: 'text', text: '<JSON result string>' }]` where the JSON object contains at least `{ ok, connectionId, agentName, projectName, baseDirectory, idFilePath, message }` |

The JSON also includes `openCodeSessionId` when an OpenCode session was successfully detected or explicitly provided, and `parentSessionId` when the OpenCode API returned a parent session for this connection.

#### Behavior

1. Upserts a record in the `registered_connections` SQLite table (keyed by `connectionId`), storing `agentName`, `projectName`, `baseDirectory`, the detected `openCodeSessionId` (or `null`), and `parentSessionId` (or `null`).
2. Writes a JSON ID file to `/tmp/imcp-agent-<safe-name>.json` so the agent can recover its `connectionId` after a restart without re-registering.
3. Renames the active channel in the `session_channels` table to `agentName`.
4. Sends a `connection-registered` IPC event to the renderer so the sidebar updates immediately.
5. Resolves `openCodeSessionId`: if `openCodeSessionId` was passed explicitly it is used directly; otherwise `autoDetectOpenCodeSession(openCodePort, baseDirectory)` is called, which returns a `DetectedSession | null` object with `{ id: string; parentId: string | null }` (see [OpenCode auto-detection](#opencode-auto-detection)).
6. Resolves `parentSessionId`: after the `openCodeSessionId` is known (whether explicit or auto-detected), the tool fetches `GET /session` and inspects the matched session's `parentID` field to identify the parent OpenCode session, if any.
7. Returns `{ ok: true, connectionId, agentName, projectName, baseDirectory?, idFilePath, message, openCodeSessionId?, parentSessionId? }`.

#### OpenCode auto-detection

When `register_connection` is called without an explicit `openCodeSessionId`, the tool queries the local OpenCode ACP HTTP API to locate the most relevant session:

1. `GET http://localhost:{openCodePort}/session?directory={baseDirectory}` — returns sessions scoped to `baseDirectory`.
2. If the response is empty, falls back to `GET http://localhost:{openCodePort}/session` (all sessions).
3. Picks the session with the highest `time.created` value (not `time.updated`), so freshly-spawned subagent sessions are preferred over the longer-running parent session.
4. Returns a `DetectedSession` object: `{ id: string; parentId: string | null }` — `parentId` is the `parentID` field on the session as reported by the OpenCode API.
5. Stores the detected `openCodeSessionId` and `parentSessionId` in the `registered_connections` table.
6. If the OpenCode API is unreachable (2-second timeout) or returns no sessions, both values are `null` and registration succeeds silently.

When `openCodeSessionId` is provided explicitly, auto-detection is skipped entirely. The tool still fetches `GET /session` to resolve `parentSessionId` from the matched session's `parentID` field.

The `openCodePort` is configurable in Settings (default `4096`). See [`SETTINGS-CONFIG.md`](./SETTINGS-CONFIG.md) for details.

#### ID file format

```json
{
  "connectionId": "<uuid>",
  "agentName": "Claude Code",
  "projectName": "my-project",
  "baseDirectory": "/Users/me/projects/my-project",
  "parentSessionId": "<opencode-parent-session-id-or-null>"
}
```

#### Example (pseudocode)

```ts
const result = await mcp.callTool('register_connection', {
  agentName: 'Claude Code - my-project',
  projectName: 'my-project',
  baseDirectory: '/Users/me/projects/my-project',
});
// result.content[0].text contains JSON, e.g.:
// {
//   "ok": true,
//   "connectionId": "<uuid>",
//   "agentName": "Claude Code - my-project",
//   "projectName": "my-project",
//   "baseDirectory": "/Users/me/projects/my-project",
//   "openCodeSessionId": "ses_abc123",
//   "parentSessionId": "ses_xyz456",   // null if not a subagent
//   "idFilePath": "/tmp/imcp-agent-claude-code-my-project.json",
//   "message": "Connection registered successfully. ..."
// }
```

---

### `request_user_input`

**File:** `desktop/src/main/tools/request-user-input.ts`

**Description:** Send a question to the user via an interactive prompt surface. Crucial for clarifying requirements, confirming plans, or resolving ambiguity. Use whenever there is any uncertainty or a need for clarification or confirmation. Proactive questioning is preferred over making assumptions.

#### Parameters

| Parameter           | Type                                | Required | Description                                                                                                                                                                                                  |
| ------------------- | ----------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `projectName`       | `string`                            | Yes      | Identifies the context/project making the request (shown in prompt header/title context).                                                                                                                    |
| `message`           | `string`                            | Yes      | The specific question for the user (prompt body text).                                                                                                                                                       |
| `predefinedOptions` | `string[]`                          | No       | Predefined options for the user to choose from. When provided, the UI renders these as clickable choices in addition to free-text input.                                                                     |
| `baseDirectory`     | `string`                            | Yes      | Required absolute path to the current repository root (must be a git repo root; used as file autocomplete/search scope).                                                                                     |
| `clientInfo`        | `{ model?: string; mode?: string }` | No       | Optional metadata about the MCP client. `model` is the model name (e.g. `"Claude Opus 4.6"`); `mode` is the agent mode (e.g. `"Plan"`, `"Code"`). Desktop-specific parameter not present in the TUI version. |

#### Return Value

The tool always returns an MCP `content` array.

| Scenario                      | Content                                                                   |
| ----------------------------- | ------------------------------------------------------------------------- |
| User replied with text        | `[{ type: 'text', text: 'User replied: <answer>' }, ...attachments]`      |
| User replied with empty input | `[{ type: 'text', text: 'User replied with empty input.' }]`              |
| Prompt timed out              | `[{ type: 'text', text: 'User did not reply: Timeout occurred.' }]`       |
| Prompt superseded             | `[{ type: 'text', text: 'Error: Prompt superseded by a newer prompt.' }]` |
| Window unavailable            | `[{ type: 'text', text: 'Error: Application window is not available.' }]` |

Attachments are appended to the content array after the text reply (see [Attachments](#attachments)).

#### Behavior

1. A UUID `promptId` is generated via `crypto.randomUUID()`.
2. `promptUser()` is called with the full `PromptData` payload, including the `connectionId` and `connectionName` bound at registration time.
3. Inside `promptUser()`:
   - Any existing active prompt for the same `connectionId` is cancelled and superseded (see [Prompt Lifecycle](#prompt-lifecycle)).
   - The app window is brought to the foreground (`win.show()` + `win.focus()`).
   - A beep notification is played via `shell.beep()`, subject to the 2-second cooldown (see [Prompt Lifecycle](#prompt-lifecycle)).
   - A `prompt-request` IPC event is sent to the renderer with the full `PromptData` payload.
   - The question is recorded in `session_channel_history` as a `question` message.
4. The tool suspends and awaits a `prompt-response` IPC reply from the renderer matching the `promptId`.
5. On reply:
   - The answer and any attachments are saved to the `conversations` table.
   - The answer is appended to `session_channel_history` as an `answer` message.
   - The content array is assembled and returned to the MCP caller.
6. On timeout (default 800 s): the promise resolves with the timeout error text.

#### When to use

- Before starting any task, even if requirements appear clear
- After completing any task, to run the mandatory satisfaction check — ask exactly: "Are you satisfied with this result, or would you like any changes?"
- When any requirement is ambiguous
- When multiple implementation approaches are possible and user input is needed
- Before making potentially impactful changes (code edits, file operations, complex commands)
- When you need to confirm assumptions before proceeding
- When the user asks a direct question or reply question
- When replying after system notifications and presenting task output/handoff
- Immediately before any final/closing handoff
- **Whenever you feel even slightly unsure about the user's intent or the correct next step**

> **Important:** Do NOT use plain-text replies when a prompt trigger applies. NEVER exit the prompt loop until the user explicitly says "Stop prompting", "End session", "Don't ask anymore", or "Close conversation". If a prompt times out or the user gives an empty response, re-prompt indefinitely.

#### Example (pseudocode)

```ts
const result = await mcp.callTool('request_user_input', {
  projectName: 'my-app',
  message: 'Which database should I use?',
  predefinedOptions: ['PostgreSQL', 'SQLite', 'MongoDB'],
  baseDirectory: '/workspace/my-app',
  clientInfo: { model: 'Claude Opus 4.6', mode: 'Code' },
});
// result.content[0].text => "User replied: PostgreSQL"
```

---

### `start_intensive_chat`

**File:** `desktop/src/main/tools/intensive-chat.ts`

**Description:** Start an intensive chat session for gathering multiple answers quickly from the user. Highly recommended for scenarios requiring a sequence of related inputs or confirmations. Especially useful for brainstorming ideas or discussing complex topics with the user.

#### Parameters

| Parameter       | Type     | Required | Description                                                                                                                                                                                                                                             |
| --------------- | -------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sessionTitle`  | `string` | Yes      | Title for the intensive chat session (appears at the top of the console). Used as `projectName` for all prompts within the session.                                                                                                                     |
| `baseDirectory` | `string` | Yes      | Required absolute path to the current repository root (must be a git repo root; default autocomplete/search scope for this session). Acts as the default `baseDirectory` for all `ask_intensive_chat` calls in this session unless overridden per-call. |

#### Return Value

| Scenario | Content                                                                                       |
| -------- | --------------------------------------------------------------------------------------------- |
| Always   | `[{ type: 'text', text: 'Intensive chat session started successfully. Session ID: <uuid>' }]` |

#### Behavior

1. A UUID `sessionId` is generated via `crypto.randomUUID()`.
2. The session `{ title, baseDirectory }` is stored in the module-level `activeChatSessions` Map under the `sessionId` key.
3. An `intensive-chat-start` IPC event is sent to the renderer with `{ sessionId, title, connectionId }`.
4. The session ID is returned to the caller immediately — no user interaction occurs at this step.

The session remains active until `stop_intensive_chat` is called or the session ID becomes invalid.

#### When to use

- When you need to collect a series of quick answers from the user (more than 2–3 questions)
- When setting up a project with multiple configuration options
- When guiding a user through a multi-step process requiring input at each stage
- When gathering sequential user preferences
- When you want to maintain context between multiple related questions efficiently
- When brainstorming ideas with the user interactively

#### Example (pseudocode)

```ts
const result = await mcp.callTool('start_intensive_chat', {
  sessionTitle: 'Project Setup',
  baseDirectory: '/workspace/my-app',
});
const sessionId = result.content[0].text.split('Session ID: ')[1];
// sessionId => "<uuid>"
```

---

### `ask_intensive_chat`

**File:** `desktop/src/main/tools/intensive-chat.ts`

**Description:** Ask a new question in an active intensive chat session previously started with `start_intensive_chat`.

#### Parameters

| Parameter           | Type       | Required | Description                                                                                                                                                                                                              |
| ------------------- | ---------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `sessionId`         | `string`   | Yes      | ID of the intensive chat session (from `start_intensive_chat`).                                                                                                                                                          |
| `question`          | `string`   | Yes      | Question to ask the user.                                                                                                                                                                                                |
| `predefinedOptions` | `string[]` | No       | Predefined options for the user to choose from.                                                                                                                                                                          |
| `baseDirectory`     | `string`   | Yes      | Required absolute path to the current repository root (must be a git repo root; autocomplete/search scope for this question). If provided, overrides the `baseDirectory` stored on the session for this specific prompt. |

#### Return Value

| Scenario                      | Content                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------- |
| User replied with text        | `[{ type: 'text', text: 'User replied: <answer>' }, ...attachments]`                              |
| User replied with empty input | `[{ type: 'text', text: 'User replied with empty input in intensive chat.' }]`                    |
| Prompt timed out              | `[{ type: 'text', text: 'User did not reply to question in intensive chat: Timeout occurred.' }]` |
| Invalid or expired session ID | `[{ type: 'text', text: 'Error: Invalid or expired session ID.' }]`                               |

Attachments are appended to the content array after the text reply (see [Attachments](#attachments)).

#### Behavior

1. `activeChatSessions.get(sessionId)` is called. If the session does not exist, the error response is returned immediately without any prompt.
2. A UUID `promptId` is generated.
3. `promptUser()` is called with:
   - `projectName` set to `session.title`
   - `baseDirectory` set to the call-level `baseDirectory` if provided, otherwise falling back to `session.baseDirectory`
   - `sessionId` included in the `PromptData` payload
4. The full prompt flow (window focus, beep, IPC, persistence) is identical to `request_user_input` — see [Prompt Lifecycle](#prompt-lifecycle).
5. The content array (text + attachments) is assembled and returned identically to `request_user_input`.

#### When to use

- When continuing a series of questions in an intensive chat session
- When you need the next piece of information in a multi-step process initiated via `start_intensive_chat`
- When offering multiple choice options to the user within the session
- When gathering sequential information from the user within the session

#### Example (pseudocode)

```ts
const result = await mcp.callTool('ask_intensive_chat', {
  sessionId,
  question: 'Which framework should I use?',
  predefinedOptions: ['React', 'Vue', 'Svelte'],
  baseDirectory: '/workspace/my-app',
});
// result.content[0].text => "User replied: React"
```

---

### `stop_intensive_chat`

**File:** `desktop/src/main/tools/intensive-chat.ts`

**Description:** Stop and close an active intensive chat session. Must be called after all questions have been asked using `ask_intensive_chat`.

#### Parameters

| Parameter   | Type     | Required | Description                               |
| ----------- | -------- | -------- | ----------------------------------------- |
| `sessionId` | `string` | Yes      | ID of the intensive chat session to stop. |

#### Return Value

| Scenario                      | Content                                                             |
| ----------------------------- | ------------------------------------------------------------------- |
| Session stopped               | `[{ type: 'text', text: 'Session stopped successfully.' }]`         |
| Invalid or expired session ID | `[{ type: 'text', text: 'Error: Invalid or expired session ID.' }]` |

#### Behavior

1. `activeChatSessions.get(sessionId)` is called. If the session does not exist, the error response is returned immediately.
2. The session is removed from `activeChatSessions` via `.delete(sessionId)`.
3. An `intensive-chat-stop` IPC event is sent to the renderer with `{ sessionId, connectionId }`.
4. The success response is returned immediately — no user interaction occurs.

> **Note:** `stop_intensive_chat` does **not** cancel any in-flight `ask_intensive_chat` prompt. If a prompt is actively awaiting a user reply when `stop_intensive_chat` is called, that prompt will continue to run until it resolves or times out. The session entry is simply removed from the registry; subsequent `ask_intensive_chat` calls with the same `sessionId` will receive the invalid-session error.

#### When to use

- When you've completed gathering all needed information via `ask_intensive_chat`
- When the multi-step process requiring intensive chat is complete
- When you're ready to move on to processing the collected information
- When the user indicates they want to end the session
- As the final action related to the intensive chat flow within a single response message

#### Example (pseudocode)

```ts
await mcp.callTool('stop_intensive_chat', { sessionId });
// renderer receives 'intensive-chat-stop', UI closes the session view
```

---

### `push_session_status`

**File:** `desktop/src/main/tools/session-channel.ts`

**Description:** Push a status update to the UI. Non-blocking — returns immediately. Use to show the user what the agent is currently doing.

#### Parameters

| Parameter | Type                                          | Required | Description                                                                               |
| --------- | --------------------------------------------- | -------- | ----------------------------------------------------------------------------------------- |
| `status`  | `string`                                      | Yes      | Status message to display in the UI.                                                      |
| `type`    | `'info' \| 'working' \| 'success' \| 'error'` | No       | Visual indicator type. Controls the icon/color of the status badge. Defaults to `'info'`. |

#### Return Value

| Scenario | Content                                   |
| -------- | ----------------------------------------- |
| Always   | `[{ type: 'text', text: '{"ok":true}' }]` |

#### Behavior

- Sends a `session-status-update` IPC event to the renderer with `{ connectionId, status, type }`.
- Returns `{"ok":true}` immediately without awaiting any response.
- Does **not** interact with the prompt system.
- Does **not** trigger a beep, record to history, or affect the active prompt state.
- This tool is safe to call at any frequency and from any agent state (e.g. while a prompt is pending).

#### `type` values

| Value       | Intended Use                                      |
| ----------- | ------------------------------------------------- |
| `'info'`    | General informational messages (default).         |
| `'working'` | Agent is actively processing or executing a task. |
| `'success'` | A task or step completed successfully.            |
| `'error'`   | A task or step failed.                            |

#### Example (pseudocode)

```ts
await mcp.callTool('push_session_status', {
  status: 'Running unit tests…',
  type: 'working',
});
// UI immediately updates the status badge; tool returns without blocking
```

---

### `send_message`

**File:** `desktop/src/main/tools/session-channel.ts`

**Description:** Send a visible, persistent message directly into the desktop app channel history. Non-blocking — returns immediately. Use to communicate information to the user without requiring a response. Unlike `push_session_status` (which shows a transient badge), messages sent via `send_message` are persisted in SQLite and survive app restarts.

#### Parameters

| Parameter | Type     | Required | Description                                         |
| --------- | -------- | -------- | --------------------------------------------------- |
| `message` | `string` | Yes      | The message text to display. Markdown is supported. |

#### Return Value

| Scenario | Content                                   |
| -------- | ----------------------------------------- |
| Always   | `[{ type: 'text', text: '{"ok":true}' }]` |

#### Behavior

- Appends an `agent_message` row to `session_channel_history` in SQLite (persisted across restarts).
- Fires an `agent-message` IPC event to the renderer with `{ connectionId, message }`.
- The renderer renders the message with a distinct teal left-border (`msg-agent-info` CSS class) to distinguish it from blocking prompts (`msg-agent`).
- Returns `{"ok":true}` immediately without awaiting any response.
- Does **not** interact with the prompt system or trigger a beep.
- Safe to call at any frequency and from any agent state.

#### Visual style

| CSS class         | Border color                          | Usage                        |
| ----------------- | ------------------------------------- | ---------------------------- |
| `.msg-agent`      | `--color-agent` (blue)                | `request_user_input` prompts |
| `.msg-agent-info` | `--color-agent-info` (teal `#2dd4bf`) | `send_message` messages      |

#### Example (pseudocode)

```ts
await mcp.callTool('send_message', {
  message: '## Build complete\n- 3 files changed\n- All tests passed',
});
// UI immediately shows the message in channel history; tool returns without blocking
```

---

### `find_repo_docs`

**File:** `desktop/src/main/tools/find-repo-docs.ts`

**Description:** Search repository documentation files by query. Uses hybrid keyword + semantic search to find the most relevant docs. Returns file paths, scores, and snippet previews. Use the Read tool to access the full content of any returned file.

This tool is only available when the agent registered with a `baseDirectory` via `register_connection`. If no `baseDirectory` was provided, the tool returns an error.

The search combines:

- **Keyword matching**: path tokens, content frequency (capped at 3 per token), title bonus, directory-context bonuses (e.g. queries mentioning "standard" boost files under `/standards/`).
- **Semantic similarity**: embedding-based cosine similarity using cached vectors (model: `Xenova/all-MiniLM-L6-v2`, 384 dimensions). Available after the background indexer warms up.

Results are ranked by combined score. The first search after registration may be keyword-only while the semantic index builds in the background.

#### Parameters

| Parameter | Type     | Required | Default | Description                                          |
| --------- | -------- | -------- | ------- | ---------------------------------------------------- |
| `query`   | `string` | Yes      | —       | Search query for repository docs and markdown files. |
| `limit`   | `number` | No       | `8`     | Maximum number of matches to return (1–20).          |

#### Return Value

| Scenario         | Content                                                                   |
| ---------------- | ------------------------------------------------------------------------- |
| Matches found    | `[{ type: 'text', text: '<formatted results with paths and snippets>' }]` |
| No matches       | `[{ type: 'text', text: 'No doc matches found for "<query>".' }]`         |
| No baseDirectory | `[{ type: 'text', text: 'Error: No baseDirectory registered...' }]`       |
| Stale connection | `[{ type: 'text', text: '<stale connection error>' }]`                    |

#### Result Format

```
Top doc matches for "authentication":
1. docs/guides/auth-setup.md (score: 18)
   L12: ## Setting up authentication with JWT
2. docs/standards/security.md (score: 14)
   L45: All API endpoints must validate the bearer token
3. .github/instructions/auth-flow.instructions.md (score: 11)
   (semantic match, similarity: 0.72)
```

Each result includes:

- **Path**: repo-relative file path
- **Score**: combined keyword + semantic score
- **Snippet**: first matching line (with line number) or semantic similarity note

#### Behavior

1. Looks up the registered connection to retrieve `baseDirectory`.
2. Calls `searchDocs(query, baseDirectory, limit)` which:
   a. Discovers all doc files (same discovery rules as manifest injection).
   b. Tokenizes the query and scores each file by keyword matches.
   c. If the semantic worker is ready, augments scores with cosine similarity from cached embeddings.
   d. Sorts by combined score descending and returns the top `limit` results.
3. Formats results as human-readable text and returns them.

#### Document Discovery

The tool discovers files from these locations:

- `docs/` — all `.md` and `.mdx` files (recursive)
- Root `README.md`
- `apps/`, `libs/`, `tools/` — `README.md` files (recursive)
- `.github/instructions/` — all `.md` files
- `.github/skills/` — `SKILL.md` files
- `.agents/skills/` — `SKILL.md` files

Directories like `node_modules`, `dist`, `.git`, `build`, `coverage`, etc. are skipped.

#### Semantic Indexing

On first `register_connection` with a `baseDirectory`, the background indexer:

1. Injects a doc manifest (paths + titles) into the OpenCode session via `noReply`.
2. Warms up an embedding worker thread (`Xenova/all-MiniLM-L6-v2`).
3. Builds an embedding cache at `<baseDirectory>/.doc-embeddings.json`.
4. Cache entries are keyed by repo-relative path and invalidated by `mtimeMs`.

The embedding worker runs in a separate thread and does not block the main process. First-time indexing may take 30–60 seconds depending on repo size. Subsequent searches benefit from the cached embeddings.

#### Settings

Doc indexing can be disabled via the **Repository Doc Indexing** toggle in Settings (`docIndexingEnabled`, default `true`). When disabled, `register_connection` skips manifest injection and background indexing, and `find_repo_docs` falls back to keyword-only search.

#### Example (pseudocode)

```ts
const result = await mcp.callTool('find_repo_docs', {
  query: 'how to set up authentication',
  limit: 5,
});
// result.content[0].text contains the ranked matches
// Use the Read tool to access full content of any returned file path
```

---

## Prompt Lifecycle

All blocking tools (`request_user_input`, `ask_intensive_chat`) share the same underlying `promptUser()` function defined in `desktop/src/main/ipc-prompt.ts`. This section documents the complete lifecycle.

### Prompt data flow

```
MCP caller
  │
  ▼
promptUser(win, PromptData)
  │  1. Cancel any existing active prompt for connectionId (supersede)
  │  2. win.show() + win.focus()
  │  3. Beep (if enabled and cooldown elapsed)
  │  4. IPC → renderer: 'prompt-request' with PromptData
  │  5. DB: append 'question' to session_channel_history
  │  6. Register in activePrompts Map
  │  7. Set timeout timer
  │
  ▼  (wait)
IPC ← renderer: 'prompt-response' with { id, answer, attachments? }
  │  8. Match promptId
  │  9. DB: save to conversations table
  │  10. DB: append 'answer' to session_channel_history
  │  11. Resolve promise with { answer, attachments }
  │
  ▼
Tool returns content array to MCP caller
```

### Prompt supersession

Only one prompt per `connectionId` can be active at a time. This is enforced by the `activePrompts` Map keyed on `connectionId`.

When `promptUser()` is called for a `connectionId` that already has an active prompt:

1. The existing prompt's `cancel()` function is invoked.
2. The existing promise resolves immediately with `'Error: Prompt superseded by a newer prompt.'`
3. The new prompt is registered as the active prompt.

This means the MCP caller that issued the original prompt will receive a supersession error, and the new prompt takes over.

### Timeout

- Default timeout: **800 seconds** (configurable via `setPromptTimeout(fn)`).
- If the timer fires before the user responds and the prompt has not already settled, the promise resolves with `'Error: Prompt timed out — no response received.'`
- The tool returns this as `'User did not reply: Timeout occurred.'` (or the intensive-chat variant).
- Timeout can be disabled by setting the timeout to `0` or a negative value.

### Beep cooldown

- A beep is played via `shell.beep()` when a new prompt is shown, provided sound is enabled.
- Beeps are rate-limited to at most one per **2000 ms** across all connections. Rapid sequential calls (e.g. an agent looping quickly) will only trigger one beep per 2-second window.

### Force termination

The `forceTerminateChat(connectionId)` function (internal, not an MCP tool) can be called by the application to immediately resolve any active prompt for a connection with:

```
USER_FORCE_TERMINATED: The user has force-terminated this conversation.
Stop all current work and acknowledge the termination.
```

This is used when the user explicitly closes or terminates a chat session from the UI.

### Connection cleanup

When a connection drops, `cancelActivePrompt(connectionId)` is called to cancel and clean up any pending prompt, preventing listener leaks on the `ipcMain` event emitter.

---

## Attachments

Users can attach files to any prompt response. Attachments flow through the system as follows:

### Data shape

Attachments are carried in the `PromptResponse` type:

```ts
interface PromptResponse {
  answer: string;
  attachments?: {
    data: string; // base64-encoded content (images) or raw text content
    mimeType: string; // MIME type, e.g. "image/png", "text/plain"
    name: string; // original filename
    size: number; // file size in bytes
  }[];
}
```

### Persistence

Attachments are saved alongside the conversation in the `conversations` table and appended to `session_channel_history` as part of the `answer` record.

### MCP content encoding

When the tool constructs its return value, attachments are appended to the content array after the primary text reply:

| Attachment MIME type | MCP content block                                         |
| -------------------- | --------------------------------------------------------- |
| `image/*`            | `{ type: 'image', data: <base64>, mimeType: <mimeType> }` |
| Any other type       | `{ type: 'text', text: '--- File: <name> ---\n<data>' }`  |

The `data` field for non-image attachments is the raw string content of the file (not base64). For image attachments, `data` is the base64-encoded binary content.

### Example content array (text + image attachment)

```json
[
  { "type": "text", "text": "User replied: Here is the screenshot" },
  { "type": "image", "data": "<base64>", "mimeType": "image/png" }
]
```

### Example content array (text + file attachment)

```json
[
  { "type": "text", "text": "User replied: See the log file" },
  {
    "type": "text",
    "text": "--- File: build.log ---\nError: module not found\n..."
  }
]
```

Attachments are supported by both `request_user_input` and `ask_intensive_chat`. They are not applicable to `start_intensive_chat`, `stop_intensive_chat`, `push_session_status`, or `send_message`.

---

## Internal IPC Events

These Electron IPC events are used internally between the main process and the renderer. They are not part of the MCP tool surface but are documented here for completeness.

| Channel                   | Direction       | Payload                                                                                              | Triggered by                                                                                         |
| ------------------------- | --------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `prompt-request`          | main → renderer | `PromptData`                                                                                         | `request_user_input`, `ask_intensive_chat`                                                           |
| `prompt-response`         | renderer → main | `{ id, answer, attachments? }`                                                                       | User submits a prompt reply                                                                          |
| `intensive-chat-start`    | main → renderer | `{ sessionId, title, connectionId }`                                                                 | `start_intensive_chat`                                                                               |
| `intensive-chat-stop`     | main → renderer | `{ sessionId, connectionId }`                                                                        | `stop_intensive_chat`                                                                                |
| `session-status-update`   | main → renderer | `{ connectionId, status, type }`                                                                     | `push_session_status`                                                                                |
| `agent-message`           | main → renderer | `{ connectionId, message }`                                                                          | `send_message`                                                                                       |
| `connection-registered`   | main → renderer | `{ connectionId, agentName, projectName, baseDirectory, label, openCodeSessionId, parentSessionId }` | `register_connection`                                                                                |
| `child-sessions-detected` | main → renderer | `{ openCodeSessionId: string; parentOpenCodeSessionId: string }[]`                                   | _(Deprecated — replaced by `session-tree-updated`.)_ Formerly fired by the background poller.        |
| `session-tree-updated`    | main → renderer | `SessionTreeNode[]` (see [`IPC-API.md`](./IPC-API.md#session-tree))                                  | Session-tree manager (~2 s poll) delivers a full snapshot of all OpenCode sessions + MCP connections |
| `inject-opencode-message` | renderer → main | `(openCodeSessionId: string, message: string)` (IPC invoke)                                          | `ChannelComposer` message send when OpenCode session is present                                      |

---

## Connection Scope

All tools operate within the scope of a single MCP connection. The `connectionId` (a UUID assigned at connection time) and `connectionName` (the human-readable name of the connected client) are bound at tool registration time via closure and are not exposed as tool parameters.

- `request_user_input`: uses `connectionId` + `connectionName` for prompt tracking and persistence.
- `start_intensive_chat` / `ask_intensive_chat` / `stop_intensive_chat`: use `connectionId` + `connectionName` for prompt tracking; `activeChatSessions` is a module-level Map shared across all connections.
- `push_session_status`: uses `connectionId` to route the status update to the correct UI channel.
- `find_repo_docs`: uses `connectionId` to look up the registered `baseDirectory` for document search.

---

## Server Lifecycle

The MCP server is managed via three exported functions from `desktop/src/main/mcp-server.ts`:

### Hard restart (`restartMcpServer`)

Stops the HTTP listener entirely, clears the session file, and starts a fresh Express server. All in-memory sessions are lost. Clients will see `ECONNREFUSED` until the new server is listening. This is used when the port changes (via Settings).

### Soft restart (`softRestartMcpServer`)

Clears all in-memory MCP sessions (transports, servers, active prompts) but **keeps the HTTP listener running**. The next client request will trigger either:

- A fresh `initialize` handshake (per MCP spec), or
- A **transparent session resurrection** — the server creates a new session internally, runs the MCP handshake behind the scenes, and forwards the original request so the client never sees an error.

This is the preferred approach for in-app "reconnect" operations since it avoids the TCP downtime window that causes OpenCode (and other `type: "remote"` clients) to require manual toggling.

**Accessible via:**

- IPC: `reconnect-mcp-server` handler (called from Settings UI)
- REST: `POST /api/reconnect` endpoint (returns `{ ok, cleared, message }`)

### Stop (`stopMcpServer`)

Shuts down the HTTP listener and cleans up all closures. Used on app quit.

### Transparent session resurrection

When a client sends a tool call with a stale MCP session ID (e.g., after the server cleared sessions), instead of returning a 404 error, the server:

1. Creates a new `McpServer` + `StreamableHTTPServerTransport`
2. Runs a synthetic MCP `initialize` → `notifications/initialized` handshake
3. Forwards the original request body to the new session
4. Returns the result with the new `Mcp-Session-Id` header

This means well-behaved MCP clients (including OpenCode) can reconnect transparently without any user intervention after a soft restart.

---

## Stdio Bridge (`desktop-bridge.cjs`)

**File:** `tools/mcp/desktop-bridge.cjs`

The bridge is a lightweight Node.js script that proxies between OpenCode's stdio transport and the desktop app's HTTP Streamable Transport. It enables automatic reconnection even when the desktop app is fully killed and restarted.

```
OpenCode  <──stdio──>  desktop-bridge.cjs  <──HTTP──>  Desktop App (port 3100)
           (type: local)                                (Streamable HTTP Transport)
```

### Why use the bridge?

| Scenario                      | Without bridge (`type: "remote"`)           | With bridge (`type: "local"`)             |
| ----------------------------- | ------------------------------------------- | ----------------------------------------- |
| Desktop app in-app restart    | Transparent (soft-restart keeps listener)   | Transparent                               |
| Desktop app full kill/restart | ECONNREFUSED → user must toggle in OpenCode | Bridge retries automatically → reconnects |
| Desktop app port change       | Must reconfigure and toggle                 | Bridge detects via session file           |

### How it works

1. OpenCode spawns the bridge as a `type: "local"` process (stdio transport).
2. The bridge reads JSON-RPC messages from stdin and forwards them as HTTP POST requests to the desktop app's `/mcp` endpoint.
3. Server-initiated notifications are received via an SSE (GET `/mcp`) long-poll and forwarded to stdout.
4. On network errors (ECONNREFUSED, ECONNRESET, etc.), the bridge retries with exponential backoff (500ms → 1s → 2s → ... → 30s max).
5. The bridge watches `/tmp/imcp-session.json` for port changes and auto-adjusts.
6. A background health poll (every 5s) logs connectivity status to stderr.

### Port resolution

The bridge resolves the desktop app port in this order:

1. `--port <port>` CLI argument
2. `IMCP_PORT` environment variable
3. `/tmp/imcp-session.json` (written by the desktop app)
4. Default: `3100`

### Configuration for OpenCode

Add this to your OpenCode MCP server config (e.g., `.opencode/config.json` or equivalent):

```json
{
  "mcpServers": {
    "interactive-desktop": {
      "type": "local",
      "command": "node",
      "args": ["/absolute/path/to/tools/mcp/desktop-bridge.cjs"]
    }
  }
}
```

Or with an explicit port:

```json
{
  "mcpServers": {
    "interactive-desktop": {
      "type": "local",
      "command": "node",
      "args": [
        "/absolute/path/to/tools/mcp/desktop-bridge.cjs",
        "--port",
        "3100"
      ]
    }
  }
}
```

Or with the environment variable:

```json
{
  "mcpServers": {
    "interactive-desktop": {
      "type": "local",
      "command": "node",
      "args": ["/absolute/path/to/tools/mcp/desktop-bridge.cjs"],
      "env": { "IMCP_PORT": "3100" }
    }
  }
}
```

### Logs

The bridge writes status and error messages to **stderr** (not stdout, which is reserved for JSON-RPC). Messages include:

- `[bridge] Interactive MCP Desktop Bridge started (port: 3100)`
- `[bridge] desktop app unreachable (ECONNREFUSED), retrying in 500ms...`
- `[bridge] desktop app is reachable at port 3100`
- `[bridge] session expired, will re-initialize on next request`
- `[bridge] desktop app port changed: 3100 -> 3200`

### Requirements

- Node.js 18+ (uses built-in `node:http`, `node:readline`, `node:fs`, `node:os`, `node:path`)
- No npm dependencies — the script is self-contained CommonJS
