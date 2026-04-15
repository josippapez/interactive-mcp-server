#!/usr/bin/env node
/**
 * Copies the appropriate OpenCode binary for a target platform to resources/bin/.
 *
 * Usage:
 *   node scripts/copy-opencode.js [--platform <platform>] [--arch <arch>] [--source <dir>]
 *
 * Options:
 *   --platform   Target platform: darwin, linux, windows (default: current OS)
 *   --arch       Target architecture: x64, arm64 (default: current arch)
 *   --source     Source directory containing opencode-* builds
 *                (default: ~/Desktop/opencode/packages/opencode/dist)
 *
 * Examples:
 *   node scripts/copy-opencode.js                          # Current platform
 *   node scripts/copy-opencode.js --platform darwin --arch arm64
 *   node scripts/copy-opencode.js --platform windows --arch x64
 *   node scripts/copy-opencode.js --platform linux --arch x64
 *
 * This script is run before packaging to include the bundled OpenCode binary.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const PLATFORM_MAP = {
  darwin: 'darwin',
  macos: 'darwin',
  mac: 'darwin',
  linux: 'linux',
  win32: 'windows',
  windows: 'windows',
  win: 'windows',
};

const ARCH_MAP = {
  x64: 'x64',
  x86_64: 'x64',
  amd64: 'x64',
  arm64: 'arm64',
  aarch64: 'arm64',
};

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {
    platform: null,
    arch: null,
    source: null,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--platform' && args[i + 1]) {
      result.platform = args[++i];
    } else if (args[i] === '--arch' && args[i + 1]) {
      result.arch = args[++i];
    } else if (args[i] === '--source' && args[i + 1]) {
      result.source = args[++i];
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
Usage: node scripts/copy-opencode.js [options]

Options:
  --platform <platform>  Target platform: darwin, linux, windows
  --arch <arch>          Target architecture: x64, arm64
  --source <dir>         Source directory with opencode builds
  --help                 Show this help

Examples:
  npm run copy:opencode                                    # Current platform
  npm run copy:opencode -- --platform darwin --arch arm64  # macOS ARM
  npm run copy:opencode -- --platform darwin --arch x64    # macOS Intel
  npm run copy:opencode -- --platform windows --arch x64   # Windows
  npm run copy:opencode -- --platform linux --arch x64     # Linux
`);
      process.exit(0);
    }
  }

  return result;
}

function main() {
  const args = parseArgs();

  // Resolve platform
  let platform = args.platform
    ? PLATFORM_MAP[args.platform.toLowerCase()]
    : PLATFORM_MAP[os.platform()];

  if (!platform) {
    console.error(`Unknown platform: ${args.platform}`);
    console.error('Valid platforms: darwin, linux, windows');
    process.exit(1);
  }

  // Resolve architecture
  let arch = args.arch
    ? ARCH_MAP[args.arch.toLowerCase()]
    : ARCH_MAP[os.arch()];

  if (!arch) {
    console.error(`Unknown architecture: ${args.arch}`);
    console.error('Valid architectures: x64, arm64');
    process.exit(1);
  }

  const sourceDir =
    args.source ||
    path.join(os.homedir(), 'Desktop/opencode/packages/opencode/dist');

  const binaryName = platform === 'windows' ? 'opencode.exe' : 'opencode';
  const distName = `opencode-${platform}-${arch}`;
  const sourcePath = path.join(sourceDir, distName, 'bin', binaryName);

  if (!fs.existsSync(sourcePath)) {
    console.error(`OpenCode binary not found at: ${sourcePath}`);
    console.error(`\nAvailable builds in ${sourceDir}:`);
    try {
      const dirs = fs
        .readdirSync(sourceDir)
        .filter((d) => d.startsWith('opencode-'));
      dirs.forEach((d) => console.error(`  - ${d}`));
    } catch {
      console.error('  (could not list directory)');
    }
    process.exit(1);
  }

  const targetDir = path.join(__dirname, '..', 'resources', 'bin');
  const targetPath = path.join(targetDir, binaryName);

  // Ensure target directory exists
  fs.mkdirSync(targetDir, { recursive: true });

  // Copy the binary
  console.log(`Copying OpenCode binary for ${platform}-${arch}...`);
  console.log(`  From: ${sourcePath}`);
  console.log(`  To:   ${targetPath}`);

  fs.copyFileSync(sourcePath, targetPath);

  // Make executable on Unix (even when cross-compiling)
  if (platform !== 'windows') {
    fs.chmodSync(targetPath, 0o755);
  }

  const stats = fs.statSync(targetPath);
  const sizeMB = (stats.size / (1024 * 1024)).toFixed(1);
  console.log(`Done! Binary size: ${sizeMB} MB`);
}

main();
