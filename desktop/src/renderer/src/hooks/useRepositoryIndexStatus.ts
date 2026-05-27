import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  RepositoryIndexStatusPayload,
  RepositoryIndexSummary,
} from '../../../preload/api/types';
import { runIpcQuery } from './useIpcQuery';
import { deriveRepositoryIndexViewState } from './repository-index-view-state';
import {
  getRepositoryIndexQueryKey,
  reduceRepositoryIndexQueryResult,
  type RepositoryIndexQueryState,
} from './repository-index-status-state';

export function useRepositoryIndexStatus(
  baseDirectory: string | null,
  providerSessionId?: string | null,
) {
  const enabled = Boolean(baseDirectory || providerSessionId);
  const queryKey = getRepositoryIndexQueryKey({
    baseDirectory,
    providerSessionId,
  });
  const [query, setQuery] = useState<
    RepositoryIndexQueryState & { loading: boolean }
  >({ data: null, error: null, key: null, loading: true });
  const queryStateRef = useRef<RepositoryIndexQueryState>({
    data: null,
    error: null,
    key: null,
  });
  queryStateRef.current = query;
  const fetchIdRef = useRef(0);
  const mountedRef = useRef(true);
  const [refetchTick, setRefetchTick] = useState(0);

  const refetch = useCallback(() => {
    setRefetchTick((tick) => tick + 1);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const myId = ++fetchIdRef.current;
    setQuery((previous) => ({
      data: previous.key === queryKey ? previous.data : null,
      error: null,
      key: queryKey,
      loading: true,
    }));

    const fetcher = () => {
      if (baseDirectory) {
        return window.api.fetchRepositoryIndexStatus(baseDirectory);
      }
      if (providerSessionId) {
        return window.api.fetchRepositoryIndexStatusForSession(
          providerSessionId,
        );
      }
      return Promise.resolve({
        ok: true as const,
        data: {
          repositoryRoot: '',
          index: null,
          watchedRepositoryRoots: [],
        },
      });
    };

    runIpcQuery<RepositoryIndexStatusPayload>(fetcher).then((result) => {
      if (!mountedRef.current || fetchIdRef.current !== myId) return;
      setQuery({
        ...reduceRepositoryIndexQueryResult(
          queryStateRef.current,
          result,
          queryKey,
        ),
        loading: false,
      });
    });
  }, [baseDirectory, providerSessionId, queryKey, refetchTick]);

  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [lastSummary, setLastSummary] = useState<RepositoryIndexSummary | null>(
    null,
  );
  const [isStoppingWatcher, setIsStoppingWatcher] = useState(false);

  useEffect(() => {
    if (!enabled || query.data?.unavailableReason || query.data?.disabled) {
      return;
    }
    const interval = window.setInterval(refetch, 1500);
    return () => window.clearInterval(interval);
  }, [enabled, query.data?.disabled, query.data?.unavailableReason, refetch]);

  const startIndexing = useCallback(async () => {
    if (!baseDirectory && !providerSessionId) return;
    setIsStarting(true);
    setStartError(null);
    let result: Awaited<ReturnType<typeof window.api.startRepositoryIndex>>;
    try {
      result = await window.api.startRepositoryIndex(baseDirectory, {
        watch: true,
        providerSessionId,
      });
    } catch (error) {
      setIsStarting(false);
      setStartError(error instanceof Error ? error.message : String(error));
      return;
    }
    setIsStarting(false);
    if (!result.ok) {
      setStartError(result.error);
      return;
    }
    setLastSummary(result.data);
    refetch();
  }, [baseDirectory, providerSessionId, refetch]);

  const stopWatcher = useCallback(async () => {
    const repositoryRoot = query.data?.repositoryRoot || baseDirectory;
    if (!repositoryRoot) return false;
    setIsStoppingWatcher(true);
    try {
      const result =
        await window.api.stopRepositoryIndexWatcher(repositoryRoot);
      if (!result.ok) {
        setStartError(result.error);
        return false;
      }
      refetch();
      return result.data.stopped;
    } catch (error) {
      setStartError(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setIsStoppingWatcher(false);
    }
  }, [baseDirectory, query.data?.repositoryRoot, refetch]);

  useEffect(() => {
    if (
      !enabled ||
      query.loading ||
      query.error ||
      query.data?.disabled ||
      query.data?.unavailableReason
    )
      return;
    const status = query.data?.index?.status;
    if (status === 'ready' || status === 'indexing') return;
    void startIndexing();
  }, [enabled, query.loading, query.error, query.data, startIndexing]);

  const viewState = deriveRepositoryIndexViewState({
    enabled,
    loading: (query.loading && !query.data) || isStarting,
    error: startError ?? query.error,
    data: query.data,
  });

  return {
    ...query,
    error: startError ?? query.error,
    loading: (query.loading && !query.data) || isStarting,
    startIndexing,
    stopWatcher,
    isStoppingWatcher,
    lastSummary,
    viewState,
  };
}
