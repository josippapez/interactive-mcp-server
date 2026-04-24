/**
 * Shell environment probing for Electron apps.
 *
 * When Electron is launched from macOS Dock/Spotlight (or Linux app launchers),
 * the PATH and other environment variables are minimal — they don't include
 * the user's shell configuration (.zshrc, .bashrc, etc.). This module probes
 * the user's login shell to capture the full environment, which is critical
 * for spawning MCP servers that depend on `npx`, `node`, etc.
 *
 * Ported from OpenCode's desktop-electron implementation.
 *
 * Strategy:
 *   1. Try interactive-login shell (`-il`) — captures full env including
 *      .zshrc/.bashrc customizations
 *   2. Fall back to login-only (`-l`) if interactive times out or fails
 *   3. Return null if both fail — caller can use fallback PATH augmentation
 *
 * Special cases:
 *   - Nushell is skipped (doesn't support `-il` / `-l` flags the same way)
 *   - 5-second timeout prevents hanging on misconfigured shells
 */

import { spawnSync } from 'node:child_process';
import { basename } from 'node:path';

const TIMEOUT_MS = 5_000;

type ProbeResult =
  | { type: 'Loaded'; value: Record<string, string> }
  | { type: 'Timeout' }
  | { type: 'Unavailable' };

/**
 * Get the user's default shell from $SHELL, or fall back to /bin/sh.
 */
export function getUserShell(): string {
  return process.env.SHELL || '/bin/sh';
}

/**
 * Parse null-separated environment output from `env -0`.
 *
 * Each line is `KEY=value` separated by null bytes. We split on null,
 * then split each entry on the first `=` to handle values containing `=`.
 */
export function parseShellEnv(out: Buffer): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of out.toString('utf8').split('\0')) {
    if (!line) continue;
    const ix = line.indexOf('=');
    if (ix <= 0) continue;
    env[line.slice(0, ix)] = line.slice(ix + 1);
  }
  return env;
}

/**
 * Probe a shell with the given mode to extract environment variables.
 *
 * @param shell - Path to the shell (e.g., /bin/zsh)
 * @param mode - Shell flags: "-il" for interactive-login, "-l" for login-only
 */
function probe(shell: string, mode: '-il' | '-l'): ProbeResult {
  const result = spawnSync(shell, [mode, '-c', 'env -0'], {
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: TIMEOUT_MS,
    windowsHide: true,
  });

  const err = result.error as NodeJS.ErrnoException | undefined;
  if (err) {
    if (err.code === 'ETIMEDOUT') return { type: 'Timeout' };
    console.log(
      `[shell-env] Probe failed for ${shell} ${mode}: ${err.message}`,
    );
    return { type: 'Unavailable' };
  }

  if (result.status !== 0) {
    console.log(
      `[shell-env] Probe exited with non-zero status for ${shell} ${mode}`,
    );
    return { type: 'Unavailable' };
  }

  const env = parseShellEnv(result.stdout);
  if (Object.keys(env).length === 0) {
    console.log(`[shell-env] Probe returned empty env for ${shell} ${mode}`);
    return { type: 'Unavailable' };
  }

  return { type: 'Loaded', value: env };
}

/**
 * Check if the shell is nushell, which doesn't support standard shell flags.
 */
export function isNushell(shell: string): boolean {
  const name = basename(shell).toLowerCase();
  const raw = shell.toLowerCase();
  return name === 'nu' || name === 'nu.exe' || raw.endsWith('\\nu.exe');
}

/**
 * Load environment variables from the user's login shell.
 *
 * Tries interactive-login mode first, falls back to login-only mode.
 * Returns null if both fail (caller should use fallback PATH augmentation).
 *
 * @param shell - Path to the shell (defaults to getUserShell())
 */
export function loadShellEnv(
  shell: string = getUserShell(),
): Record<string, string> | null {
  if (isNushell(shell)) {
    console.log(`[shell-env] Skipping probe for nushell: ${shell}`);
    return null;
  }

  // Try interactive-login mode first — this captures .zshrc/.bashrc
  const interactive = probe(shell, '-il');
  if (interactive.type === 'Loaded') {
    console.log(
      `[shell-env] Loaded environment with -il (${Object.keys(interactive.value).length} vars)`,
    );
    return interactive.value;
  }
  if (interactive.type === 'Timeout') {
    console.warn(`[shell-env] Interactive shell probe timed out: ${shell}`);
    return null;
  }

  // Fall back to login-only mode
  const login = probe(shell, '-l');
  if (login.type === 'Loaded') {
    console.log(
      `[shell-env] Loaded environment with -l (${Object.keys(login.value).length} vars)`,
    );
    return login.value;
  }

  console.warn(`[shell-env] Falling back to app environment: ${shell}`);
  return null;
}

/**
 * Merge shell environment with additional env overrides.
 *
 * Shell env is the base, overrides take precedence.
 */
export function mergeShellEnv(
  shell: Record<string, string> | null,
  env: Record<string, string>,
): Record<string, string> {
  return {
    ...shell,
    ...env,
  };
}
