# @opencode-ai/sdk v2 — Complete Method Signatures

**Reference**: All 150+ methods with full parameter and return type information.

---

## Session2 (18 methods)

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

// Initialize session
init(params: {
  sessionID: string;
  directory?: string;
  workspace?: string;
  agent?: string;
  model?: { providerID: string; modelID: string };
}): Promise<SessionInitResponses>;

// Send prompt (streams SSE)
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

// Send prompt (async)
promptAsync(params: {
  sessionID: string;
  directory?: string;
  workspace?: string;
  messageID?: string;
  agent?: string;
  model?: string;
  parts?: Array<...>;
}): Promise<SessionPromptResponses>;

// Send command (streams SSE)
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

// Execute shell command (streams SSE)
shell(params: {
  sessionID: string;
  directory?: string;
  workspace?: string;
  messageID?: string;
  agent?: string;
  model?: { providerID: string; modelID: string };
  command?: string;
}): Promise<ServerSentEventsResult<SessionShellResponses>>;

// Get message
message(params: {
  sessionID: string;
  directory?: string;
  workspace?: string;
  messageID?: string;
}): Promise<SessionMessageResponses>;

// List messages
messages(params: {
  sessionID: string;
  directory?: string;
  workspace?: string;
  start?: number;
  limit?: number;
}): Promise<SessionMessagesResponses>;

// Delete message
deleteMessage(params: {
  sessionID: string;
  messageID: string;
  directory?: string;
  workspace?: string;
}): Promise<SessionDeleteMessageResponses>;

// Revert message
revert(params: {
  sessionID: string;
  directory?: string;
  workspace?: string;
  messageID?: string;
  partID?: string;
}): Promise<SessionRevertResponses>;

// Restore reverted messages
unrevert(params: {
  sessionID: string;
  directory?: string;
  workspace?: string;
}): Promise<SessionUnrevertResponses>;

// Get session diff
diff(params: {
  sessionID: string;
  directory?: string;
  workspace?: string;
}): Promise<SessionDiffResponses>;

// Summarize session
summarize(params: {
  sessionID: string;
  directory?: string;
  workspace?: string;
}): Promise<SessionSummarizeResponses>;

// Abort session
abort(params: {
  sessionID: string;
  directory?: string;
  workspace?: string;
}): Promise<SessionAbortResponses>;

// Share session
share(params: {
  sessionID: string;
  directory?: string;
  workspace?: string;
}): Promise<SessionShareResponses>;

// Unshare session
unshare(params: {
  sessionID: string;
  directory?: string;
  workspace?: string;
}): Promise<SessionUnshareResponses>;

// Fork session
fork(params: {
  sessionID: string;
  directory?: string;
  workspace?: string;
  title?: string;
}): Promise<SessionForkResponses>;

// Get child sessions
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
```

---

## Part (2 methods)

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

## File (3 methods)

```typescript
// List files
list(params: {
  directory?: string;
  workspace?: string;
  path?: string;
  recursive?: boolean;
  limit?: number;
}): Promise<FileListResponses>;

// Read file
read(params: {
  directory?: string;
  workspace?: string;
  path: string;
  encoding?: string;
}): Promise<FileReadResponses>;

// Get file status
status(params?: {
  directory?: string;
  workspace?: string;
}): Promise<FileStatusResponses>;
```

---

## Find (3 methods)

```typescript
// Search files
files(params: {
  directory?: string;
  workspace?: string;
  query: string;
  limit?: number;
}): Promise<FindFilesResponses>;

// Search text
text(params: {
  directory?: string;
  workspace?: string;
  query: string;
  limit?: number;
}): Promise<FindTextResponses>;

// Search symbols
symbols(params: {
  directory?: string;
  workspace?: string;
  query: string;
  limit?: number;
}): Promise<FindSymbolsResponses>;
```

---

## Permission (3 methods)

```typescript
// List permissions
list(params?: {
  directory?: string;
  workspace?: string;
}): Promise<PermissionListResponses>;

// Reply to permission
reply(params: {
  permissionID: string;
  directory?: string;
  workspace?: string;
  allow?: boolean;
  always?: Array<string>;
}): Promise<PermissionReplyResponses>;

// Respond to permission (alias)
respond(params: {
  permissionID: string;
  directory?: string;
  workspace?: string;
  allow?: boolean;
  always?: Array<string>;
}): Promise<PermissionRespondResponses>;
```

---

## Auth (2 methods)

```typescript
// Set auth credentials
set(params: {
  providerID: string;
  auth?: OAuth | ApiAuth | WellKnownAuth;
}): Promise<AuthSetResponses>;

// Remove auth credentials
remove(params: {
  providerID: string;
}): Promise<AuthRemoveResponses>;
```

---

## Auth2 (4 methods)

```typescript
// Start OAuth flow
start(params: {
  name: string;
  directory?: string;
  workspace?: string;
}): Promise<McpAuthStartResponses>;

// Complete OAuth flow
callback(params: {
  name: string;
  code: string;
  directory?: string;
  workspace?: string;
}): Promise<McpAuthCallbackResponses>;

// Full OAuth flow
authenticate(params: {
  name: string;
  directory?: string;
  workspace?: string;
}): Promise<McpAuthAuthenticateResponses>;

// Remove OAuth credentials
remove(params: {
  name: string;
  directory?: string;
  workspace?: string;
}): Promise<McpAuthRemoveResponses>;
```

---

## Config (2 methods)

```typescript
// Get global config
get(options?: Options): Promise<GlobalConfigGetResponses>;

// Update global config
update(params?: {
  config?: Config;
}): Promise<GlobalConfigUpdateResponses>;
```

---

## Config2 (3 methods)

```typescript
// Get project config
get(params?: {
  directory?: string;
  workspace?: string;
}): Promise<ConfigGetResponses>;

// Update project config
update(params?: {
  directory?: string;
  workspace?: string;
  config?: Config;
}): Promise<ConfigUpdateResponses>;

// List providers
providers(params?: {
  directory?: string;
  workspace?: string;
}): Promise<ConfigProvidersResponses>;
```

---

## Provider (3 methods)

```typescript
// List providers
list(params?: {
  directory?: string;
  workspace?: string;
}): Promise<ProviderListResponses>;

// Get provider auth
auth(params: {
  providerID: string;
  directory?: string;
  workspace?: string;
}): Promise<ProviderAuthResponses>;

// Get provider OAuth
oauth(params: {
  providerID: string;
  directory?: string;
  workspace?: string;
}): Promise<ProviderOauthResponses>;
```

---

## Project (3 methods)

```typescript
// Get current project
current(params?: {
  directory?: string;
}): Promise<ProjectCurrentResponses>;

// List projects
list(params?: {
  directory?: string;
}): Promise<ProjectListResponses>;

// Initialize git
initGit(params?: {
  directory?: string;
}): Promise<ProjectInitGitResponses>;
```

---

## Path (1 method)

```typescript
// Get path info
get(params?: {
  directory?: string;
  workspace?: string;
}): Promise<PathGetResponses>;
```

---

## VCS (2 methods)

```typescript
// Get VCS info
get(params?: {
  directory?: string;
  workspace?: string;
}): Promise<VcsGetResponses>;

// Get VCS diff
diff(params?: {
  directory?: string;
  workspace?: string;
}): Promise<VcsDiffResponses>;
```

---

## Mcp (5 methods)

```typescript
// Get MCP status
status(params?: {
  directory?: string;
  workspace?: string;
}): Promise<McpStatusResponses>;

// Connect to MCP server
connect(params: {
  name: string;
  directory?: string;
  workspace?: string;
}): Promise<McpConnectResponses>;

// Disconnect from MCP server
disconnect(params: {
  name: string;
  directory?: string;
  workspace?: string;
}): Promise<McpDisconnectResponses>;

// Add MCP server
add(params: {
  name: string;
  config: McpLocalConfig | McpRemoteConfig;
  directory?: string;
  workspace?: string;
}): Promise<McpAddResponses>;

// Get MCP auth handler
auth(): Auth2;
```

---

## Tool (2 methods)

```typescript
// List tools
list(params: {
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

## Tui (11 methods)

```typescript
// Publish to TUI
publish(params?: {
  directory?: string;
  workspace?: string;
}): Promise<TuiPublishResponses>;

// Append to prompt
appendPrompt(params: {
  text: string;
  directory?: string;
  workspace?: string;
}): Promise<TuiAppendPromptResponses>;

// Clear prompt
clearPrompt(params?: {
  directory?: string;
  workspace?: string;
}): Promise<TuiClearPromptResponses>;

// Submit prompt
submitPrompt(params?: {
  directory?: string;
  workspace?: string;
}): Promise<TuiSubmitPromptResponses>;

// Show toast
showToast(params: {
  message: string;
  type?: "info" | "success" | "error" | "warning";
  duration?: number;
  directory?: string;
  workspace?: string;
}): Promise<TuiShowToastResponses>;

// Execute command
executeCommand(params: {
  command: string;
  directory?: string;
  workspace?: string;
}): Promise<TuiExecuteCommandResponses>;

// Select session
selectSession(params: {
  sessionID: string;
  directory?: string;
  workspace?: string;
}): Promise<TuiSelectSessionResponses>;

// Open sessions panel
openSessions(params?: {
  directory?: string;
  workspace?: string;
}): Promise<TuiOpenSessionsResponses>;

// Open models panel
openModels(params?: {
  directory?: string;
  workspace?: string;
}): Promise<TuiOpenModelsResponses>;

// Open themes panel
openThemes(params?: {
  directory?: string;
  workspace?: string;
}): Promise<TuiOpenThemesResponses>;

// Open help panel
openHelp(params?: {
  directory?: string;
  workspace?: string;
}): Promise<TuiOpenHelpResponses>;

// Get control handler
control(): Control;
```

---

## Question (3 methods)

```typescript
// List questions
list(params?: {
  directory?: string;
  workspace?: string;
}): Promise<QuestionListResponses>;

// Reply to question
reply(params: {
  questionID: string;
  answer: string;
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

## Workspace (5 methods)

```typescript
// List workspaces
list(params?: {
  directory?: string;
  workspace?: string;
}): Promise<ExperimentalWorkspaceListResponses>;

// Create workspace
create(params?: {
  directory?: string;
  workspace?: string;
  id?: string;
  type?: string;
  branch?: string | null;
  extra?: unknown | null;
}): Promise<ExperimentalWorkspaceCreateResponses>;

// Get workspace status
status(params?: {
  directory?: string;
  workspace?: string;
}): Promise<ExperimentalWorkspaceStatusResponses>;

// Remove workspace
remove(params: {
  id: string;
  directory?: string;
  workspace?: string;
}): Promise<ExperimentalWorkspaceRemoveResponses>;

// Warp session to workspace
warp(params?: {
  directory?: string;
  workspace?: string;
  sessionID?: string;
  targetWorkspace?: string;
}): Promise<ExperimentalWorkspaceWarpResponses>;
```

---

## Worktree (4 methods)

```typescript
// List worktrees
list(params?: {
  directory?: string;
  workspace?: string;
}): Promise<WorktreeListResponses>;

// Create worktree
create(params?: {
  directory?: string;
  workspace?: string;
  path?: string;
  branch?: string;
}): Promise<WorktreeCreateResponses>;

// Remove worktree
remove(params?: {
  directory?: string;
  workspace?: string;
  path?: string;
}): Promise<WorktreeRemoveResponses>;

// Reset worktree
reset(params?: {
  directory?: string;
  workspace?: string;
  path?: string;
}): Promise<WorktreeResetResponses>;
```

---

## Pty (8 methods)

```typescript
// List PTYs
list(params?: {
  directory?: string;
  workspace?: string;
}): Promise<PtyListResponses>;

// Create PTY
create(params?: {
  directory?: string;
  workspace?: string;
  shell?: string;
  cwd?: string;
}): Promise<PtyCreateResponses>;

// Get PTY
get(params: {
  ptyID: string;
  directory?: string;
  workspace?: string;
}): Promise<PtyGetResponses>;

// Update PTY (send input)
update(params: {
  ptyID: string;
  directory?: string;
  workspace?: string;
  input?: string;
}): Promise<PtyUpdateResponses>;

// Remove PTY
remove(params: {
  ptyID: string;
  directory?: string;
  workspace?: string;
}): Promise<PtyRemoveResponses>;

// List shells
shells(params?: {
  directory?: string;
  workspace?: string;
}): Promise<PtyShellsResponses>;

// Connect to PTY
connect(params: {
  ptyID: string;
  directory?: string;
  workspace?: string;
}): Promise<PtyConnectResponses>;

// Get PTY connection token
connectToken(params: {
  ptyID: string;
  directory?: string;
  workspace?: string;
}): Promise<PtyConnectTokenResponses>;
```

---

## Sync (4 methods)

```typescript
// Start sync
start(params?: {
  directory?: string;
  workspace?: string;
}): Promise<SyncStartResponses>;

// Get sync history
history(params?: {
  directory?: string;
  workspace?: string;
}): Promise<SyncHistoryResponses>;

// Replay session
replay(params?: {
  directory?: string;
  workspace?: string;
}): Promise<SyncReplayResponses>;

// Steal session
steal(params?: {
  directory?: string;
  workspace?: string;
}): Promise<SyncStealResponses>;
```

---

## Lsp (1 method)

```typescript
// Get LSP status
status(params?: {
  directory?: string;
  workspace?: string;
}): Promise<LspStatusResponses>;
```

---

## Formatter (1 method)

```typescript
// Get formatter status
status(params?: {
  directory?: string;
  workspace?: string;
}): Promise<FormatterStatusResponses>;
```

---

## App (3 methods)

```typescript
// Write log
log(params?: {
  directory?: string;
  workspace?: string;
  service?: string;
  level?: "debug" | "info" | "error" | "warn";
  message?: string;
  extra?: { [key: string]: unknown };
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

## Command (1 method)

```typescript
// List commands
list(params?: {
  directory?: string;
  workspace?: string;
}): Promise<CommandListResponses>;
```

---

## Event (1 method)

```typescript
// Subscribe to events
subscribe(params?: {
  directory?: string;
  workspace?: string;
  topics?: Array<string>;
}): Promise<ServerSentEventsResult<EventSubscribeResponses>>;
```

---

## Global (5 methods)

```typescript
// Check server health
health(options?: Options): Promise<GlobalHealthResponses>;

// Subscribe to all events (SSE)
event(options?: Options): Promise<ServerSentEventsResult<GlobalEventResponses>>;

// Dispose server
dispose(options?: Options): Promise<GlobalDisposeResponses>;

// Upgrade server
upgrade(params?: {
  version?: string;
}): Promise<GlobalUpgradeResponses>;

// Get config handler
config(): Config;
```

---

## Instance (1 method)

```typescript
// Dispose instance
dispose(options?: Options): Promise<InstanceDisposeResponses>;
```

---

## Additional Namespaces

### Experimental (4 methods)

- `console()` → Console
- `resource()` → Resource
- `session()` → Session
- `workspace()` → Workspace

### Console (3 methods)

- `get(params?: { directory?, workspace? })`
- `listOrgs(params?: { directory?, workspace? })`
- `switchOrg(params?: { directory?, workspace? })`

### Resource (1 method)

- `list(params?: { directory?, workspace? })`

### Adapter (1 method)

- `list(params?: { directory?, workspace? })`

### Control (2 methods)

- `next(params?: { directory?, workspace? })`
- `response(params?: { directory?, workspace? })`

### Oauth (2 methods)

- `authorize(params?: { directory?, workspace? })`
- `callback(params?: { directory?, workspace? })`

### History (1 method)

- `list(params?: { directory?, workspace? })`

### V2 (1 method)

- `session()` → Session2

---

## Type Definitions

### Auth Types

```typescript
type Auth = OAuth | ApiAuth | WellKnownAuth;

type OAuth = {
  type: 'oauth';
  refresh: string;
  access: string;
  expires: number;
  accountId?: string;
  enterpriseUrl?: string;
};

type ApiAuth = {
  type: 'api';
  key: string;
  metadata?: { [key: string]: string };
};

type WellKnownAuth = {
  type: 'wellknown';
  key: string;
  token: string;
};
```

### Permission Types

```typescript
type PermissionRequest = {
  id: string;
  sessionID: string;
  permission: string;
  patterns: Array<string>;
  metadata: { [key: string]: unknown };
  always: Array<string>;
  tool?: { messageID: string; callID: string };
};

type PermissionRuleset = {
  [permission: string]: {
    allow?: boolean;
    patterns?: Array<string>;
    always?: boolean;
  };
};
```

### Model Types

```typescript
type Model = {
  id: string;
  providerID: string;
  variant?: string;
};
```

---

## Error Handling

All methods return `RequestResult<Success, Error, ThrowOnError>`:

```typescript
// With throwOnError: false (default)
const result = await client.session.list();
if (result.error) {
  console.error(result.error);
} else {
  console.log(result.data);
}

// With throwOnError: true
try {
  const data = await client.session.list({}, { throwOnError: true });
  console.log(data);
} catch (error) {
  console.error(error);
}
```
