import type { RepositoryIndexStatusPayload } from '../../../preload/api/types';

export type RepositoryIndexViewState =
  | 'disabled'
  | 'unavailable'
  | 'loading'
  | 'indexing'
  | 'ready'
  | 'error'
  | 'not-indexed';

export function deriveRepositoryIndexViewState(args: {
  enabled: boolean;
  loading: boolean;
  error: string | null;
  data: RepositoryIndexStatusPayload | null;
}): RepositoryIndexViewState {
  if (!args.enabled) return 'unavailable';
  if (args.data?.disabled) return 'disabled';
  if (args.loading) return 'loading';
  if (args.error) return 'error';
  if (args.data?.unavailableReason) return 'unavailable';
  const status = args.data?.index?.status;
  if (status === 'ready') return 'ready';
  if (status === 'indexing') return 'indexing';
  if (status === 'error') return 'error';
  return 'not-indexed';
}
