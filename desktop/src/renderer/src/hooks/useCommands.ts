/**
 * Re-export commands hook and utilities from the Jotai store.
 *
 * This file exists for backwards compatibility. All state management
 * has been migrated to @renderer/store/commands.ts
 */
export {
  // Types
  type Command,
  type CommandArg,
  type ExecuteCommandResult,
  // Main hook (backwards compatible)
  useCommands,
  // Individual hooks for granular subscriptions
  useCommandsData,
  useCommandsLoading,
  useCommandExecuting,
  useCommandsState,
  useFetchCommands,
  useExecuteCommand,
  // Utility functions
  findCommandByName,
  filterCommands,
  // Atoms (for advanced use cases)
  commandsAtom,
  commandsLoadingAtom,
  commandsErrorAtom,
  commandExecutingAtom,
  commandsStateAtom,
  fetchCommandsAtom,
  executeCommandAtom,
} from '../store/commands';
