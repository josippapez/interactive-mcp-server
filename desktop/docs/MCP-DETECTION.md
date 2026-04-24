# MCP Detection & Per-Project Configuration

This document describes how OpenCode handles MCP server detection and per-project configuration, and proposes solutions for the Interactive MCP Desktop app to support dynamic MCP registration across different project directories.

---

## Table of Contents

1. [OpenCode Server Architecture](#opencode-server-architecture)
2. [OpenCode Desktop App Architecture](#opencode-desktop-app-architecture)
3. [How OpenCode Handles Per-Project MCPs](#how-opencode-handles-per-project-mcps)
4. [Interactive MCP Desktop Current State](#interactive-mcp-desktop-current-state)
5. [The Problem](#the-problem)
6. [Proposed Solutions](#proposed-solutions)
7. [Implementation Recommendations](#implementation-recommendations)

---

## OpenCode Server Architecture

### Single Server, Per-Directory Instances

OpenCode runs a **single Hono HTTP server** (default port 4096) but uses **AsyncLocalStorage (ALS)** via the `Instance` abstraction to provide per-directory isolation.

```
┌─────────────────────────────────────────────────────────────┐
│                    OpenCode HTTP Server                      │
│                      (port 4096)                             │
├─────────────────────────────────────────────────────────────┤
│  AsyncLocalStorage (Instance)                                │
│  ├── /path/to/project-a → InstanceState (MCPs, Config, etc) │
│  ├── /path/to/project-b → InstanceState (MCPs, Config, etc) │
│  └── /path/to/project-c → InstanceState (MCPs, Config, etc) │
└─────────────────────────────────────────────────────────────┘
```

**Key files:**

- `packages/opencode/src/server/server.ts:18-109` - Hono HTTP server
- `packages/opencode/src/effect/instance-state.ts:39-60` - Per-directory cached state
- `packages/opencode/src/server/instance/middleware.ts:49-50` - Directory detection from query param/header/cwd

### MCP Server Lifecycle

MCP servers are **per-instance/per-directory** — not global.

| Type       | Transport                           | Code Reference                               |
| ---------- | ----------------------------------- | -------------------------------------------- |
| Local MCP  | `StdioClientTransport` (subprocess) | `packages/opencode/src/mcp/index.ts:392-422` |
| Remote MCP | `StreamableHTTPClientTransport`     | `packages/opencode/src/mcp/index.ts:282-390` |

**Cleanup:** Effect finalizers automatically terminate MCP processes when the instance is disposed (`mcp/index.ts:531-551`).

### Dynamic MCP Management API

OpenCode exposes REST endpoints for runtime MCP management:

| Endpoint                   | Method | Purpose                       |
| -------------------------- | ------ | ----------------------------- |
| `/mcp`                     | GET    | Get status of all MCP servers |
| `/mcp`                     | POST   | Add MCP server dynamically    |
| `/mcp/:name/connect`       | POST   | Connect/reconnect             |
| `/mcp/:name/disconnect`    | POST   | Disconnect                    |
| `/mcp/:name/auth`          | POST   | Start OAuth flow              |
| `/mcp/:name/auth/callback` | POST   | Complete OAuth                |
| `/mcp/:name/auth`          | DELETE | Remove OAuth credentials      |

**Code reference:** `packages/opencode/src/server/instance/mcp.ts:9-225`

---

## OpenCode Desktop App Architecture

> **Note:** This section describes the **official OpenCode desktop app** (the Tauri-based `packages/desktop/` reference implementation) for comparison. The Interactive MCP Desktop app (this repo) takes a different approach: since Phase C it loads the OpenCode server bundle in-process via `Server.listen()` rather than spawning a CLI sidecar. See [`ARCHITECTURE.md` — OpenCode server runs in-process](./ARCHITECTURE.md#opencode-server-runs-in-process-phase-c).

The official OpenCode desktop app (`packages/desktop/`) uses **Tauri** (Rust backend + web frontend).

### How It Spawns OpenCode

The desktop app **spawns a sidecar process** — a bundled OpenCode CLI binary:

```rust
// packages/desktop/src-tauri/src/cli.rs:552-607
pub fn serve(app: &AppHandle, hostname: &str, port: u32, password: &str) {
    let (events, child) = spawn_command(
        app,
        format!("serve --hostname {hostname} --port {port}").as_str(),
        &envs,
    );
}
```

**Key characteristics:**

1. **Single sidecar instance** — spawned on app launch via `spawn_local_server()`
2. **Random port** — finds an available port via `TcpListener::bind("127.0.0.1:0")`
3. **Password-protected** — uses basic auth with a UUID password
4. **No per-project spawning** — the same sidecar serves all projects

### Config Loading

The sidecar loads configs hierarchically:

1. Global: `~/.config/opencode/opencode.json`
2. Project: `.opencode/opencode.jsonc` in the working directory

**The working directory is determined at spawn time** — the desktop app does not change directories after launch.

---

## How OpenCode Handles Per-Project MCPs

### Config Merge Order

```
┌─────────────────────────────────────────────┐
│ 1. System managed config (highest priority) │
│    /Library/Application Support/opencode    │
├─────────────────────────────────────────────┤
│ 2. Global config                            │
│    ~/.config/opencode/opencode.json         │
├─────────────────────────────────────────────┤
│ 3. Project config                           │
│    .opencode/opencode.jsonc                 │
└─────────────────────────────────────────────┘
```

**Code reference:** `packages/opencode/src/config/config.ts:1323-1540`

### Instance State

Each project directory gets isolated state via `InstanceState`:

```typescript
// 22+ services use this pattern
InstanceState.make<T>({
  make: Effect.fn(function* () {
    // Per-directory initialization
    // Cached by ScopedCache keyed by directory path
  }),
});
```

Services using InstanceState:

- MCP connections
- Config
- Sessions
- LSP servers
- Formatters
- And more (22+ total)

---

## Interactive MCP Desktop Current State

### How It Connects to OpenCode

| Method | Endpoint                           | Purpose                                                                                                     |
| ------ | ---------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| SSE    | `/global/event`                    | Real-time session events (both in-process `Bus` events and versioned sync events share this unified stream) |
| REST   | `GET /session?directory=<dir>`     | Find sessions for a project                                                                                 |
| Config | `~/.config/opencode/opencode.json` | Register as MCP server                                                                                      |

**Code references:**

- `desktop/src/main/session/session-tree-service.ts` — SSE subscription (+ `desktop/src/main/session/sse-handlers.ts` for per-event dispatch)
- `desktop/src/main/opencode/session.ts:115-146` — REST API queries
- `desktop/src/main/opencode/config-sync.ts:52-172` — Config file sync

### Session Tracking

The app tracks sessions with `baseDirectory`:

```sql
-- desktop/src/main/database.ts:169-182
CREATE TABLE registered_connections (
  provider_type        TEXT NOT NULL,
  provider_session_id  TEXT NOT NULL,
  connection_id        TEXT,
  agent_name           TEXT NOT NULL,
  project_name         TEXT NOT NULL,
  base_directory       TEXT,          -- ← Project directory
  parent_session_id    TEXT,
  PRIMARY KEY (provider_type, provider_session_id)
)
```

### Current Limitations

1. **No per-project MCP awareness** — the desktop app doesn't read `.opencode/` configs from different directories
2. **Static MCP registration** — only registers itself (`interactive-desktop`) via config file
3. **No project switcher** — no UI to activate MCPs from other projects

---

## The Problem

When starting OpenCode from directory A, MCPs from directory B's `.opencode/opencode.jsonc` are not available.

**Example scenario:**

- User launches OpenCode from `/Users/josippapez` (home directory)
- Global config only has `interactive-desktop`, `context7`, `interactive-mcp` MCPs
- Sciensus project at `/Volumes/encrypted/Sciensus.Digital.Core.NX` has ADO, Figma, mobile-mcp, chrome-devtools MCPs
- These project-specific MCPs are **not loaded**

---

## Proposed Solutions

### Option A: Project Switcher UI

Add a feature to detect `.opencode/` configs in different directories and provide a UI to activate/deactivate project-specific MCPs.

**Implementation:**

1. Scan known project directories for `.opencode/opencode.jsonc`
2. Show a project picker in the desktop app sidebar
3. When activated, call OpenCode's `POST /mcp` API to add each MCP
4. When deactivated, call `POST /mcp/:name/disconnect`

**Pros:**

- User-controlled
- Clear visibility of which MCPs are active
- No background scanning

**Cons:**

- Manual activation required
- Need to maintain project list

```typescript
// Proposed API
interface ProjectConfig {
  path: string;
  name: string;
  mcps: Record<string, McpConfig>;
}

async function activateProjectMcps(project: ProjectConfig): Promise<void> {
  for (const [name, config] of Object.entries(project.mcps)) {
    await fetch(`http://localhost:${openCodePort}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, config }),
    });
  }
}
```

---

### Option B: Auto-Inject MCPs on baseDirectory

When a session registers with a `baseDirectory`, automatically read that directory's `.opencode/opencode.jsonc` and inject those MCPs.

**Implementation:**

1. On `register_connection`, check if `baseDirectory` contains `.opencode/opencode.jsonc`
2. Parse the config and extract MCP definitions
3. Call `POST /mcp` for each MCP that isn't already registered
4. Track which MCPs were auto-injected for cleanup

**Pros:**

- Automatic — no user action needed
- Works with existing `register_connection` flow
- Session-aware

**Cons:**

- MCPs may conflict between sessions
- Cleanup complexity
- Potential for duplicate spawning

```typescript
// Proposed implementation in register-connection.ts
async function autoInjectProjectMcps(
  baseDirectory: string,
  openCodePort: number,
): Promise<string[]> {
  const configPath = path.join(baseDirectory, '.opencode', 'opencode.jsonc');
  if (!fs.existsSync(configPath)) return [];

  const config = JSON5.parse(fs.readFileSync(configPath, 'utf8'));
  const injectedMcps: string[] = [];

  for (const [name, mcpConfig] of Object.entries(config.mcp ?? {})) {
    await fetch(`http://localhost:${openCodePort}/mcp`, {
      method: 'POST',
      body: JSON.stringify({ name, config: mcpConfig }),
    });
    injectedMcps.push(name);
  }

  return injectedMcps;
}
```

---

### Option C: Multi-Instance OpenCode Support

The desktop app could manage multiple OpenCode server instances (one per project directory).

> **Note:** Since Phase C, the app starts a **single in-process** OpenCode server by dynamic-importing the bundled server and calling `Server.listen({ port, hostname: '127.0.0.1' })` — there is no `opencode serve` subprocess. Multi-instance support would therefore run as multiple in-process listeners on different ports (each with its own `XDG_STATE_HOME` / `cwd` override), not as multiple spawned CLI processes.

**Implementation:**

1. Track multiple in-process `Server.listen()` instances with different working directories
2. Each instance loads its own `.opencode/` config
3. Route MCP tool calls to the correct instance based on `baseDirectory`

**Pros:**

- Complete isolation between projects
- Each project gets its native MCP configuration
- Mirrors OpenCode CLI behavior exactly

**Cons:**

- Higher resource usage (multiple in-process servers per Electron main process)
- Complex routing logic
- Session management complexity
- Per-instance `XDG_STATE_HOME` / `process.chdir()` juggling in a single Node.js process

```typescript
// Proposed architecture — note: in-process, no child process
interface OpenCodeInstance {
  port: number;
  baseDirectory: string;
  sessions: Set<string>;
  stop: () => Promise<void>;
}

const instances = new Map<string, OpenCodeInstance>();

async function getOrStartInstance(
  baseDirectory: string,
): Promise<OpenCodeInstance> {
  const existing = instances.get(baseDirectory);
  if (existing) return existing;

  const port = await findFreePort();
  // Dynamic import of the bundled OpenCode server (see desktop/src/main/opencode/server.ts)
  const { Server } = await import('virtual:opencode-server');
  const handle = await Server.listen({ port, hostname: '127.0.0.1' });

  const instance: OpenCodeInstance = {
    port,
    baseDirectory,
    sessions: new Set(),
    stop: () => handle.close(),
  };

  instances.set(baseDirectory, instance);
  return instance;
}
```

---

## Implementation Recommendations

### Short-Term (Option B - Recommended)

**Auto-inject on baseDirectory** is the quickest to implement and integrates naturally with the existing flow:

1. Modify `register_connection` tool handler
2. Read `.opencode/opencode.jsonc` from `baseDirectory`
3. Call OpenCode's `POST /mcp` API for each discovered MCP
4. Store injected MCP names in the session record for later cleanup

### Medium-Term (Option A + B)

Combine auto-injection with a UI for visibility:

1. Show auto-injected MCPs in a "Project MCPs" section in the sidebar
2. Allow manual enable/disable
3. Show which MCPs are active per session

### Long-Term (Option C)

For full project isolation, implement multi-instance support:

1. Start an in-process `Server.listen()` per unique `baseDirectory` (see [`ARCHITECTURE.md`](./ARCHITECTURE.md#opencode-server-runs-in-process-phase-c))
2. Route all API calls based on session → instance mapping
3. Close instances when all sessions close

---

## References

| File                                             | Description                         |
| ------------------------------------------------ | ----------------------------------- |
| `packages/opencode/src/server/instance/mcp.ts`   | Dynamic MCP management API          |
| `packages/opencode/src/config/config.ts`         | Config loading and merge            |
| `packages/opencode/src/mcp/index.ts`             | MCP client implementation           |
| `packages/opencode/src/effect/instance-state.ts` | Per-directory state isolation       |
| `packages/desktop/src-tauri/src/cli.rs`          | Sidecar spawning (official desktop) |
| `desktop/src/main/tools/register-connection.ts`  | Connection registration             |
| `desktop/src/main/opencode/config-sync.ts`       | OpenCode config sync                |
