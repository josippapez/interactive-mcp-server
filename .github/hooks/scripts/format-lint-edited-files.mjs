#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const ESLINT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const isVerbose = process.env.COPILOT_HOOK_VERBOSE === '1';
const verboseLog = (...args) => {
  if (isVerbose) {
    console.log('[copilot-hook][verbose]', ...args);
  }
};
const PRETTIER_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.json',
  '.md',
  '.css',
  '.scss',
  '.html',
  '.yml',
  '.yaml',
]);

const readStdin = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
};

const parseJson = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
};

const normalizeToolName = (toolName) => {
  if (typeof toolName !== 'string') return '';
  const segments = toolName.split(/[./:]/).filter(Boolean);
  return segments.length > 0 ? segments.at(-1) : toolName;
};

const extractFilesFromPatch = (patchText) => {
  const files = new Set();
  const patchFileRegex =
    /^\*\*\* (?:Add|Update|Delete) File: (.+)$|^\*\*\* Move to: (.+)$/gm;

  let match = patchFileRegex.exec(patchText);
  while (match) {
    const file = match[1] ?? match[2];
    if (file) files.add(file.trim());
    match = patchFileRegex.exec(patchText);
  }

  return files;
};

const resolveEditedFiles = (event) => {
  const parsedToolArgs = parseJson(event.toolArgs ?? '');
  const toolName = normalizeToolName(event.toolName);
  const files = new Set();

  if (toolName === 'edit' || toolName === 'create' || toolName === 'view') {
    const path = parsedToolArgs?.path;
    if (typeof path === 'string' && path.trim().length > 0) {
      files.add(path.trim());
    }
  }

  if (toolName === 'apply_patch') {
    const patchPayload =
      parsedToolArgs?.input ??
      parsedToolArgs?.patch ??
      (typeof event.toolArgs === 'string' ? event.toolArgs : '');

    if (typeof patchPayload === 'string' && patchPayload.trim().length > 0) {
      for (const file of extractFilesFromPatch(patchPayload)) {
        files.add(file);
      }
    }
  }

  return files;
};

const toAbsoluteFile = (filePath, workspaceRoot) => {
  if (isAbsolute(filePath)) return filePath;

  const candidateRoots = Array.from(
    new Set([
      workspaceRoot,
      process.cwd(),
      resolve(workspaceRoot, '..'),
      resolve(workspaceRoot, '../..'),
      resolve(process.cwd(), '..'),
      resolve(process.cwd(), '../..'),
    ]),
  );

  for (const root of candidateRoots) {
    const candidate = resolve(root, filePath);
    if (existsSync(candidate)) return candidate;
  }

  return resolve(workspaceRoot, filePath);
};

const runCommand = (args, cwd) => {
  verboseLog('run command:', ['npx', '--no-install', ...args]);
  const result = spawnSync('npx', ['--no-install', ...args], {
    cwd,
    stdio: 'inherit',
    env: process.env,
  });

  if (result.error) throw result.error;
  if ((result.status ?? 0) !== 0) {
    process.exit(result.status ?? 1);
  }
};

const main = async () => {
  const input = await readStdin();
  verboseLog('raw hook input:', input);
  const event = parseJson(input);
  if (!event) process.exit(0);

  if (event.toolResult?.resultType !== 'success') process.exit(0);

  const toolName = normalizeToolName(event.toolName);
  verboseLog('toolName raw:', event.toolName, 'normalized:', toolName);

  if (!['apply_patch', 'edit', 'create'].includes(toolName)) {
    process.exit(0);
  }

  const cwd = typeof event.cwd === 'string' ? event.cwd : process.cwd();
  const workspaceRoot = cwd;
  verboseLog('workspaceRoot:', workspaceRoot);
  const editedFiles = Array.from(resolveEditedFiles(event))
    .map((filePath) => toAbsoluteFile(filePath, workspaceRoot))
    .filter((filePath) => existsSync(filePath));
  verboseLog('edited files (existing):', editedFiles);

  if (editedFiles.length === 0) process.exit(0);

  const prettierTargets = editedFiles
    .filter((filePath) => PRETTIER_EXTENSIONS.has(extname(filePath)))
    .map((filePath) => relative(workspaceRoot, filePath));

  const eslintTargets = editedFiles
    .filter((filePath) => ESLINT_EXTENSIONS.has(extname(filePath)))
    .map((filePath) => relative(workspaceRoot, filePath));

  if (prettierTargets.length > 0) {
    runCommand(['prettier', '--write', ...prettierTargets], workspaceRoot);
  }

  if (eslintTargets.length > 0) {
    runCommand(
      ['eslint', '--fix', '--max-warnings=0', ...eslintTargets],
      workspaceRoot,
    );
  }
};

await main();
