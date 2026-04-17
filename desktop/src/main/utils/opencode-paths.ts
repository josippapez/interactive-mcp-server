/**
 * Canonical helpers for OpenCode filesystem paths.
 *
 * These replace ad-hoc `join(homedir(), '.config', 'opencode', ...)` and
 * `join(baseDirectory, '.opencode', ...)` snippets scattered across the
 * opencode modules. Centralising them makes it trivial to rewire test
 * fixtures, port the app to another OS layout, or rename the directory.
 */

import { homedir } from 'os';
import { join } from 'path';

const GLOBAL_OPENCODE_SEGMENTS = ['.config', 'opencode'] as const;
const PROJECT_OPENCODE_SEGMENT = '.opencode';
const AGENT_SEGMENT = 'agent';
const CONFIG_FILE = 'opencode.json';
const CONFIG_FILE_JSONC = 'opencode.jsonc';

/** `~/.config/opencode` */
export function getGlobalOpencodeDir(): string {
  return join(homedir(), ...GLOBAL_OPENCODE_SEGMENTS);
}

/** `<baseDirectory>/.opencode` */
export function getProjectOpencodeDir(baseDirectory: string): string {
  return join(baseDirectory, PROJECT_OPENCODE_SEGMENT);
}

/** `~/.config/opencode/agent` */
export function getGlobalAgentDir(): string {
  return join(getGlobalOpencodeDir(), AGENT_SEGMENT);
}

/** `<baseDirectory>/.opencode/agent` */
export function getProjectAgentDir(baseDirectory: string): string {
  return join(getProjectOpencodeDir(baseDirectory), AGENT_SEGMENT);
}

/** `~/.config/opencode/opencode.json` */
export function getGlobalOpencodeConfigPath(): string {
  return join(getGlobalOpencodeDir(), CONFIG_FILE);
}

/**
 * `<baseDirectory>/.opencode/opencode.jsonc` — the preferred project config
 * location. Callers that need to fall back to `.json` should check for
 * `getProjectOpencodeConfigPath(base, 'json')` separately.
 */
export function getProjectOpencodeConfigPath(
  baseDirectory: string,
  variant: 'jsonc' | 'json' = 'jsonc',
): string {
  return join(
    getProjectOpencodeDir(baseDirectory),
    variant === 'jsonc' ? CONFIG_FILE_JSONC : CONFIG_FILE,
  );
}
