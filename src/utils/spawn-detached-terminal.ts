import { ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import logger from './logger.js';

interface SpawnDetachedTerminalOptions {
  scriptPath: string;
  args: string[];
  darwinArgs?: string[];
  macLauncherPath: string;
  macFallbackLogMessage: string;
  env?: NodeJS.ProcessEnv;
}

function resolveRuntimeExecutable(): string {
  if (process.versions.bun) {
    return process.execPath;
  }

  return process.env.INTERACTIVE_MCP_BUN_PATH || 'bun';
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
