/**
 * Global providers and models state using Jotai.
 *
 * This provides a single source of truth for AI providers and models,
 * eliminating redundant API calls when multiple components need provider data.
 *
 * Key benefits:
 * - Single fetch shared across all consumers (sidebar, model picker, settings)
 * - Reactive updates when provider auth status changes
 * - Connected/authenticated providers tracked globally
 */

import { atom, useAtomValue, useSetAtom } from 'jotai';
import { useCallback, useEffect } from 'react';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/** Provider model definition. */
export interface ProviderModel {
  id: string;
  name: string;
  contextWindow?: number;
  inputLimit?: number;
  outputLimit?: number;
  /** Whether this model supports reasoning/thinking capabilities. */
  reasoning?: boolean;
  /** Available effort/variant levels for reasoning models (e.g., 'low', 'medium', 'high'). */
  variants?: string[];
  /** The recommended default variant/effort level for this model. */
  defaultVariant?: string;
}

/** Provider definition. */
export interface Provider {
  id: string;
  name: string;
  models: ProviderModel[];
}

/** Flattened model with provider info. */
export interface Model {
  id: string;
  name: string;
  providerId: string;
  providerName: string;
  contextWindow?: number;
  inputLimit?: number;
  outputLimit?: number;
  /** Whether this model supports reasoning/thinking capabilities. */
  reasoning?: boolean;
  /** Available effort/variant levels for reasoning models (e.g., 'low', 'medium', 'high'). */
  variants?: string[];
  /** The recommended default variant/effort level for this model. */
  defaultVariant?: string;
}

// -----------------------------------------------------------------------------
// Base Atoms
// -----------------------------------------------------------------------------

/** List of all providers. */
export const providersAtom = atom<Provider[]>([]);

/** Flattened list of all models with provider info. */
export const modelsAtom = atom<Model[]>([]);

/** Set of connected/authenticated provider IDs. */
export const connectedProviderIdsAtom = atom<Set<string>>(new Set<string>());

/** Loading state for provider fetch operations. */
export const providersLoadingAtom = atom<boolean>(false);

/** Error state for provider fetch operations. */
export const providersErrorAtom = atom<string | null>(null);

// -----------------------------------------------------------------------------
// Derived Atoms
// -----------------------------------------------------------------------------

/** Combined provider state for components that need everything. */
export const providersStateAtom = atom((get) => ({
  providers: get(providersAtom),
  models: get(modelsAtom),
  connectedProviderIds: get(connectedProviderIdsAtom),
  isLoading: get(providersLoadingAtom),
  error: get(providersErrorAtom),
}));

// -----------------------------------------------------------------------------
// Action Atoms
// -----------------------------------------------------------------------------

/** Fetch providers and models from the OpenCode API. */
export const fetchProvidersAtom = atom(null, async (_get, set) => {
  set(providersLoadingAtom, true);
  set(providersErrorAtom, null);

  try {
    const providersInfo = await window.api.fetchProvidersInfo();

    if (providersInfo) {
      set(providersAtom, providersInfo.providers);
      set(
        connectedProviderIdsAtom,
        new Set(providersInfo.connectedProviderIds),
      );

      // Flatten models with provider info
      const flattenedModels: Model[] = [];
      for (const provider of providersInfo.providers) {
        for (const model of provider.models) {
          flattenedModels.push({
            id: model.id,
            name: model.name,
            providerId: provider.id,
            providerName: provider.name,
            contextWindow: model.contextWindow,
            inputLimit: model.inputLimit,
            outputLimit: model.outputLimit,
            reasoning: model.reasoning,
            variants: model.variants,
            defaultVariant: model.defaultVariant,
          });
        }
      }
      set(modelsAtom, flattenedModels);

      if (process.env.NODE_ENV === 'development') {
        console.log('[providers-store] Providers fetched', {
          providerCount: providersInfo.providers.length,
          modelCount: flattenedModels.length,
          connectedCount: providersInfo.connectedProviderIds.length,
          timestamp: new Date().toISOString(),
        });
      }
    } else {
      set(providersAtom, []);
      set(modelsAtom, []);
      set(connectedProviderIdsAtom, new Set());
    }
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to fetch providers';
    set(providersErrorAtom, message);

    if (process.env.NODE_ENV === 'development') {
      console.warn('[providers-store] Failed to fetch:', err);
    }
  } finally {
    set(providersLoadingAtom, false);
  }
});

// -----------------------------------------------------------------------------
// Hooks
// -----------------------------------------------------------------------------

/** Get providers list (read-only). */
export function useProvidersData(): Provider[] {
  return useAtomValue(providersAtom);
}

/** Get flattened models list (read-only). */
export function useModelsData(): Model[] {
  return useAtomValue(modelsAtom);
}

/** Get connected provider IDs set (read-only). */
export function useConnectedProviderIds(): Set<string> {
  return useAtomValue(connectedProviderIdsAtom);
}

/** Get loading state (read-only). */
export function useProvidersLoading(): boolean {
  return useAtomValue(providersLoadingAtom);
}

/** Get full providers state (read-only). */
export function useProvidersState(): {
  providers: Provider[];
  models: Model[];
  connectedProviderIds: Set<string>;
  isLoading: boolean;
  error: string | null;
} {
  return useAtomValue(providersStateAtom);
}

/** Get the fetch/refresh function (write-only). */
export function useFetchProviders(): () => Promise<void> {
  return useSetAtom(fetchProvidersAtom);
}

/**
 * Backwards-compatible hook matching the old useProviders API.
 *
 * Fetches providers on mount when enabled.
 */
export function useProviders(enabled = true): {
  providers: Provider[];
  models: Model[];
  connectedProviderIds: Set<string>;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  isConnected: (providerId: string) => boolean;
} {
  const state = useProvidersState();
  const fetchProviders = useFetchProviders();

  // Fetch on mount when enabled
  useEffect(() => {
    if (enabled) {
      void fetchProviders();
    }
  }, [enabled, fetchProviders]);

  // Check if a provider is connected
  const isConnected = useCallback(
    (providerId: string) => state.connectedProviderIds.has(providerId),
    [state.connectedProviderIds],
  );

  return {
    ...state,
    refresh: fetchProviders,
    isConnected,
  };
}

// -----------------------------------------------------------------------------
// Utility Functions
// -----------------------------------------------------------------------------

/**
 * Find a model by ID, preferring an exact provider+model match when available.
 */
export function findModelById(
  models: Model[],
  modelId: string,
  providerId?: string | null,
): Model | null {
  if (providerId) {
    const exactMatch = models.find(
      (model) => model.id === modelId && model.providerId === providerId,
    );
    if (exactMatch) {
      return exactMatch;
    }
  }

  return models.find((model) => model.id === modelId) ?? null;
}

/** Find a provider by ID in the providers array. */
export function findProviderById(
  providers: Provider[],
  providerId: string,
): Provider | null {
  return providers.find((p) => p.id === providerId) ?? null;
}
