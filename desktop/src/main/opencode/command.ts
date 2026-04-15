/**
 * OpenCode slash command API integration.
 *
 * Provides functions to fetch available commands and execute them
 * in OpenCode sessions.
 *
 * API:
 * - GET /command — List available commands
 * - POST /session/:id/command — Execute a command
 */

import {
  buildOpenCodePortCandidates,
  fetchFirstSuccessfulJson,
} from './endpoints';

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
 * Fetch all available commands from the OpenCode API.
 * Results are cached for subsequent lookups.
 *
 * @param openCodePort - The port OpenCode is running on
 * @returns Array of commands, or null if the request fails
 */
export async function fetchCommands(
  openCodePort: number,
): Promise<Command[] | null> {
  const ports = buildOpenCodePortCandidates(openCodePort);

  try {
    const response = await fetchFirstSuccessfulJson<CommandsResponse>(
      ports,
      '/command',
      5000,
    );
    if (!response) return null;
    const data = response.data;
    _cachedCommands = data.commands;
    return data.commands;
  } catch {
    return null;
  }
}

/**
 * Execute a slash command in an OpenCode session.
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
  const ports = buildOpenCodePortCandidates(openCodePort);

  const body: { name: string; args?: Record<string, string> } = {
    name: commandName,
  };
  if (args && Object.keys(args).length > 0) {
    body.args = args;
  }

  for (const port of ports) {
    try {
      const res = await fetch(
        `http://localhost:${port}/session/${encodeURIComponent(sessionId)}/command`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(30000),
        },
      );

      if (!res.ok) {
        continue;
      }

      return { ok: true };
    } catch {
      // failure isolation: try next endpoint
    }
  }

  return {
    ok: false,
    error: 'Command failed on all reachable OpenCode endpoints',
  };
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
