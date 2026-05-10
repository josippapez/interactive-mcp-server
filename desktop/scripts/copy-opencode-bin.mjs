#!/usr/bin/env node
/**
 * copy-opencode-bin.mjs — Mode C binary fetcher.
 *
 * Downloads the per-platform `opencode` native binary from the
 * `anomalyco/opencode` GitHub release pinned in
 * `resources/opencode-bin/manifest.json`, verifies the SHA-256, extracts
 * the single `opencode` (or `opencode.exe`) entry, and places it at
 *
 *   resources/opencode-bin/<platform>-<arch>/opencode[.exe]
 *
 * # Why pre-fetch instead of letting electron-builder do it
 *
 * electron-builder ships an unpacking pipeline, but it expects assets to
 * live somewhere on disk before the build step runs. The previous design
 * (Mode B, JS bundle) used `copy-opencode-node.mjs` which COPIED a
 * locally-built bundle. For Mode C we need a real OS binary per platform
 * that the user almost certainly does NOT have built locally, so this
 * script fetches it from upstream releases instead. Output layout is the
 * same as the existing copy script so `extraResources` keeps working
 * with a parallel `resources/opencode-bin/**` glob.
 *
 * # Local-source mode (--local-source / OPENCODE_LOCAL_SOURCE)
 *
 * For maintainers iterating on a fork of opencode, fetching from a
 * GitHub release is too slow. Pass `--local-source <repo-root>` (or set
 * `OPENCODE_LOCAL_SOURCE`) to copy from a sibling opencode checkout
 * instead of downloading. We expect the upstream `bun run build` layout:
 *
 *   <repo-root>/packages/opencode/dist/opencode-<platform>-<arch>/bin/opencode[.exe]
 *
 * The script reads each platform's `dist/.../package.json` `version`
 * field, copies the binary, chmods +x, and writes that string to the
 * `.version` marker. This makes the local build's identity visible
 * (e.g. `0.0.0-work/copilot-premium-fix-202604260752`) and ensures
 * subsequent runs are no-ops unless the version field changed.
 *
 * The same binary path is what dev runtime resolves via
 * `desktop/src/main/opencode/runtime/strategies/native-binary.ts` step 3
 * (project-local sidecar), so dev + packaged builds use the SAME
 * binary — no drift between development and shipped artifacts.
 *
 * # Idempotency
 *
 * On every run the script:
 *  1. Reads the manifest (`version` + per-platform `asset`/`sha256`).
 *  2. Looks at the existing extracted binary (if any) and reads a
 *     companion `.version` marker.
 *  3. If `marker.version === manifest.version` AND the binary exists,
 *     it's a no-op. (Common case in dev: `npm run build` runs this many
 *     times.)
 *  4. Otherwise it fetches, verifies, extracts, chmod +x, and writes
 *     the marker.
 *
 * # SHA-256 self-pinning
 *
 * The manifest can ship empty sha256 strings for platforms whose checksum
 * the maintainer hasn't filled in (e.g. linux/windows pinned from a Mac
 * dev box). In that case the script:
 *   - Fetches the asset.
 *   - Computes its SHA-256.
 *   - Logs a warning with the computed value so the maintainer can paste
 *     it back into the manifest.
 *   - Continues so the build doesn't break.
 * Once the manifest has a non-empty sha256, mismatch is fatal.
 *
 * # Usage
 *
 *   node scripts/copy-opencode-bin.mjs [--platform <darwin|linux|win32>] [--arch <arm64|x64>] [--all] [--force] [--local-source <repo-root>]
 *
 * Defaults to current host (`process.platform`/`process.arch`). Use
 * `--all` to fetch every entry in the manifest (used in CI for
 * cross-builds). `--force` re-downloads even if the marker matches.
 * `--local-source` (or `OPENCODE_LOCAL_SOURCE` env var) switches to
 * local copy mode and skips network entirely.
 */

import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCRIPT = 'copy-opencode-bin';
const MANIFEST_PATH = path.join(
  __dirname,
  '..',
  'resources',
  'opencode-bin',
  'manifest.json',
);
const OUTPUT_ROOT = path.join(__dirname, '..', 'resources', 'opencode-bin');

const BASELINE_X64_TARGETS = new Set(['darwin-x64', 'linux-x64', 'win32-x64']);

function log(...args) {
  console.log(`[${SCRIPT}]`, ...args);
}
function warn(...args) {
  console.warn(`[${SCRIPT}] WARN`, ...args);
}
function die(msg) {
  console.error(`[${SCRIPT}] ERROR ${msg}`);
  process.exit(1);
}

/**
 * Default location to look for a sibling opencode checkout. We treat
 * `~/Desktop/opencode` as the maintainer's working tree because that's
 * where this repo's binaries are actually built from. Used as a
 * fall-through when neither `--local-source` nor `OPENCODE_LOCAL_SOURCE`
 * is set AND the directory is present — so CI runners (no local
 * checkout) still hit the GitHub-release fetch path.
 *
 * Detection: the path must contain `packages/opencode/dist` (i.e. the
 * upstream `bun run build` artefact tree). A bare `~/Desktop/opencode`
 * folder without builds is ignored.
 */
const DEFAULT_LOCAL_SOURCE = path.join(homedir(), 'Desktop', 'opencode');

function parseArgs() {
  const args = process.argv.slice(2);
  // Resolution order for localSource:
  //   1. Explicit --local-source flag (highest priority)
  //   2. OPENCODE_LOCAL_SOURCE env var
  //   3. DEFAULT_LOCAL_SOURCE if `packages/opencode/dist` exists there
  //   4. null → fall through to the GitHub-release fetch path
  let localSource = process.env.OPENCODE_LOCAL_SOURCE ?? null;
  if (
    !localSource &&
    existsSync(path.join(DEFAULT_LOCAL_SOURCE, 'packages', 'opencode', 'dist'))
  ) {
    localSource = DEFAULT_LOCAL_SOURCE;
  }
  const result = {
    platform: null,
    arch: null,
    all: false,
    force: false,
    localSource,
    noPrune: false,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--platform') result.platform = args[++i];
    else if (a === '--arch') result.arch = args[++i];
    else if (a === '--all') result.all = true;
    else if (a === '--force') result.force = true;
    else if (a === '--no-prune') result.noPrune = true;
    else if (a === '--local-source') result.localSource = args[++i];
    else if (a === '--no-local-source') result.localSource = null;
    else if (a === '-h' || a === '--help') {
      console.log(
        'Usage: node scripts/copy-opencode-bin.mjs [--platform <darwin|linux|win32>] [--arch <arm64|x64>] [--all] [--force] [--local-source <opencode-repo-root> | --no-local-source]\n' +
          '\n' +
          'Local-source mode resolution (in order):\n' +
          '  1. --local-source <path>\n' +
          '  2. OPENCODE_LOCAL_SOURCE env var\n' +
          `  3. ${DEFAULT_LOCAL_SOURCE} (if packages/opencode/dist exists there)\n` +
          '  4. None — fall through to fetching from the GitHub release pinned in manifest.json\n' +
          '\n' +
          'Pass --no-local-source to force the fetch path even when a local checkout is present.',
      );
      process.exit(0);
    } else die(`unknown arg: ${a}`);
  }
  return result;
}

function readManifest() {
  if (!existsSync(MANIFEST_PATH)) die(`manifest not found at ${MANIFEST_PATH}`);
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
}

function sourceDistKeyForTarget(key) {
  if (key === 'win32-x64') return 'windows-x64-baseline';
  if (key === 'win32-arm64') return 'windows-arm64';
  if (BASELINE_X64_TARGETS.has(key)) return `${key}-baseline`;
  return key;
}

/** Resolve which platform-arch pairs to fetch this run. */
function resolveTargets(manifest, args) {
  if (args.all) {
    return Object.keys(manifest.platforms).map((key) => {
      const [platform, arch] = key.split('-');
      return { key, platform, arch, entry: manifest.platforms[key] };
    });
  }
  const platform = args.platform ?? process.platform;
  const arch = args.arch ?? process.arch;
  const key = `${platform}-${arch}`;
  const entry = manifest.platforms[key];
  if (!entry) die(`no manifest entry for ${key}`);
  return [{ key, platform, arch, entry }];
}

/**
 * Stream a download to a file. We use the global `fetch()` available in
 * Node 18+ (Electron's bundled Node is well above this) and pipe the
 * response body through `node:stream/promises.pipeline` so the whole
 * thing never sits in memory at once. ~35–70MB binaries warrant this.
 */
async function downloadTo(url, destPath) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) {
    die(`download failed: ${url} -> HTTP ${res.status}`);
  }
  await pipeline(res.body, createWriteStream(destPath));
}

function sha256OfFile(filePath) {
  const hash = createHash('sha256');
  hash.update(readFileSync(filePath));
  return hash.digest('hex');
}

/**
 * Extract the single `opencode` (or `opencode.exe`) entry from the
 * downloaded archive into `outDir`. We delegate to the system `unzip`
 * for `.zip` and `tar` for `.tar.gz` rather than pulling in a
 * dependency just for this one script — both tools ship by default on
 * macOS/Linux/Windows-with-Git-Bash and are present in every CI runner
 * we'd plausibly use.
 */
function extractArchive(archivePath, outDir, binaryName) {
  mkdirSync(outDir, { recursive: true });
  if (archivePath.endsWith('.zip')) {
    const r = spawnSync('unzip', ['-o', '-q', archivePath, '-d', outDir], {
      stdio: 'inherit',
    });
    if (r.status !== 0) die(`unzip failed for ${archivePath}`);
  } else if (archivePath.endsWith('.tar.gz') || archivePath.endsWith('.tgz')) {
    const r = spawnSync('tar', ['-xzf', archivePath, '-C', outDir], {
      stdio: 'inherit',
    });
    if (r.status !== 0) die(`tar failed for ${archivePath}`);
  } else {
    die(`unsupported archive format: ${archivePath}`);
  }
  // Both upstream archive layouts put the binary at the root with the
  // filename `opencode` (or `opencode.exe` on Windows).
  const extracted = path.join(outDir, binaryName);
  if (!existsSync(extracted)) {
    die(`binary not found after extraction: ${extracted}`);
  }
  return extracted;
}

/**
 * Copy a freshly-built `opencode` binary from a sibling opencode
 * checkout into our resources tree. We expect the upstream `bun run
 * build` layout under `packages/opencode/dist/opencode-<key>/bin/`.
 *
 * The version marker is sourced from the dist folder's `package.json`
 * (e.g. `0.0.0-work/copilot-premium-fix-202604260752`) so the
 * idempotency check trips whenever you rebuild upstream and bump that
 * field. If your upstream build doesn't bump the field on rebuild, pass
 * `--force` to re-copy unconditionally.
 */
function copyFromLocal({ key, platform, arch, localSource }, args) {
  const binaryName = platform === 'win32' ? 'opencode.exe' : 'opencode';
  const outDir = path.join(OUTPUT_ROOT, key);
  const outBin = path.join(outDir, binaryName);
  const markerPath = path.join(outDir, '.version');

  // Resolve the local source binary path. We support both a single-arch
  // build (`<root>/packages/opencode/dist/opencode-<key>/bin/...`) and a
  // pre-resolved binary path (treat localSource as the file itself).
  // The directory form is the standard upstream `bun run build` layout.
  const distRoot = path.join(
    localSource,
    'packages',
    'opencode',
    'dist',
    `opencode-${sourceDistKeyForTarget(key)}`,
  );
  const sourceBin = path.join(distRoot, 'bin', binaryName);
  if (!existsSync(sourceBin)) {
    die(
      `${key}: local source binary not found at ${sourceBin}. ` +
        `Run \`bun run build\` in ${localSource} first, or check that the dist folder exists for this platform.`,
    );
  }

  // Read the dist package.json to identify what we're shipping. This
  // gives the .version marker something meaningful and surfaces the
  // build identity in `resources/opencode-bin/<key>/.version`.
  const distPkgPath = path.join(distRoot, 'package.json');
  let sourceVersion = 'local-unknown';
  if (existsSync(distPkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(distPkgPath, 'utf8'));
      if (typeof pkg.version === 'string' && pkg.version) {
        sourceVersion = `local-${pkg.version}`;
      }
    } catch {
      /* fall through to default */
    }
  }

  // Idempotency: skip when marker matches and binary still exists.
  if (!args.force && existsSync(outBin) && existsSync(markerPath)) {
    const marker = readFileSync(markerPath, 'utf8').trim();
    if (marker === sourceVersion) {
      log(`${key}: up to date (${sourceVersion}, local source)`);
      return;
    }
  }

  // Wipe + copy. We keep `outDir` fresh so a stale `.version` from a
  // previous fetch-mode run can't confuse the idempotency check.
  if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  copyFileSync(sourceBin, outBin);
  if (platform !== 'win32') chmodSync(outBin, 0o755);
  writeFileSync(markerPath, sourceVersion);
  log(`${key}: copied ${sourceVersion} from ${sourceBin}`);
}

async function fetchOne({ key, platform, arch, entry }, manifest, args) {
  const binaryName = platform === 'win32' ? 'opencode.exe' : 'opencode';
  const outDir = path.join(OUTPUT_ROOT, key);
  const outBin = path.join(outDir, binaryName);
  const markerPath = path.join(outDir, '.version');

  // Idempotency check.
  if (!args.force && existsSync(outBin) && existsSync(markerPath)) {
    const marker = readFileSync(markerPath, 'utf8').trim();
    if (marker === manifest.version) {
      log(`${key}: up to date (${manifest.version})`);
      return;
    }
  }

  const url = `https://github.com/${manifest.repo}/releases/download/${manifest.version}/${entry.asset}`;
  log(`${key}: downloading ${entry.asset} from ${manifest.version}`);

  // Download to a temp file so a half-written archive never lands in
  // resources/.
  const tmpFile = path.join(
    tmpdir(),
    `opencode-${manifest.version}-${key}-${Date.now()}-${entry.asset}`,
  );
  try {
    await downloadTo(url, tmpFile);

    const actualSha = sha256OfFile(tmpFile);
    if (entry.sha256 && entry.sha256 !== actualSha) {
      die(
        `sha256 mismatch for ${key}: manifest=${entry.sha256} actual=${actualSha}`,
      );
    }
    if (!entry.sha256) {
      warn(
        `${key}: manifest sha256 is empty. Computed=${actualSha} — paste this into manifest.json to enforce verification.`,
      );
    }

    // Wipe + re-extract.
    if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
    const extracted = extractArchive(tmpFile, outDir, binaryName);

    // Make executable on POSIX (no-op on Windows).
    if (platform !== 'win32') chmodSync(extracted, 0o755);

    writeFileSync(markerPath, manifest.version);
    log(`${key}: installed ${manifest.version} -> ${outBin}`);
  } finally {
    try {
      if (existsSync(tmpFile)) rmSync(tmpFile, { force: true });
    } catch {
      /* best-effort temp cleanup */
    }
  }
}

/**
 * Remove foreign-platform binary directories from `OUTPUT_ROOT` so
 * electron-builder doesn't bake them into the asar.
 *
 * # Why this exists
 *
 * electron-builder's default file-include glob picks up everything under
 * the project root, and `files` array exclusion patterns
 * (`!resources/opencode-bin/**`) are unreliable when an `extraResources`
 * entry references the same path — electron-builder force-includes the
 * source directory regardless of the exclusion. Result: a `package:mac`
 * run with all six platform binaries staged on disk produced an
 * `app.asar` containing 686MB of foreign-platform binaries on top of the
 * 99MB extracted-to-Resources copy of the host platform.
 *
 * Deleting the foreign dirs from disk before electron-builder runs is the
 * only reliable fix: it can't pack what isn't there.
 *
 * # Behaviour
 *
 * Skipped when `--all` is passed (cross-build scenario where every
 * platform is intentionally staged) or when `--no-prune` is passed (escape
 * hatch). Otherwise: list `OUTPUT_ROOT`, keep `manifest.json` plus the
 * `<platform>-<arch>` dirs in `targets`, delete the rest.
 */
function pruneForeignTargets(targets, args) {
  if (args.all || args.noPrune) return;
  if (!existsSync(OUTPUT_ROOT)) return;
  const keepKeys = new Set(targets.map((t) => t.key));
  const entries = readdirSync(OUTPUT_ROOT);
  for (const name of entries) {
    if (name === 'manifest.json') continue;
    if (keepKeys.has(name)) continue;
    const full = path.join(OUTPUT_ROOT, name);
    let isDir = false;
    try {
      isDir = statSync(full).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;
    rmSync(full, { recursive: true, force: true });
    log(`pruned foreign platform dir: ${name}`);
  }
}

async function main() {
  const args = parseArgs();
  const manifest = readManifest();
  const targets = resolveTargets(manifest, args);

  // Local-source mode: skip network entirely, copy binaries from a
  // sibling opencode checkout. The same files end up in
  // resources/opencode-bin/<key>/ that the dev runtime resolves at
  // step 3 of `native-binary.ts:resolveBinaryPath`, so dev and packaged
  // builds use identical artifacts.
  if (args.localSource) {
    log(`local-source mode: ${args.localSource}`);
    for (const target of targets) {
      copyFromLocal({ ...target, localSource: args.localSource }, args);
    }
    pruneForeignTargets(targets, args);
    log('done (local-source)');
    return;
  }

  // Sanity: empty bytes downloaded would be silent corruption. Sequential
  // fetches keep the log readable; parallelism here saves at most one
  // round-trip during the rare cross-build case.
  for (const target of targets) {
    await fetchOne(target, manifest, args);
  }

  pruneForeignTargets(targets, args);
  log('done');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
