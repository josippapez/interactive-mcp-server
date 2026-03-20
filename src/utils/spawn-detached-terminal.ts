import { ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import logger from './logger.js';

interface SpawnDetachedTerminalOptions {
  scriptPath: string;
  args: string[];
  darwinArgs?: string[];
  macLauncherPath: string;
  macFallbackLogMessage: string;
  env?: NodeJS.ProcessEnv;
}

const require = createRequire(import.meta.url);

function isCurrentRuntimeBun(): boolean {
  return typeof process.versions.bun === 'string';
}

function isExecutablePath(filePath: string): boolean {
  if (!fsSync.existsSync(filePath)) {
    return false;
  }

  if (process.platform === 'win32') {
    return true;
  }

  try {
    fsSync.accessSync(filePath, fsSync.constants.X_OK);
    return true;
  } catch {
    // Not executable or not accessible.
    return false;
  }
}

function resolveExecutableFromPath(binaryName: string): string | undefined {
  const pathValue = process.env.PATH;
  if (!pathValue) {
    return undefined;
  }

  const pathEntries = pathValue.split(path.delimiter).filter(Boolean);
  const extensions =
    process.platform === 'win32'
      ? (process.env.PATHEXT?.split(';').filter(Boolean) ?? [
          '.EXE',
          '.CMD',
          '.BAT',
          '.COM',
        ])
      : [''];

  for (const entry of pathEntries) {
    for (const extension of extensions) {
      const candidate =
        process.platform === 'win32'
          ? path.join(entry, `${binaryName}${extension}`)
          : path.join(entry, binaryName);
      if (isExecutablePath(candidate)) {
        return candidate;
      }
    }
  }

  return undefined;
}

function resolveLocalNpmBunBinary(): string | undefined {
  try {
    const bunPackageJson = require.resolve('bun/package.json');
    const bunPackageDir = path.dirname(bunPackageJson);
    const bunManifestRaw = fsSync.readFileSync(bunPackageJson, 'utf8');
    const bunManifest = JSON.parse(bunManifestRaw) as {
      bin?: string | Record<string, string>;
    };

    let relativeBinPath: string | undefined;
    if (typeof bunManifest.bin === 'string') {
      relativeBinPath = bunManifest.bin;
    } else if (
      typeof bunManifest.bin === 'object' &&
      bunManifest.bin !== null &&
      typeof bunManifest.bin.bun === 'string'
    ) {
      relativeBinPath = bunManifest.bin.bun;
    }

    if (!relativeBinPath) {
      logger.warn(
        { bunPackageJson },
        'Resolved bun package without a usable "bin" entry.',
      );
      return undefined;
    }

    const bunBinFile = path.resolve(bunPackageDir, relativeBinPath);

    if (isExecutablePath(bunBinFile)) {
      return bunBinFile;
    }

    logger.warn(
      { bunBinFile },
      'Found bun package but binary is missing or not executable.',
    );
  } catch (error) {
    const moduleResolutionError = error as NodeJS.ErrnoException;
    if (moduleResolutionError.code !== 'MODULE_NOT_FOUND') {
      logger.warn(
        { error: moduleResolutionError },
        'Failed to resolve local bun npm package.',
      );
    }
  }

  return undefined;
}

function resolveRuntimeExecutable(): string {
  // If an explicit override is set, honour it (supports both old and new env var names).
  const envOverride =
    process.env.INTERACTIVE_MCP_RUNTIME || process.env.INTERACTIVE_MCP_BUN_PATH;
  if (envOverride) {
    return envOverride;
  }

  // If we are already running under Bun, use current runtime.
  if (isCurrentRuntimeBun()) {
    return process.execPath;
  }

  // Prefer Bun from PATH for OpenTUI scripts.
  const bunFromPath = resolveExecutableFromPath('bun');
  if (bunFromPath) {
    return bunFromPath;
  }

  // Fallback to the npm-installed bun package binary if present.
  const localNpmBun = resolveLocalNpmBunBinary();
  if (localNpmBun) {
    logger.warn(
      { localNpmBun },
      'Using local npm-installed Bun fallback for interactive prompt runtime.',
    );
    return localNpmBun;
  }

  logger.warn(
    { processExecPath: process.execPath },
    'Bun runtime was not resolved from override, current runtime, PATH, or local npm package; falling back to current process runtime. OpenTUI prompt scripts may fail under Node.',
  );

  // Final fallback to whatever runtime is currently executing this process.
  return process.execPath;
}

function createEscapedRuntimeCommand(
  executable: string,
  scriptPath: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
): string {
  const runtimeArgs = [scriptPath, ...args].map((arg) => `"${arg}"`).join(' ');
  const envPrefix = createShellEnvPrefix(env);

  return `${envPrefix}exec "${executable}" ${runtimeArgs}; exit 0`
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
}

function createLauncherScript(
  executable: string,
  scriptPath: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
): string {
  const runtimeArgs = [scriptPath, ...args].map((arg) => `"${arg}"`).join(' ');
  const envPrefix = createShellEnvPrefix(env);

  return `#!/bin/bash\n${envPrefix}exec "${executable}" ${runtimeArgs}\n`;
}

function escapeForDoubleQuotedShellString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$')
    .replace(/`/g, '\\`');
}

function createShellEnvPrefix(env?: NodeJS.ProcessEnv): string {
  if (!env) {
    return '';
  }

  return Object.entries(env)
    .filter(
      ([key, value]) =>
        typeof value === 'string' &&
        key.length > 0 &&
        /^[A-Za-z_][A-Za-z0-9_]*$/.test(key),
    )
    .map(([key, value]) => {
      const escapedValue = escapeForDoubleQuotedShellString(value as string);
      return `export ${key}="${escapedValue}"; `;
    })
    .join('');
}

export function spawnDetachedTerminal(
  options: SpawnDetachedTerminalOptions,
): ChildProcess {
  const platform = os.platform();
  const runtimeExecutable = resolveRuntimeExecutable();
  const spawnEnv = {
    ...process.env,
    ...options.env,
  };

  if (platform === 'darwin') {
    const darwinArgs = options.darwinArgs ?? options.args;
    const escapedRuntimeCommand = createEscapedRuntimeCommand(
      runtimeExecutable,
      options.scriptPath,
      darwinArgs,
      options.env,
    );
    const command = `osascript -e 'tell application "Terminal" to activate' -e 'tell application "Terminal" to do script "${escapedRuntimeCommand}"'`;

    const childProcess = spawn(command, [], {
      stdio: ['ignore', 'ignore', 'ignore'],
      shell: true,
      detached: true,
      env: spawnEnv,
    });

    const launchViaOpenCommand = async () => {
      try {
        await fs.writeFile(
          options.macLauncherPath,
          createLauncherScript(
            runtimeExecutable,
            options.scriptPath,
            darwinArgs,
            options.env,
          ),
          'utf8',
        );
        await fs.chmod(options.macLauncherPath, 0o755);
        const openProc = spawn(
          'open',
          ['-a', 'Terminal', options.macLauncherPath],
          {
            stdio: ['ignore', 'ignore', 'ignore'],
            detached: true,
            env: spawnEnv,
          },
        );
        openProc.unref();
      } catch (error) {
        logger.error({ error }, options.macFallbackLogMessage);
      }
    };

    childProcess.on('error', () => {
      void launchViaOpenCommand();
    });
    childProcess.on('close', (code: number | null) => {
      if (code !== null && code !== 0) {
        void launchViaOpenCommand();
      }
    });

    return childProcess;
  }

  if (platform === 'win32') {
    return spawn(runtimeExecutable, [options.scriptPath, ...options.args], {
      stdio: ['ignore', 'ignore', 'ignore'],
      shell: true,
      detached: true,
      windowsHide: false,
      env: spawnEnv,
    });
  }

  return spawn(runtimeExecutable, [options.scriptPath, ...options.args], {
    stdio: ['ignore', 'ignore', 'ignore'],
    shell: true,
    detached: true,
    env: spawnEnv,
  });
}
