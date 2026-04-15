/**
 * Re-export providers hook and utilities from the Jotai store.
 *
 * This file exists for backwards compatibility. All state management
 * has been migrated to @renderer/store/providers.ts
 */
export {
  // Types
  type Provider,
  type ProviderModel,
  type Model,
  // Main hook (backwards compatible)
  useProviders,
  // Individual hooks for granular subscriptions
  useProvidersData,
  useModelsData,
  useConnectedProviderIds,
  useProvidersLoading,
  useProvidersState,
  useFetchProviders,
  // Utility functions
  findModelById,
  findProviderById,
  // Atoms (for advanced use cases)
  providersAtom,
  modelsAtom,
  connectedProviderIdsAtom,
  providersLoadingAtom,
  providersErrorAtom,
  providersStateAtom,
  fetchProvidersAtom,
} from '../store/providers';
