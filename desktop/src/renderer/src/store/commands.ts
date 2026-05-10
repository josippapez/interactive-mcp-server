/**
 * Global commands state using Jotai.
 *
 * This provides a single source of truth for OpenCode slash commands,
 * eliminating redundant API calls when multiple components need command data.
 *
 * Key benefits:
 * - Single fetch shared across all consumers (command palette, autocomplete, etc.)
 * - Reactive updates when commands change
 * - Centralized command execution with loading state
 */

import { atom, useAtomValue, useSetAtom } from 'jotai';
import { useCallback, useEffect } from 'react';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

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
  source?: 'command' | 'mcp' | 'skill';
}

/** Result of executing a command. */
export interface ExecuteCommandResult {
  ok: boolean;
  error?: string;
}

// -----------------------------------------------------------------------------
// Base Atoms
// -----------------------------------------------------------------------------

/** List of all available commands. */
export const commandsAtom = atom<Command[]>([]);

/** Loading state for command fetch operations. */
export const commandsLoadingAtom = atom<boolean>(false);

/** Error state for command fetch operations. */
export const commandsErrorAtom = atom<string | null>(null);

/** Whether a command is currently executing. */
export const commandExecutingAtom = atom<boolean>(false);

// -----------------------------------------------------------------------------
// Derived Atoms
// -----------------------------------------------------------------------------

/** Combined commands state for components that need everything. */
export const commandsStateAtom = atom((get) => ({
  commands: get(commandsAtom),
  isLoading: get(commandsLoadingAtom),
  error: get(commandsErrorAtom),
  isExecuting: get(commandExecutingAtom),
}));

// -----------------------------------------------------------------------------
// Action Atoms
// -----------------------------------------------------------------------------

/** Fetch commands from the OpenCode API. */
export const fetchCommandsAtom = atom(
  null,
  async (_get, set, params?: { baseDirectory?: string }) => {
    set(commandsLoadingAtom, true);
    set(commandsErrorAtom, null);

    try {
      const result = await window.api.fetchCommands(params?.baseDirectory);

      if (result) {
        set(commandsAtom, result);

        if (process.env.NODE_ENV === 'development') {
          console.log('[commands-store] Commands fetched', {
            count: result.length,
            commands: result.map((c) => c.name),
            baseDirectory: params?.baseDirectory,
            timestamp: new Date().toISOString(),
          });
        }
      } else {
        set(commandsAtom, []);
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to fetch commands';
      set(commandsErrorAtom, message);

      if (process.env.NODE_ENV === 'development') {
        console.warn('[commands-store] Failed to fetch:', err);
      }
    } finally {
      set(commandsLoadingAtom, false);
    }
  },
);

/** Execute a command in a session. */
export const executeCommandAtom = atom(
  null,
  async (
    _get,
    set,
    params: {
      sessionId: string;
      commandName: string;
      args?: Record<string, string>;
      baseDirectory?: string;
    },
  ): Promise<ExecuteCommandResult> => {
    set(commandExecutingAtom, true);

    try {
      const result = await window.api.executeCommand(
        params.sessionId,
        params.commandName,
        params.args,
        params.baseDirectory,
      );

      if (process.env.NODE_ENV === 'development') {
        console.log('[commands-store] Command executed', {
          sessionId: params.sessionId,
          command: params.commandName,
          ok: result.ok,
          timestamp: new Date().toISOString(),
        });
      }

      return result;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Command execution failed';

      if (process.env.NODE_ENV === 'development') {
        console.warn('[commands-store] Command execution failed:', err);
      }

      return { ok: false, error: message };
    } finally {
      set(commandExecutingAtom, false);
    }
  },
);

// -----------------------------------------------------------------------------
// Hooks
// -----------------------------------------------------------------------------

/** Get commands list (read-only). */
export function useCommandsData(): Command[] {
  return useAtomValue(commandsAtom);
}

/** Get loading state (read-only). */
export function useCommandsLoading(): boolean {
  return useAtomValue(commandsLoadingAtom);
}

/** Get executing state (read-only). */
export function useCommandExecuting(): boolean {
  return useAtomValue(commandExecutingAtom);
}

/** Get full commands state (read-only). */
export function useCommandsState(): {
  commands: Command[];
  isLoading: boolean;
  error: string | null;
  isExecuting: boolean;
} {
  return useAtomValue(commandsStateAtom);
}

/** Get the fetch/refresh function (write-only). */
export function useFetchCommands(): (params?: {
  baseDirectory?: string;
}) => Promise<void> {
  return useSetAtom(fetchCommandsAtom);
}

/** Get the execute command function (write-only). */
export function useExecuteCommand(): (params: {
  sessionId: string;
  commandName: string;
  args?: Record<string, string>;
  baseDirectory?: string;
}) => Promise<ExecuteCommandResult> {
  return useSetAtom(executeCommandAtom);
}

/**
 * Backwards-compatible hook matching the old useCommands API.
 *
 * Fetches commands on mount when enabled.
 */
export function useCommands(
  enabled = true,
  baseDirectory?: string | null,
): {
  commands: Command[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  execute: (
    sessionId: string,
    commandName: string,
    args?: Record<string, string>,
  ) => Promise<ExecuteCommandResult>;
  isExecuting: boolean;
} {
  const state = useCommandsState();
  const fetchCommands = useFetchCommands();
  const executeCommand = useExecuteCommand();

  // Fetch on mount when enabled
  useEffect(() => {
    if (enabled) {
      void fetchCommands({ baseDirectory: baseDirectory ?? undefined });
    }
  }, [enabled, fetchCommands, baseDirectory]);

  // Wrapper for execute to match original API signature
  const execute = useCallback(
    async (
      sessionId: string,
      commandName: string,
      args?: Record<string, string>,
    ): Promise<ExecuteCommandResult> => {
      return executeCommand({
        sessionId,
        commandName,
        args,
        baseDirectory: baseDirectory ?? undefined,
      });
    },
    [executeCommand, baseDirectory],
  );

  const refresh = useCallback(
    () => fetchCommands({ baseDirectory: baseDirectory ?? undefined }),
    [fetchCommands, baseDirectory],
  );

  return {
    ...state,
    refresh,
    execute,
  };
}

// -----------------------------------------------------------------------------
// Utility Functions
// -----------------------------------------------------------------------------

/** Find a command by name in the commands array. */
export function findCommandByName(
  commands: Command[],
  name: string,
): Command | null {
  return commands.find((c) => c.name === name) ?? null;
}

/** Filter commands by search query (matches name or description). */
export function filterCommands(commands: Command[], query: string): Command[] {
  if (!query.trim()) return commands;
  const lowerQuery = query.toLowerCase();
  return commands.filter(
    (c) =>
      c.name.toLowerCase().includes(lowerQuery) ||
      c.description.toLowerCase().includes(lowerQuery),
  );
}
