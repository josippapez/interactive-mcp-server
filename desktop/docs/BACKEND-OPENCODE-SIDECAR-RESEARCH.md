# Research: How OpenCode's Tauri Desktop App Runs the Backend

**Source:** `~/Desktop/opencode/packages/desktop` (Tauri v2, Rust + SolidJS).
**Purpose:** Compare their architecture against our current in-process Electron model, to decide whether a sidecar-binary approach beats a `utilityProcess` extraction for our desktop app.
**Status:** Research only — no code changes.

---

## 1. One-line summary

OpenCode's Tauri app **does not run OpenCode in-process**. It ships the `opencode` CLI as a **Tauri external sidecar binary**, spawns it as a child process on startup, talks to it over **localhost HTTP + Basic Auth**, and the UI is just a web client against that HTTP server.

There is no Rust-side import of OpenCode, no virtual module, no wasm-copy pipeline. The desktop app is a **shell around the CLI**.

---

## 2. Packaging — how the binary gets into the app

File: `~/Desktop/opencode/packages/desktop/src-tauri/tauri.conf.json`

```jsonc
{
  "bundle": {
    "externalBin": ["sidecars/opencode-cli"],
    ...
  }
}
```

Tauri's `externalBin` field tells the bundler: "include this binary in the final app package, one per target triple, named `<basename>-<rust-target>`." At runtime the binary sits next to the app's main executable.

**Build pipeline** (`packages/desktop/scripts/prepare.ts` + `utils.ts`):

1. `packages/opencode` is compiled to a standalone binary per platform (`opencode-darwin-arm64`, `opencode-linux-x64-baseline`, `opencode-windows-arm64`, etc.).
2. `prepare.ts` copies that binary into `src-tauri/sidecars/opencode-cli-<rust-target>`.
3. `tauri build` picks it up and bundles it into the final `.app` / `.dmg` / `.exe` / `.deb` / `.rpm`.
4. For dev (`predev.ts`), the binary is copied from `../opencode/dist/<platform>/bin/opencode`.

Target matrix (`utils.ts:3-34`):

- `aarch64-apple-darwin` → `opencode-darwin-arm64`
- `x86_64-apple-darwin` → `opencode-darwin-x64-baseline`
- `aarch64-pc-windows-msvc` → `opencode-windows-arm64`
- `x86_64-pc-windows-msvc` → `opencode-windows-x64-baseline`
- `x86_64-unknown-linux-gnu` → `opencode-linux-x64-baseline`
- `aarch64-unknown-linux-gnu` → `opencode-linux-arm64`

---

## 3. Spawn — how Rust launches the sidecar

Relevant files:

- `src-tauri/src/lib.rs` — startup orchestration
- `src-tauri/src/server.rs` — spawn + health-check
- `src-tauri/src/cli.rs` — process spawn plumbing

### 3.1 Startup sequence (`lib.rs:418 initialize`)

```rust
async fn initialize(app: AppHandle) {
    let (init_tx, init_rx) = watch::channel(InitStep::ServerWaiting);
    setup_app(&app, init_rx);
    spawn_cli_sync_task(app.clone());

    // Pick a free port
    let port = get_sidecar_port();
    let hostname = "127.0.0.1";
    let url = format!("http://{hostname}:{port}");
    let password = uuid::Uuid::new_v4().to_string();

    // Spawn the sidecar
    let (child, health_check) =
        server::spawn_local_server(app.clone(), hostname.to_string(), port, password.clone());

    // Make credentials available to the renderer IMMEDIATELY (before health check)
    let (ready_tx, ready_rx) = oneshot::channel();
    let _ = ready_tx.send(ServerReadyData {
        url,
        username: Some("opencode".to_string()),
        password: Some(password),
    });
    app.manage(SidecarReady(ready_rx.shared()));
    app.manage(ServerState { child: Arc::new(Mutex::new(Some(child))) });

    // ... SQLite migration loading window logic, then:
    MainWindow::create(&app).expect("Failed to create main window");
}
```

### 3.2 Command construction (`cli.rs:366 spawn_command`)

```rust
let sidecar = get_sidecar_path(app); // <app-binary-dir>/opencode-cli
let shell   = get_user_shell();
let envs    = merge_shell_env(load_shell_env(&shell), envs);
let line    = format!("\"{}\" {}", sidecar.display(), args);
let mut cmd = Command::new(shell);
cmd.args(["-lc", &line]);
```

Key detail: on macOS/Linux they launch the sidecar **via the user's login shell** (`bash -lc`, `zsh -lc`, etc.) so the spawned process inherits `PATH`, Homebrew paths, and any shell-sourced `OPENCODE_*` env vars. Windows branch spawns `opencode-cli.exe` directly or via WSL.

Env vars passed to the sidecar (`cli.rs:376-395`):

- `OPENCODE_EXPERIMENTAL_ICON_DISCOVERY=true`
- `OPENCODE_EXPERIMENTAL_FILEWATCHER=true`
- `OPENCODE_CLIENT=desktop`
- `XDG_STATE_HOME=<app local data dir>`
- `OPENCODE_SERVER_USERNAME=opencode`
- `OPENCODE_SERVER_PASSWORD=<random UUID>`

Spawn args (`server.rs:563-570`):

```
--print-logs --log-level WARN serve --hostname 127.0.0.1 --port <free-port>
```

### 3.3 Binary location resolution (`cli.rs:112`)

```rust
pub fn get_sidecar_path(app: &tauri::AppHandle) -> std::path::PathBuf {
    tauri::process::current_binary(&app.env())
        .expect("Failed to get current binary")
        .parent()
        .expect("Failed to get parent dir")
        .join("opencode-cli")
}
```

Simple: sibling of the Tauri main binary.

### 3.4 Port selection (`lib.rs:551`)

```rust
fn get_sidecar_port() -> u32 {
    option_env!("OPENCODE_PORT")
        .and_then(|s| s.parse().ok())
        .unwrap_or_else(|| {
            TcpListener::bind("127.0.0.1:0")  // OS assigns free port
                .unwrap().local_addr().unwrap().port()
        }) as u32
}
```

Bind to port 0, read back the kernel-assigned port, close the listener, pass the port to the sidecar. Classic.

---

## 4. Health check — how main detects the sidecar is ready

File: `src-tauri/src/server.rs:87 spawn_local_server`

```rust
let health_check = HealthCheck(tokio::spawn(async move {
    let url = format!("http://{hostname}:{port}");
    let ready = async {
        loop {
            tokio::time::sleep(Duration::from_millis(100)).await;
            if check_health(&url, Some(&password)).await {
                return Ok(());
            }
        }
    };
    let terminated = async {
        match exit.await {
            Ok(p) => Err(format!("Sidecar terminated before becoming healthy (code={:?})", p.code)),
            Err(_) => Err("Sidecar terminated before becoming healthy".into()),
        }
    };
    tokio::select! { res = ready => res, res = terminated => res }
}));
```

`check_health()` does `GET http://<host>:<port>/global/health` with Basic Auth, 7-second timeout, `no_proxy()` for loopback (critical when users have `HTTP_PROXY` set that would otherwise route 127.0.0.1 through a proxy).

They race "port became healthy" against "sidecar exited". First one wins. The health-check future is awaited with a 30-second timeout (`lib.rs:489`).

---

## 5. Renderer — how the UI finds the server

File: `packages/desktop/src/index.tsx:432-458`

```tsx
// Fetch sidecar credentials from Rust (available immediately, before health check)
const [sidecar] = createResource(() =>
  commands.awaitInitialization(new Channel<InitStep>() as any),
);

const servers = () => {
  const data = sidecar();
  if (!data) return [];
  const http = {
    url: data.url,
    username: data.username,
    password: data.password,
  };
  const server: ServerConnection.Sidecar = {
    displayName: t('desktop.server.local'),
    type: 'sidecar',
    variant: 'base',
    http,
  };
  return [server] as ServerConnection.Any[];
};
```

The renderer has a generic `ServerConnection` abstraction. The sidecar appears to the app as just one more server entry, with `type: "sidecar"`. Remote servers can also be configured — the UI doesn't know the difference.

### 5.1 `await_initialization` Tauri command (`lib.rs:96`)

```rust
#[tauri::command]
async fn await_initialization(
    state: State<'_, SidecarReady>,
    init_state: State<'_, InitState>,
    events: Channel<InitStep>,
) -> Result<ServerReadyData, String> {
    // Stream InitStep progress via Channel; resolve with credentials
}
```

Credentials (`url`, `username`, `password`) are returned **before the health check completes**, so the renderer can start rendering/connecting immediately. The loading window polls `InitStep` via a Tauri `Channel` for progress UI.

### 5.2 Everything is HTTP from the renderer

The SolidJS app uses `@tauri-apps/plugin-http` (`fetch as tauriFetch`) to talk to the sidecar:

- Regular REST endpoints for sessions/messages
- SSE over HTTP for event stream (OpenCode's server exposes `/event` as an EventSource)
- Basic Auth on every request

There is **no** `window.api.*` IPC bridge in the modern Tauri app — all backend data flow is HTTP. Only Tauri commands are used (for platform things: dialogs, shell, clipboard, notifications, deep-link).

---

## 6. Shutdown — how they tear it down cleanly

File: `lib.rs:364-370`

```rust
.run(|app, event| {
    if let RunEvent::Exit = event {
        kill_sidecar(app.clone());
    }
});
```

`kill_sidecar` (`lib.rs:73`):

```rust
fn kill_sidecar(app: AppHandle) {
    let Some(server_state) = app.try_state::<ServerState>() else { return; };
    let Some(server_state) = server_state.child.lock().unwrap().take() else { return; };
    let _ = server_state.kill();
}
```

Additionally:

- `platform.restart()` (renderer, `index.tsx:306`) calls `commands.killSidecar()` before `relaunch()`.
- `platform.update()` (Windows only, `index.tsx:300`) also kills the sidecar before installing updates, to release the binary handle.

No supervisor loop, no auto-respawn — if the sidecar dies, the app is broken and the user restarts. That simplicity is possible because the sidecar is just `opencode serve`, a stable long-running HTTP server.

---

## 7. SQLite

The OpenCode CLI owns the database. Tauri side only:

- Detects if `~/.local/share/opencode/opencode.db` exists (`lib.rs:565 sqlite_file_exists`).
- If missing, shows a loading window while the sidecar creates/migrates it, driven by `SqliteMigrationProgress` events the CLI emits over stderr/stdout.

Tauri never opens SQLite directly.

---

## 8. Why this is attractive

| Concern                          | Tauri sidecar answer                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------ |
| Main-process event-loop blocking | Impossible. OpenCode runs in its own OS process with its own event loop.             |
| HMR survival in dev              | Dev-server restarts don't touch the sidecar; only the renderer/Tauri wrapper reload. |
| Crash isolation                  | OpenCode crash = sidecar exit; UI still paints, user sees disconnected state.        |
| SQLite native bindings packaging | Owned entirely by the CLI — zero desktop packaging surface for native modules.       |
| Dev/prod divergence              | None. Same binary, same protocol, same shell launch.                                 |
| Debugging                        | `curl http://localhost:<port>/global/health` works. Standard HTTP tools apply.       |
| Updates                          | Can swap CLI versions without rebuilding the Tauri shell (they don't, but could).    |

## 9. What it costs

| Cost                         | Notes                                                                                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build-pipeline complexity    | Must compile OpenCode to standalone per-platform binaries and stage them before bundling. For us: the `opencode` SEA is already a thing; we'd reuse it. |
| HTTP round-trip per call     | Localhost HTTP is fast, but slower than in-process function calls. For our workloads (prompts, tools, SSE) it's irrelevant.                             |
| Basic Auth secret management | Password generated per-launch and passed as env var. Straightforward.                                                                                   |
| Loopback proxy traps         | `HTTP_PROXY` env vars can route 127.0.0.1 through a proxy. Solved by `reqwest::no_proxy()` for loopback.                                                |
| Port conflicts               | Solved by `bind(:0)` trick.                                                                                                                             |
| Sidecar orphaning on crash   | If Electron main crashes, the sidecar stays running. Need PID-parent-watch or a kill-file strategy.                                                     |

---

## 10. How this maps to our Electron desktop app

Our app is fundamentally different from OpenCode's:

1. **We are an MCP _server_ and prompt UI, not an OpenCode client.** OpenCode is a _dependency_ we embed; the user's agent talks to _us_ via MCP.
2. Our backend is **three things coupled by shared DB and SDK cache**:
   - OpenCode HTTP server (now spawned as a native subprocess — Mode C; see [ARCHITECTURE.md](./ARCHITECTURE.md#opencode-server-runs-as-a-native-subprocess-mode-c--committed-default). Historically this doc described the in-process `virtual:opencode-server` path, which is now dormant/reactivation-ready.)
   - MCP Express server (the thing agents connect to)
   - SSE event-stream consumer (reads from OpenCode, fans out to renderer)
3. The MCP server's tools call `window.api` style prompts that must round-trip through Electron IPC to the renderer and back.

### Options for us

**Option A: `utilityProcess` (current plan)**

- Move all three subsystems into an Electron utility child.
- All data stays in Node/Electron world; MessagePort is a zero-serialization fast path for renderer forwarding.
- Native modules (`better-sqlite3`) still in our packaging matrix.
- Rollout is incremental (Phase 2 SSE, Phase 3 OpenCode+DB, Phase 4 MCP).

**Option B: Sidecar binary (Tauri-style)**

- Package the OpenCode CLI separately (`opencode serve`) and spawn it as a `child_process`.
- Main process goes back to being a thin HTTP client + MCP server host.
- MCP server **could** also be extracted into a second sidecar, or stay in main.
- **Blocker:** our MCP tools currently reach into OpenCode's internals (session-tree, skills, provider config) via the imported SDK. If OpenCode runs as an opaque HTTP sidecar, we only have its public HTTP API. Some of our internal hooks might not have HTTP equivalents.
- **Blocker:** bundle size — we'd ship two ~100MB+ binaries (Electron + OpenCode CLI).
- **Cost:** our MCP server still runs in Electron main, so main-event-loop blocking still exists for _MCP workloads_ (tool calls with prompts/LSP/diff). The sidecar only fixes the OpenCode-server + SSE coupling.

**Option C: Hybrid**

- OpenCode runs as a sidecar binary (Tauri-style).
- Our MCP + prompt store + DB stay in a `utilityProcess`.
- Main is a thin router: IPC to renderer, HTTP client to OpenCode sidecar, MessagePort to MCP utility.
- Gives us Tauri-grade OpenCode isolation **plus** event-loop isolation for our own MCP workloads.
- Highest engineering cost but cleanest boundary long-term.

### Recommendation

Given:

- Our MCP tools reach into OpenCode SDK internals today (`sdk-client.ts`, `provider.ts`, session-tree integrations),
- The fastest path to "UI no longer flips to connecting… under load" is Phase 2 alone (SSE out of main),
- `utilityProcess` keeps the existing import graph intact (no HTTP-ification of internal calls),

**stick with the `utilityProcess` plan but add a migration exit to Option C** after Phase 4 if the CLI's public HTTP API becomes a superset of what our MCP tools need. That would retire `virtual:opencode-server` entirely. (Update: the implementation has since moved directly to Mode C — the OpenCode HTTP server is now spawned as a native subprocess, and the in-process `virtual:opencode-server` import path is dormant. The reasoning below is preserved for historical context.)

---

## 11. Concrete patterns worth stealing

Even if we don't go sidecar, the Tauri app has several patterns we can lift for our `utilityProcess` plan:

1. **Credentials known before health check.** They make the URL + Basic Auth available immediately after spawn so the UI can start rendering. We should make the utility-process port available to main before the first health probe returns — avoids a "connecting…" phase.

2. **`bind(:0)` for free port.** If we ever need the utility to expose an HTTP surface, use this instead of hard-coding a port.

3. **`no_proxy()` for loopback.** Document this in `KNOWN-ISSUES.md` — users with corporate proxies can break localhost connections.

4. **Shell-launched sidecar on macOS/Linux.** Our utility process inherits Electron main's env; if we ever sidecar, remember `bash -lc` to get login-shell env.

5. **Races "ready" vs "terminated".** Our supervisor should do the same: a `tokio::select!`-style race between "utility emitted ready" and "utility exited", so we don't wait the full timeout when the child crashed on startup.

6. **`RunEvent::Exit` → kill child.** Our main must hook `app.on('before-quit')` and `app.on('will-quit')` and await the utility's clean shutdown. (Already in the plan.)

7. **Public MCP timeout via init snapshot.** Tauri passes credentials via `SidecarReady` state. We should pass `{ userDataPath, settingsSnapshot, dbPath }` on the port's first message, not via env vars — env vars can't be updated without respawn.

8. **`SqliteMigrationProgress` events during startup.** If our DB migration ever gets slow, steal their loading-window pattern: stream progress events to the renderer while the backend warms up.

---

## 12. Files referenced (in `~/Desktop/opencode/packages/desktop`)

- `src-tauri/tauri.conf.json` — `externalBin` + bundle config
- `src-tauri/src/lib.rs` — startup, shutdown, command registration
- `src-tauri/src/server.rs` — spawn, health check
- `src-tauri/src/cli.rs` — process spawn plumbing, sidecar path resolution
- `src/index.tsx` — renderer entry, `ServerConnection.Sidecar` wiring
- `src/loading.tsx` — loading window
- `src/bindings.ts` — generated tauri-specta bindings
- `scripts/prepare.ts`, `scripts/predev.ts`, `scripts/utils.ts` — sidecar binary staging
