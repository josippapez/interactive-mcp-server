import type { RepositoryIndexStatusPayload } from '../../../preload/api/types';
import type { IpcResult } from '../lib/ipc-result';

export type RepositoryIndexQueryState = {
  data: RepositoryIndexStatusPayload | null;
  error: string | null;
  key: string | null;
};

export function reduceRepositoryIndexQueryResult(
  previous: RepositoryIndexQueryState,
  result: IpcResult<RepositoryIndexStatusPayload>,
  key: string | null,
): RepositoryIndexQueryState {
  if (result.ok) {
    return { data: result.data, error: null, key };
  }

  return {
    data: previous.key === key ? previous.data : null,
    error: result.error,
    key,
  };
}

export function getRepositoryIndexQueryKey(args: {
  baseDirectory: string | null;
  providerSessionId?: string | null;
}): string | null {
  if (args.baseDirectory) return `repo:${args.baseDirectory}`;
  if (args.providerSessionId) return `session:${args.providerSessionId}`;
  return null;
}
