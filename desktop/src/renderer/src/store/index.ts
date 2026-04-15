/**
 * Global state store using Jotai.
 *
 * Re-exports all atoms and hooks for easy importing.
 */

export {
  // Atoms
  activeChannelIdAtom,
  intentionalNullSelectionAtom,
  channelSelectionStateAtom,
  selectChannelAtom,
  // Types
  type ChannelSelectionSource,
  // Hooks
  useActiveChannelId,
  useChannelSelectionState,
  useSelectChannel,
  useChannelSelection,
} from './channel-selection';

export {
  // Atoms
  settingsAtom,
  settingsLoadingAtom,
  settingsErrorAtom,
  settingsStateAtom,
  fetchSettingsAtom,
  updateSettingsAtom,
  // Types
  type SyncedSettings,
  // Hooks
  useSettings,
  useSettingsLoading,
  useSettingsState,
  useFetchSettings,
  useUpdateSettings,
  useSettingsSync,
  useSettingsStore,
} from './settings';

export {
  // Atoms
  providersAtom,
  modelsAtom,
  connectedProviderIdsAtom,
  providersLoadingAtom,
  providersErrorAtom,
  providersStateAtom,
  fetchProvidersAtom,
  // Types
  type Provider,
  type ProviderModel,
  type Model,
  // Hooks
  useProvidersData,
  useModelsData,
  useConnectedProviderIds,
  useProvidersLoading,
  useProvidersState,
  useFetchProviders,
  useProviders,
  // Utility functions
  findModelById,
  findProviderById,
} from './providers';

export {
  // Atoms
  healthStatusAtom,
  healthCheckingAtom,
  healthEnabledAtom,
  lastHealthCheckAtom,
  healthStateAtom,
  checkHealthAtom,
  setHealthEnabledAtom,
  // Types
  type OpenCodeHealthStatus,
  // Hooks
  useHealthStatus,
  useHealthChecking,
  useHealthState,
  useCheckHealth,
  useSetHealthEnabled,
  useOpenCodeHealth,
} from './opencode-health';

export {
  // Atoms
  commandsAtom,
  commandsLoadingAtom,
  commandsErrorAtom,
  commandExecutingAtom,
  commandsStateAtom,
  fetchCommandsAtom,
  executeCommandAtom,
  // Types
  type Command,
  type CommandArg,
  type ExecuteCommandResult,
  // Hooks
  useCommandsData,
  useCommandsLoading,
  useCommandExecuting,
  useCommandsState,
  useFetchCommands,
  useExecuteCommand,
  useCommands,
  // Utility functions
  findCommandByName,
  filterCommands,
} from './commands';

export {
  // Atoms
  channelPreferencesAtom,
  setChannelPreferenceAtom,
  clearChannelPreferenceAtom,
  clearAllChannelPreferencesAtom,
  channelPreferenceAtom,
  // Types
  type ChannelModelPreference,
  type ChannelPreferencesMap,
  // Hooks
  useChannelPreferences,
  useChannelPreference,
  useSetChannelPreference,
  useClearChannelPreference,
  useChannelPreferencesStore,
} from './channel-preferences';

export {
  sessionGraphStore,
  setSessionGraphNodes,
  useSessionGraphProjects,
  useSessionGraphSelector,
} from './session-graph';
