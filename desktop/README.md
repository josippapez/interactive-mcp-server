# Name

### interactive-mcp-desktop

# Synopsis

Desktop app for Interactive MCP Server — SSE transport for Android Studio and other HTTP-based MCP clients

# Description

`interactive-mcp-desktop` is an Electron application that hosts an MCP server for HTTP/SSE-based MCP clients (Android Studio, Copilot CLI, Claude SDK, standalone agents) and provides a GUI for prompting, session history, and OpenCode integration.

Internally the app runs as two processes:

- A thin **main process** that owns the BrowserWindow, tray, preload, settings file IO, the OpenCode watchdog, and IPC handlers that act as bridge proxies.
- A long-lived **utility process** (`src/main/utility/entry.ts`, forked via `utilityProcess.fork`) that owns the MCP Express server and all tools, the in-process OpenCode HTTP server and SDK wrappers, the SSE event bridge, the session-tree service, the async session resolver, the durable prompt store, and a `better-sqlite3`-backed `conversations.db`.

Main and utility communicate over a typed `MessagePort` bridge (`src/main/utility/bridge.ts`) with request/emit/handle semantics and a 15s default RPC timeout. Renderer-facing IPC is unchanged — handlers proxy to the utility via `getUtilitySupervisor().getBridge().request(...)`, and utility-originated events reach the focused BrowserWindow via a supervisor-forwarded `'to-renderer'` envelope. The supervisor respawns the utility with backoff, capped at 3 consecutive failures within a 30s rolling window. See [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) for the full main ↔ utility split and RPC surface.

# Example

# Install:

`npm install interactive-mcp-desktop`

# Test:

`npm test`

#License:
