/**
 * Native-binary process strategy (Mode C).
 *
 * # What this is
 *
 * Spawns the upstream `opencode` native binary directly via
 * `child_process.spawn`. The binary handles `Server.listen()` itself —
 * we don't import the OpenCode JS bundle at all. This is the production
 * topology: a real OS process with a real binary identity, no Electron
 * sandbox, no `ELECTRON_RUN_AS_NODE` shenanigans.
 *
 * # Why Mode C is the real fix
 *
 * Mode B (Electron `utilityProcess.fork`) and Mode B' (Node
 * `child_process.fork`) both run under the Electron framework binary
 * because `process.execPath` is the Electron framework when the parent
 * is Electron main. macOS attaches networking entitlements / sandbox
 * scopes to binary identity, so both modes inherit Electron's
 * cross-process loopback restrictions, which manifested as ECONNREFUSED
 * after ~30 seconds of healthy serving.
 *
 * Mode C spawns a different binary entirely — the upstream `opencode`
 * single-file binary — so it has its own clean process identity and
 * none of those constraints apply.
 *
 * # CLI shape (verified against installed binary)
 *
 *   opencode serve --port <N> --hostname 127.0.0.1 --print-logs --log-level WARN
 *
 * On bind, the binary writes one line to STDOUT (not stderr):
 *   opencode server listening on http://127.0.0.1:<N>
 *
 * Logs (when `--print-logs --log-level <level>` is set) go to stderr.
 *
 * # Binary location
 *
 *   1. `process.env.OPENCODE_BIN` override (dev convenience).
 *   2. Production: `<resourcesPath>/opencode-bin/<platform>-<arch>/opencode[.exe]`
 *      (matches the upstream Tauri sidecar layout — to be wired up by a
 *      `desktop/scripts/copy-opencode-bin.mjs` step before packaging).
 *   3. Dev fallback: `~/.opencode/bin/opencode` (the user's installed
 *      OpenCode CLI). Convenient because it's already there.
 *
 * # Orphan / parent-death protection
 *
 * Same approach as `ChildProcessForkStrategy`: track PIDs in a module
 * set, install a one-time parent-death hook that SIGKILLs all live
 * children on exit/SIGTERM/SIGINT/SIGHUP/uncaughtException. Plus a
 * pre-spawn orphan sweep that kills anything currently holding LISTEN
 * on the target port.
 */

import { execFileSync, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { cpus, homedir } from 'node:os';

import { app } from 'electron';

import type { ProcessStrategy, SpawnedHandle } from '../managed-process';
import { setOpenCodePassword } from '../../password-subject';
import { writePidfile, clearPidfile } from '../port-resolver';

const LOG_PREFIX = '[native-binary-strategy]';
const LISTEN_TIMEOUT_MS = 10_000;
const IS_POSIX = process.platform !== 'win32';

type SpawnArgs = Parameters<ProcessStrategy['spawn']>[0];

// ─── Process-group / tree kill helpers ───
//
// `opencode serve` spawns shells (via its agent bash tool) which in turn
// can spawn long-running build processes. If we kill only the opencode
// PID, those grandchildren get reparented to PID 1 and keep running,
// pegging CPU and holding gigabytes of RAM (observed: a leaked
// `electron-vite build` + esbuild services consuming 100% CPU and ~1.5
// GB after the parent shell exited).
//
// On POSIX we make `opencode serve` its own process-group leader by
// spawning with `detached: true`, then signal the whole group via the
// negative-PID convention: `process.kill(-pgid, sig)` delivers `sig` to
// every process in the group. On Windows we fall back to
// `taskkill /T /F` which walks the parent-child tree and force-kills it.

function killTree(pid: number, signal: NodeJS.Signals, reason: string): void {
  if (IS_POSIX) {
    try {
      // Negative PID = signal the whole process group.
      process.kill(-pid, signal);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      // ESRCH = group already gone. Anything else, fall back to single-PID.
      if (code !== 'ESRCH') {
        try {
          process.kill(pid, signal);
        } catch {
          /* already gone */
        }
      }
    }
    return;
  }

  // Windows: taskkill /T (tree) /F (force) — only meaningful for SIGKILL.
  // For SIGTERM equivalent we just drop the /F and let taskkill send
  // WM_CLOSE-style termination to the tree.
  try {
    const force = signal === 'SIGKILL' ? ['/F'] : [];
    execFileSync('taskkill', ['/pid', String(pid), '/T', ...force], {
      stdio: 'ignore',
    });
  } catch {
    // Fallback to the direct child kill if taskkill is unavailable.
    try {
      process.kill(pid, signal);
    } catch {
      /* already gone */
    }
  }
  void reason;
}

// ─── Parent-death protection (mirrors child-process-fork.ts) ───

const liveBinPids = new Set<number>();
let parentDeathHookInstalled = false;

function installParentDeathHook(): void {
  if (parentDeathHookInstalled) return;
  parentDeathHookInstalled = true;

  const killAll = (reason: string): void => {
    if (liveBinPids.size === 0) return;
    console.info(
      `${LOG_PREFIX} parent-death hook: SIGKILL ${liveBinPids.size} binary child(ren) (reason=${reason})`,
    );
    for (const pid of liveBinPids) {
      killTree(pid, 'SIGKILL', `parent-death:${reason}`);
    }
    liveBinPids.clear();
  };

  process.on('exit', () => killAll('exit'));

  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
    process.on(sig, () => {
      killAll(sig);
      process.removeAllListeners(sig);
      process.kill(process.pid, sig);
    });
  }

  process.on('uncaughtException', (err) => {
    killAll('uncaughtException');
    setImmediate(() => {
      throw err;
    });
  });
}

// Note: previous releases included `sweepOrphansHoldingPort(port)` which
// SIGKILLed any process holding LISTEN on the requested port. That broke
// dev/prod coexistence (each Eden instance murdered the other on startup).
// Port collision handling now lives in `port-resolver.resolveOpenCodePort`,
// invoked by the host adapter before `strategy.spawn`. We only kill our own
// stale children (tracked via `<userDataPath>/opencode.pid`) and probe
// upward for a free port otherwise.

// ─── Binary path resolution ───

function resolveBinaryPath(): string {
  const platform = process.platform;
  const arch = process.arch;
  const binName = platform === 'win32' ? 'opencode.exe' : 'opencode';
  const sidecarArch =
    platform === 'darwin' && arch === 'x64' && isAppleSiliconHost()
      ? 'arm64'
      : arch;

  // 1. Env override — highest priority, useful in dev and CI.
  const envOverride = process.env.OPENCODE_BIN;
  if (envOverride && existsSync(envOverride)) {
    return envOverride;
  }

  // 2. Production sidecar layout.
  if (app.isPackaged) {
    const sidecar = join(
      process.resourcesPath,
      'opencode-bin',
      `${platform}-${sidecarArch}`,
      binName,
    );
    if (existsSync(sidecar)) return sidecar;
    throw new Error(
      `${LOG_PREFIX} packaged opencode binary not found at ${sidecar}. ` +
        'Did the copy-opencode-bin prebuild step run?',
    );
  }

  // 3. Dev: project-local sidecar (if the user has copied one in).
  const devSidecar = join(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    '..',
    'resources',
    'opencode-bin',
    `${platform}-${sidecarArch}`,
    binName,
  );
  if (existsSync(devSidecar)) return devSidecar;

  // 4. Dev fallback: globally installed OpenCode CLI under ~/.opencode/bin.
  const userInstall = join(homedir(), '.opencode', 'bin', binName);
  if (existsSync(userInstall)) return userInstall;

  throw new Error(
    `${LOG_PREFIX} could not locate opencode binary. Tried (in order):\n` +
      `  - $OPENCODE_BIN (=${envOverride ?? 'unset'})\n` +
      `  - ${devSidecar}\n` +
      `  - ${userInstall}\n` +
      'Set OPENCODE_BIN, run the copy-opencode-bin script, or install OpenCode globally.',
  );
}

function isAppleSiliconHost(): boolean {
  if (process.platform !== 'darwin') return false;
  if (process.arch === 'arm64') return true;
  return cpus().some((cpu) => /apple/i.test(cpu.model));
}

// ─── Strategy ───

export class NativeBinaryStrategy implements ProcessStrategy {
  async spawn(args: SpawnArgs): Promise<SpawnedHandle> {
    const { port, userDataPath } = args;

    installParentDeathHook();
    // Note: port collision handling lives in `port-resolver.resolveOpenCodePort`
    // (called by the host adapter before this strategy's spawn). We no longer
    // SIGKILL foreign processes holding the requested port.

    // Generate a random Basic-auth password for this spawn. The binary
    // honours `OPENCODE_SERVER_PASSWORD` and emits a "server is unsecured"
    // warning when it's missing. Username is always `opencode` per the
    // upstream SDK helper. URL-safe base64 keeps it env-var-friendly.
    const password = randomBytes(32).toString('base64url');

    const binPath = resolveBinaryPath();
    console.info(
      `${LOG_PREFIX} spawning ${binPath} serve --port ${port} --hostname 127.0.0.1`,
    );

    const child = spawn(
      binPath,
      [
        'serve',
        '--port',
        String(port),
        '--hostname',
        '127.0.0.1',
        '--print-logs',
        '--log-level',
        'WARN',
      ],
      {
        env: {
          ...process.env,
          XDG_STATE_HOME: userDataPath,
          OPENCODE_CLIENT: 'desktop',
          OPENCODE_SERVER_PASSWORD: password,
          // Strip ELECTRON_RUN_AS_NODE if it leaked from a parent — we are
          // running a real binary, not Electron-as-Node.
          ELECTRON_RUN_AS_NODE: undefined as unknown as string,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        // POSIX: become process-group leader so we can later signal the
        // whole tree (opencode + agent-spawned shells + their children)
        // via process.kill(-pid, …). On Windows we leave it false and
        // rely on `taskkill /T /F` for tree termination.
        //
        // Note: we do NOT call `child.unref()`. We still want Node's
        // event loop to track stdio + the exit event; `detached: true`
        // alone is enough to make the child its own process-group leader.
        detached: IS_POSIX,
      },
    );

    // Race spawn vs error.
    await new Promise<void>((resolve, reject) => {
      const onSpawn = (): void => {
        child.off('error', onError);
        resolve();
      };
      const onError = (err: unknown): void => {
        child.off('spawn', onSpawn);
        reject(err instanceof Error ? err : new Error(String(err)));
      };
      child.once('spawn', onSpawn);
      child.once('error', onError);
    });

    if (typeof child.pid === 'number') {
      liveBinPids.add(child.pid);
      writePidfile(userDataPath, child.pid);
      child.once('exit', () => {
        if (typeof child.pid === 'number') {
          liveBinPids.delete(child.pid);
        }
        clearPidfile(userDataPath);
      });
    }

    // Set up log fan-out before parsing the listen line so any startup
    // diagnostics are captured.
    const logSubscribers = new Set<(line: string) => void>();
    const emitLine = (line: string): void => {
      if (line.length === 0) return;
      for (const cb of logSubscribers) {
        try {
          cb(line);
        } catch (err) {
          console.warn(`${LOG_PREFIX} log subscriber threw:`, err);
        }
      }
    };

    // Parse stdout for the listen line; mirror everything to log fan-out.
    const url = await waitForListenLine(child, emitLine);

    // Publish the Basic-auth password into the main-side subject NOW —
    // before this `spawn()` resolves. The managed-process supervisor's
    // readiness probe (`runHealthProbe`) fires immediately after we
    // return, and it reads the password lazily via `auth-header.ts`. If
    // we waited until after the supervisor's probe (when host-adapter
    // calls `broadcastUrl(url, password)`), every probe attempt would
    // 401 and the supervisor would force-kill the binary as unhealthy.
    //
    // Idempotent: host-adapter will set the same value again at the end
    // of `start()` and additionally push it onto the bridge for the
    // utility process. Setting it twice with the same value is a no-op.
    setOpenCodePassword(password);

    // After listen-line found, keep stdout flowing as logs.
    const stopStdout = attachLineReader(child.stdout, emitLine);
    const stopStderr = attachLineReader(child.stderr, emitLine);

    const handle: SpawnedHandle = {
      url,
      password,
      getPid: () => child.pid ?? null,
      onExit: (cb) => {
        const handler = (
          code: number | null,
          signal: NodeJS.Signals | null,
        ): void => {
          cb({ code, signal });
        };
        child.on('exit', handler);
        return () => {
          child.off('exit', handler);
        };
      },
      onLog: (cb) => {
        logSubscribers.add(cb);
        return () => {
          logSubscribers.delete(cb);
        };
      },
      requestStop: () => {
        const pid = child.pid;
        if (typeof pid === 'number') {
          killTree(pid, 'SIGTERM', 'requestStop');
        } else {
          try {
            child.kill('SIGTERM');
          } catch {
            /* ignore */
          }
        }
      },
      forceKill: () => {
        const pid = child.pid;
        if (typeof pid === 'number') {
          killTree(pid, 'SIGKILL', 'forceKill');
        } else {
          try {
            child.kill('SIGKILL');
          } catch {
            /* ignore */
          }
        }
        stopStdout();
        stopStderr();
      },
    };

    child.once('exit', () => {
      stopStdout();
      stopStderr();
    });

    return handle;
  }
}

// ─── Helpers ───

/**
 * Read child stdout until we see the `opencode server listening on <url>`
 * line, OR the LISTEN_TIMEOUT_MS deadline, OR an early exit. Resolves with
 * the URL on success.
 *
 * Lines read here are ALSO forwarded to `emitLine` so they remain visible
 * via the standard log fan-out path. After this function resolves, the
 * caller still attaches its own line reader to keep streaming subsequent
 * stdout (we detach our temporary listener before resolving).
 */
function waitForListenLine(
  child: ChildProcess,
  emitLine: (line: string) => void,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const startedAt = Date.now();
    let buffer = '';

    const cleanup = (): void => {
      child.stdout?.off('data', onData);
      child.off('exit', onExit);
      clearTimeout(timer);
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
      const elapsed = Date.now() - startedAt;
      reject(
        new Error(
          `${LOG_PREFIX} did not see listen line within ${LISTEN_TIMEOUT_MS}ms (waited ${elapsed}ms)`,
        ),
      );
    }, LISTEN_TIMEOUT_MS);
    timer.unref?.();

    const onData = (chunk: Buffer | string): void => {
      if (settled) return;
      buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      let nl = buffer.indexOf('\n');
      while (nl !== -1) {
        const line = buffer.slice(0, nl).replace(/\r$/, '');
        buffer = buffer.slice(nl + 1);
        emitLine(line);
        const m = line.match(/listening on (https?:\/\/\S+)/i);
        if (m && !settled) {
          settled = true;
          cleanup();
          // Trim a trailing slash if present so callers can append paths
          // predictably.
          const url = m[1].replace(/\/+$/, '');
          console.info(`${LOG_PREFIX} listen line found: ${url}`);
          resolve(url);
          // Push any remaining buffered text back through emitLine via the
          // post-resolve attachLineReader the caller installs.
          return;
        }
        nl = buffer.indexOf('\n');
      }
    };

    const onExit = (
      code: number | null,
      signal: NodeJS.Signals | null,
    ): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(
        new Error(
          `${LOG_PREFIX} binary exited before listen line (code=${code}, signal=${signal})`,
        ),
      );
    };

    child.stdout?.on('data', onData);
    child.once('exit', onExit);
  });
}

/**
 * Same line-buffering reader used in `child-process-fork.ts`. Duplicated
 * rather than shared so each strategy is self-contained.
 */
function attachLineReader(
  stream: NodeJS.ReadableStream | null,
  onLine: (line: string) => void,
): () => void {
  if (stream === null) {
    return () => {
      /* noop */
    };
  }

  let buffer = '';
  let detached = false;

  const onData = (chunk: Buffer | string): void => {
    if (detached) return;
    buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    let nl = buffer.indexOf('\n');
    while (nl !== -1) {
      const line = buffer.slice(0, nl).replace(/\r$/, '');
      buffer = buffer.slice(nl + 1);
      onLine(line);
      nl = buffer.indexOf('\n');
    }
  };

  const onEnd = (): void => {
    if (detached) return;
    if (buffer.length > 0) {
      onLine(buffer.replace(/\r$/, ''));
      buffer = '';
    }
  };

  stream.on('data', onData);
  stream.once('end', onEnd);

  return () => {
    if (detached) return;
    detached = true;
    stream.off('data', onData);
    stream.off('end', onEnd);
    if (buffer.length > 0) {
      try {
        onLine(buffer.replace(/\r$/, ''));
      } catch {
        /* ignore */
      }
      buffer = '';
    }
  };
}
