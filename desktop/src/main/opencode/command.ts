/**
 * OpenCode slash command API integration.
 *
 * Provides functions to fetch available commands and execute them
 * in OpenCode sessions using the SDK.
 */

import { getClient } from './sdk-client';

/** Command argument definition. */
export interface CommandArg {
  name: string;
  description: string;
  required?: boolean;
}

/** Command definition from OpenCode API. */
export interface Command {
  name: string;
  description: string;
  args: CommandArg[];
}

/** Response shape from GET /command. */
export interface CommandsResponse {
  commands: Command[];
}

/** Result of executing a command. */
export interface ExecuteCommandResult {
  ok: boolean;
  error?: string;
}

// ─── In-memory cache ─────────────────────────────────────────────────────────

let _cachedCommands: Command[] | null = null;

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Fetch all available commands from the OpenCode API using SDK.
 * Results are cached for subsequent lookups.
 *
 * @param openCodePort - The port OpenCode is running on
 * @returns Array of commands, or null if the request fails
 */
export async function fetchCommands(
  openCodePort: number,
): Promise<Command[] | null> {
  try {
    const client = getClient(openCodePort);
    const response = await client.command.list(undefined, {
      signal: AbortSignal.timeout(5000),
    });

    if (response.error) return null;

    const data = response.data as CommandsResponse | undefined;
    if (!data?.commands) return null;

    _cachedCommands = data.commands;
    return data.commands;
  } catch {
    return null;
  }
}

/**
 * Execute a slash command in an OpenCode session using SDK.
 *
 * @param openCodePort - The port OpenCode is running on
 * @param sessionId - The session ID to execute the command in
 * @param commandName - The name of the command to execute
 * @param args - Optional arguments for the command
 * @returns Result indicating success or failure
 */
export async function executeCommand(
  openCodePort: number,
  sessionId: string,
  commandName: string,
  args?: Record<string, string>,
): Promise<ExecuteCommandResult> {
  // Format arguments as a string if provided (command expects "arguments" as string)
  const argsString =
    args && Object.keys(args).length > 0
      ? Object.entries(args)
          .map(([k, v]) => `${k}=${v}`)
          .join(' ')
      : undefined;

  try {
    const client = getClient(openCodePort);
    const response = await client.session.command(
      {
        sessionID: sessionId,
        command: commandName,
        arguments: argsString,
      },
      { signal: AbortSignal.timeout(30000) },
    );

    if (response.error) {
      return { ok: false, error: 'Command execution failed' };
    }

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Command failed',
    };
  }
}

/**
 * Get the cached commands without making a network request.
 *
 * @returns Cached commands, or null if not yet fetched
 */
export function getCachedCommands(): Command[] | null {
  return _cachedCommands;
}

/**
 * Clear the command cache.
 * Useful for testing or forcing a refresh.
 */
export function clearCommandCache(): void {
  _cachedCommands = null;
}

/**
 * Find a command by name in the cache.
 *
 * @param name - The command name to look up
 * @returns The command, or null if not found
 */
export function getCommandByName(name: string): Command | null {
  if (!_cachedCommands) return null;
  return _cachedCommands.find((c) => c.name === name) ?? null;
}
