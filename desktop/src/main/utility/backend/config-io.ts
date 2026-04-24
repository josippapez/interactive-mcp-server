/**
 * Safe reader/writer for OpenCode config files (global + per-project).
 *
 * The critical invariant is that the `mcp["interactive-desktop"]` subtree is
 * OWNED by `syncRemoteConfig` (see config-sync.ts). UI-facing writers must
 * never overwrite it. `mergePreservingManagedKeys` enforces that invariant by
 * always copying the on-disk managed value back over whatever the caller
 * supplied.
 *
 * Comment handling: the reader strips `//` line comments and `/* ... *\/`
 * block comments outside of strings. It does NOT understand `//` appearing
 * inside a JSON string value (same limitation documented in config-sync.ts).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { stripJsonComments } from '../../utils/json-parse';
import { errorMessage, errWithCause } from '../../utils/errors';
import {
  getGlobalOpencodeDir,
  getGlobalOpencodeConfigPath,
  getProjectOpencodeConfigPath,
} from '../../utils/opencode-paths';

// ─── Paths ────────────────────────────────────────────────────────────────────

export const OPENCODE_GLOBAL_CONFIG_DIR = getGlobalOpencodeDir();
export const OPENCODE_GLOBAL_CONFIG_FILE = getGlobalOpencodeConfigPath();

// ─── Managed keys ─────────────────────────────────────────────────────────────

/**
 * Managed keys: entries that UI writers must never overwrite. Structured as a
 * list of dotted paths so adding a new managed key is trivial.
 */
const MANAGED_KEYS: readonly string[][] = [['mcp', 'interactive-desktop']];

// ─── Public types ────────────────────────────────────────────────────────────

export interface ReadConfigResult {
  exists: boolean;
  config: Record<string, unknown> | null;
  filePath: string;
}

export interface WriteConfigResult {
  filePath: string;
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function getPath(
  obj: Record<string, unknown> | null | undefined,
  path: readonly string[],
): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function setPath(
  target: Record<string, unknown>,
  path: readonly string[],
  value: unknown,
): void {
  let cur: Record<string, unknown> = target;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    const existing = cur[key];
    if (existing == null || typeof existing !== 'object') {
      cur[key] = {};
    } else {
      // Clone to avoid mutating the caller's object
      cur[key] = { ...(existing as Record<string, unknown>) };
    }
    cur = cur[key] as Record<string, unknown>;
  }
  cur[path[path.length - 1]] = value;
}

/**
 * Given the on-disk parsed config and an incoming config from the UI, return
 * a new object that preserves every managed key from `onDisk`, even if
 * `incoming` provides a different value for it. If `onDisk` has no managed
 * key set, `incoming` is returned verbatim (unmodified).
 *
 * Pure function — does not mutate inputs.
 */
export function mergePreservingManagedKeys(
  onDisk: Record<string, unknown> | null | undefined,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  // Collect managed values that are actually set on disk
  const toPreserve: { path: readonly string[]; value: unknown }[] = [];
  for (const path of MANAGED_KEYS) {
    const val = getPath(onDisk ?? {}, path);
    if (val !== undefined) {
      toPreserve.push({ path, value: val });
    }
  }

  if (toPreserve.length === 0) {
    return incoming;
  }

  // Deep-ish clone: only clone the spine along each managed path
  const merged: Record<string, unknown> = { ...incoming };
  for (const { path, value } of toPreserve) {
    setPath(merged, path, value);
  }
  return merged;
}

// ─── Path safety ──────────────────────────────────────────────────────────────

function assertSafeBaseDirectory(baseDirectory: string): void {
  if (!baseDirectory || baseDirectory.trim() === '') {
    throw new Error('baseDirectory must be a non-empty string');
  }
  if (baseDirectory.includes('..')) {
    throw new Error(`baseDirectory must not contain '..': ${baseDirectory}`);
  }
}

// ─── Low-level file IO (exported for tests & reuse) ──────────────────────────

/**
 * Read a JSON/JSONC file from disk. Returns `{ exists: false, config: null }`
 * if the file is absent. Throws on parse error or read error.
 */
export function readConfigFile(filePath: string): ReadConfigResult {
  if (!existsSync(filePath)) {
    return { exists: false, config: null, filePath };
  }

  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch (err) {
    throw errWithCause(`Failed to read ${filePath}: ${errorMessage(err)}`, err);
  }

  const stripped = stripJsonComments(raw);
  try {
    const parsed = JSON.parse(stripped) as Record<string, unknown>;
    return { exists: true, config: parsed, filePath };
  } catch (err) {
    throw errWithCause(
      `Failed to parse ${filePath}: ${errorMessage(err)}`,
      err,
    );
  }
}

/**
 * Write a config object to disk as pretty-printed JSON (with trailing newline).
 * Creates parent directories if missing. Throws on write failure.
 */
export function writeConfigFile(
  filePath: string,
  config: Record<string, unknown>,
): WriteConfigResult {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const serialized = JSON.stringify(config, null, 2) + '\n';
  try {
    writeFileSync(filePath, serialized, 'utf-8');
  } catch (err) {
    throw errWithCause(
      `Failed to write ${filePath}: ${errorMessage(err)}`,
      err,
    );
  }
  return { filePath };
}

// ─── Public API: global config ───────────────────────────────────────────────

export function readGlobalConfig(): ReadConfigResult {
  return readConfigFile(OPENCODE_GLOBAL_CONFIG_FILE);
}

/**
 * Write the global config, preserving any on-disk managed key(s). UI callers
 * should pass the config they want on disk; this function will always re-apply
 * the managed-key invariant so the `interactive-desktop` entry is never lost
 * or silently changed.
 */
export function writeGlobalConfig(
  config: Record<string, unknown>,
): WriteConfigResult {
  const existing = existsSync(OPENCODE_GLOBAL_CONFIG_FILE)
    ? readConfigFile(OPENCODE_GLOBAL_CONFIG_FILE).config
    : null;
  const merged = mergePreservingManagedKeys(existing, config);
  return writeConfigFile(OPENCODE_GLOBAL_CONFIG_FILE, merged);
}

// ─── Public API: project config ──────────────────────────────────────────────

function projectJsoncPath(baseDirectory: string): string {
  return getProjectOpencodeConfigPath(baseDirectory, 'jsonc');
}

function projectJsonPath(baseDirectory: string): string {
  return getProjectOpencodeConfigPath(baseDirectory, 'json');
}

/**
 * Read `<baseDirectory>/.opencode/opencode.jsonc`, falling back to
 * `.opencode/opencode.json` if the jsonc variant is missing. When neither is
 * present, returns `{ exists: false, config: null, filePath }` where
 * `filePath` points at the preferred (`.jsonc`) location.
 */
export function readProjectConfig(baseDirectory: string): ReadConfigResult {
  assertSafeBaseDirectory(baseDirectory);

  const jsoncPath = projectJsoncPath(baseDirectory);
  if (existsSync(jsoncPath)) {
    return readConfigFile(jsoncPath);
  }

  const jsonPath = projectJsonPath(baseDirectory);
  if (existsSync(jsonPath)) {
    return readConfigFile(jsonPath);
  }

  return { exists: false, config: null, filePath: jsoncPath };
}

/**
 * Write `<baseDirectory>/.opencode/opencode.jsonc`, preserving the managed
 * key invariant. Creates the `.opencode` directory if missing. Always writes
 * to the `.jsonc` variant to match the convention used by `mcp-inject.ts`.
 */
export function writeProjectConfig(
  baseDirectory: string,
  config: Record<string, unknown>,
): WriteConfigResult {
  assertSafeBaseDirectory(baseDirectory);

  // Prefer the existing file (jsonc or json) for the managed-key read, but
  // always write to .jsonc.
  const jsoncPath = projectJsoncPath(baseDirectory);
  const jsonPath = projectJsonPath(baseDirectory);

  let existing: Record<string, unknown> | null = null;
  if (existsSync(jsoncPath)) {
    existing = readConfigFile(jsoncPath).config;
  } else if (existsSync(jsonPath)) {
    existing = readConfigFile(jsonPath).config;
  }

  const merged = mergePreservingManagedKeys(existing, config);
  return writeConfigFile(jsoncPath, merged);
}
