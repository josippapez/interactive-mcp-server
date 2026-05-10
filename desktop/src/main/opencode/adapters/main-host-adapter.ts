/**
 * Mode B / Mode C adapter — main-process owns the OpenCode runtime.
 *
 * Composes:
 *   - {@link createManagedProcess} — process supervisor (health probe,
 *     graceful stop → forceKill, exit/log fan-out, idempotent stop).
 *   - A {@link ProcessStrategy} chosen by `RUNTIME_KIND`:
 *       * `dedicated-utility`  → {@link ForkedUtilityStrategy}  (Mode B)
 *       * `native-subprocess`  → {@link NativeBinaryStrategy}   (Mode C)
 *
 * The strategy is the ONE file that differs between Mode B and Mode C.
 * Everything above (supervisor, adapter, facade, selector) is identical.
 * That is the entire point of the refactor: when Mode C lands, it's a
 * one-file diff.
 *
 * Lifecycle responsibilities owned here (and not by the strategy):
 *   1. Read `userDataPath` and `logsDir` from main-side `loadSettings`
 *      and Electron's `app.getPath('logs')` so the strategy stays pure.
 *   2. Idempotency on same-port `start` calls; restart on different-port.
 *   3. Push the new URL into the main-side URL subject and broadcast it
 *      to the backend utility via `supervisor.pushOpenCodeUrl(url)` so
 *      backend SDK clients see the authoritative value.
 *   4. Crash detection — when the managed process exits unexpectedly,
 *      clear the URL subject and broadcast `null` to the backend.
 *   5. Forward strategy log lines to the file logger and console.
 *
 * Topology guard: Mode B/C MUST NOT be created from anything other than
 * the Electron main process. The runtime factory enforces this; this
 * adapter is structurally main-only by virtue of importing
 * `electron.app` (transitively, via `loadSettings`) and the strategy
 * files which import `electron` / `node:child_process`.
 */

import { app } from 'electron';
import { createLogger } from '../../utils/logger';
import { getUtilitySupervisor } from '../../utility/supervisor';
import {
  createManagedProcess,
  type ManagedProcess,
  type ProcessStrategy,
} from '../runtime/managed-process';
import { ForkedUtilityStrategy } from '../runtime/strategies/forked-utility';
import { ChildProcessForkStrategy } from '../runtime/strategies/child-process-fork';
import { NativeBinaryStrategy } from '../runtime/strategies/native-binary';
import { RUNTIME_KIND } from '../runtime-mode';
import { resolveOpenCodePort } from '../runtime/port-resolver';
import {
  setOpenCodeUrl as setMainUrl,
  getOpenCodeUrl as getMainUrl,
} from '../url-subject';
import {
  getOpenCodePassword as getMainPassword,
  setOpenCodePassword as setMainPassword,
} from '../password-subject';
import { setOpenCodePasswordGetter } from '../../../shared/opencode-password-source';

// Register the main-process password source for the shared SDK cache so
// any main-side `getClient()` consumer that fires before the host adapter
// has spawned still gets `null` (and unauthenticated) until the password
// is published. Idempotent.
setOpenCodePasswordGetter(getMainPassword);
import { loadSettings } from '../../settings';
import type { OpenCodeServerAdapter } from './types';

const LOG_PREFIX = '[opencode-adapter:main-host]';
const HEALTH_PROBE_PATH = '/'; // OpenCode root returns 200 once listening
const HEALTH_PROBE_TIMEOUT_MS = 30_000;
const HEALTH_PROBE_INTERVAL_MS = 250;
const STOP_TIMEOUT_MS = 5_000;

/**
 * Build the strategy instance for the active mode. Lives at module scope
 * (not inside the adapter) so unit tests can swap it out cheaply.
 */
function buildStrategy(): ProcessStrategy {
  switch (RUNTIME_KIND) {
    case 'dedicated-utility':
      return new ForkedUtilityStrategy();
    case 'forked-child':
      return new ChildProcessForkStrategy();
    case 'native-subprocess':
      return new NativeBinaryStrategy();
    default:
      // Defensive — `MainHostAdapter` should never be selected for Mode A.
      // Selector enforces this; throw loud if reached.
      throw new Error(
        `${LOG_PREFIX} buildStrategy() called with non-host RUNTIME_KIND='${RUNTIME_KIND}'. ` +
          `MainHostAdapter is only valid for 'dedicated-utility', 'forked-child', or 'native-subprocess'.`,
      );
  }
}

export class MainHostAdapter implements OpenCodeServerAdapter {
  private managed: ManagedProcess | null = null;
  /** Port the caller asked for (the starting hint). */
  private requestedPort: number | null = null;
  /** Port we actually bound (may differ from requestedPort after probing). */
  private resolvedPort: number | null = null;
  private startingPromise: Promise<void> | null = null;
  private detachExit: (() => void) | null = null;
  private detachLog: (() => void) | null = null;
  private readonly log = createLogger('opencode-host');

  /**
   * Boot the OpenCode HTTP server.
   *
   * Idempotent: same-port (after resolution) call resolves immediately.
   * Different-port call stops the previous instance first.
   *
   * `requestedPort` is a *starting hint* — if it's free we use it, otherwise
   * we probe upward via `resolveOpenCodePort`. The actually-bound port is
   * available afterwards via `getResolvedPort()` and via the broadcast URL.
   */
  async start(requestedPort: number): Promise<void> {
    if (this.managed && this.requestedPort === requestedPort) {
      return;
    }

    if (this.startingPromise) {
      await this.startingPromise;
      if (this.managed && this.requestedPort === requestedPort) return;
    }

    if (this.managed) {
      await this.stop();
    }

    this.startingPromise = (async () => {
      const settings = loadSettings();
      const userDataPath = app.getPath('userData');
      const logsDir = app.getPath('logs');

      void settings; // settings reserved for future use (e.g. log level)

      // Resolve a free port. Reclaims our own stale child if the pidfile
      // names a process still pinning `requestedPort`. Otherwise probes
      // upward without touching foreign processes.
      const resolution = await resolveOpenCodePort({
        userDataPath,
        startPort: requestedPort,
        log: (msg) => {
          this.log.info(msg);
          console.info(msg);
        },
      });
      const port = resolution.port;

      const strategy = buildStrategy();
      const managed = createManagedProcess(strategy, {
        port,
        userDataPath,
        logsDir,
        tag: 'opencode-host',
        healthProbe: {
          pathSuffix: HEALTH_PROBE_PATH,
          intervalMs: HEALTH_PROBE_INTERVAL_MS,
          timeoutMs: HEALTH_PROBE_TIMEOUT_MS,
        },
      });

      // Wire log fan-out before start() so any early stderr is captured.
      // Mirror to console as well — file-only logging hid the host's own
      // diagnostics during the Mode B restart-loop investigation.
      this.detachLog = managed.onLog((line) => {
        if (line.length === 0) return;
        this.log.info(line);
        console.log(`[opencode-host] ${line}`);
      });

      // Wire crash detection BEFORE start() so a probe-time exit is also
      // caught here (the supervisor already rejects the start promise on
      // exit; this listener handles unexpected post-start exits).
      this.detachExit = managed.onExit((info) => {
        const summary = `child exited code=${info.code ?? 'null'} signal=${info.signal ?? 'null'}`;
        this.log.warn(summary);
        // Console mirror so the restart cause is visible in `npm run dev`.
        // Logged unconditionally — even when triggered via stop(), this
        // tells us whether forceKill was needed.
        console.warn(`${LOG_PREFIX} ${summary}`);
        // Only mutate state if THIS adapter still believes it owns the
        // managed process. A concurrent stop() already cleared state.
        if (this.managed === managed) {
          this.broadcastUrl(null);
          this.managed = null;
          this.requestedPort = null;
          this.resolvedPort = null;
        }
      });

      console.info(
        `${LOG_PREFIX} starting (mode=${RUNTIME_KIND}) on port=${port} (requested=${requestedPort})`,
      );

      try {
        const { url, password } = await managed.start();
        this.managed = managed;
        this.requestedPort = requestedPort;
        this.resolvedPort = port;
        this.broadcastUrl(url, password);
        console.info(
          `${LOG_PREFIX} ready at ${url} (auth=${password ? 'enabled' : 'disabled'})`,
        );
      } catch (err) {
        // Spawn or probe failed — supervisor has already force-killed and
        // reset its internal state. We just need to detach our listeners
        // so a retry doesn't double-fire them.
        this.detachListeners();
        throw err;
      }
    })();

    try {
      await this.startingPromise;
    } finally {
      this.startingPromise = null;
    }
  }

  async stop(): Promise<void> {
    const dying = this.managed;
    if (!dying) return;

    this.managed = null;
    this.requestedPort = null;
    this.resolvedPort = null;
    this.broadcastUrl(null);

    try {
      await dying.stop(STOP_TIMEOUT_MS);
    } catch (err) {
      console.warn(
        `${LOG_PREFIX} managed.stop threw (ignored): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    } finally {
      this.detachListeners();
    }
  }

  isRunning(): boolean {
    return this.managed !== null && getMainUrl() !== null;
  }

  getUrl(): string | null {
    return getMainUrl();
  }

  getResolvedPort(): number | null {
    return this.resolvedPort;
  }

  /**
   * Push URL state into both the main-side URL subject and the backend
   * utility. The backend mirror is updated via the bridge event handled
   * in `utility/backend/opencode/url-bridge-handler.ts`.
   *
   * Password (Mode C): set BEFORE the URL on the main side so any
   * synchronous reader of the URL subject already sees the credential.
   * The bridge payload carries both fields together; the receiving handler
   * applies them in the same order.
   */
  private broadcastUrl(url: string | null, password?: string | null): void {
    // Password first: closes the auth race for any consumer that wakes
    // on the URL change. `null` clears, `undefined` leaves unchanged on
    // the bridge side; on the main side we map undefined → null because
    // a missing url + undefined password is meaningless.
    setMainPassword(password ?? null);
    setMainUrl(url);
    try {
      getUtilitySupervisor().pushOpenCodeUrl(url, password ?? null);
    } catch (err) {
      // Non-fatal: supervisor may not be up yet (very early startup) or
      // already disposed (during quit). Log and continue.
      console.warn(
        `${LOG_PREFIX} pushOpenCodeUrl failed (continuing): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private detachListeners(): void {
    if (this.detachExit) {
      try {
        this.detachExit();
      } catch {
        /* ignore */
      }
      this.detachExit = null;
    }
    if (this.detachLog) {
      try {
        this.detachLog();
      } catch {
        /* ignore */
      }
      this.detachLog = null;
    }
  }
}
