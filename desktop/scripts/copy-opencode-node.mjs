#!/usr/bin/env node
/**
 * Copies the platform-agnostic OpenCode Node bundle (node.js + *.wasm)
 * to resources/opencode-node/.
 *
 * This is used by the in-process `Server.listen()` path (see
 * src/main/opencode/server.ts). The bundle is a single ESM file produced
 * by `bun run script/build-node.ts` inside the opencode repo; unlike the
 * per-platform `opencode-*` binaries, a single node.js works on every
 * platform because it runs on Electron's bundled Node runtime.
 *
 * Usage:
 *   node scripts/copy-opencode-node.js [--source <dir>] [--include-map]
 *
 * Options:
 *   --source         Source directory containing node.js + *.wasm
 *                    (default: ~/Desktop/opencode/packages/opencode/dist/node)
 *   --include-map    Also copy node.js.map (~37 MB, dev only — default: false)
 *   --help           Show this help
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {
    source: null,
    includeMap: false,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--source' && args[i + 1]) {
      result.source = args[++i];
    } else if (args[i] === '--include-map') {
      result.includeMap = true;
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
Usage: node scripts/copy-opencode-node.js [options]

Options:
  --source <dir>   Source directory with node.js + *.wasm
                   (default: ~/Desktop/opencode/packages/opencode/dist/node)
  --include-map    Also copy node.js.map (~37 MB, dev only)
  --help           Show this help
`);
      process.exit(0);
    }
  }

  return result;
}

function main() {
  const args = parseArgs();

  const sourceDir =
    args.source ||
    path.join(os.homedir(), 'Desktop/opencode/packages/opencode/dist/node');

  if (!fs.existsSync(sourceDir)) {
    console.error(`OpenCode node bundle directory not found: ${sourceDir}`);
    console.error(
      '\nBuild it first with `bun run script/build-node.ts` inside the opencode repo.',
    );
    process.exit(1);
  }

  const nodeJsPath = path.join(sourceDir, 'node.js');
  if (!fs.existsSync(nodeJsPath)) {
    console.error(`node.js not found at: ${nodeJsPath}`);
    process.exit(1);
  }

  const targetDir = path.join(__dirname, '..', 'resources', 'opencode-node');
  fs.mkdirSync(targetDir, { recursive: true });

  // Enumerate source files we care about.
  const entries = fs.readdirSync(sourceDir);
  const copyList = entries.filter((name) => {
    if (name === 'node.js') return true;
    if (name.endsWith('.wasm')) return true;
    if (name === 'node.js.map') return args.includeMap;
    return false;
  });

  if (copyList.length === 0) {
    console.error('Nothing to copy — source directory is empty.');
    process.exit(1);
  }

  // Clean any stale .wasm / node.js files in target so old hashes don't linger.
  for (const existing of fs.readdirSync(targetDir)) {
    if (
      existing === 'node.js' ||
      existing === 'node.js.map' ||
      existing.endsWith('.wasm')
    ) {
      fs.rmSync(path.join(targetDir, existing), { force: true });
    }
  }

  console.log('Copying OpenCode node bundle...');
  console.log(`  From: ${sourceDir}`);
  console.log(`  To:   ${targetDir}`);

  let totalBytes = 0;
  for (const name of copyList) {
    const src = path.join(sourceDir, name);
    const dst = path.join(targetDir, name);
    fs.copyFileSync(src, dst);
    const size = fs.statSync(dst).size;
    totalBytes += size;
    const sizeMB = (size / (1024 * 1024)).toFixed(2);
    console.log(`  • ${name} (${sizeMB} MB)`);
  }

  const totalMB = (totalBytes / (1024 * 1024)).toFixed(2);
  console.log(`Done! ${copyList.length} file(s), ${totalMB} MB total.`);
}

main();
