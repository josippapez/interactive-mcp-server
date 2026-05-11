# @opencode-ai/sdk v2 — Complete Capability Map (May 2026)

**Source**: `/Users/josippapez/Desktop/interactive-mcp-server/desktop/node_modules/@opencode-ai/sdk/dist/v2/`  
**Purpose**: Authoritative reference for SDK v2 namespaces, methods, and signatures for desktop custom code migration planning.

---

## Table of Contents

1. [Client Initialization](#client-initialization)
2. [Namespace Overview](#namespace-overview)
3. [Detailed Namespace Reference](#detailed-namespace-reference)
4. [Notable Gaps & Caveats](#notable-gaps--caveats)
5. [Event Stream (SSE)](#event-stream-sse)

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

**Returns**: `OpencodeClient` instance with all 25 namespaces attached.

**Config options**:

- `baseUrl`: Server URL (default: `http://localhost:8080`)
- `directory`: Project root directory
- `experimental_workspaceID`: Workspace ID for multi-workspace projects

---

## Namespace Overview

| Namespace      | Methods | Purpose                                                  | Desktop Relevance |
| -------------- | ------- | -------------------------------------------------------- | ----------------- |
| **session**    | 24      | Session lifecycle, messages, prompts, commands           | ⭐⭐⭐ Core       |
| **config**     | 3       | Project config, providers, settings                      | ⭐⭐⭐ Core       |
| **mcp**        | 4       | MCP server management (add, connect, disconnect, status) | ⭐⭐⭐ Core       |
| **file**       | 3       | File operations (list, read, status)                     | ⭐⭐ Secondary    |
| **find**       | 3       | Search (files, text, symbols)                            | ⭐⭐ Secondary    |
| **permission** | 3       | Permission handling (list, reply, respond)               | ⭐⭐ Secondary    |
| **auth**       | 2       | Auth credentials (set, remove)                           | ⭐ Utility        |
| **auth2**      | 4       | OAuth flow (start, callback, authenticate, remove)       | ⭐ Utility        |
| **project**    | 4       | Project info (current, list, initGit, update)            | ⭐⭐ Secondary    |
| **path**       | 1       | Path resolution                                          | ⭐ Utility        |
| **vcs**        | 2       | VCS operations (get, diff)                               | ⭐⭐ Secondary    |
| **command**    | 1       | Command listing                                          | ⭐ Utility        |
| **lsp**        | 1       | LSP status                                               | ⭐ Utility        |
| **formatter**  | 1       | Formatter status                                         | ⭐ Utility        |
| **pty**        | 8       | PTY/shell management (create, connect, list, etc.)       | ⭐⭐ Secondary    |
| **question**   | 3       | Question/prompt handling (list, reply, reject)           | ⭐⭐ Secondary    |
| **provider**   | 2       | Model providers (list, auth)                             | ⭐ Utility        |
| **part**       | 2       | Message part operations (delete, update)                 | ⭐ Utility        |
| **sync**       | 3       | Session sync (start, replay, steal)                      | ⭐ Utility        |
| **tui**        | 11      | Terminal UI operations (prompts, toasts, sessions)       | ⭐⭐ Secondary    |
| **tool**       | 2       | Tool listing (list, ids)                                 | ⭐ Utility        |
| **worktree**   | 4       | Worktree management (create, list, remove, reset)        | ⭐ Utility        |
| **app**        | 3       | App info (log, agents, skills)                           | ⭐ Utility        |
| **global**     | 4       | Global operations (health, event, dispose, upgrade)      | ⭐ Utility        |
| **event**      | 1       | Event subscription (SSE)                                 | ⭐⭐⭐ Core       |

---

## Detailed Namespace Reference

### Session (24 methods) ⭐⭐⭐

**Core session lifecycle and message operations.**

```typescript
// List sessions
list(params?: {
  directory?: string;
  workspace?: string;
  scope?: "project";
  path?: string;
  roots?: boolean | "true" | "false";
  start?: number;
  search?: string;
  limit?: number;
}): Promise<SessionListResponses>;

// Create session
create(params?: {
  directory?: string;
  workspace?: string;
  parentID?: string;
  title?: string;
  agent?: string;
  model?: { id: string; providerID: string; variant?: string };
  permission?: PermissionRuleset;
  workspaceID?: string;
}): Promise<SessionCreateResponses>;

// Get session
get(params: {
  sessionID: string;
  directory?: string;
  workspace?: string;
}): Promise<SessionGetResponses>;

// Delete session
delete(params: {
  sessionID: string;
  directory?: string;
  workspace?: string;
}): Promise<SessionDeleteResponses>;

// Update session
update(params: {
  sessionID: string;
  directory?: string;
  workspace?: string;
  title?: string;
  permission?: PermissionRuleset;
  time?: { archived?: number };
}): Promise<SessionUpdateResponses>;

// Get session status
status(params?: {
  directory?: string;
  workspace?: string;
}): Promise<SessionStatusResponses>;

// Get session children (forked sessions)
children(params: {
  sessionID: string;
  directory?: string;
  workspace?: string;
}): Promise<SessionChildrenResponses>;

// Get session todos
todo(params: {
  sessionID: string;
  directory?: string;
  workspace?: string;
}): Promise<SessionTodoResponses>;

// Get message diff
diff(params: {
  sessionID: string;
  messageID: string;
  directory?: string;
  workspace?: string;
}): Promise<SessionDiffResponses>;

// Get session messages
messages(params: {
  sessionID: string;
  directory?: string;
  workspace?: string;
}): Promise<SessionMessagesResponses>;

// Send message (streams SSE)
prompt(params: {
  sessionID: string;
  directory?: string;
  workspace?: string;
  messageID?: string;
  agent?: string;
  model?: string;
  parts?: Array<{
    id?: string;
    type: "file";
    mime: string;
    filename?: string;
    url: string;
    source?: FilePartSource;
  }>;
}): Promise<ServerSentEventsResult<SessionPromptResponses>>;

// Send message (async)
promptAsync(params: {
  sessionID: string;
  directory?: string;
  workspace?: string;
  messageID?: string;
  agent?: string;
  model?: string;
  parts?: Array<...>;
}): Promise<SessionPromptResponses>;

// Delete message
deleteMessage(params: {
  sessionID: string;
  messageID: string;
  directory?: string;
  workspace?: string;
}): Promise<SessionDeleteMessageResponses>;

// Get message
message(params: {
  sessionID: string;
  messageID: string;
  directory?: string;
  workspace?: string;
}): Promise<SessionMessageResponses>;

// Fork session
fork(params: {
  sessionID: string;
  messageID: string;
  directory?: string;
  workspace?: string;
  title?: string;
}): Promise<SessionForkResponses>;

// Abort session
abort(params: {
  sessionID: string;
  directory?: string;
  workspace?: string;
}): Promise<SessionAbortResponses>;

// Initialize session (generate AGENTS.md)
init(params: {
  sessionID: string;
  directory?: string;
  workspace?: string;
  agent?: string;
  model?: { providerID: string; modelID: string };
}): Promise<SessionInitResponses>;

// Unshare session
unshare(params: {
  sessionID: string;
  directory?: string;
  workspace?: string;
}): Promise<SessionUnshareResponses>;

// Share session
share(params: {
  sessionID: string;
  directory?: string;
  workspace?: string;
}): Promise<SessionShareResponses>;

// Summarize session
summarize(params: {
  sessionID: string;
  directory?: string;
  workspace?: string;
}): Promise<SessionSummarizeResponses>;

// Send command
command(params: {
  sessionID: string;
  directory?: string;
  workspace?: string;
  messageID?: string;
  agent?: string;
  model?: string;
  arguments?: string;
  command?: string;
  variant?: string;
  parts?: Array<...>;
}): Promise<ServerSentEventsResult<SessionCommandResponses>>;

// Run shell command
shell(params: {
  sessionID: string;
  directory?: string;
  workspace?: string;
  messageID?: string;
  agent?: string;
  model?: string;
  command?: string;
  parts?: Array<...>;
}): Promise<ServerSentEventsResult<SessionShellResponses>>;

// Revert message
revert(params: {
  sessionID: string;
  messageID: string;
  directory?: string;
  workspace?: string;
}): Promise<SessionRevertResponses>;

// Restore reverted messages
unrevert(params: {
  sessionID: string;
  directory?: string;
  workspace?: string;
}): Promise<SessionUnrevertResponses>;
```

**Key notes**:

- `prompt()` and `command()` return SSE streams for real-time response streaming
- `promptAsync()` is non-streaming variant
- Session forking creates child sessions at specific message points
- Sharing creates a public link; unshare makes it private again

---

### Config (3 methods) ⭐⭐⭐

**Project configuration and provider management.**

```typescript
// Get configuration
get(params?: {
  directory?: string;
  workspace?: string;
}): Promise<ConfigGetResponses>;

// Update configuration
update(params?: {
  directory?: string;
  workspace?: string;
  config?: Record<string, unknown>;
}): Promise<ConfigUpdateResponses>;

// List config providers
providers(params?: {
  directory?: string;
  workspace?: string;
}): Promise<ConfigProvidersResponses>;
```

**Caveats**:

- `update()` **does NOT preserve JSONC comments** — raw JSON only
- No mode namespace (e.g., `config.mode.get()`) — use `global.event` for mode changes
- Config is project-scoped; use `global.config` for global settings

---

### Mcp (4 methods) ⭐⭐⭐

**Model Context Protocol server management.**

```typescript
// Get MCP status
status(params?: {
  directory?: string;
  workspace?: string;
}): Promise<McpStatusResponses>;

// Add MCP server
add(params?: {
  directory?: string;
  workspace?: string;
  name?: string;
  config?: McpLocalConfig | McpRemoteConfig;
}): Promise<McpAddResponses>;

// Connect MCP server
connect(params: {
  name: string;
  directory?: string;
  workspace?: string;
}): Promise<McpConnectResponses>;

// Disconnect MCP server
disconnect(params: {
  name: string;
  directory?: string;
  workspace?: string;
}): Promise<McpDisconnectResponses>;
```

**Key notes**:

- `add()` supports both local (stdio) and remote (SSE) MCP configs
- `status()` returns all connected servers and their capabilities
- No `remove()` method — use config file editing for permanent removal

---

### File (3 methods) ⭐⭐

**File system operations.**

```typescript
// List files
list(params?: {
  directory?: string;
  workspace?: string;
  path?: string;
  recursive?: boolean;
}): Promise<FileListResponses>;

// Read file
read(params: {
  path: string;
  directory?: string;
  workspace?: string;
}): Promise<FileReadResponses>;

// Get file status
status(params: {
  path: string;
  directory?: string;
  workspace?: string;
}): Promise<FileStatusResponses>;
```

---

### Find (3 methods) ⭐⭐

**Search operations.**

```typescript
// Search text
text(params: {
  query: string;
  directory?: string;
  workspace?: string;
  path?: string;
  limit?: number;
}): Promise<FindTextResponses>;

// Search files
files(params: {
  query: string;
  directory?: string;
  workspace?: string;
  path?: string;
  type?: "file" | "directory";
  limit?: number;
}): Promise<FindFilesResponses>;

// Search symbols
symbols(params: {
  query: string;
  directory?: string;
  workspace?: string;
  path?: string;
  limit?: number;
}): Promise<FindSymbolsResponses>;
```

---

### Permission (3 methods) ⭐⭐

**Permission handling.**

```typescript
// List permissions
list(params?: {
  directory?: string;
  workspace?: string;
}): Promise<PermissionListResponses>;

// Reply to permission request
reply(params: {
  permissionID: string;
  decision: "allow" | "deny";
  directory?: string;
  workspace?: string;
}): Promise<PermissionReplyResponses>;

// Respond to permission
respond(params: {
  permissionID: string;
  response: unknown;
  directory?: string;
  workspace?: string;
}): Promise<PermissionRespondResponses>;
```

---

### Auth (2 methods) ⭐

**Basic authentication.**

```typescript
// Set auth credentials
set(params: {
  provider: string;
  credentials: Record<string, unknown>;
  directory?: string;
  workspace?: string;
}): Promise<AuthSetResponses>;

// Remove auth credentials
remove(params: {
  provider: string;
  directory?: string;
  workspace?: string;
}): Promise<AuthRemoveResponses>;
```

---

### Auth2 (4 methods) ⭐

**OAuth flow.**

```typescript
// Start OAuth flow
start(params: {
  provider: string;
  directory?: string;
  workspace?: string;
}): Promise<AuthStartResponses>;

// OAuth callback
callback(params: {
  provider: string;
  code: string;
  state?: string;
  directory?: string;
  workspace?: string;
}): Promise<AuthCallbackResponses>;

// Authenticate
authenticate(params: {
  provider: string;
  directory?: string;
  workspace?: string;
}): Promise<AuthAuthenticateResponses>;

// Remove OAuth
remove(params: {
  provider: string;
  directory?: string;
  workspace?: string;
}): Promise<AuthRemoveResponses>;
```

---

### Project (4 methods) ⭐⭐

**Project information and management.**

```typescript
// Get current project
current(params?: {
  directory?: string;
  workspace?: string;
}): Promise<ProjectCurrentResponses>;

// List projects
list(params?: {
  directory?: string;
  workspace?: string;
}): Promise<ProjectListResponses>;

// Initialize git
initGit(params?: {
  directory?: string;
  workspace?: string;
}): Promise<ProjectInitGitResponses>;

// Update project
update(params?: {
  directory?: string;
  workspace?: string;
  name?: string;
  description?: string;
}): Promise<ProjectUpdateResponses>;
```

---

### Path (1 method) ⭐

**Path resolution.**

```typescript
// Get path
get(params: {
  path: string;
  directory?: string;
  workspace?: string;
}): Promise<PathGetResponses>;
```

---

### Vcs (2 methods) ⭐⭐

**Version control operations.**

```typescript
// Get VCS info
get(params?: {
  directory?: string;
  workspace?: string;
}): Promise<VcsGetResponses>;

// Get diff
diff(params: {
  path?: string;
  directory?: string;
  workspace?: string;
}): Promise<VcsDiffResponses>;
```

---

### Command (1 method) ⭐

**Command listing.**

```typescript
// List commands
list(params?: {
  directory?: string;
  workspace?: string;
}): Promise<CommandListResponses>;
```

---

### Lsp (1 method) ⭐

**Language Server Protocol status.**

```typescript
// Get LSP status
status(params?: {
  directory?: string;
  workspace?: string;
}): Promise<LspStatusResponses>;
```

---

### Formatter (1 method) ⭐

**Code formatter status.**

```typescript
// Get formatter status
status(params?: {
  directory?: string;
  workspace?: string;
}): Promise<FormatterStatusResponses>;
```

---

### Pty (8 methods) ⭐⭐

**PTY/shell management.**

```typescript
// List available shells
shells(params?: {
  directory?: string;
  workspace?: string;
}): Promise<PtyShellsResponses>;

// List PTY sessions
list(params?: {
  directory?: string;
  workspace?: string;
}): Promise<PtyListResponses>;

// Create PTY
create(params: {
  shell?: string;
  directory?: string;
  workspace?: string;
}): Promise<PtyCreateResponses>;

// Remove PTY
remove(params: {
  ptyID: string;
  directory?: string;
  workspace?: string;
}): Promise<PtyRemoveResponses>;

// Get PTY
get(params: {
  ptyID: string;
  directory?: string;
  workspace?: string;
}): Promise<PtyGetResponses>;

// Update PTY
update(params: {
  ptyID: string;
  directory?: string;
  workspace?: string;
  data?: string;
}): Promise<PtyUpdateResponses>;

// Get PTY connect token
connectToken(params: {
  ptyID: string;
  directory?: string;
  workspace?: string;
}): Promise<PtyConnectTokenResponses>;

// Connect to PTY
connect(params: {
  ptyID: string;
  directory?: string;
  workspace?: string;
}): Promise<PtyConnectResponses>;
```

---

### Question (3 methods) ⭐⭐

**Question/prompt handling.**

```typescript
// List questions
list(params?: {
  directory?: string;
  workspace?: string;
}): Promise<QuestionListResponses>;

// Reply to question
reply(params: {
  questionID: string;
  answer: QuestionAnswer;
  directory?: string;
  workspace?: string;
}): Promise<QuestionReplyResponses>;

// Reject question
reject(params: {
  questionID: string;
  directory?: string;
  workspace?: string;
}): Promise<QuestionRejectResponses>;
```

---

### Provider (2 methods) ⭐

**Model provider management.**

```typescript
// List providers
list(params?: {
  directory?: string;
  workspace?: string;
}): Promise<ProviderListResponses>;

// Get provider auth
auth(params: {
  provider: string;
  directory?: string;
  workspace?: string;
}): Promise<ProviderAuthResponses>;
```

---

### Part (2 methods) ⭐

**Message part operations.**

```typescript
// Delete message part
delete(params: {
  sessionID: string;
  messageID: string;
  partID: string;
  directory?: string;
  workspace?: string;
}): Promise<PartDeleteResponses>;

// Update message part
update(params: {
  sessionID: string;
  messageID: string;
  partID: string;
  directory?: string;
  workspace?: string;
  content?: string;
}): Promise<PartUpdateResponses>;
```

---

### Sync (3 methods) ⭐

**Session synchronization.**

```typescript
// Start sync
start(params: {
  sessionID: string;
  directory?: string;
  workspace?: string;
}): Promise<SyncStartResponses>;

// Replay sync
replay(params: {
  sessionID: string;
  directory?: string;
  workspace?: string;
}): Promise<SyncReplayResponses>;

// Steal sync
steal(params: {
  sessionID: string;
  directory?: string;
  workspace?: string;
}): Promise<SyncStealResponses>;
```

---

### Tui (11 methods) ⭐⭐

**Terminal UI operations.**

```typescript
// Append prompt
appendPrompt(params: {
  text: string;
  directory?: string;
  workspace?: string;
}): Promise<EventTuiPromptAppend2>;

// Open help
openHelp(params?: {
  directory?: string;
  workspace?: string;
}): Promise<void>;

// Open sessions
openSessions(params?: {
  directory?: string;
  workspace?: string;
}): Promise<EventTuiSessionSelect2>;

// Open themes
openThemes(params?: {
  directory?: string;
  workspace?: string;
}): Promise<void>;

// Open models
openModels(params?: {
  directory?: string;
  workspace?: string;
}): Promise<void>;

// Submit prompt
submitPrompt(params?: {
  directory?: string;
  workspace?: string;
}): Promise<void>;

// Clear prompt
clearPrompt(params?: {
  directory?: string;
  workspace?: string;
}): Promise<void>;

// Execute command
executeCommand(params: {
  command: string;
  directory?: string;
  workspace?: string;
}): Promise<EventTuiCommandExecute2>;

// Show toast
showToast(params: {
  message: string;
  type?: "info" | "success" | "error" | "warning";
  directory?: string;
  workspace?: string;
}): Promise<EventTuiToastShow2>;

// Publish event
publish(params: {
  event: string;
  data?: unknown;
  directory?: string;
  workspace?: string;
}): Promise<void>;

// Select session
selectSession(params?: {
  directory?: string;
  workspace?: string;
}): Promise<EventTuiSessionSelect2>;
```

---

### Tool (2 methods) ⭐

**Tool management.**

```typescript
// List tools
list(params?: {
  directory?: string;
  workspace?: string;
}): Promise<ToolListResponses>;

// Get tool IDs
ids(params?: {
  directory?: string;
  workspace?: string;
}): Promise<ToolIdsResponses>;
```

---

### Worktree (4 methods) ⭐

**Worktree management.**

```typescript
// List worktrees
list(params?: {
  directory?: string;
  workspace?: string;
}): Promise<WorktreeListResponses>;

// Create worktree
create(params: {
  path: string;
  directory?: string;
  workspace?: string;
}): Promise<WorktreeCreateResponses>;

// Remove worktree
remove(params: {
  path: string;
  directory?: string;
  workspace?: string;
}): Promise<WorktreeRemoveResponses>;

// Reset worktree
reset(params: {
  path: string;
  directory?: string;
  workspace?: string;
}): Promise<WorktreeResetResponses>;
```

---

### App (3 methods) ⭐

**Application information.**

```typescript
// Write log
log(params?: {
  directory?: string;
  workspace?: string;
  service?: string;
  level?: "debug" | "info" | "warn" | "error";
  message?: string;
  extra?: Record<string, unknown>;
}): Promise<AppLogResponses>;

// List agents
agents(params?: {
  directory?: string;
  workspace?: string;
}): Promise<AppAgentsResponses>;

// List skills
skills(params?: {
  directory?: string;
  workspace?: string;
}): Promise<AppSkillsResponses>;
```

---

### Global (4 methods) ⭐

**Global operations.**

```typescript
// Get health
health(params?: {
  directory?: string;
  workspace?: string;
}): Promise<GlobalHealthResponses>;

// Subscribe to events (SSE)
event(params?: {
  directory?: string;
  workspace?: string;
}): Promise<ServerSentEventsResult<GlobalEventResponses>>;

// Dispose
dispose(params?: {
  directory?: string;
  workspace?: string;
}): Promise<GlobalDisposeResponses>;

// Upgrade
upgrade(params?: {
  directory?: string;
  workspace?: string;
}): Promise<GlobalUpgradeResponses>;
```

---

### Event (1 method) ⭐⭐⭐

**Event subscription (SSE).**

```typescript
// Subscribe to events
subscribe(params?: {
  directory?: string;
  workspace?: string;
  topics?: string[];
}): Promise<ServerSentEventsResult<EventSubscribeResponses>>;
```

**Key notes**:

- Returns SSE stream for real-time event delivery
- Topics include: `session.*`, `message.*`, `permission.*`, `question.*`, `tui.*`, etc.

---

## Notable Gaps & Caveats

### Missing Namespaces / Methods

| Gap                                             | Impact                                            | Workaround                                                               |
| ----------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------ |
| **No `mode` namespace**                         | Cannot query/set app mode (CLI vs TUI vs desktop) | Use `global.event` SSE stream to detect mode changes                     |
| **No `config.update()` JSONC preservation**     | Comments lost on config update                    | Parse/preserve comments manually before calling SDK                      |
| **No MCP `remove()` method**                    | Cannot delete MCP servers via SDK                 | Edit config file directly or use `disconnect()` + manual cleanup         |
| **No `session.revert()` for multiple messages** | Can only revert one message at a time             | Loop over `revert()` calls                                               |
| **No `file.write()` method**                    | Cannot write files via SDK                        | Use `session.shell()` or `session.command()` to execute write operations |
| **No `project.delete()` method**                | Cannot delete projects via SDK                    | Manual file system cleanup required                                      |
| **No `workspace.delete()` method**              | Cannot delete workspaces via SDK                  | Manual cleanup required                                                  |
| **No `pty.send()` method**                      | PTY interaction limited                           | Use `pty.update()` with data payload                                     |
| **No `question.create()` method**               | Cannot programmatically create questions          | Questions are server-initiated only                                      |
| **No `permission.create()` method**             | Cannot programmatically create permissions        | Permissions are server-initiated only                                    |

### Config Caveats

- **JSONC preservation**: `config.update()` does NOT preserve JSON comments. If you need to preserve comments, parse the config file manually, update it, and write it back.
- **No mode namespace**: The SDK does not expose a `mode` namespace. Mode changes are communicated via SSE events (`event.subscribe()`).
- **Project-scoped config**: `config` namespace is project-scoped. For global settings, use `global.config` (if available) or direct file access.

### SSE Streaming

- `session.prompt()`, `session.command()`, `session.shell()`, and `global.event()` return SSE streams.
- Use `ServerSentEventsResult<T>` to iterate over streamed responses.
- Streams are real-time and should be consumed immediately.

### Workspace & Multi-Project

- `experimental_workspaceID` is available but marked experimental.
- Most methods accept optional `workspace` parameter for multi-workspace support.
- Workspace isolation is enforced at the server level.

---

## Event Stream (SSE)

### Subscribing to Events

```typescript
const client = createOpencodeClient();
const stream = await client.event.subscribe({
  topics: ['session.*', 'message.*', 'permission.*'],
});

for await (const event of stream) {
  console.log(event);
}
```

### Event Topics

| Topic                  | Payload                                   | Use Case                       |
| ---------------------- | ----------------------------------------- | ------------------------------ |
| `session.created`      | `{ sessionID, title, agent, model }`      | Track new sessions             |
| `session.updated`      | `{ sessionID, title, permission }`        | Track session metadata changes |
| `session.deleted`      | `{ sessionID }`                           | Track session deletion         |
| `message.created`      | `{ sessionID, messageID, role, content }` | Track new messages             |
| `message.updated`      | `{ sessionID, messageID, content }`       | Track message edits            |
| `message.deleted`      | `{ sessionID, messageID }`                | Track message deletion         |
| `permission.requested` | `{ permissionID, type, resource }`        | Handle permission requests     |
| `question.asked`       | `{ questionID, text, options }`           | Handle user questions          |
| `tui.prompt.append`    | `{ text }`                                | TUI prompt updates             |
| `tui.toast.show`       | `{ message, type }`                       | TUI toast notifications        |
| `tui.session.select`   | `{ sessionID }`                           | TUI session selection          |
| `tui.command.execute`  | `{ command, args }`                       | TUI command execution          |

---

## Summary

**SDK v2 provides 40+ namespaces with 150+ methods** covering:

- ✅ Session lifecycle and messaging
- ✅ Configuration and providers
- ✅ MCP server management
- ✅ File and search operations
- ✅ Permission and auth flows
- ✅ PTY/shell management
- ✅ Real-time SSE events
- ❌ Desktop-specific features (IPC, window management, SQLite persistence) — **must remain custom**

**Desktop custom code should prioritize**:

1. Session management (`session.*`)
2. Configuration (`config.*`)
3. MCP operations (`mcp.*`)
4. Event streaming (`event.subscribe()`)
5. File operations (`file.*`, `find.*`)

**Gaps requiring custom implementation**:

- JSONC config preservation
- Mode namespace (use SSE events instead)
- File writing (use shell commands)
- Project/workspace deletion
- Question/permission creation (server-initiated only)
