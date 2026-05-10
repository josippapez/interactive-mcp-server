# @opencode-ai/sdk v2 — Authoritative Capability Map

**Version**: SDK v2 (as of May 2026)  
**Source**: `/Users/josippapez/Desktop/interactive-mcp-server/desktop/node_modules/@opencode-ai/sdk/dist/v2/`  
**Purpose**: Complete enumeration of SDK capabilities for migration planning against custom Eden modules.

---

## Table of Contents

1. [Client Initialization](#client-initialization)
2. [Namespace Reference](#namespace-reference)
   - [App](#app-namespace)
   - [Session](#session-namespace)
   - [Message Operations](#message-operations)
   - [File & Find](#file--find)
   - [Permission & Auth](#permission--auth)
   - [Config & Provider](#config--provider)
   - [Project & Path](#project--path)
   - [MCP & Tools](#mcp--tools)
   - [TUI & Prompt](#tui--prompt)
   - [Workspace & Worktree](#workspace--worktree)
   - [LSP & Formatter](#lsp--formatter)
   - [PTY & Shell](#pty--shell)
   - [VCS & Sync](#vcs--sync)
   - [Global & Instance](#global--instance)
3. [Event Stream (SSE Topics)](#event-stream-sse-topics)
4. [Notable Gaps vs Desktop Needs](#notable-gaps-vs-desktop-needs)

---

## Client Initialization

### `createOpencodeClient(config?)`

```typescript
export function createOpencodeClient(
  config?: Config & {
    directory?: string;
    experimental_workspaceID?: string;
  },
): OpencodeClient;
```

**Returns**: `OpencodeClient` instance with all namespaces attached.

**Side-effects**: Initializes HTTP client to OpenCode server (default: `http://localhost:8080`).

**Config options**:

- `baseUrl`: Server URL (e.g., `http://localhost:8080`)
- `directory`: Project root directory
- `experimental_workspaceID`: Workspace ID for multi-workspace projects

---

## Namespace Reference

### App Namespace

| Method     | Signature                                                                      | Returns              | Side-effects                    |
| ---------- | ------------------------------------------------------------------------------ | -------------------- | ------------------------------- |
| **log**    | `log(params?: { directory?, workspace?, service?, level?, message?, extra? })` | `AppLogResponses`    | Writes log entry to server logs |
| **agents** | `agents(params?: { directory?, workspace? })`                                  | `AppAgentsResponses` | —                               |
| **skills** | `skills(params?: { directory?, workspace? })`                                  | `AppSkillsResponses` | —                               |

**Use case**: Enumerate available agents and skills; write diagnostic logs.

---

### Session Namespace

#### Session2 (Primary Session API)

| Method            | Signature                                                                                                          | Returns                           | Side-effects                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------- | ------------------------------------------------------- |
| **list**          | `list(params?: { directory?, workspace?, scope?, path?, roots?, start?, search?, limit? })`                        | `SessionListResponses`            | —                                                       |
| **create**        | `create(params?: { directory?, workspace?, parentID?, title?, agent?, model?, permission?, workspaceID? })`        | `SessionCreateResponses`          | Creates new session; emits `session.created` event      |
| **get**           | `get(params: { sessionID, directory?, workspace? })`                                                               | `SessionGetResponses`             | —                                                       |
| **delete**        | `delete(params: { sessionID, directory?, workspace? })`                                                            | `SessionDeleteResponses`          | Deletes session; emits `session.deleted` event          |
| **update**        | `update(params: { sessionID, directory?, workspace?, title?, permission?, time? })`                                | `SessionUpdateResponses`          | Updates session metadata; emits `session.updated` event |
| **status**        | `status(params?: { directory?, workspace? })`                                                                      | `SessionStatusResponses`          | —                                                       |
| **init**          | `init(params: { sessionID, directory?, workspace?, agent?, model? })`                                              | `SessionInitResponses`            | Initializes session; emits `session.next.*` events      |
| **prompt**        | `prompt(params: { sessionID, directory?, workspace?, messageID?, agent?, model?, parts? })`                        | `SessionPromptResponses`          | Sends prompt; streams `session.next.*` events           |
| **promptAsync**   | `promptAsync(params: { sessionID, directory?, workspace?, messageID?, agent?, model?, parts? })`                   | `Promise<SessionPromptResponses>` | Async version of prompt                                 |
| **command**       | `command(params: { sessionID, directory?, workspace?, messageID?, agent?, model?, command?, arguments?, parts? })` | `SessionCommandResponses`         | Sends command; streams `session.next.*` events          |
| **shell**         | `shell(params: { sessionID, directory?, workspace?, messageID?, agent?, model?, command? })`                       | `SessionShellResponses`           | Executes shell command; streams `session.next.*` events |
| **message**       | `message(params: { sessionID, directory?, workspace?, messageID? })`                                               | `SessionMessageResponses`         | —                                                       |
| **messages**      | `messages(params: { sessionID, directory?, workspace?, start?, limit? })`                                          | `SessionMessagesResponses`        | —                                                       |
| **deleteMessage** | `deleteMessage(params: { sessionID, messageID, directory?, workspace? })`                                          | `SessionDeleteMessageResponses`   | Deletes message; emits `message.removed` event          |
| **revert**        | `revert(params: { sessionID, directory?, workspace?, messageID?, partID? })`                                       | `SessionRevertResponses`          | Reverts message; emits `session.diff` event             |
| **unrevert**      | `unrevert(params: { sessionID, directory?, workspace? })`                                                          | `SessionUnrevertResponses`        | Restores reverted messages; emits `session.diff` event  |
| **diff**          | `diff(params: { sessionID, directory?, workspace? })`                                                              | `SessionDiffResponses`            | —                                                       |
| **summarize**     | `summarize(params: { sessionID, directory?, workspace? })`                                                         | `SessionSummarizeResponses`       | —                                                       |
| **abort**         | `abort(params: { sessionID, directory?, workspace? })`                                                             | `SessionAbortResponses`           | Aborts active session; emits `session.status` event     |
| **share**         | `share(params: { sessionID, directory?, workspace? })`                                                             | `SessionShareResponses`           | Generates share link; emits `session.updated` event     |
| **unshare**       | `unshare(params: { sessionID, directory?, workspace? })`                                                           | `SessionUnshareResponses`         | Revokes share link; emits `session.updated` event       |
| **fork**          | `fork(params: { sessionID, directory?, workspace?, title? })`                                                      | `SessionForkResponses`            | Creates child session; emits `session.created` event    |
| **children**      | `children(params: { sessionID, directory?, workspace? })`                                                          | `SessionChildrenResponses`        | —                                                       |
| **todo**          | `todo(params: { sessionID, directory?, workspace? })`                                                              | `SessionTodoResponses`            | —                                                       |

**Key behaviors**:

- `prompt()` and `command()` stream events via SSE (see [Event Stream](#event-stream-sse-topics))
- `create()` accepts optional `agent` and `model` to set defaults
- `permission` parameter accepts `PermissionRuleset` for fine-grained access control
- `revert()` undoes a message; `unrevert()` restores all reverted messages

---

### Message Operations

#### Part (Message Part API)

| Method     | Signature                                                                            | Returns               | Side-effects                                     |
| ---------- | ------------------------------------------------------------------------------------ | --------------------- | ------------------------------------------------ |
| **delete** | `delete(params: { sessionID, messageID, partID, directory?, workspace? })`           | `PartDeleteResponses` | Deletes part; emits `message.part.removed` event |
| **update** | `update(params: { sessionID, messageID, partID, directory?, workspace?, content? })` | `PartUpdateResponses` | Updates part; emits `message.part.updated` event |

**Use case**: Modify or remove individual message parts (text, code, tool calls, etc.).

---

### File & Find

#### File (File Operations)

| Method     | Signature                                                             | Returns               | Side-effects |
| ---------- | --------------------------------------------------------------------- | --------------------- | ------------ |
| **list**   | `list(params: { directory?, workspace?, path?, recursive?, limit? })` | `FileListResponses`   | —            |
| **read**   | `read(params: { directory?, workspace?, path?, encoding? })`          | `FileReadResponses`   | —            |
| **status** | `status(params?: { directory?, workspace? })`                         | `FileStatusResponses` | —            |

**Use case**: List, read, and monitor file status in project.

#### Find (Search Operations)

| Method      | Signature                                                    | Returns                | Side-effects |
| ----------- | ------------------------------------------------------------ | ---------------------- | ------------ |
| **files**   | `files(params: { directory?, workspace?, query, limit? })`   | `FindFilesResponses`   | —            |
| **text**    | `text(params: { directory?, workspace?, query, limit? })`    | `FindTextResponses`    | —            |
| **symbols** | `symbols(params: { directory?, workspace?, query, limit? })` | `FindSymbolsResponses` | —            |

**Use case**: Full-text search, file search, and symbol search across project.

---

### Permission & Auth

#### Permission (Permission Management)

| Method      | Signature                                                                    | Returns                      | Side-effects                                               |
| ----------- | ---------------------------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------- |
| **list**    | `list(params?: { directory?, workspace? })`                                  | `PermissionListResponses`    | —                                                          |
| **reply**   | `reply(params: { permissionID, directory?, workspace?, allow?, always? })`   | `PermissionReplyResponses`   | Grants/denies permission; emits `permission.replied` event |
| **respond** | `respond(params: { permissionID, directory?, workspace?, allow?, always? })` | `PermissionRespondResponses` | Alias for `reply()`                                        |

**Use case**: Handle permission requests from tools and agents.

#### Auth (Authentication)

| Method     | Signature                            | Returns               | Side-effects                                        |
| ---------- | ------------------------------------ | --------------------- | --------------------------------------------------- |
| **set**    | `set(params: { providerID, auth? })` | `AuthSetResponses`    | Stores auth credentials; emits `auth.updated` event |
| **remove** | `remove(params: { providerID })`     | `AuthRemoveResponses` | Removes auth; emits `auth.removed` event            |

**Auth types supported**:

- `OAuth`: `{ type: "oauth", refresh, access, expires, accountId?, enterpriseUrl? }`
- `ApiAuth`: `{ type: "api", key, metadata? }`
- `WellKnownAuth`: `{ type: "wellknown", key, token }`

#### Auth2 (OAuth Flow)

| Method           | Signature                                                  | Returns                        | Side-effects                           |
| ---------------- | ---------------------------------------------------------- | ------------------------------ | -------------------------------------- |
| **start**        | `start(params: { name, directory?, workspace? })`          | `McpAuthStartResponses`        | Initiates OAuth flow; returns auth URL |
| **callback**     | `callback(params: { name, code, directory?, workspace? })` | `McpAuthCallbackResponses`     | Completes OAuth flow; stores token     |
| **authenticate** | `authenticate(params: { name, directory?, workspace? })`   | `McpAuthAuthenticateResponses` | Full OAuth flow (start + callback)     |
| **remove**       | `remove(params: { name, directory?, workspace? })`         | `McpAuthRemoveResponses`       | Removes OAuth credentials              |

---

### Config & Provider

#### Config (Global Configuration)

| Method     | Signature                      | Returns                       | Side-effects                                        |
| ---------- | ------------------------------ | ----------------------------- | --------------------------------------------------- |
| **get**    | `get(options?: Options)`       | `GlobalConfigGetResponses`    | —                                                   |
| **update** | `update(params?: { config? })` | `GlobalConfigUpdateResponses` | Updates global config; emits `config.updated` event |

#### Config2 (Project Configuration)

| Method        | Signature                                              | Returns                    | Side-effects               |
| ------------- | ------------------------------------------------------ | -------------------------- | -------------------------- |
| **get**       | `get(params?: { directory?, workspace? })`             | `ConfigGetResponses`       | —                          |
| **update**    | `update(params?: { directory?, workspace?, config? })` | `ConfigUpdateResponses`    | Updates project config     |
| **providers** | `providers(params?: { directory?, workspace? })`       | `ConfigProvidersResponses` | Lists configured providers |

#### Provider (Model Providers)

| Method    | Signature                                               | Returns                  | Side-effects |
| --------- | ------------------------------------------------------- | ------------------------ | ------------ |
| **list**  | `list(params?: { directory?, workspace? })`             | `ProviderListResponses`  | —            |
| **auth**  | `auth(params: { providerID, directory?, workspace? })`  | `ProviderAuthResponses`  | —            |
| **oauth** | `oauth(params: { providerID, directory?, workspace? })` | `ProviderOauthResponses` | —            |

**Use case**: Enumerate available model providers (OpenAI, Anthropic, etc.) and manage authentication.

---

### Project & Path

#### Project (Project Information)

| Method      | Signature                          | Returns                   | Side-effects                        |
| ----------- | ---------------------------------- | ------------------------- | ----------------------------------- |
| **current** | `current(params?: { directory? })` | `ProjectCurrentResponses` | —                                   |
| **list**    | `list(params?: { directory? })`    | `ProjectListResponses`    | —                                   |
| **initGit** | `initGit(params?: { directory? })` | `ProjectInitGitResponses` | Initializes git repo if not present |

#### Path (Path Resolution)

| Method  | Signature                                  | Returns            | Side-effects |
| ------- | ------------------------------------------ | ------------------ | ------------ |
| **get** | `get(params?: { directory?, workspace? })` | `PathGetResponses` | —            |

#### VCS (Version Control)

| Method   | Signature                                   | Returns            | Side-effects |
| -------- | ------------------------------------------- | ------------------ | ------------ |
| **get**  | `get(params?: { directory?, workspace? })`  | `VcsGetResponses`  | —            |
| **diff** | `diff(params?: { directory?, workspace? })` | `VcsDiffResponses` | —            |

---

### MCP & Tools

#### Mcp (MCP Server Management)

| Method         | Signature                                               | Returns                  | Side-effects                                        |
| -------------- | ------------------------------------------------------- | ------------------------ | --------------------------------------------------- |
| **status**     | `status(params?: { directory?, workspace? })`           | `McpStatusResponses`     | —                                                   |
| **connect**    | `connect(params: { name, directory?, workspace? })`     | `McpConnectResponses`    | Connects to MCP server; emits `mcp.connected` event |
| **disconnect** | `disconnect(params: { name, directory?, workspace? })`  | `McpDisconnectResponses` | Disconnects from MCP server                         |
| **add**        | `add(params: { name, config, directory?, workspace? })` | `McpAddResponses`        | Registers new MCP server                            |
| **auth**       | `auth()`                                                | `Auth2`                  | Returns OAuth handler for MCP auth                  |

#### Tool (Tool Management)

| Method   | Signature                                  | Returns             | Side-effects |
| -------- | ------------------------------------------ | ------------------- | ------------ |
| **list** | `list(params: { directory?, workspace? })` | `ToolListResponses` | —            |
| **ids**  | `ids(params?: { directory?, workspace? })` | `ToolIdsResponses`  | —            |

**Use case**: Enumerate available tools from MCP servers and manage MCP connections.

---

### TUI & Prompt

#### Tui (Terminal UI)

| Method             | Signature                                                                  | Returns                      | Side-effects                                                |
| ------------------ | -------------------------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------- |
| **publish**        | `publish(params?: { directory?, workspace? })`                             | `TuiPublishResponses`        | —                                                           |
| **appendPrompt**   | `appendPrompt(params: { text, directory?, workspace? })`                   | `TuiAppendPromptResponses`   | Appends text to TUI prompt; emits `tui.prompt.append` event |
| **clearPrompt**    | `clearPrompt(params?: { directory?, workspace? })`                         | `TuiClearPromptResponses`    | Clears TUI prompt                                           |
| **submitPrompt**   | `submitPrompt(params?: { directory?, workspace? })`                        | `TuiSubmitPromptResponses`   | Submits current prompt                                      |
| **showToast**      | `showToast(params: { message, type?, duration?, directory?, workspace? })` | `TuiShowToastResponses`      | Shows toast notification; emits `tui.toast.show` event      |
| **executeCommand** | `executeCommand(params: { command, directory?, workspace? })`              | `TuiExecuteCommandResponses` | Executes TUI command; emits `tui.command.execute` event     |
| **selectSession**  | `selectSession(params: { sessionID, directory?, workspace? })`             | `TuiSelectSessionResponses`  | Selects session in TUI; emits `tui.session.select` event    |
| **openSessions**   | `openSessions(params?: { directory?, workspace? })`                        | `TuiOpenSessionsResponses`   | Opens sessions panel                                        |
| **openModels**     | `openModels(params?: { directory?, workspace? })`                          | `TuiOpenModelsResponses`     | Opens models panel                                          |
| **openThemes**     | `openThemes(params?: { directory?, workspace? })`                          | `TuiOpenThemesResponses`     | Opens themes panel                                          |
| **openHelp**       | `openHelp(params?: { directory?, workspace? })`                            | `TuiOpenHelpResponses`       | Opens help panel                                            |
| **control**        | `control()`                                                                | `Control`                    | Returns control handler for TUI                             |

**Use case**: Interact with OpenCode TUI from external clients.

#### Question (Prompt/Question Management)

| Method     | Signature                                                       | Returns                   | Side-effects                                      |
| ---------- | --------------------------------------------------------------- | ------------------------- | ------------------------------------------------- |
| **list**   | `list(params?: { directory?, workspace? })`                     | `QuestionListResponses`   | —                                                 |
| **reply**  | `reply(params: { questionID, answer, directory?, workspace? })` | `QuestionReplyResponses`  | Answers question; emits `question.replied` event  |
| **reject** | `reject(params: { questionID, directory?, workspace? })`        | `QuestionRejectResponses` | Rejects question; emits `question.rejected` event |

---

### Workspace & Worktree

#### Workspace (Workspace Management)

| Method      | Signature                                                                  | Returns                                | Side-effects                                       |
| ----------- | -------------------------------------------------------------------------- | -------------------------------------- | -------------------------------------------------- |
| **list**    | `list(params?: { directory?, workspace? })`                                | `ExperimentalWorkspaceListResponses`   | —                                                  |
| **create**  | `create(params?: { directory?, workspace?, id?, type?, branch?, extra? })` | `ExperimentalWorkspaceCreateResponses` | Creates workspace; emits `workspace.ready` event   |
| **status**  | `status(params?: { directory?, workspace? })`                              | `ExperimentalWorkspaceStatusResponses` | —                                                  |
| **remove**  | `remove(params: { id, directory?, workspace? })`                           | `ExperimentalWorkspaceRemoveResponses` | Removes workspace; emits `workspace.deleted` event |
| **warp**    | `warp(params?: { directory?, workspace?, sessionID?, targetWorkspace? })`  | `ExperimentalWorkspaceWarpResponses`   | Moves session to workspace                         |
| **adapter** | `adapter()`                                                                | `Adapter`                              | Returns adapter handler                            |

#### Worktree (Git Worktree Management)

| Method     | Signature                                                     | Returns                   | Side-effects                                     |
| ---------- | ------------------------------------------------------------- | ------------------------- | ------------------------------------------------ |
| **list**   | `list(params?: { directory?, workspace? })`                   | `WorktreeListResponses`   | —                                                |
| **create** | `create(params?: { directory?, workspace?, path?, branch? })` | `WorktreeCreateResponses` | Creates worktree; emits `worktree.ready` event   |
| **remove** | `remove(params?: { directory?, workspace?, path? })`          | `WorktreeRemoveResponses` | Removes worktree; emits `worktree.deleted` event |
| **reset**  | `reset(params?: { directory?, workspace?, path? })`           | `WorktreeResetResponses`  | Resets worktree                                  |

---

### LSP & Formatter

#### Lsp (Language Server Protocol)

| Method     | Signature                                     | Returns              | Side-effects |
| ---------- | --------------------------------------------- | -------------------- | ------------ |
| **status** | `status(params?: { directory?, workspace? })` | `LspStatusResponses` | —            |

#### Formatter (Code Formatter)

| Method     | Signature                                     | Returns                    | Side-effects |
| ---------- | --------------------------------------------- | -------------------------- | ------------ |
| **status** | `status(params?: { directory?, workspace? })` | `FormatterStatusResponses` | —            |

---

### PTY & Shell

#### Pty (Pseudo-Terminal)

| Method           | Signature                                                   | Returns                    | Side-effects                                  |
| ---------------- | ----------------------------------------------------------- | -------------------------- | --------------------------------------------- |
| **list**         | `list(params?: { directory?, workspace? })`                 | `PtyListResponses`         | —                                             |
| **create**       | `create(params?: { directory?, workspace?, shell?, cwd? })` | `PtyCreateResponses`       | Creates PTY; emits `pty.created` event        |
| **get**          | `get(params: { ptyID, directory?, workspace? })`            | `PtyGetResponses`          | —                                             |
| **update**       | `update(params: { ptyID, directory?, workspace?, input? })` | `PtyUpdateResponses`       | Sends input to PTY; emits `pty.updated` event |
| **remove**       | `remove(params: { ptyID, directory?, workspace? })`         | `PtyRemoveResponses`       | Closes PTY; emits `pty.deleted` event         |
| **shells**       | `shells(params?: { directory?, workspace? })`               | `PtyShellsResponses`       | Lists available shells                        |
| **connect**      | `connect(params: { ptyID, directory?, workspace? })`        | `PtyConnectResponses`      | Connects to PTY stream                        |
| **connectToken** | `connectToken(params: { ptyID, directory?, workspace? })`   | `PtyConnectTokenResponses` | Gets token for PTY connection                 |

---

### VCS & Sync

#### Sync (Session Sync/Replay)

| Method      | Signature                                      | Returns                | Side-effects                       |
| ----------- | ---------------------------------------------- | ---------------------- | ---------------------------------- |
| **start**   | `start(params?: { directory?, workspace? })`   | `SyncStartResponses`   | Starts sync session                |
| **history** | `history(params?: { directory?, workspace? })` | `SyncHistoryResponses` | —                                  |
| **replay**  | `replay(params?: { directory?, workspace? })`  | `SyncReplayResponses`  | Replays session history            |
| **steal**   | `steal(params?: { directory?, workspace? })`   | `SyncStealResponses`   | Steals session from another client |

---

### Global & Instance

#### Global (Global Server Operations)

| Method      | Signature                        | Returns                           | Side-effects                    |
| ----------- | -------------------------------- | --------------------------------- | ------------------------------- |
| **health**  | `health(options?: Options)`      | `GlobalHealthResponses`           | —                               |
| **event**   | `event(options?: Options)`       | `Promise<ServerSentEventsResult>` | Opens SSE stream for all events |
| **dispose** | `dispose(options?: Options)`     | `GlobalDisposeResponses`          | Shuts down server               |
| **upgrade** | `upgrade(params?: { version? })` | `GlobalUpgradeResponses`          | Upgrades OpenCode server        |
| **config**  | `config()`                       | `Config`                          | Returns config handler          |

#### Instance (Server Instance)

| Method      | Signature                    | Returns                    | Side-effects              |
| ----------- | ---------------------------- | -------------------------- | ------------------------- |
| **dispose** | `dispose(options?: Options)` | `InstanceDisposeResponses` | Disposes current instance |

#### Event (Event Subscription)

| Method        | Signature                                                 | Returns                   | Side-effects                         |
| ------------- | --------------------------------------------------------- | ------------------------- | ------------------------------------ |
| **subscribe** | `subscribe(params?: { directory?, workspace?, topics? })` | `EventSubscribeResponses` | Opens SSE stream for specific topics |

---

## Event Stream (SSE Topics)

The SDK supports **Server-Sent Events (SSE)** for real-time updates. Subscribe via:

```typescript
const stream = await client.global.event();
// or
const stream = await client.event.subscribe({
  topics: ['session.created', 'message.*'],
});
```

### Session Events

| Event               | Payload                 | Trigger                                             |
| ------------------- | ----------------------- | --------------------------------------------------- |
| `session.created`   | `EventSessionCreated`   | New session created                                 |
| `session.updated`   | `EventSessionUpdated`   | Session metadata changed (title, permissions, etc.) |
| `session.deleted`   | `EventSessionDeleted`   | Session deleted                                     |
| `session.status`    | `EventSessionStatus`    | Session status changed (active, idle, completed)    |
| `session.idle`      | `EventSessionIdle`      | Session became idle                                 |
| `session.diff`      | `EventSessionDiff`      | Session diff updated (revert/unrevert)              |
| `session.error`     | `EventSessionError`     | Session encountered error                           |
| `session.compacted` | `EventSessionCompacted` | Session history compacted                           |

### Session.Next Events (Streaming)

Emitted during `prompt()`, `command()`, `shell()` calls:

| Event                             | Payload                             | Meaning                   |
| --------------------------------- | ----------------------------------- | ------------------------- |
| `session.next.prompted`           | `EventSessionNextPrompted`          | Prompt received           |
| `session.next.agent_switched`     | `EventSessionNextAgentSwitched`     | Agent changed             |
| `session.next.model_switched`     | `EventSessionNextModelSwitched`     | Model changed             |
| `session.next.synthetic`          | `EventSessionNextSynthetic`         | Synthetic event           |
| `session.next.shell_started`      | `EventSessionNextShellStarted`      | Shell command started     |
| `session.next.shell_ended`        | `EventSessionNextShellEnded`        | Shell command ended       |
| `session.next.step_started`       | `EventSessionNextStepStarted`       | Step started              |
| `session.next.step_ended`         | `EventSessionNextStepEnded`         | Step ended                |
| `session.next.step_failed`        | `EventSessionNextStepFailed`        | Step failed               |
| `session.next.text_started`       | `EventSessionNextTextStarted`       | Text generation started   |
| `session.next.text_delta`         | `EventSessionNextTextDelta`         | Text chunk received       |
| `session.next.text_ended`         | `EventSessionNextTextEnded`         | Text generation ended     |
| `session.next.reasoning_started`  | `EventSessionNextReasoningStarted`  | Reasoning started         |
| `session.next.reasoning_delta`    | `EventSessionNextReasoningDelta`    | Reasoning chunk received  |
| `session.next.reasoning_ended`    | `EventSessionNextReasoningEnded`    | Reasoning ended           |
| `session.next.tool_input_started` | `EventSessionNextToolInputStarted`  | Tool input started        |
| `session.next.tool_input_delta`   | `EventSessionNextToolInputDelta`    | Tool input chunk received |
| `session.next.tool_input_ended`   | `EventSessionNextToolInputEnded`    | Tool input ended          |
| `session.next.tool_called`        | `EventSessionNextToolCalled`        | Tool called               |
| `session.next.tool_progress`      | `EventSessionNextToolProgress`      | Tool progress update      |
| `session.next.tool_success`       | `EventSessionNextToolSuccess`       | Tool succeeded            |
| `session.next.tool_failed`        | `EventSessionNextToolFailed`        | Tool failed               |
| `session.next.retried`            | `EventSessionNextRetried`           | Step retried              |
| `session.next.compaction_started` | `EventSessionNextCompactionStarted` | Compaction started        |
| `session.next.compaction_delta`   | `EventSessionNextCompactionDelta`   | Compaction progress       |
| `session.next.compaction_ended`   | `EventSessionNextCompactionEnded`   | Compaction ended          |

### Message Events

| Event                  | Payload                   | Trigger                 |
| ---------------------- | ------------------------- | ----------------------- |
| `message.updated`      | `EventMessageUpdated`     | Message content changed |
| `message.removed`      | `EventMessageRemoved`     | Message deleted         |
| `message.part.delta`   | `EventMessagePartDelta`   | Message part streaming  |
| `message.part.updated` | `EventMessagePartUpdated` | Message part updated    |
| `message.part.removed` | `EventMessagePartRemoved` | Message part deleted    |

### Permission & Question Events

| Event                | Payload                  | Trigger                   |
| -------------------- | ------------------------ | ------------------------- |
| `permission.asked`   | `EventPermissionAsked`   | Permission requested      |
| `permission.replied` | `EventPermissionReplied` | Permission granted/denied |
| `question.asked`     | `EventQuestionAsked`     | Question asked            |
| `question.replied`   | `EventQuestionReplied`   | Question answered         |
| `question.rejected`  | `EventQuestionRejected`  | Question rejected         |

### TUI Events

| Event                 | Payload                  | Trigger                     |
| --------------------- | ------------------------ | --------------------------- |
| `tui.prompt.append`   | `EventTuiPromptAppend`   | Text appended to TUI prompt |
| `tui.command.execute` | `EventTuiCommandExecute` | TUI command executed        |
| `tui.toast.show`      | `EventTuiToastShow1`     | Toast notification shown    |
| `tui.session.select`  | `EventTuiSessionSelect`  | Session selected in TUI     |

### Workspace & Worktree Events

| Event              | Payload                | Trigger                         |
| ------------------ | ---------------------- | ------------------------------- |
| `workspace.ready`  | `EventWorkspaceReady`  | Workspace initialized           |
| `workspace.failed` | `EventWorkspaceFailed` | Workspace initialization failed |
| `workspace.status` | `EventWorkspaceStatus` | Workspace status changed        |
| `worktree.ready`   | `EventWorktreeReady`   | Worktree created                |
| `worktree.failed`  | `EventWorktreeFailed`  | Worktree creation failed        |

### PTY Events

| Event         | Payload           | Trigger             |
| ------------- | ----------------- | ------------------- |
| `pty.created` | `EventPtyCreated` | PTY created         |
| `pty.updated` | `EventPtyUpdated` | PTY received output |
| `pty.exited`  | `EventPtyExited`  | PTY process exited  |
| `pty.deleted` | `EventPtyDeleted` | PTY closed          |

### File & LSP Events

| Event                    | Payload                     | Trigger                 |
| ------------------------ | --------------------------- | ----------------------- |
| `file.edited`            | `EventFileEdited`           | File edited             |
| `file.watcher.updated`   | `EventFileWatcherUpdated`   | File watcher triggered  |
| `lsp.updated`            | `EventLspUpdated`           | LSP diagnostics updated |
| `lsp.client.diagnostics` | `EventLspClientDiagnostics` | LSP client diagnostics  |

### MCP & Tool Events

| Event                     | Payload                     | Trigger                 |
| ------------------------- | --------------------------- | ----------------------- |
| `mcp.tools.changed`       | `EventMcpToolsChanged`      | Available tools changed |
| `mcp.browser.open_failed` | `EventMcpBrowserOpenFailed` | Browser open failed     |

### Project & VCS Events

| Event                | Payload                 | Trigger                |
| -------------------- | ----------------------- | ---------------------- |
| `project.updated`    | `EventProjectUpdated`   | Project config changed |
| `vcs.branch.updated` | `EventVcsBranchUpdated` | Git branch changed     |

### System Events

| Event                           | Payload                            | Trigger                  |
| ------------------------------- | ---------------------------------- | ------------------------ |
| `server.connected`              | `EventServerConnected`             | Server connected         |
| `server.instance.disposed`      | `EventServerInstanceDisposed`      | Server instance disposed |
| `global.disposed`               | `EventGlobalDisposed`              | Global disposed          |
| `command.executed`              | `EventCommandExecuted`             | Command executed         |
| `todo.updated`                  | `EventTodoUpdated`                 | Todo updated             |
| `installation.updated`          | `EventInstallationUpdated`         | Installation updated     |
| `installation.update_available` | `EventInstallationUpdateAvailable` | Update available         |

---

## Notable Gaps vs Desktop Needs

### ✅ What SDK v2 DOES Cover

- ✅ Full session lifecycle (create, list, get, delete, update, abort, share, fork)
- ✅ Message operations (list, get, delete, revert, unrevert)
- ✅ Streaming prompts/commands with SSE events
- ✅ Permission & question handling
- ✅ File operations (list, read, status)
- ✅ Search (files, text, symbols)
- ✅ MCP server management (connect, disconnect, add)
- ✅ Tool enumeration
- ✅ Provider & model listing
- ✅ Auth (OAuth, API key, well-known)
- ✅ Project & VCS info
- ✅ Workspace & worktree management
- ✅ PTY/shell operations
- ✅ TUI interaction (prompts, toasts, commands)
- ✅ LSP & formatter status
- ✅ Global config & upgrade
- ✅ Comprehensive SSE event stream

### ❌ What SDK v2 Does NOT Cover (Must Stay Custom)

1. **Desktop-specific IPC**
   - Window management (minimize, maximize, close)
   - Tray icon control
   - Native notifications (beyond TUI toasts)
   - Clipboard integration
   - File dialogs

2. **Electron-specific features**
   - Auto-update mechanism
   - Crash reporting
   - DevTools integration
   - Native menu bar
   - Keyboard shortcuts (OS-level)

3. **Session persistence & storage**
   - SQLite session history (SDK assumes server-side storage)
   - Local caching strategy
   - Offline mode
   - Session export/import

4. **UI state management**
   - Sidebar tree state (collapsed/expanded)
   - Panel layout (split panes, resizing)
   - Theme persistence
   - Window geometry

5. **Advanced session features**
   - Session snapshots (create/restore/diff) — **SDK v2 only** (not in v1)
   - Session compaction — **SDK v2 only**
   - Session context injection
   - Custom session metadata

6. **Provider-specific integrations**
   - GitHub OAuth flow (beyond generic OAuth)
   - GitLab integration
   - Jira integration
   - Slack integration

7. **Monitoring & diagnostics**
   - Performance metrics
   - Memory profiling
   - Network diagnostics
   - Error tracking

8. **Multi-instance coordination**
   - Lock files
   - Process communication
   - Singleton enforcement

---

## Migration Checklist

### Phase 1: Replace Session Management

- [ ] Replace custom session list/create/delete with `client.session.list()`, `create()`, `delete()`
- [ ] Replace session update logic with `client.session.update()`
- [ ] Replace message operations with `client.session.message()`, `messages()`, `deleteMessage()`
- [ ] Replace revert logic with `client.session.revert()`, `unrevert()`

### Phase 2: Replace Prompt/Command Handling

- [ ] Replace prompt sending with `client.session.prompt()` (with SSE streaming)
- [ ] Replace command execution with `client.session.command()`
- [ ] Replace shell execution with `client.session.shell()`
- [ ] Wire SSE event handlers for `session.next.*` events

### Phase 3: Replace Permission & Auth

- [ ] Replace permission handling with `client.permission.list()`, `reply()`
- [ ] Replace auth management with `client.auth.set()`, `remove()`
- [ ] Replace OAuth flow with `client.auth.oauth()` or `client.mcp.auth.start()`, `callback()`

### Phase 4: Replace File & Search

- [ ] Replace file listing with `client.file.list()`
- [ ] Replace file reading with `client.file.read()`
- [ ] Replace search with `client.find.files()`, `text()`, `symbols()`

### Phase 5: Replace MCP & Tools

- [ ] Replace tool enumeration with `client.tool.list()`
- [ ] Replace MCP management with `client.mcp.connect()`, `disconnect()`, `add()`

### Phase 6: Keep Custom (Desktop-specific)

- [ ] Keep IPC handlers for window management
- [ ] Keep Electron auto-update logic
- [ ] Keep SQLite session persistence layer
- [ ] Keep UI state management (sidebar, panels, theme)
- [ ] Keep native notification system

---

## Version Notes

- **SDK v2 Release**: May 2026
- **Breaking changes from v1**: Session snapshot API, compaction API, improved streaming
- **Recommended for**: New desktop integrations, migration from custom session management
- **Stability**: Production-ready

---

## References

- OpenCode Server Docs: https://opencode.ai/docs/server/
- OpenCode SDK Docs: https://opencode.ai/docs/sdk/
- OpenCode Agents: https://opencode.ai/docs/agents/
- OpenCode Config: https://opencode.ai/docs/config/
