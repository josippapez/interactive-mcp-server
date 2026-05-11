# @opencode-ai/sdk v2 — Critical Method Signatures

**Purpose**: Exact TypeScript signatures for the 3 core namespaces (Session, Config, Mcp) and Event streaming.

**Date**: May 2026

---

## Session Namespace (24 methods)

### Core CRUD

```typescript
// List all sessions
session.list(params?: {
  directory?: string;
  workspace?: string;
  scope?: "project";
  path?: string;
  roots?: boolean | "true" | "false";
  start?: number;
  search?: string;
  limit?: number;
}): Promise<SessionListResponses>;

// Create new session
session.create(params?: {
  directory?: string;
  workspace?: string;
  parentID?: string;
  title?: string;
  agent?: string;
  model?: { id: string; providerID: string; variant?: string };
  permission?: PermissionRuleset;
  workspaceID?: string;
}): Promise<SessionCreateResponses>;

// Get session details
session.get(params: {
  sessionID: string;
  directory?: string;
  workspace?: string;
}): Promise<SessionGetResponses>;

// Update session metadata
session.update(params: {
  sessionID: string;
  directory?: string;
  workspace?: string;
  title?: string;
  permission?: PermissionRuleset;
  time?: { archived?: number };
}): Promise<SessionUpdateResponses>;

// Delete session
session.delete(params: {
  sessionID: string;
  directory?: string;
  workspace?: string;
}): Promise<SessionDeleteResponses>;

// Get session status
session.status(params?: {
  directory?: string;
  workspace?: string;
}): Promise<SessionStatusResponses>;
```

### Message Operations

```typescript
// Get all messages in session
session.messages(params: {
  sessionID: string;
  directory?: string;
  workspace?: string;
}): Promise<SessionMessagesResponses>;

// Get specific message
session.message(params: {
  sessionID: string;
  messageID: string;
  directory?: string;
  workspace?: string;
}): Promise<SessionMessageResponses>;

// Delete message
session.deleteMessage(params: {
  sessionID: string;
  messageID: string;
  directory?: string;
  workspace?: string;
}): Promise<SessionDeleteMessageResponses>;

// Get message diff (file changes)
session.diff(params: {
  sessionID: string;
  messageID: string;
  directory?: string;
  workspace?: string;
}): Promise<SessionDiffResponses>;
```

### Prompt & Command Execution

```typescript
// Send prompt (STREAMING SSE)
session.prompt(params: {
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

// Send prompt (ASYNC, non-streaming)
session.promptAsync(params: {
  sessionID: string;
  directory?: string;
  workspace?: string;
  messageID?: string;
  agent?: string;
  model?: string;
  parts?: Array<...>;
}): Promise<SessionPromptResponses>;

// Send command (STREAMING SSE)
session.command(params: {
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

// Run shell command (STREAMING SSE)
session.shell(params: {
  sessionID: string;
  directory?: string;
  workspace?: string;
  messageID?: string;
  agent?: string;
  model?: string;
  command?: string;
  parts?: Array<...>;
}): Promise<ServerSentEventsResult<SessionShellResponses>>;
```

### Session Lifecycle

```typescript
// Fork session at message point
session.fork(params: {
  sessionID: string;
  messageID: string;
  directory?: string;
  workspace?: string;
  title?: string;
}): Promise<SessionForkResponses>;

// Get child sessions (forked from this session)
session.children(params: {
  sessionID: string;
  directory?: string;
  workspace?: string;
}): Promise<SessionChildrenResponses>;

// Abort active session
session.abort(params: {
  sessionID: string;
  directory?: string;
  workspace?: string;
}): Promise<SessionAbortResponses>;

// Revert message (undo its effects)
session.revert(params: {
  sessionID: string;
  messageID: string;
  directory?: string;
  workspace?: string;
}): Promise<SessionRevertResponses>;

// Restore reverted messages
session.unrevert(params: {
  sessionID: string;
  directory?: string;
  workspace?: string;
}): Promise<SessionUnrevertResponses>;

// Initialize session (generate AGENTS.md)
session.init(params: {
  sessionID: string;
  directory?: string;
  workspace?: string;
  agent?: string;
  model?: { providerID: string; modelID: string };
}): Promise<SessionInitResponses>;
```

### Session Sharing & Metadata

```typescript
// Share session (create public link)
session.share(params: {
  sessionID: string;
  directory?: string;
  workspace?: string;
}): Promise<SessionShareResponses>;

// Unshare session (make private)
session.unshare(params: {
  sessionID: string;
  directory?: string;
  workspace?: string;
}): Promise<SessionUnshareResponses>;

// Summarize session
session.summarize(params: {
  sessionID: string;
  directory?: string;
  workspace?: string;
}): Promise<SessionSummarizeResponses>;

// Get session todos
session.todo(params: {
  sessionID: string;
  directory?: string;
  workspace?: string;
}): Promise<SessionTodoResponses>;
```

---

## Config Namespace (3 methods)

```typescript
// Get project configuration
config.get(params?: {
  directory?: string;
  workspace?: string;
}): Promise<ConfigGetResponses>;

// Update project configuration
// ⚠️ WARNING: Does NOT preserve JSONC comments
config.update(params?: {
  directory?: string;
  workspace?: string;
  config?: Record<string, unknown>;
}): Promise<ConfigUpdateResponses>;

// List configuration providers
config.providers(params?: {
  directory?: string;
  workspace?: string;
}): Promise<ConfigProvidersResponses>;
```

**Caveat**: `config.update()` **does NOT preserve JSONC comments**. If you need to preserve comments:

1. Read the config file directly
2. Parse it manually (e.g., with `jsonc-parser`)
3. Update the values
4. Write it back to disk
5. Do NOT use `config.update()`

---

## Mcp Namespace (4 methods)

```typescript
// Get MCP server status
mcp.status(params?: {
  directory?: string;
  workspace?: string;
}): Promise<McpStatusResponses>;

// Add new MCP server
mcp.add(params?: {
  directory?: string;
  workspace?: string;
  name?: string;
  config?: McpLocalConfig | McpRemoteConfig;
}): Promise<McpAddResponses>;

// Connect MCP server
mcp.connect(params: {
  name: string;
  directory?: string;
  workspace?: string;
}): Promise<McpConnectResponses>;

// Disconnect MCP server
mcp.disconnect(params: {
  name: string;
  directory?: string;
  workspace?: string;
}): Promise<McpDisconnectResponses>;
```

**Gap**: No `remove()` method. To remove an MCP server:

1. Call `mcp.disconnect()`
2. Edit the config file directly to remove the server definition
3. Restart the OpenCode server

---

## Event Namespace (1 method - SSE Streaming)

```typescript
// Subscribe to real-time events (STREAMING SSE)
event.subscribe(params?: {
  directory?: string;
  workspace?: string;
  topics?: string[];
}): Promise<ServerSentEventsResult<EventSubscribeResponses>>;
```

### Usage Example

```typescript
const stream = await client.event.subscribe({
  topics: ['session.*', 'message.*', 'permission.*'],
});

for await (const event of stream) {
  console.log(event.type, event.data);
  // Handle event
}
```

### Event Topics

| Topic                  | Payload                                   | When                     |
| ---------------------- | ----------------------------------------- | ------------------------ |
| `session.created`      | `{ sessionID, title, agent, model }`      | New session created      |
| `session.updated`      | `{ sessionID, title, permission }`        | Session metadata changed |
| `session.deleted`      | `{ sessionID }`                           | Session deleted          |
| `message.created`      | `{ sessionID, messageID, role, content }` | New message added        |
| `message.updated`      | `{ sessionID, messageID, content }`       | Message edited           |
| `message.deleted`      | `{ sessionID, messageID }`                | Message deleted          |
| `permission.requested` | `{ permissionID, type, resource }`        | Permission request       |
| `question.asked`       | `{ questionID, text, options }`           | User question            |
| `tui.prompt.append`    | `{ text }`                                | TUI prompt updated       |
| `tui.toast.show`       | `{ message, type }`                       | TUI toast shown          |
| `tui.session.select`   | `{ sessionID }`                           | TUI session selected     |
| `tui.command.execute`  | `{ command, args }`                       | TUI command executed     |

---

## Global Namespace (4 methods)

```typescript
// Get server health
global.health(params?: {
  directory?: string;
  workspace?: string;
}): Promise<GlobalHealthResponses>;

// Subscribe to global events (STREAMING SSE)
global.event(params?: {
  directory?: string;
  workspace?: string;
}): Promise<ServerSentEventsResult<GlobalEventResponses>>;

// Dispose resources
global.dispose(params?: {
  directory?: string;
  workspace?: string;
}): Promise<GlobalDisposeResponses>;

// Upgrade OpenCode
global.upgrade(params?: {
  directory?: string;
  workspace?: string;
}): Promise<GlobalUpgradeResponses>;
```

---

## Client Initialization

```typescript
import { createOpencodeClient } from '@opencode-ai/sdk';

const client = createOpencodeClient({
  baseUrl: 'http://localhost:8080', // default
  directory: process.cwd(),
  experimental_workspaceID: 'workspace-id', // optional
});

// Access namespaces
client.session.list();
client.config.get();
client.mcp.status();
client.event.subscribe();
```

---

## SSE Stream Handling

### Pattern: Consuming SSE Streams

```typescript
// Streaming prompt
const stream = await client.session.prompt({
  sessionID: 'ses_123',
});

for await (const chunk of stream) {
  console.log('Chunk:', chunk);
  // Update UI in real-time
}
```

### Pattern: Streaming Events

```typescript
// Streaming events
const stream = await client.event.subscribe({
  topics: ['session.*', 'message.*'],
});

for await (const event of stream) {
  console.log('Event:', event.type, event.data);
  // Handle event
}
```

### Pattern: Error Handling

```typescript
try {
  const stream = await client.session.prompt({
    sessionID: 'ses_123',
  });

  for await (const chunk of stream) {
    // Process chunk
  }
} catch (error) {
  console.error('Stream error:', error);
  // Handle error
}
```

---

## Type Definitions

### Response Types

```typescript
// Session responses
type SessionListResponses = { data: Session[] };
type SessionCreateResponses = { data: Session };
type SessionGetResponses = { data: Session };
type SessionUpdateResponses = { data: Session };
type SessionDeleteResponses = { data: { success: boolean } };
type SessionStatusResponses = { data: SessionStatus };
type SessionMessagesResponses = { data: Message[] };
type SessionMessageResponses = { data: Message };
type SessionPromptResponses = { type: string; data: unknown };
type SessionCommandResponses = { type: string; data: unknown };
type SessionShellResponses = { type: string; data: unknown };

// Config responses
type ConfigGetResponses = { data: Record<string, unknown> };
type ConfigUpdateResponses = { data: Record<string, unknown> };
type ConfigProvidersResponses = { data: Provider[] };

// MCP responses
type McpStatusResponses = { data: McpServer[] };
type McpAddResponses = { data: McpServer };
type McpConnectResponses = { data: { success: boolean } };
type McpDisconnectResponses = { data: { success: boolean } };

// Event responses
type EventSubscribeResponses = { type: string; data: unknown };
```

### SSE Stream Type

```typescript
type ServerSentEventsResult<T> = AsyncIterable<T>;

// Usage
for await (const event of stream) {
  // event is of type T
}
```

---

## Error Handling

```typescript
import { createOpencodeClient } from '@opencode-ai/sdk';

const client = createOpencodeClient();

try {
  const result = await client.session.create({
    title: 'New Session',
  });
  console.log('Created:', result.data);
} catch (error) {
  if (error.status === 404) {
    console.error('Session not found');
  } else if (error.status === 401) {
    console.error('Unauthorized');
  } else {
    console.error('Error:', error.message);
  }
}
```

---

## Key Takeaways

1. **Session namespace** has 24 methods covering CRUD, messaging, execution, and lifecycle
2. **Config namespace** has 3 methods but **does NOT preserve JSONC comments**
3. **Mcp namespace** has 4 methods but **no remove() method**
4. **Event namespace** provides real-time SSE streaming
5. **SSE streams** are async iterables — use `for await...of`
6. **All methods** accept optional `directory` and `workspace` parameters
7. **Streaming methods** return `ServerSentEventsResult<T>` (async iterable)
8. **Error handling** uses standard HTTP status codes
