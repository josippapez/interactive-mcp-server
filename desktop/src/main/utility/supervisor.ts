/**
 * Supervisor for the backend utility process.
 *
 * Responsibilities
 * ----------------
 *   - `utilityProcess.fork()` the utility entry emitted by electron-vite at
 *     `out/main/opencode-utility.thread.mjs`.
 *   - Transfer one half of a `MessageChannelMain` to the child; keep the other
 *     half for main-side IPC (wrapped in a `Bridge`).
 *   - Race `ready` vs `exit` on startup so we fail fast if the child crashed
 *     before listening (Tauri pattern, plan §11 #2).
 *   - Auto-respawn with exponential backoff; cap at 3 consecutive failures in
 *     a rolling window — after that, surface the error and stop retrying
 *     (matches the OpenCode supervisor's existing behavior in
 *     `index.ts:117-183`).
 *   - Clean shutdown on `app.on('before-quit')` and app exit.
 *   - Phase 2: register main-side RPC handlers that the utility calls into
 *     (DB lookups, session-tree invalidation, auto-register, reinject,
 *     `to-renderer` forwarding). Push settings snapshot updates over the
 *     bridge so the utility event-stream sees the latest values.
 *
 * NOTE: This module must only be imported from the Electron main process.
 */

import { app, MessageChannelMain, utilityProcess } from 'electron';
import type { BrowserWindow, UtilityProcess } from 'electron';
import { join } from 'node:path';
import { Bridge } from './bridge';
import { injectOpenCodeMessage } from './opencode-client';
import {
  promptUser,
  cancelActivePrompt,
  forceTerminateChat,
  getPromptTimeoutSeconds,
  type PromptData,
  type PromptResponse,
} from '../ipc/prompt';
import { loadSettings } from '../settings';
import {
  showPermissionNotification,
  showQuestionNotification,
} from './permission-notification';

const UTILITY_ENTRY_FILENAME = 'opencode-utility.thread.mjs';

/** Max consecutive spawn/crash failures before giving up. */
const MAX_CONSECUTIVE_FAILURES = 3;
/** Initial backoff delay between respawn attempts. */
const INITIAL_BACKOFF_MS = 500;
/** Cap on backoff between attempts. */
const MAX_BACKOFF_MS = 5_000;
/** How long the child has to post `ready` before we treat startup as failed. */
const READY_TIMEOUT_MS = 10_000;
/** Window for counting consecutive failures; successful uptime beyond this
 *  resets the counter. */
const STABLE_UPTIME_MS = 30_000;

/** Subset of settings the utility backend needs. */
interface BackendSettingsPayload {
  allowedPermissions: readonly string[];
  allowedReadFolders: readonly string[];
  autoRegisterSubagents: boolean;
  openCodePort: number;
  logsDir: string;
  promptTimeoutSeconds: number;
  soundEnabled: boolean;
  docIndexingEnabled: boolean;
  agentBackend: 'opencode' | 'standalone' | 'claude_sdk';
  mcpPort: number;
}

function buildSettingsPayload(): BackendSettingsPayload {
  const s = loadSettings();
  return {
    allowedPermissions: s.allowedPermissions ?? [],
    allowedReadFolders: s.allowedReadFolders ?? [],
    autoRegisterSubagents: s.autoRegisterSubagents ?? true,
    openCodePort: s.openCodePort,
    logsDir: app.getPath('logs'),
    promptTimeoutSeconds: s.promptTimeoutSeconds,
    soundEnabled: s.soundEnabled,
    docIndexingEnabled: s.docIndexingEnabled,
    agentBackend: s.agentBackend,
    mcpPort: s.port,
  };
}

export interface UtilitySupervisor {
  /** Start the supervisor. Resolves when the first utility is `ready`. */
  start(): Promise<void>;
  /** Get the current bridge. Throws if not started / not ready. */
  getBridge(): Bridge;
  /** Tear down supervisor + child. Safe to call multiple times. */
  stop(): Promise<void>;
  /** Install a callback so main-side RPC handlers can reach the focused BrowserWindow. */
  setMainWindow(getMainWindow: () => BrowserWindow | null): void;
  /** Push a settings-snapshot update to the utility. Safe before start (queued implicitly via bridge availability check). */
  emitSettingsUpdate(snapshot?: Partial<BackendSettingsPayload>): void;
  /**
   * Push the OpenCode runtime URL to the utility (Mode B/C). No-op if
   * bridge not yet ready. The optional `password` argument carries the
   * Basic-auth credential for Mode C-spawned binaries; pass `undefined`
   * for unauthenticated runtimes (Mode A in-process / dev sidecars).
   */
  pushOpenCodeUrl(url: string | null, password?: string | null): void;
}

interface SupervisorState {
  starting: Promise<void> | null;
  child: UtilityProcess | null;
  bridge: Bridge | null;
  consecutiveFailures: number;
  lastSpawnAt: number;
  stopped: boolean;
  quitHookInstalled: boolean;
  getMainWindow: (() => BrowserWindow | null) | null;
}

/**
 * Create a supervisor. Only one should exist per app. The factory indirection
 * keeps this module easily unit-testable later (pass a fake
 * `utilityProcess.fork`).
 */
export function createUtilitySupervisor(): UtilitySupervisor {
  const state: SupervisorState = {
    starting: null,
    child: null,
    bridge: null,
    consecutiveFailures: 0,
    lastSpawnAt: 0,
    stopped: false,
    quitHookInstalled: false,
    getMainWindow: null,
  };

  function registerMainRpcs(bridge: Bridge): void {
    // ── Main-side shims invoked by utility backend modules ────────────
    bridge.handle('main.injectOpenCodeMessage', async (payload) => {
      const p = payload as
        | {
            openCodeSessionId?: string;
            message?: string;
            openCodePort?: number;
            noReply?: boolean;
          }
        | undefined;
      if (
        !p?.openCodeSessionId ||
        typeof p.message !== 'string' ||
        typeof p.openCodePort !== 'number'
      ) {
        return {
          ok: false,
          error: 'main.injectOpenCodeMessage missing required fields',
        };
      }
      return injectOpenCodeMessage(
        p.openCodeSessionId,
        p.message,
        undefined,
        p.openCodePort,
        undefined,
        p.noReply ?? true,
      );
    });

    // ── Prompt store RPCs (main owns BrowserWindow + ipcMain) ─────────
    bridge.handle('main.promptUser', async (payload) => {
      const p = payload as { data?: PromptData } | undefined;
      if (!p?.data) {
        return {
          answer: 'Error: main.promptUser missing data payload.',
        } satisfies PromptResponse;
      }
      const win = state.getMainWindow?.() ?? null;
      return promptUser(win, p.data);
    });

    bridge.handle('main.getPromptTimeoutSeconds', () =>
      getPromptTimeoutSeconds(),
    );

    bridge.on('main.cancelActivePrompt', (payload) => {
      const p = payload as { identity?: string } | undefined;
      if (p?.identity) {
        try {
          cancelActivePrompt(p.identity);
        } catch (err) {
          console.warn(
            `[utility-supervisor] cancelActivePrompt failed: ${String(err)}`,
          );
        }
      }
    });

    bridge.on('main.forceTerminateChat', (payload) => {
      const p = payload as { identity?: string } | undefined;
      if (p?.identity) {
        try {
          forceTerminateChat(p.identity);
        } catch (err) {
          console.warn(
            `[utility-supervisor] forceTerminateChat failed: ${String(err)}`,
          );
        }
      }
    });

    // ── Renderer forwarding ───────────────────────────────────────────
    bridge.on('to-renderer', (payload) => {
      const p = payload as { channel?: string; payload?: unknown } | undefined;
      if (!p?.channel) return;
      const win = state.getMainWindow?.();
      if (!win || win.isDestroyed()) return;
      try {
        win.webContents.send(p.channel, p.payload);
        if (p.channel === 'permission-asked') {
          const permissionPayload = p.payload as
            | {
                permission?: unknown;
                sessionID?: unknown;
                metadata?: Record<string, unknown>;
                patterns?: string[];
              }
            | undefined;
          if (typeof permissionPayload?.permission === 'string') {
            showPermissionNotification(win, {
              sessionID:
                typeof permissionPayload.sessionID === 'string'
                  ? permissionPayload.sessionID
                  : undefined,
              permission: permissionPayload.permission,
              metadata: permissionPayload.metadata,
              patterns: permissionPayload.patterns,
            });
          }
        }
        if (p.channel === 'question-asked') {
          const questionPayload = p.payload as
            | {
                questions?: Array<{ question?: unknown; header?: unknown }>;
                sessionID?: unknown;
              }
            | undefined;
          if (Array.isArray(questionPayload?.questions)) {
            showQuestionNotification(win, {
              sessionID:
                typeof questionPayload.sessionID === 'string'
                  ? questionPayload.sessionID
                  : undefined,
              questions: questionPayload.questions,
            });
          }
        }
      } catch (err) {
        console.warn(`[utility-supervisor] to-renderer failed: ${String(err)}`);
      }
    });
  }

  async function spawnOnce(): Promise<void> {
    // `__dirname` in the main-process ESM bundle resolves to `out/main/`.
    // electron-vite emits utility entries there alongside `index.mjs`
    // (see electron.vite.config.ts input map).
    const entry = join(__dirname, UTILITY_ENTRY_FILENAME);

    console.info(`[utility-supervisor] forking ${entry}`);
    state.lastSpawnAt = Date.now();

    const child = utilityProcess.fork(entry, [], {
      serviceName: 'interactive-mcp-backend',
      stdio: 'inherit',
    });
    state.child = child;

    const { port1, port2 } = new MessageChannelMain();
    const bridge = new Bridge(port1 as never, {
      tag: 'main',
      defaultRequestTimeoutMs: 15_000,
    });
    state.bridge = bridge;

    registerMainRpcs(bridge);

    // Wait for `spawn` before postMessage: the child can't receive anything
    // until it has initialised.
    await new Promise<void>((resolve, reject) => {
      const onSpawn = () => {
        child.off('error', onError);
        resolve();
      };
      const onError = (err: unknown) => {
        child.off('spawn', onSpawn);
        reject(err instanceof Error ? err : new Error(String(err)));
      };
      child.once('spawn', onSpawn);
      child.once('error', onError);
    });

    // Transfer port2 to the child. The child's entry will consume `ports[0]`
    // from the first message. Seed it with the initial settings snapshot so
    // the event-stream pump sees `allowedPermissions`/`allowedReadFolders`/
    // `autoRegisterSubagents` from the moment it starts.
    // `userDataPath` is forwarded so the utility-owned DB can compute the
    // conversations.db path without access to Electron's `app` module.
    const settings = buildSettingsPayload();
    child.postMessage(
      {
        kind: 'init',
        logsDir: settings.logsDir,
        userDataPath: app.getPath('userData'),
        settings,
      },
      [port2],
    );

    // Race ready-vs-exit. Tauri pattern: if the child exits before becoming
    // ready, we should fail fast instead of waiting the full timeout.
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(
          new Error(
            `[utility-supervisor] child did not emit 'ready' within ${READY_TIMEOUT_MS}ms`,
          ),
        );
      }, READY_TIMEOUT_MS);
      timer.unref?.();

      const offReady = bridge.on('ready', (payload) => {
        console.info('[utility-supervisor] child ready', payload);
        cleanup();
        resolve();
      });

      const onExit = (code: number) => {
        cleanup();
        reject(
          new Error(
            `[utility-supervisor] child exited before ready (code=${code})`,
          ),
        );
      };

      child.once('exit', onExit);

      function cleanup(): void {
        clearTimeout(timer);
        offReady();
        child.off('exit', onExit);
      }
    });

    // Child is healthy. Wire the "it died" handler for the rest of its life.
    child.once('exit', (code) => onChildExit(code));
  }

  function onChildExit(code: number): void {
    console.warn(`[utility-supervisor] child exited code=${code}`);
    // Drop references.
    state.bridge?.dispose(`child exited code=${code}`);
    state.bridge = null;
    state.child = null;

    if (state.stopped) return;

    const uptime = Date.now() - state.lastSpawnAt;
    if (uptime > STABLE_UPTIME_MS) {
      // Stable run — reset the failure counter.
      state.consecutiveFailures = 0;
    }
    state.consecutiveFailures++;

    if (state.consecutiveFailures > MAX_CONSECUTIVE_FAILURES) {
      console.error(
        `[utility-supervisor] giving up after ${state.consecutiveFailures} consecutive failures`,
      );
      return;
    }

    const delay = Math.min(
      INITIAL_BACKOFF_MS * 2 ** (state.consecutiveFailures - 1),
      MAX_BACKOFF_MS,
    );
    console.info(`[utility-supervisor] respawn in ${delay}ms`);
    setTimeout(() => {
      if (state.stopped) return;
      spawnOnce().catch((err) => {
        console.error('[utility-supervisor] respawn failed:', err);
        // `exit` will fire (or not) and drive the next attempt.
      });
    }, delay).unref?.();
  }

  function installQuitHook(): void {
    if (state.quitHookInstalled) return;
    state.quitHookInstalled = true;
    app.on('before-quit', () => {
      void stop();
    });
  }

  async function start(): Promise<void> {
    if (state.starting) return state.starting;
    if (state.bridge) return; // already running

    installQuitHook();
    state.stopped = false;

    state.starting = (async () => {
      try {
        await spawnOnce();
      } finally {
        state.starting = null;
      }
    })();

    return state.starting;
  }

  function getBridge(): Bridge {
    if (!state.bridge) {
      throw new Error(
        '[utility-supervisor] bridge not available — call start() first',
      );
    }
    return state.bridge;
  }

  function setMainWindow(getMainWindow: () => BrowserWindow | null): void {
    state.getMainWindow = getMainWindow;
  }

  function emitSettingsUpdate(
    snapshot?: Partial<BackendSettingsPayload>,
  ): void {
    if (!state.bridge) return;
    const payload = snapshot ?? buildSettingsPayload();
    try {
      state.bridge.emit('settings-updated', payload);
    } catch (err) {
      console.warn(
        `[utility-supervisor] emitSettingsUpdate failed: ${String(err)}`,
      );
    }
  }

  function pushOpenCodeUrl(url: string | null, password?: string | null): void {
    try {
      state.bridge?.emit('opencode.url.set', { url, password });
    } catch (err) {
      console.warn(`[supervisor] pushOpenCodeUrl failed:`, err);
    }
  }

  async function stop(): Promise<void> {
    if (state.stopped) return;
    state.stopped = true;
    const { child, bridge } = state;
    state.bridge = null;
    state.child = null;

    bridge?.dispose('supervisor.stop');

    if (!child) return;

    const exited = new Promise<void>((resolve) => {
      child.once('exit', () => resolve());
    });
    child.kill();
    // Best-effort: don't block quit indefinitely on a stuck child.
    await Promise.race([
      exited,
      new Promise<void>((r) => {
        const t = setTimeout(r, 2_000);
        t.unref?.();
      }),
    ]);
  }

  return {
    start,
    getBridge,
    stop,
    setMainWindow,
    emitSettingsUpdate,
    pushOpenCodeUrl,
  };
}

// Lazy singleton — main imports this. Tests can call the factory directly.
let singleton: UtilitySupervisor | null = null;

export function getUtilitySupervisor(): UtilitySupervisor {
  if (!singleton) singleton = createUtilitySupervisor();
  return singleton;
}
