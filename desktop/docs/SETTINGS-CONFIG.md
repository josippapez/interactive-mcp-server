# Settings Configuration

Reference documentation for the Interactive MCP Desktop application settings system.

---

## Settings Reference

| Key                    | Type      | Default | UI Label                         | Description                                                                                  |
| ---------------------- | --------- | ------- | -------------------------------- | -------------------------------------------------------------------------------------------- |
| `port`                 | `number`  | `3100`  | MCP Server Port                  | TCP port the embedded MCP HTTP server listens on.                                            |
| `soundEnabled`         | `boolean` | `true`  | Notification Sound               | Whether to play a system beep when a prompt arrives.                                         |
| `launchAtLogin`        | `boolean` | `false` | Launch at Login                  | Whether the app registers itself as a login item.                                            |
| `promptTimeoutSeconds` | `number`  | `800`   | Prompt Timeout (seconds)         | Seconds before an unanswered prompt resolves with a timeout error. `0` disables the timeout. |
| `autoRestoreSessions`  | `boolean` | `false` | Auto-restore unfinished sessions | Whether the renderer reopens persisted session tabs on startup.                              |

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
  "autoRestoreSessions": false
}
```

---

## Runtime Behavior

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

### `promptTimeoutSeconds`

Passed to `setPromptTimeout()` in `ipc-prompt.ts` as a getter that returns `currentSettings.promptTimeoutSeconds * 1000` (converting to milliseconds). The getter is evaluated per-prompt, so changes take effect for the next prompt.

Inside `promptUser()`, a `setTimeout` is set for `timeoutMs` milliseconds. If the user has not responded when the timer fires, the pending promise resolves with:

```
Error: Prompt timed out — no response received.
```

**Special value — `0`:** When `promptTimeoutSeconds` is `0`, `timeoutMs` evaluates to `0`. The check `if (timeoutMs > 0)` in `promptUser()` is `false`, so no `setTimeout` is registered. Prompts remain open indefinitely until the user responds or the connection is closed.

### `autoRestoreSessions`

Read by the renderer process on startup via `window.api.getSettings()`. If `true`, the renderer calls `getPersistedSessionChannels()` (IPC: `get-persisted-session-channels`) and creates a connection tab for each returned session. If `false`, persisted sessions are not reopened automatically and the UI starts with no tabs.

---

## Validation Rules

These rules are enforced in `SettingsView.tsx` before the save function is invoked. The Save button is disabled until `isDirty && isFormValid`.

| Field                  | Rule                           | Error message                                |
| ---------------------- | ------------------------------ | -------------------------------------------- |
| `port`                 | Integer, `1024 ≤ port ≤ 65535` | "Enter a valid port between 1024 and 65535." |
| `promptTimeoutSeconds` | Integer, `timeout ≥ 0`         | "Timeout must be 0 or greater."              |

Toggle fields (`soundEnabled`, `launchAtLogin`, `autoRestoreSessions`) have no validation; they are boolean and cannot be invalid.

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

| Concern                    | File                                                   | Symbol                                    |
| -------------------------- | ------------------------------------------------------ | ----------------------------------------- |
| Type definition & defaults | `desktop/src/main/settings.ts`                         | `AppSettings`, `defaultSettings`          |
| Load / save from disk      | `desktop/src/main/settings.ts`                         | `loadSettings()`, `saveSettings()`        |
| Settings path              | `desktop/src/main/settings.ts`                         | `getSettingsPath()`                       |
| Startup initialization     | `desktop/src/main/index.ts`                            | `currentSettings = loadSettings()`        |
| IPC handlers               | `desktop/src/main/ipc-handlers.ts`                     | `get-settings`, `save-settings`           |
| Sound & timeout wiring     | `desktop/src/main/ipc-prompt.ts`                       | `setSoundEnabled()`, `setPromptTimeout()` |
| Settings UI                | `desktop/src/renderer/src/components/SettingsView.tsx` | `SettingsView`                            |

### Load behavior

`loadSettings()` merges the parsed JSON with `defaultSettings` using object spread:

```ts
return { ...defaultSettings, ...JSON.parse(readFileSync(path, 'utf-8')) };
```

This means:

- Keys present in the file override the defaults.
- Keys absent from the file (e.g. after an app upgrade adds a new setting) fall back to their default value automatically.
- If the file does not exist or cannot be parsed, the full `defaultSettings` object is returned without error.
