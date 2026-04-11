# OpenCode Integration Features Roadmap

This document tracks the implementation of OpenCode server API features in the interactive-mcp-desktop app.

## Completed Features

### 1. Session Management (via `/session` API) ✅

**Status**: Already implemented  
**Files**:

- `src/main/opencode-session.ts` - Session detection and fetching
- `src/main/session-tree-manager.ts` - Maintains session tree cache, subscribes to sync events

**Current behavior**:

- Uses `/session` endpoint to list all OpenCode sessions
- Uses `/session?directory=<dir>` for directory-scoped queries
- Sessions are displayed in the sidebar under "SESSIONS" group
- Real-time updates via `/global/sync-event` SSE stream

### 2. Todo List Display ✅

**Status**: Implemented (needs port configuration fix)  
**Files**:

- `src/main/opencode-todo.ts` - Fetches todos from `/session/:id/todo`
- `src/main/ipc-handlers.ts` - `fetch-session-todos` handler (line ~630)
- `src/renderer/src/hooks/useTodos.ts` - React hook with 5s polling
- `src/renderer/src/components/prompt/TodoList.tsx` - UI component with collapsible list
- `src/renderer/src/pages/PromptView.tsx` - Integration point

**Features**:

- Shows tasks grouped by status (in_progress → pending → completed → cancelled)
- Priority indicators (↑ high, → medium, ↓ low)
- Collapsible panel with badge showing active task count
- Fixed height (max-h-48) with scrollable overflow
- 5-second polling for updates

**Issue**: Ensure `openCodePort` in settings matches OpenCode's configured port (default: 4096)

### 3. VCS Info in Header ✅

**Status**: Implemented (using `/vcs` API)  
**API Endpoint**: `GET /vcs`  
**Response**: `{ branch: string, default_branch: string }`

**Files**:

- `src/main/opencode-vcs.ts` - API call to `/vcs` endpoint
- `src/main/ipc-handlers.ts` - `fetch-vcs-info` IPC handler
- `src/preload/index.ts` - `fetchVcsInfo` API exposed to renderer
- `src/renderer/src/hooks/useVcsInfo.ts` - React hook with 30s polling
- `src/renderer/src/components/prompt/ChannelHeader.tsx` - `VcsBadge` component
- `src/renderer/src/pages/PromptView.tsx` - Uses `useVcsInfo` hook

**Features**:

- Shows git branch name from `/vcs` API (reliable, no parsing needed)
- Badge appears in channel header
- 30-second polling interval
- Only shows when OpenCode backend is enabled

---

## In Progress Features

### 4. Abort Session Button ✅

**Status**: Implemented  
**API Endpoint**: `POST /session/:id/abort`

**Files**:

- `src/main/opencode-abort.ts` - API call to abort OpenCode session
- `src/main/ipc-handlers.ts` - `abort-session` IPC handler (line ~650)
- `src/preload/index.ts` - `abortSession` API exposed to renderer
- `src/renderer/src/components/ConfirmAbortModal.tsx` - Confirmation dialog
- `src/renderer/src/components/prompt/ChannelHeader.tsx` - Abort button UI
- `src/renderer/src/pages/PromptView.tsx` - Abort handler integration

**Features**:

- Stop button (filled square icon) appears in channel header for OpenCode sessions
- Only shows when `canAbort` is true (i.e., session has an `openCodeSessionId`)
- Confirmation dialog before aborting ("Abort session?")
- Calls `POST /session/:id/abort` which returns boolean success
- Session remains but current task is interrupted

### 5. Real-time Events Investigation

**Status**: Investigated ✅  
**API Endpoint**: `GET /global/event` (SSE stream)

**Current usage** (`src/main/opencode-bus-events.ts`):

- `permission.asked` - Permission requests from OpenCode
- `permission.replied` - Permission reply confirmations
- `session.status` - Session status updates

**Discovered events**:

- `server.connected` - Emitted when a client connects to the SSE stream

**Session sync events** (`/global/sync-event` - already used in `session-tree-manager.ts`):

- `session.created.1` - New session created
- `session.updated.1` - Session updated
- `session.deleted.1` - Session deleted

**Findings**:

- Todo updates are NOT available via SSE - polling is required (current 5s interval is appropriate)
- VCS changes are NOT available via SSE
- The `/global/event` stream is primarily for permission handling and session status
- The `/global/sync-event` stream is for session lifecycle events (already fully integrated)

**Recommendation**: Current implementation is complete. No additional events to integrate.

### 6. Config API for MCP Registration

**Status**: Investigated ✅  
**API Endpoint**: `GET /config` (read-only)

**Current behavior** (`src/main/opencode-config-sync.ts`):

- Manually patches `~/.config/opencode/opencode.json`
- Adds `interactive-desktop` MCP server entry with `type: remote`

**Investigation findings**:

The `/config` API returns the merged configuration (global + local) but appears to be **read-only**:

- Returns complete merged config including `mcp`, `agent`, `plugin`, `skills`, etc.
- No PATCH/PUT endpoint was found for modifying config via API
- The API returns runtime state (e.g., resolved plugin paths) which differs from the on-disk format

**Recommendation**: Keep the current file-patching approach in `opencode-config-sync.ts`:

1. It's reliable and well-tested
2. The Config API doesn't support writes
3. File patching allows precise control over the `interactive-desktop` entry
4. The backup approach via `POST /mcp` dynamic registration is already implemented

---

## Pending Features

### 7. Health Check Indicator ✅

**Status**: Completed  
**API Endpoint**: `GET /global/health`
**Response**: `{ healthy: true, version: string }`

**Implementation**:

- ✅ `src/main/opencode-health.ts` - Health check API call
- ✅ `src/main/ipc-handlers.ts` - `check-opencode-health` IPC handler
- ✅ `src/preload/index.ts` - `checkOpenCodeHealth` API exposed
- ✅ `src/renderer/src/hooks/useOpenCodeHealth.ts` - React hook with 10s polling
- ✅ `src/renderer/src/components/StatusBar.tsx` - Health indicator in footer

**Features**:

- Green dot = connected & healthy
- Yellow dot = available but unhealthy
- Red dot = not available
- Shows OpenCode version on hover
- Click refresh button to check manually
- 10-second polling interval
- Only shows when OpenCode backend is enabled

### 8. Direct VCS API ✅

**Status**: Completed  
**API Endpoint**: `GET /vcs`
**Response**: `{ branch: string, default_branch: string }`

**Implementation**:

- ✅ `src/main/opencode-vcs.ts` - VCS API call
- ✅ `src/main/ipc-handlers.ts` - `fetch-vcs-info` IPC handler
- ✅ `src/preload/index.ts` - `fetchVcsInfo` API exposed
- ✅ `src/renderer/src/hooks/useVcsInfo.ts` - React hook with 30s polling
- ✅ `src/renderer/src/components/prompt/ChannelHeader.tsx` - VcsBadge component

**Features**:

- Shows current branch name directly from OpenCode's `/vcs` API
- Reliable - no string parsing needed
- 30-second polling interval
- Only shows when OpenCode backend is enabled

### 9. Session Status Display ✅

**Status**: Completed  
**API Endpoint**: `GET /session/status`
**Response**: `{ [sessionID: string]: { type: "busy" | "idle" } }`

**Implementation**:

- ✅ `src/main/opencode-session-status.ts` - Session status API call
- ✅ `src/main/ipc-handlers.ts` - `fetch-session-status` IPC handler
- ✅ `src/preload/index.ts` - `fetchSessionStatus` API exposed
- ✅ `src/renderer/src/hooks/useSessionStatus.ts` - React hook with 3s polling
- ✅ `src/renderer/src/components/prompt/ChannelSidebar.tsx` - Busy indicator per session

**Features**:

- Shows amber pulsing indicator next to session name when busy
- 3-second polling interval for responsive status updates
- Efficiently gets status for all sessions in one API call
- Only shows when OpenCode backend is enabled

### 10. MCP Server Status ❌

**Status**: Removed  
**Reason**: MCP server status is strictly an OpenCode concern and doesn't provide value for the interactive MCP desktop app.

### 11. SSE Event Stream (Real-time Updates) ✅

**Status**: Completed  
**API Endpoints**:

- `GET /event` - Session/bus events (main stream)
- `GET /global/event` - Global server events

**First event**: `server.connected` confirms connection
**Subsequent events**: All bus events (session changes, tool calls, etc.)

**Implementation**:

- ✅ `src/main/opencode-bus-events.ts` - SSE event subscriber and handler
- ✅ `src/preload/index.ts` - IPC listeners for SSE events
- ✅ `src/renderer/src/hooks/useTodos.ts` - Listens for `todo.updated` SSE
- ✅ `src/renderer/src/hooks/useVcsInfo.ts` - Listens for `vcs.branch.updated` SSE
- ✅ `src/renderer/src/hooks/useSessionStatus.ts` - Listens for `session.status` SSE

**Supported events**:

- `todo.updated` - Real-time todo changes (replaces 5s polling when available)
- `vcs.branch.updated` - Real-time VCS branch changes (replaces 30s polling)
- `session.status` - Real-time session status (replaces 3s polling)
- `permission.asked` - Permission requests (already implemented)
- `permission.replied` - Permission reply confirmations (already implemented)

**Features**:

- SSE events provide instant updates without polling latency
- Polling remains as fallback when SSE is unavailable
- Each hook tracks whether SSE events have been received
- When SSE is active, polling is automatically skipped

### 12. File Status Tracking ❌

**Status**: Removed  
**Reason**: The `/file/status` API returns global (project-wide) file changes, not per-session changes. This doesn't provide value for the desktop app's session-focused workflow.

### 13. OpenCode Provider API ❌

**Status**: Removed  
**API Endpoint**: `GET /provider`  
**Reason**: The OpenCode `/provider` API endpoint returns OpenCode's internal provider configuration, which is strictly an OpenCode concern and doesn't provide value for the interactive MCP desktop app.

> **Note**: This refers to the OpenCode `/provider` REST API, not the app's internal `ProviderStatus` type (see `IPC-API.md → App Info → getProviderStatus`). The app's `ProviderStatus` returns backend mode settings (standalone/opencode/claude_sdk) and is still actively used.

---

## Completed Feature Summary

All planned OpenCode integration features have been evaluated:

### 14. Bi-directional Messaging (Future) ❌

**Status**: Deferred  
**API Endpoints**:

- `POST /session/:id/message` - Send and wait for response
- `POST /session/:id/prompt_async` - Fire-and-forget (returns 204)
- `POST /session/:id/command` - Execute slash commands
- `POST /session/:id/shell` - Run shell commands via agent

**Message body**:

```json
{
  "messageID?": "string",
  "model?": "string",
  "agent?": "string",
  "noReply?": "boolean",
  "system?": "string",
  "tools?": "array",
  "parts": "array"
}
```

**Current state**: Using `noReply: true` for context injection only.

**Future**: Full bi-directional conversation support.

---

## API Endpoints Reference

Based on [OpenCode Server API docs](https://opencode.ai/docs/server/):

| Endpoint                         | Method    | Description         | Status                               |
| -------------------------------- | --------- | ------------------- | ------------------------------------ |
| `/session`                       | GET       | List all sessions   | ✅ Used                              |
| `/session/:id`                   | GET       | Get session details | ✅ Used                              |
| `/session/:id/todo`              | GET       | Get session todos   | ✅ Implemented                       |
| `/session/:id/abort`             | POST      | Abort session       | ✅ Implemented                       |
| `/session/:id/message`           | POST      | Inject message      | ✅ Used                              |
| `/session/:id/permission/:reqId` | POST      | Reply to permission | ✅ Used                              |
| `/session/status`                | GET       | Session status      | ✅ Implemented                       |
| `/global/event`                  | GET       | SSE event stream    | ✅ Used                              |
| `/global/sync-event`             | GET       | SSE sync events     | ✅ Used                              |
| `/global/health`                 | GET       | Health check        | ✅ Implemented                       |
| `/vcs`                           | GET       | VCS info            | ✅ Implemented                       |
| `/mcp`                           | GET       | MCP server status   | ❌ Removed (OpenCode-specific)       |
| `/event`                         | GET       | SSE bus events      | ❌ Not used                          |
| `/file/status`                   | GET       | File tracking       | ❌ Removed (global, not per-session) |
| `/provider`                      | GET       | OpenCode providers  | ❌ Removed (OpenCode-specific)       |
| `/config`                        | GET/PATCH | Configuration       | ❌ Not used (manual file patch)      |

---

## Technical Notes

### OpenCode Port Configuration

- Default port: `4096` (configurable in Settings)
- Settings location: `src/main/settings.ts` (line 45)
- UI control: `src/renderer/src/pages/SettingsView.tsx`

### Session Tree Updates

- SSE stream: `/global/sync-event`
- Events: `session.created.1`, `session.updated.1`, `session.deleted.1`
- Debounce: 50ms between snapshot emissions

### Auto-register Subagents

- When a new child session is created, the manager auto-injects the session ID
- Window for auto-bind: 3 seconds after `register_connection`
