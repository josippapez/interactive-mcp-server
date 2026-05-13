import { app, BrowserWindow, Tray } from 'electron';
import { electronApp, optimizer } from '@electron-toolkit/utils';
import {
  softRestartMcpServer,
  startMcpServer,
  stopMcpServer,
} from './utility/mcp-server-client';
import { initDatabase, seedBuiltinTemplates } from './utility/db-client';
import { defaultSettings, loadSettings, type AppSettings } from './settings';
import { createWindow } from './window';
import { createTray } from './tray';
import { registerIpcHandlers } from './ipc/handlers';
import {
  startSessionTreeService,
  stopSessionTreeService,
} from './utility/session-client';
import { reconcileSessionConnections } from './utility/session-client';
import {
  startOpenCodeServer,
  stopOpenCodeServer,
} from './opencode/server-facade';
import { syncRemoteConfig } from './utility/opencode-client';
import { checkOpenCodeHealth } from './opencode/health';
import { registerMcpAfterOpenCodeHealthy } from './opencode/mcp-startup-registration';
import {
  fetchProvidersInfo,
  refreshProvidersInfo,
  registerMcpWithRetry,
} from './utility/opencode-client';
import { detectClaudeSdkRuntime } from './claude-sdk-runtime';
import { BUILTIN_TEMPLATES } from './builtin-templates';
import { initLogger, createLogger, flushLogger } from './utils/logger';
import {
  flushSessionLogger,
  rotateOldSessionLogs,
} from './utils/session-logger';
import { pinDevUserData } from './utils/dev-userdata-pin';
import { getUtilitySupervisor } from './utility/supervisor';
import { requestNativeNotificationPermission } from './utility/permission-notification';

// Dev-only: pin userData (and therefore the SQLite DB + OpenCode XDG state)
// to the same path the packaged production build uses. Without this, dev
// runs read/write a separate `eden-desktop/` directory and cannot see
// sessions started in the packaged "Eden" app, and vice-versa.
//
// MUST run before `app.whenReady()` and before any subsystem reads
// `app.getPath('userData')`. Production builds are left alone.
if (!app.isPackaged) {
  pinDevUserData({
    appSetPath: (key, value) => app.setPath(key, value),
    appGetPath: (key) => app.getPath(key),
    targetName: 'Eden',
    log: {
      info: (msg) => console.info(msg),
      warn: (msg) => console.warn(msg),
    },
  });
}

// In development, expose CDP on a configurable port so external tools
// (chrome-devtools-mcp, electron-mcp-server, React DevTools, etc.) can attach
// to the renderer. Override with ELECTRON_DEBUG_PORT to avoid collisions
// (e.g. Chrome's default 9222). Must be set before app.whenReady();
// no-op in packaged builds.
//
// Note: electron-mcp-server hardcodes 9222, so keep the default at 9222
// and only override via env when needed.
if (!app.isPackaged) {
  const debugPort = process.env.ELECTRON_DEBUG_PORT ?? '9222';
  app.commandLine.appendSwitch('remote-debugging-port', debugPort);
}

let mainWindow: BrowserWindow | null = null;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let tray: Tray | null = null;
let isQuitting = false;
let currentSettings: AppSettings = defaultSettings;

/**
 * Actually-bound ports as reported by the resolver/probe layer. May differ
 * from `currentSettings.{port,openCodePort}` when another instance occupies
 * the configured port and the resolver probed upward. We track these
 * separately so:
 *   1. The user's chosen hint stays in `currentSettings` (preserved on save).
 *   2. Downstream consumers that need the live port (config-sync, MCP
 *      register, OpenCode SDK calls) read from this holder.
 *   3. The renderer Settings UI surfaces the resolved value as a read-only
 *      hint under the editable port input.
 *
 * `null` means the resolver hasn't run yet (or fell back to the requested
 * port verbatim). Callers should fall back to `currentSettings` in that case.
 */
const resolvedPorts: { mcp: number | null; openCode: number | null } = {
  mcp: null,
  openCode: null,
};

/** Live port we should use for MCP traffic (resolved if known, else hint). */
function getEffectiveMcpPort(): number {
  return resolvedPorts.mcp ?? currentSettings.port;
}

/** Live port we should use for OpenCode HTTP traffic (resolved if known). */
function getEffectiveOpenCodePort(): number {
  return resolvedPorts.openCode ?? currentSettings.openCodePort;
}

/**
 * Push the current resolved-port snapshot (with the on-disk requested
 * values) to the focused renderer so the Settings page can update its
 * read-only "currently bound on port X" hint without polling AND without
 * a follow-up `getResolvedPorts()` IPC roundtrip. Called from every site
 * that mutates `resolvedPorts` (initial MCP startup, OpenCode startup,
 * supervisor rebind callback, IPC `setResolvedPort`).
 *
 * Payload shape matches `get-resolved-ports` so the renderer can use a
 * single shared type. Safe to call before a window exists — falls
 * through silently and the renderer will pick up the value via its
 * one-shot fetch on mount.
 */
function emitResolvedPortsChanged(): void {
  const win = mainWindow;
  if (!win || win.isDestroyed()) return;
  const onDisk = loadSettings();
  win.webContents.send('resolved-ports:changed', {
    mcpRequestedPort: onDisk.port,
    mcpResolvedPort: resolvedPorts.mcp ?? onDisk.port,
    openCodeRequestedPort: onDisk.openCodePort,
    openCodeResolvedPort: resolvedPorts.openCode ?? onDisk.openCodePort,
  });
}

/**
 * Interval (ms) between periodic background refreshes of the providers-info
 * cache. Keeps the renderer hydrated even when users leave the app open for
 * long periods between opening new sessions. 5 minutes is a reasonable
 * balance between freshness (connect/disconnect showing up eventually) and
 * not hammering OpenCode needlessly.
 */
const PROVIDERS_REFRESH_INTERVAL_MS = 5 * 60_000;
let providersRefreshTimer: NodeJS.Timeout | null = null;

/**
 * Supervisor interval (ms) for the background health watchdog. Probes the
 * in-process OpenCode server and auto-restarts it after a streak of
 * failures. Kept conservative — the renderer's own health poll already
 * surfaces transient outages to the user UI; this is a backstop for
 * genuinely wedged listeners.
 */
const OPENCODE_SUPERVISOR_INTERVAL_MS = 15_000;
/** Failures in a row before the supervisor triggers a restart. */
const OPENCODE_SUPERVISOR_MAX_FAILURES = 3;
/** Guard so overlapping restarts never run concurrently. */
let openCodeRestartInFlight = false;
/** Running count of consecutive failures for the supervisor. */
let openCodeConsecutiveFailures = 0;
let openCodeSupervisorTimer: NodeJS.Timeout | null = null;

/**
 * Poll `checkOpenCodeHealth` until the server responds healthy or the
 * ~30-second budget expires. Resolves `true` on success, `false` on timeout.
 *
 * Used during cold-start to gate session-tree and provider warmup so we do
 * not race OpenCode's HTTP listener coming up.
 */
async function waitForOpenCodeHealthy(
  getPort: () => number,
  opts: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<boolean> {
  const intervalMs = opts.intervalMs ?? 500;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    // Cold-start DB + workspace init can easily exceed the default 5s
    // per-attempt timeout on slow disks. Give each probe the full remaining
    // budget up to 10s so we don't count a slow-but-alive server as "down".
    const perAttempt = Math.min(10_000, Math.max(1_000, deadline - Date.now()));
    const health = await checkOpenCodeHealth(getPort(), perAttempt);
    if (health.healthy) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

/**
 * Start the background supervisor that auto-restarts the in-process
 * OpenCode server when it stops responding to health probes.
 *
 * Rationale: `Server.listen()` runs in the same Node process as Electron
 * main, so a stuck listener cannot be recovered by the OS. The supervisor
 * is the failsafe — it probes every {@link OPENCODE_SUPERVISOR_INTERVAL_MS}
 * and forces a stop/start cycle after
 * {@link OPENCODE_SUPERVISOR_MAX_FAILURES} consecutive failures.
 *
 * Idempotent: calling `start` twice is a no-op after the first call.
 */
function startOpenCodeSupervisor(
  getPort: () => number,
  shouldRun: () => boolean,
  appLog: ReturnType<typeof createLogger>,
  onPortResolved?: (resolvedPort: number) => void,
): void {
  if (openCodeSupervisorTimer) return;

  openCodeSupervisorTimer = setInterval(() => {
    if (isQuitting) return;
    if (!shouldRun()) return;
    if (openCodeRestartInFlight) return;

    void (async () => {
      const health = await checkOpenCodeHealth(getPort(), 5_000);
      if (health.healthy) {
        if (openCodeConsecutiveFailures > 0) {
          appLog.info(
            `[supervisor] OpenCode recovered after ${openCodeConsecutiveFailures} failure(s)`,
          );
        }
        openCodeConsecutiveFailures = 0;
        return;
      }

      openCodeConsecutiveFailures += 1;
      const failureLine = `[supervisor] OpenCode health probe failed (${openCodeConsecutiveFailures}/${OPENCODE_SUPERVISOR_MAX_FAILURES}): ${
        health.error ?? 'unknown error'
      }`;
      appLog.warn(failureLine);
      // Mirror to console so the failure cause is visible during dev runs.
      console.warn(failureLine);

      if (openCodeConsecutiveFailures < OPENCODE_SUPERVISOR_MAX_FAILURES) {
        return;
      }

      openCodeRestartInFlight = true;
      try {
        const restartLine = `[supervisor] OpenCode unresponsive — restarting in-process server`;
        appLog.error(restartLine);
        console.error(restartLine);
        try {
          await stopOpenCodeServer();
        } catch (err) {
          appLog.warn(
            `[supervisor] stopOpenCodeServer during restart: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
        try {
          const resolvedPort = await startOpenCodeServer(getPort());
          if (onPortResolved && resolvedPort !== getPort()) {
            onPortResolved(resolvedPort);
          }
        } catch (err) {
          appLog.error(
            `[supervisor] startOpenCodeServer during restart failed: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
        // Reset regardless — the next probe cycle will decide if we're
        // healthy again. Clearing here prevents a thrash loop.
        openCodeConsecutiveFailures = 0;
      } finally {
        openCodeRestartInFlight = false;
      }
    })();
  }, OPENCODE_SUPERVISOR_INTERVAL_MS);
}

function stopOpenCodeSupervisor(): void {
  if (openCodeSupervisorTimer) {
    clearInterval(openCodeSupervisorTimer);
    openCodeSupervisorTimer = null;
  }
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.rawwee.eden');

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  // =====================================================================
  // CRITICAL PATH — must complete before the renderer connects via IPC.
  // Keep this section as small and fast as possible.
  // =====================================================================

  // Initialize file logger first so everything else can log.
  initLogger(app.getPath('logs'));
  rotateOldSessionLogs(app.getPath('logs'));
  const appLog = createLogger('app');
  appLog.info(`Application started, version=${app.getVersion()}`);

  // Patch process.env.PATH from the user's login shell so MCP servers
  // configured as `npx -y …` and the spawned OpenCode binary can find
  // node/npm/npx. Without this, launchd-spawned Electron sees only
  // `/usr/bin:/bin:/usr/sbin:/sbin` and Homebrew/nvm Node is invisible.
  //
  // The user must have Node installed on their machine — we no longer
  // bundle it. If they don't, MCP servers using `npx` will fail with a
  // clear "command not found" error.
  try {
    const { default: fixPath } = await import('fix-path');
    const before = process.env.PATH ?? '';
    fixPath();
    appLog.info(
      `[fix-path] patched PATH (was ${before.length} chars, now ${(process.env.PATH ?? '').length} chars)`,
    );
  } catch (err) {
    appLog.warn(
      `[fix-path] failed to patch PATH: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Database init is required here because many IPC handlers (sidebar,
  // templates, session history) read from the DB immediately on renderer
  // load. better-sqlite3 init is fast (<10ms typical) and writes are
  // synchronous to the WAL-enabled SQLite file on disk.
  await initDatabase();

  // Settings are required to pass `startHidden` to createWindow.
  currentSettings = loadSettings();

  // Register IPC handlers BEFORE the window loads so the renderer's
  // immediate IPC calls don't race with handler registration.
  registerIpcHandlers({
    getMainWindow: () => mainWindow,
    getSettings: () => currentSettings,
    getLogsDir: () => app.getPath('logs'),
    getResolvedPorts: () => ({
      mcp: resolvedPorts.mcp,
      openCode: resolvedPorts.openCode,
    }),
    setResolvedPort: (kind, port) => {
      resolvedPorts[kind] = port;
      emitResolvedPortsChanged();
    },
    setSettings: (settings: AppSettings) => {
      currentSettings = settings;
      // Push new settings snapshot to the backend utility so the event-stream
      // pump sees `allowedPermissions`, `allowedReadFolders`, and
      // `autoRegisterSubagents` without re-reading electron-store.
      try {
        getUtilitySupervisor().emitSettingsUpdate({
          allowedPermissions: settings.allowedPermissions ?? [],
          allowedReadFolders: settings.allowedReadFolders ?? [],
          autoRegisterSubagents: settings.autoRegisterSubagents ?? true,
          openCodePort: settings.openCodePort,
          promptTimeoutSeconds: settings.promptTimeoutSeconds,
          soundEnabled: settings.soundEnabled,
          docIndexingEnabled: settings.docIndexingEnabled,
          agentBackend: settings.agentBackend,
          mcpPort: settings.port,
        });
      } catch {
        // Supervisor may not be started yet — non-fatal.
      }
    },
  });

  // =====================================================================
  // Create window + tray as early as possible so the user sees UI fast.
  // =====================================================================

  const openedAtLogin = app.getLoginItemSettings().wasOpenedAtLogin;
  mainWindow = createWindow(() => isQuitting, {
    startHidden: openedAtLogin,
  });
  mainWindow.once('ready-to-show', () => {
    requestNativeNotificationPermission(mainWindow);
  });

  // providers-info pushes from the utility process are relayed to the
  // renderer automatically by the `to-renderer` bridge handler in the
  // utility supervisor (see `utility/supervisor.ts`). No main-side wiring
  // needed here.

  tray = createTray(
    () => mainWindow,
    () => {
      isQuitting = true;
      stopMcpServer();
      app.quit();
    },
  );

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow(() => isQuitting);
    } else {
      mainWindow?.show();
    }
  });

  // =====================================================================
  // DEFERRED INITIALIZATION — runs after the window's first paint.
  //
  // Everything below is non-essential for the renderer to mount its UI.
  // Running it after `ready-to-show` means users see the window before
  // we start the MCP server, probe OpenCode, etc.
  // =====================================================================

  const runDeferredInit = async () => {
    // Phase 1 of backend-utility-process extraction: spawn the utility child
    // ASAP so we pay startup cost in parallel with MCP + OpenCode boot. At
    // this point it only handles `ping` — no subsystems have moved yet.
    // See docs/BACKEND-UTILITY-PROCESS-PLAN.md.
    try {
      const supervisor = getUtilitySupervisor();
      supervisor.setMainWindow(() => mainWindow);
      await supervisor.start();
      // Prove transport with a ping — will be removed once real calls exist.
      const reply = await supervisor
        .getBridge()
        .request<{ ok: boolean; echo: unknown; at: number }>('ping', {
          from: 'main',
          at: Date.now(),
        });
      appLog.info(`[utility] ping round-trip ok=${reply.ok} at=${reply.at}`);
    } catch (err) {
      appLog.error(
        `[utility] supervisor failed to start: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      // Phase 1 is non-fatal — continue booting normal paths even if the
      // utility is unavailable. Real coupling arrives in Phase 2+.
    }

    // Set login item settings in packaged (signed) builds only.
    //
    // In unsigned dev builds macOS refuses the call and logs the failure
    // natively (`platform_util_mac.mm:260: Operation not permitted`) BEFORE
    // control returns to JS, so a try/catch around it does not suppress the
    // noise. Guarding on `app.isPackaged` is the only way to keep the dev
    // console clean.
    if (app.isPackaged) {
      try {
        app.setLoginItemSettings({
          openAtLogin: currentSettings.launchAtLogin,
          openAsHidden: currentSettings.launchAtLogin,
        });
      } catch {
        // Still defensive — some unsigned packaged configs can throw instead
        // of just logging. We don't want startup to fail over launch-at-login.
      }
    }

    // Seed built-in templates on first launch (only inserts if not already present)
    const seededCount = await seedBuiltinTemplates(BUILTIN_TEMPLATES);
    if (seededCount > 0) {
      console.log(
        `[builtin-templates] Seeded ${seededCount} built-in templates`,
      );
    }

    // Start MCP server (utility reads settings via settings-mirror).
    // The utility probes upward from `currentSettings.port` if that port
    // is in use (e.g. another Eden instance) and returns the actually-bound
    // port. We track the resolved port in `resolvedPorts` (separate from
    // `currentSettings`) so:
    //   1. Downstream consumers (syncRemoteConfig, registerMcpWithRetry,
    //      writeMcpConfigHint) can target the live port.
    //   2. The user's chosen hint port stays in `currentSettings.port`
    //      and is preserved on save.
    const resolvedMcpPort = await startMcpServer();
    if (typeof resolvedMcpPort === 'number') {
      resolvedPorts.mcp = resolvedMcpPort;
      emitResolvedPortsChanged();
      if (resolvedMcpPort !== currentSettings.port) {
        appLog.info(
          `[startup] MCP bound on port=${resolvedMcpPort} (requested=${currentSettings.port})`,
        );
        // Keep the utility's settings-mirror in sync so writeMcpConfigHint
        // and any future readers see the resolved value.
        try {
          getUtilitySupervisor().emitSettingsUpdate({
            allowedPermissions: currentSettings.allowedPermissions ?? [],
            allowedReadFolders: currentSettings.allowedReadFolders ?? [],
            autoRegisterSubagents:
              currentSettings.autoRegisterSubagents ?? true,
            openCodePort:
              resolvedPorts.openCode ?? currentSettings.openCodePort,
            promptTimeoutSeconds: currentSettings.promptTimeoutSeconds,
            soundEnabled: currentSettings.soundEnabled,
            docIndexingEnabled: currentSettings.docIndexingEnabled,
            agentBackend: currentSettings.agentBackend,
            mcpPort: resolvedMcpPort,
          });
        } catch {
          // Supervisor may not have settled yet — non-fatal.
        }
      }
    }

    const isOpenCodeBackend = currentSettings.agentBackend === 'opencode';
    if (isOpenCodeBackend) {
      // Sync remote MCP entry into opencode.json on startup
      // Registration with OpenCode must be triggered manually via the
      // "Register provider config" button in Settings after OpenCode restarts.
      if (currentSettings.autoSyncOpencode) {
        try {
          const syncResult = await syncRemoteConfig(
            getEffectiveMcpPort(),
            currentSettings.promptTimeoutSeconds,
          );
          appLog.info(`[config-sync] ${syncResult}`);
        } catch (err) {
          appLog.warn(
            `[config-sync] failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      // Auto-start OpenCode serve before session probing/reconcile so cold-start
      // startup does not waste time probing a dead instance first.
      //
      // `startOpenCodeServer` is now async (in-process Server.listen()). We
      // still fire-and-forget the promise because the cold-start health-probe
      // below handles the race against consumers that need a live HTTP port.
      //
      // The resolver may bind a different port than `openCodePort` if it's
      // in use (e.g. another Eden instance). We record the actually-bound
      // port in `resolvedPorts.openCode` (separate from `currentSettings`)
      // so the user's hint is preserved and downstream consumers route to
      // the live server via `getEffectiveOpenCodePort()`.
      const openCodeStartPromise = currentSettings.autoStartOpenCode
        ? startOpenCodeServer(currentSettings.openCodePort)
            .then((resolvedPort) => {
              resolvedPorts.openCode = resolvedPort;
              emitResolvedPortsChanged();
              if (resolvedPort !== currentSettings.openCodePort) {
                appLog.info(
                  `[startup] OpenCode bound on port=${resolvedPort} (requested=${currentSettings.openCodePort})`,
                );
              }
            })
            .catch((err: unknown) => {
              appLog.error(
                `[startup] OpenCode in-process start failed: ${
                  err instanceof Error ? err.message : String(err)
                }`,
              );
            })
        : Promise.resolve();
      void openCodeStartPromise;

      // Start session-tree service (pull-on-invalidation model). Wait for
      // resolver so it gets the actually-bound port, not the stale hint.
      void openCodeStartPromise.then(() => {
        void startSessionTreeService(getEffectiveOpenCodePort());
      });

      // Cold-start readiness probe. `startOpenCodeServer` is fire-and-forget,
      // so the HTTP server may still be coming up when we fire the initial
      // provider fetch. Poll `checkOpenCodeHealth` every 500ms for up to 30s,
      // and once healthy, warm the main-side providers cache so the first
      // renderer IPC after mount returns instantly instead of racing boot.
      // (The session tree is pulled on-demand by the renderer — no warmup.)
      const openCodeHealthyPromise = waitForOpenCodeHealthy(() =>
        getEffectiveOpenCodePort(),
      );
      void openCodeHealthyPromise.then(async (healthy) => {
        if (!healthy) {
          appLog.warn(
            '[startup] OpenCode did not become healthy within 30s — skipping cold-start warmup',
          );
          return;
        }
        await fetchProvidersInfo(getEffectiveOpenCodePort()).catch(
          (err: unknown) => {
            appLog.warn(
              `[startup] providers warmup failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          },
        );

        // Start the periodic providers-info refresh now that OpenCode is
        // known healthy. This keeps the renderer cache warm across long
        // idle periods so opening a new-session form never hits a cold
        // main-side cache. Idempotent — clear any prior timer first.
        if (providersRefreshTimer) clearInterval(providersRefreshTimer);
        providersRefreshTimer = setInterval(() => {
          void refreshProvidersInfo(getEffectiveOpenCodePort()).catch(
            (err: unknown) => {
              appLog.warn(
                `[providers-refresh] periodic refresh failed: ${err instanceof Error ? err.message : String(err)}`,
              );
            },
          );
        }, PROVIDERS_REFRESH_INTERVAL_MS);

        // Kick off the health supervisor now that we've confirmed at
        // least one successful probe. Only supervises when the user has
        // auto-start enabled — otherwise they're running OpenCode
        // externally and we must not interfere with its lifecycle.
        startOpenCodeSupervisor(
          () => getEffectiveOpenCodePort(),
          () => currentSettings.autoStartOpenCode,
          appLog,
          (resolvedPort) => {
            appLog.info(
              `[supervisor] OpenCode rebound on port=${resolvedPort} (requested=${currentSettings.openCodePort})`,
            );
            resolvedPorts.openCode = resolvedPort;
            emitResolvedPortsChanged();
          },
        );
      });

      void openCodeHealthyPromise.then((healthy) => {
        if (!healthy) return;
        void getUtilitySupervisor()
          .getBridge()
          .request<{ ok: boolean; error?: string }>('start-event-stream', {
            openCodePort: getEffectiveOpenCodePort(),
          })
          .catch((err: unknown) => {
            appLog.error(
              `[utility] start-event-stream failed: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          });
      });

      void openCodeHealthyPromise.then((healthy) => {
        if (!healthy) return;
        void reconcileSessionConnections(getEffectiveOpenCodePort(), null)
          .then((reconResult) => {
            console.log(
              `[session-reconnect] matched=${reconResult.matched} cleaned=${reconResult.cleaned} total=${reconResult.total}`,
            );
          })
          .catch((err: unknown) => {
            appLog.warn(
              `[session-reconnect] failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          });
      });

      // Re-register with OpenCode on every startup so its MCP client performs a
      // fresh initialize handshake instead of hanging on a stale reconnect backoff.
      // This is fire-and-forget with retries — it resolves the Cmd+Q → relaunch
      // hang where activeClients stays 0 because OpenCode's client never completes
      // re-initialization after the previous server instance was killed.
      void registerMcpAfterOpenCodeHealthy({
        waitForHealthy: () => openCodeHealthyPromise,
        register: () =>
          registerMcpWithRetry({
            appPort: getEffectiveMcpPort(),
            openCodePort: getEffectiveOpenCodePort(),
            promptTimeoutSeconds: currentSettings.promptTimeoutSeconds,
          }),
        log: appLog,
      });
    } else if (currentSettings.agentBackend === 'claude_sdk') {
      const claudeRuntime = await detectClaudeSdkRuntime();
      console.log(`[claude-sdk] ${claudeRuntime.message}`);
    }
  };

  // Run deferred work after the window is ready to paint. `ready-to-show`
  // fires even when the window is kept hidden (launch-at-login case), so
  // this path still runs. Fallback to setImmediate if the window somehow
  // doesn't exist (shouldn't happen, but defensive).
  let deferredStarted = false;
  const startDeferredOnce = () => {
    if (deferredStarted) return;
    deferredStarted = true;
    setImmediate(() => {
      void runDeferredInit().catch((err) => {
        appLog.error(`Deferred init failed: ${String(err)}`);
      });
    });
  };

  if (mainWindow) {
    mainWindow.once('ready-to-show', startDeferredOnce);
    // Safety net: if ready-to-show never fires (e.g. renderer load failure),
    // kick off deferred init after a short delay so the MCP server still
    // comes up.
    setTimeout(startDeferredOnce, 3000);
  } else {
    setImmediate(startDeferredOnce);
  }
});

app.on('window-all-closed', () => {
  // Keep running in tray on macOS
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

let quitCleanupStarted = false;

app.on('before-quit', (event) => {
  // Synchronous cleanup is safe to call every time (idempotent).
  isQuitting = true;
  void stopSessionTreeService();
  // Ask the backend utility to stop the event stream. Fire-and-forget —
  // the supervisor's own before-quit hook will kill the child anyway.
  try {
    void getUtilitySupervisor()
      .getBridge()
      .request('stop-event-stream')
      .catch(() => {
        // Non-fatal during shutdown; child may have exited already.
      });
  } catch {
    // Supervisor not started yet — nothing to stop.
  }
  stopOpenCodeSupervisor();
  // stopOpenCodeServer is async now (in-process listener.stop()); fire-and-forget
  // since before-quit can't await and the OS will force-kill us if we linger.
  void stopOpenCodeServer().catch((err: unknown) => {
    console.warn(
      `[before-quit] stopOpenCodeServer failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  });

  if (providersRefreshTimer) {
    clearInterval(providersRefreshTimer);
    providersRefreshTimer = null;
  }

  // Layer D (stale-status fix): no-op for sidebar `sessionStatuses`.
  //
  // Renderer `sessionStatuses` is pure in-memory React state in
  // `useConnections`. It is never written to sqlite, electron-store, or
  // any persisted Jotai atom — verified by `grep -rn sessionStatuses src/`.
  // Closing the renderer drops the state on its own, so there is nothing
  // to clear here on shutdown. The startup grace-window gate in
  // `useStatusHandlers` (Layer A) is what prevents stale "green dot"
  // statuses from reappearing on the next launch.

  // Cancel any active MCP prompts BEFORE stopping the HTTP server so that
  // per-prompt `diagInterval`s and SSE keepalive timers do not keep the
  // Node.js event loop alive (which would prevent Electron from quitting
  // and leave the icon in the taskbar). Fire-and-forget: the async work
  // resolves quickly and we do not need to block shutdown on it.
  void softRestartMcpServer().catch((err: unknown) => {
    console.error('[main] softRestartMcpServer on before-quit failed:', err);
  });
  stopMcpServer();

  // With better-sqlite3, all writes are synchronous to WAL-journaled disk,
  // so there is no pending buffer to flush on shutdown.

  // Async cleanup: flush logs before quitting. Re-entrancy guard ensures
  // we only kick this off once; the second before-quit (after app.quit())
  // falls through cleanly.
  if (quitCleanupStarted) return;
  quitCleanupStarted = true;
  event.preventDefault();

  // Drain any pending log writes before we let the process exit.
  // Best-effort: flushLogger swallows I/O errors internally.
  // Guard with a 2 s timeout so a hung write chain never prevents quit.
  const flushTimeout = new Promise<void>((resolve) =>
    setTimeout(resolve, 2000),
  );
  void Promise.race([
    Promise.all([flushLogger(), flushSessionLogger()]).then(() => undefined),
    flushTimeout,
  ]).finally(() => {
    app.quit();
  });
});

// Export for IPC access
export { mainWindow };
