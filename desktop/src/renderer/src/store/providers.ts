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
import { healthStatusAtom } from './opencode-health';

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
  /** True when the model has zero input and output token cost. */
  isFree?: boolean;
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
  /** True when the model has zero input and output token cost. */
  isFree?: boolean;
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

/**
 * Whether we have ever successfully completed a provider fetch that returned
 * a non-empty provider list. Used to distinguish "not yet fetched" from
 * "loaded empty" — the cold-start race can resolve with `[]` while OpenCode
 * is still booting, and we must retry in that case.
 */
export const hasFetchedProvidersSuccessfullyAtom = atom<boolean>(false);

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

/**
 * Module-scoped in-flight fetch promise. When a fetch is active, additional
 * callers (e.g. sidebar + model picker + settings all mounting at once)
 * await the SAME promise rather than each firing their own round-trip.
 * See D2 in docs/STREAMING-REWRITE-PLAN.md.
 */
let inFlightPromise: Promise<void> | null = null;

/** Fetch providers and models from the OpenCode API. */
export const fetchProvidersAtom = atom(null, async (_get, set) => {
  if (inFlightPromise) {
    return inFlightPromise;
  }

  set(providersLoadingAtom, true);
  set(providersErrorAtom, null);

  inFlightPromise = (async () => {
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

        // Only mark the fetch as "successful" when we actually got providers.
        // During cold-start the main-side can resolve a racy empty list;
        // leaving the flag false here lets the mount / health-flip effects
        // retry on the next opportunity.
        if (providersInfo.providers.length > 0) {
          set(hasFetchedProvidersSuccessfullyAtom, true);
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
      window.api.log?.(
        'warn',
        'providers-store',
        `Failed to fetch: ${message}`,
      );
    } finally {
      set(providersLoadingAtom, false);
    }
  })();

  try {
    await inFlightPromise;
  } finally {
    inFlightPromise = null;
  }
});

/**
 * Write an incoming providers-info payload into the relevant atoms. Used by
 * both the mount-fetch path (`fetchProvidersAtom`) and the push-event path
 * (`hydrateProvidersAtom` via `useProvidersBootstrap`) so behaviour is
 * identical regardless of source.
 */
export const hydrateProvidersAtom = atom(
  null,
  (
    _get,
    set,
    providersInfo: {
      providers: Provider[];
      connectedProviderIds: string[];
      defaults: Record<string, string>;
    },
  ) => {
    set(providersAtom, providersInfo.providers);
    set(connectedProviderIdsAtom, new Set(providersInfo.connectedProviderIds));

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
          isFree: model.isFree,
        });
      }
    }
    set(modelsAtom, flattenedModels);

    if (providersInfo.providers.length > 0) {
      set(hasFetchedProvidersSuccessfullyAtom, true);
    }
  },
);

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
 * App-level bootstrap for providers/models.
 *
 * Call ONCE near the root of the component tree (e.g. from `App`). Wires:
 *
 * 1. A push-event listener (`providers-info:updated`) that hydrates the atoms
 *    whenever main emits fresh data — initial cold-start warmup, periodic
 *    background refresh, and post-auth callbacks all flow through here. This
 *    is the primary source and does NOT depend on `useProviders()` being
 *    mounted anywhere.
 *
 * 2. An eager fetch fallback fired once on mount. Covers the window between
 *    renderer boot and the first push event, plus the case where the main
 *    warmup already resolved before the renderer subscribed.
 *
 * The mount-fetch in `useProviders()` remains as a third-tier safety net for
 * surfaces (ProviderAuthSection, NewSessionInput, ChannelComposer) that were
 * hidden during bootstrap and only render later.
 */
export function useProvidersBootstrap(): void {
  const hydrate = useSetAtom(hydrateProvidersAtom);
  const fetchProviders = useSetAtom(fetchProvidersAtom);

  useEffect(() => {
    const unsubscribe = window.api.onProvidersInfoUpdated((info) => {
      hydrate(info);
    });
    // Eager fetch so we don't wait an entire refresh cycle if the main-side
    // warmup already completed before the renderer subscribed.
    void fetchProviders();
    return () => {
      unsubscribe();
    };
  }, [hydrate, fetchProviders]);
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
  const hasFetchedSuccessfully = useAtomValue(
    hasFetchedProvidersSuccessfullyAtom,
  );
  const healthStatus = useAtomValue(healthStatusAtom);

  // Fetch on mount when enabled. Treat an empty provider list as "not yet
  // fetched" — during cold-start the main-side can resolve a racy empty
  // list before OpenCode is fully up, and the D2 in-flight dedup alone is
  // not enough to break out of that state.
  useEffect(() => {
    if (!enabled) return;
    if (hasFetchedSuccessfully) return;
    void fetchProviders();
  }, [enabled, fetchProviders, hasFetchedSuccessfully]);

  // If OpenCode health flips to healthy AFTER the initial mount fetch has
  // already settled with an empty list, trigger one fresh fetch. No event
  // bus exists, so we observe the health atom (already polled at 10s) and
  // react to the edge. `hasFetchedSuccessfully` gates this to avoid refetch
  // storms on repeated healthy/unhealthy flips.
  useEffect(() => {
    if (!enabled) return;
    if (!healthStatus.healthy) return;
    if (hasFetchedSuccessfully) return;
    void fetchProviders();
  }, [enabled, healthStatus.healthy, hasFetchedSuccessfully, fetchProviders]);

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
