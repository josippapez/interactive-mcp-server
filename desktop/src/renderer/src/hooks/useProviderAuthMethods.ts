import { useState, useEffect, useCallback } from 'react';
import type { AuthMethod } from '../../../preload/index';

interface UseProviderAuthMethodsResult {
  /** Map of provider ID to available auth methods. */
  authMethods: Record<string, AuthMethod[]>;
  /** Whether we're currently loading. */
  isLoading: boolean;
  /** Error message if loading failed. */
  error: string | null;
  /** Refresh auth methods from API. */
  refresh: () => Promise<void>;
  /** Check if a provider has auth methods available. */
  hasAuthMethods: (providerId: string) => boolean;
}

/**
 * Hook to fetch available auth methods for all providers.
 *
 * @param enabled - Whether to enable fetching (default: true)
 */
export function useProviderAuthMethods(
  enabled = true,
): UseProviderAuthMethodsResult {
  const [authMethods, setAuthMethods] = useState<Record<string, AuthMethod[]>>(
    {},
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setAuthMethods({});
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await window.api.fetchProviderAuthMethods();
      if (result) {
        setAuthMethods(result);
      } else {
        setAuthMethods({});
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to fetch auth methods';
      setError(message);
      window.api.log?.(
        'warn',
        'useProviderAuthMethods',
        `Failed to fetch: ${message}`,
      );
    } finally {
      setIsLoading(false);
    }
  }, [enabled]);

  // Fetch on mount and when enabled changes
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const hasAuthMethods = useCallback(
    (providerId: string): boolean => {
      const methods = authMethods[providerId];
      return methods != null && methods.length > 0;
    },
    [authMethods],
  );

  return {
    authMethods,
    isLoading,
    error,
    refresh,
    hasAuthMethods,
  };
}
