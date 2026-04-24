# Settings Configuration

Reference documentation for the Interactive MCP Desktop application settings system.

---

## Settings Reference

| Key                     | Type      | Default    | UI Label                         | Description                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------- | --------- | ---------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `port`                  | `number`  | `3100`     | MCP Server Port                  | TCP port the embedded MCP HTTP server listens on.                                                                                                                                                                                                                                                                                                                                                                                                |
| `soundEnabled`          | `boolean` | `true`     | Notification Sound               | Whether to play a system beep when a prompt arrives.                                                                                                                                                                                                                                                                                                                                                                                             |
| `launchAtLogin`         | `boolean` | `false`    | Launch at Login                  | Whether the app registers itself as a login item.                                                                                                                                                                                                                                                                                                                                                                                                |
| `promptTimeoutSeconds`  | `number`  | `800`      | Prompt Timeout (seconds)         | Seconds before an unanswered prompt resolves with a timeout error. `0` disables the timeout.                                                                                                                                                                                                                                                                                                                                                     |
| `autoRestoreSessions`   | `boolean` | `false`    | Auto-restore unfinished sessions | Whether the renderer reopens persisted session tabs on startup.                                                                                                                                                                                                                                                                                                                                                                                  |
| `openCodePort`          | `number`  | `4096`     | OpenCode API Port                | Port the local OpenCode HTTP API listens on. Used by `register_connection` to auto-detect the active OpenCode session, by the `inject-opencode-message` IPC handler to deliver messages, by `opencode/health.ts` for health probes, and by `opencode/server.ts` when `autoStartOpenCode` is enabled (the in-process `Server.listen()` binds to `127.0.0.1:<openCodePort>`).                                                                      |
| `docIndexingEnabled`    | `boolean` | `true`     | Repository Doc Indexing          | Whether to index repository markdown files and inject a doc manifest into the agent's OpenCode session when an agent calls `register_connection` with a `baseDirectory`. When disabled, `find_repo_docs` falls back to keyword-only search.                                                                                                                                                                                                      |
| `noReplyInjection`      | `boolean` | `true`     | Context-only messages            | When `true`, injected messages use `noReply: true` (context-only — the agent receives the message but does not generate a response). When `false`, injected messages trigger the agent to respond.                                                                                                                                                                                                                                               |
| `autoStartOpenCode`     | `boolean` | `true`     | Auto-start OpenCode server       | When `true`, the app boots the OpenCode HTTP API **in-process** via `Server.listen({ port, hostname: '127.0.0.1' })` at startup and runs a background health supervisor that auto-restarts the listener after 3 consecutive failed health probes. When `false`, neither the in-process server nor the supervisor runs, and the user is expected to run `opencode serve` (or equivalent) externally. See [autoStartOpenCode](#autostartopencode). |
| `agentBackend`          | `string`  | `opencode` | Agent Backend                    | Active provider backend mode. `standalone` runs pure Interactive MCP behavior without provider session discovery; `opencode` enables OpenCode session discovery/hierarchy/injection; `claude_sdk` is reserved for upcoming Anthropic SDK integration.                                                                                                                                                                                            |
| `autoRegisterSubagents` | `boolean` | `true`     | Auto-register sessions           | When `true`, all OpenCode sessions (both root and subagents) are automatically registered as sidebar channels when detected. See [autoRegisterSubagents](#autoregistersubagents).                                                                                                                                                                                                                                                                |

---

## File Location

Settings are stored as pretty-printed JSON. The file is created automatically on first save.

| Platform | Path                                                                  |
| -------- | --------------------------------------------------------------------- |
| macOS    | `~/Library/Application Support/interactive-mcp-desktop/settings.json` |
| General  | `{app.getPath('userData')}/settings.json`                             |

### Example file

```json
{
  "port": 3100,
  "soundEnabled": true,
  "launchAtLogin": false,
  "promptTimeoutSeconds": 800,
  "autoRestoreSessions": false,
  "openCodePort": 4096,
  "docIndexingEnabled": true,
  "noReplyInjection": true,
  "autoStartOpenCode": true,
  "agentBackend": "opencode",
  "autoRegisterSubagents": true
}
```

---

## Runtime Behavior

> **Settings propagation (post Phases 0–4).** `settings.ts` and its file IO live on
> **main**, but every backend consumer runs in the utility process. Propagation works in
> two steps:
>
> 1. **Init envelope** — when the supervisor forks the utility, the first message
>    contains `{ userDataPath, logsDir, settings: BackendSettingsSnapshot, … }`. The
>    utility seeds its in-memory settings mirror from this snapshot before calling
>    `initDatabase` or registering any RPC handlers.
> 2. **Live updates** — on every successful `save-settings` IPC, main calls
>    `emitSettingsUpdate(snapshot)` on the supervisor. The supervisor
>    `bridge.emit('settings-updated', snapshot)` and the utility atomically replaces its
>    in-memory mirror. Getters like `() => currentSettings.soundEnabled` that previously
>    closed over the main-process `currentSettings` now read the utility mirror.
>
> `BackendSettingsSnapshot` is the subset of `AppSettings` the backend actually reads
> (port, sound, timeout, openCodePort, doc indexing, noReplyInjection, autoStart,
> autoRegisterSubagents, agentBackend, …). Fields that are UI-only (e.g.
> `compactMode`, `launchAtLogin`) do not need to travel to the utility.

### `port`

Passed directly to `startMcpServer()` at startup. The server binds to `http://localhost:{port}/mcp`.

When a `save-settings` IPC call is received and the new `port` differs from the current one, the running HTTP server is stopped (`stopMcpServer()`) and a new one is started on the updated port before the IPC call returns. All active MCP sessions are terminated as part of the restart; connected clients must reinitialize.

The MCP client config URL displayed in the Settings footer is `http://localhost:{port}/mcp` and updates to reflect the saved port.

### `soundEnabled`

Passed to `setSoundEnabled()` in `ipc-prompt.ts` as a getter function (`() => currentSettings.soundEnabled`). The getter is evaluated at the moment each prompt fires, so toggling the setting takes effect for the next incoming prompt without requiring a restart.

When a prompt arrives, `shell.beep()` is called only if:

1. `soundEnabled` is `true`, **and**
2. at least 2 000 ms have elapsed since the last beep (`BEEP_COOLDOWN_MS = 2000`).

The cooldown prevents rapid-fire notification sounds when multiple prompts arrive in quick succession.

### `launchAtLogin`

Applied via Electron's `app.setLoginItemSettings()` in two places:

1. **On startup** — immediately after `loadSettings()` returns, using the persisted value.
2. **On every save** — the `save-settings` IPC handler calls `app.setLoginItemSettings({ openAtLogin, openAsHidden })` where both flags equal the new `launchAtLogin` value.

When `launchAtLogin` is `true`, the app is also opened hidden (`openAsHidden: true`), meaning the window does not appear on screen at login — the app runs in the system tray only.

**macOS dev-build guard:** both call sites are wrapped in `if (app.isPackaged) { … }`. Unsigned dev builds cannot register a login item on macOS, and the rejection is logged natively (`platform_util_mac.mm:260: Operation not permitted`) before control returns to JS — a try/catch does not suppress it. Skipping the call in dev keeps the console clean. Packaged (signed) builds still register the login item normally. See [KNOWN-ISSUES.md #2](./KNOWN-ISSUES.md#2-macos-unsigned-dev-launch-at-login-error-platform_util_macmm260).

### `promptTimeoutSeconds`

Passed to `setPromptTimeout()` in `ipc-prompt.ts` as a getter that returns `currentSettings.promptTimeoutSeconds * 1000` (converting to milliseconds). The getter is evaluated per-prompt, so changes take effect for the next prompt.

Inside `promptUser()`, a `setTimeout` is set for `timeoutMs` milliseconds. If the user has not responded when the timer fires, the pending promise resolves with:

```
Error: Prompt timed out — no response received.
```

**Special value — `0`:** When `promptTimeoutSeconds` is `0`, `timeoutMs` evaluates to `0`. The check `if (timeoutMs > 0)` in `promptUser()` is `false`, so no `setTimeout` is registered. Prompts remain open indefinitely until the user responds or the connection is closed.

### `autoRestoreSessions`

Read by the renderer process on startup via `window.api.getSettings()`. If `true`, the renderer calls `getPersistedSessionChannels()` (IPC: `get-persisted-session-channels`) and creates a connection tab for each returned session. If `false`, persisted sessions are not reopened automatically and the UI starts with no tabs.

### `openCodePort`

Used in four places:

1. **`register_connection` tool** — `autoDetectOpenCodeSession(openCodePort, baseDirectory)` queries `GET http://localhost:{openCodePort}/session` to find the most recently updated OpenCode session. Called at agent registration time.
2. **`inject-opencode-message` IPC handler** — reads `currentSettings.openCodePort` at call time to construct the injection URL `http://localhost:{openCodePort}/session/{openCodeSessionId}/message`. The live value is used, so changing the port in Settings takes effect immediately without an app restart.
3. **Health probes** — `checkOpenCodeHealth(openCodePort, timeoutMs)` (`desktop/src/main/opencode/health.ts`) hits `http://127.0.0.1:{openCodePort}/global/health`. Used by the cold-start `waitForOpenCodeHealthy` probe and by the background supervisor.
4. **`autoStartOpenCode`** — when auto-start is enabled, the in-process `Server.listen()` binds to `127.0.0.1:{openCodePort}`.

If OpenCode is not running on the configured port, both user-triggered operations fail silently: `register_connection` stores `null` for `openCodeSessionId`, and `inject-opencode-message` rejects its promise (which `ChannelComposer` handles by showing an error status badge).

### `docIndexingEnabled`

Controls whether the app indexes repository documentation when an agent calls `register_connection` with a `baseDirectory`. Read by `register_connection` at call time.

When **enabled** (default):

1. A doc manifest (paths + titles) is injected into the agent's OpenCode session via `noReply`.
2. A background embedding worker is warmed up to build a semantic index.
3. The `find_repo_docs` tool uses hybrid keyword + semantic search.

When **disabled**:

1. `register_connection` skips manifest injection and background indexing.
2. `find_repo_docs` falls back to keyword-only search (no semantic augmentation).

### `noReplyInjection`

Controls whether messages injected into the OpenCode ACP session use `noReply: true` (context-only) or `noReply: false` (triggers an agent response). Read at call time by the `inject-opencode-message` IPC handler.

When **enabled** (default, `noReply: true`):

- Injected messages appear in the agent's context window but the agent does not immediately generate a response. This is the recommended mode for most workflows.

When **disabled** (`noReply: false`):

- Injected messages trigger the agent to respond, equivalent to the user typing directly in the agent's session.

### `autoStartOpenCode`

Controls whether the app boots the OpenCode HTTP API in-process on startup and runs the background health supervisor. Implemented in `desktop/src/main/opencode/server.ts` and `desktop/src/main/index.ts`.

Default: `true`

When **enabled** (default):

1. On app startup (inside `runDeferredInit`), `startOpenCodeServer(openCodePort)` is called. It dynamically imports `virtual:opencode-server` (resolved at build time to the prebuilt Node bundle at `resources/opencode-node/node.js`) and calls `Server.listen({ port: openCodePort, hostname: '127.0.0.1' })` in the current process. See `desktop/src/main/opencode/server.ts:46`.
2. Before the dynamic import, two environment variables are pinned for the OpenCode server: `XDG_STATE_HOME = app.getPath('userData')` and `OPENCODE_CLIENT = 'desktop'`. This matches the upstream `packages/desktop-electron` embedding pattern and keeps OpenCode state inside Electron's user-data directory.
3. `waitForOpenCodeHealthy` polls `GET /global/health` every 500 ms for up to 30 s (per-attempt timeout 1–10 s, adaptive to remaining budget). Once the server responds healthy, the cold-start warmup runs (session-tree seed + providers-info warmup).
4. Once the cold-start probe succeeds, the background supervisor (`startOpenCodeSupervisor`) begins probing every 15 s. After 3 consecutive failures it calls `stopOpenCodeServer()` followed by `startOpenCodeServer()`. Restarts are concurrency-guarded so overlapping restarts never run. See `desktop/src/main/index.ts:107`.
5. If the port changes in Settings, `startOpenCodeServer(newPort)` is idempotent: a listener on a different port is stopped first, then a fresh listener is started.
6. On app `before-quit`, `stopOpenCodeSupervisor()` is called first, then `stopOpenCodeServer()` shuts down the in-process listener (fire-and-forget — Electron cannot await async cleanup there).

When **disabled**:

- Neither the in-process server nor the supervisor runs. The user is expected to run `opencode serve` (or equivalent) externally on `openCodePort`.
- The renderer's health-store poll still hits `GET /global/health` so the UI shows whether OpenCode is up, but the main process takes no automatic action in response. In particular, the supervisor does **not** attempt to start or restart an externally-managed OpenCode instance — this is a deliberate guard so the app never interferes with a user-managed lifecycle.

### `autoRegisterSubagents`

Controls whether all OpenCode sessions — both root sessions and subagent sessions — are automatically registered as sidebar channels when discovered. Despite the setting key name, it applies to **all** sessions, not only subagents.

Default: `true`

When **enabled** (default):

- **SSE `session.created.1` events:** When a new OpenCode session is detected via live SSE, `autoRegisterSession(info)` is called for every session regardless of whether it has a `parentID`. This creates a `registered_connections` row with `connectionId = "auto-{sessionId}"` and a placeholder `channelName` of `"Subagent (connecting…)"` (or a name derived from the session).
- **Startup seed (`seedCacheFromRest`):** When the session tree is seeded from the OpenCode REST API at startup (or when the user clicks the refresh button), `autoRegisterSession(info)` is called for each session in the results. Sessions already known to `registered_connections` are not duplicated.

The setting is passed to `startSessionTreeManager` as `() => currentSettings.autoRegisterSubagents`.

Agents do not need to call `register_connection` for their session to appear in the sidebar when this is enabled. Calling `register_connection` remains available as an opt-in tool to set a custom channel name, link a `baseDirectory`, or enable advanced features such as doc indexing and session context injection.

When **disabled**:

- No auto-registration occurs. Sessions must call `register_connection` manually to create a channel in the sidebar.

See [SESSION-CHANNELS.md — Session-tree service](./SESSION-CHANNELS.md#session-tree-service) for the full auto-registration flow.

---

## Validation Rules

These rules are enforced in `SettingsView.tsx` before the save function is invoked. The Save button is disabled until `isDirty && isFormValid`.

| Field                  | Rule                           | Error message                                |
| ---------------------- | ------------------------------ | -------------------------------------------- |
| `port`                 | Integer, `1024 ≤ port ≤ 65535` | "Enter a valid port between 1024 and 65535." |
| `promptTimeoutSeconds` | Integer, `timeout ≥ 0`         | "Timeout must be 0 or greater."              |
| `openCodePort`         | Integer, `1024 ≤ port ≤ 65535` | "Enter a valid port between 1024 and 65535." |

Toggle fields (`soundEnabled`, `launchAtLogin`, `autoRestoreSessions`, `docIndexingEnabled`, `noReplyInjection`, `autoStartOpenCode`, `autoRegisterSubagents`) have no validation; they are boolean and cannot be invalid.

---

## IPC API

Settings are accessed and mutated by the renderer exclusively through Electron IPC. Both channels are registered in `ipc-handlers.ts`.

### `get-settings`

**Direction:** renderer → main
**Parameters:** none
**Returns:** `AppSettings` — the current in-memory settings object (`currentSettings`).

```ts
const settings = await window.api.getSettings();
```

The returned value reflects the live in-memory state, not a fresh read from disk.

### `save-settings`

**Direction:** renderer → main
**Parameters:** `AppSettings` — the full settings object to persist.
**Returns:** `true`

```ts
await window.api.saveSettings(updatedSettings);
```

The handler performs the following steps in order:

1. Compares `settings.port` with the current `port` to detect a port change.
2. Updates the in-memory `currentSettings` reference via `setSettings()`.
3. Writes the new settings to disk via `saveSettings()` (2-space-indented JSON).
4. Calls `app.setLoginItemSettings({ openAtLogin, openAsHidden })` with the new `launchAtLogin` value.
5. If the port changed: calls `stopMcpServer()` then `startMcpServer()` with the new port.
6. Returns `true`.

---

## Implementation Reference

| Concern                    | File                                                                                                         | Symbol                                                                                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Type definition & defaults | `desktop/src/main/settings.ts`                                                                               | `AppSettings`, `defaultSettings`                                                                                                                                                      |
| Load / save from disk      | `desktop/src/main/settings.ts`                                                                               | `loadSettings()`, `saveSettings()`                                                                                                                                                    |
| Settings path              | `desktop/src/main/settings.ts`                                                                               | `getSettingsPath()`                                                                                                                                                                   |
| Startup initialization     | `desktop/src/main/index.ts`                                                                                  | `currentSettings = loadSettings()`                                                                                                                                                    |
| IPC handlers               | `desktop/src/main/ipc-handlers.ts`                                                                           | `get-settings`, `save-settings`                                                                                                                                                       |
| Sound & timeout wiring     | `desktop/src/main/ipc-prompt.ts`                                                                             | `setSoundEnabled()`, `setPromptTimeout()`                                                                                                                                             |
| Settings UI                | `desktop/src/renderer/src/pages/SettingsView.tsx`                                                            | `SettingsView`                                                                                                                                                                        |
| Auto-register wiring       | `desktop/src/main/session/session-tree-service.ts` (+ `session/sse-handlers.ts`, `session/auto-register.ts`) | `startSessionTreeService(getWindow, getOpenCodePort)` — the auto-register-subagents toggle is read in `sse-handlers.ts` via `getAutoRegisterSubagents()` wired from `loadSettings()`. |
| OpenCode in-process server | `desktop/src/main/opencode/server.ts`                                                                        | `startOpenCodeServer`, `stopOpenCodeServer`, `isOpenCodeServerRunning`                                                                                                                |
| OpenCode health probe      | `desktop/src/main/opencode/health.ts`                                                                        | `checkOpenCodeHealth`                                                                                                                                                                 |
| Health supervisor          | `desktop/src/main/index.ts`                                                                                  | `startOpenCodeSupervisor`, `stopOpenCodeSupervisor`, `waitForOpenCodeHealthy`, `OPENCODE_SUPERVISOR_INTERVAL_MS`, `OPENCODE_SUPERVISOR_MAX_FAILURES`                                  |

### Load behavior

`loadSettings()` merges the parsed JSON with `defaultSettings` using object spread:

```ts
return { ...defaultSettings, ...JSON.parse(readFileSync(path, 'utf-8')) };
```

This means:

- Keys present in the file override the defaults.
- Keys absent from the file (e.g. after an app upgrade adds a new setting) fall back to their default value automatically.
- If the file does not exist or cannot be parsed, the full `defaultSettings` object is returned without error.
