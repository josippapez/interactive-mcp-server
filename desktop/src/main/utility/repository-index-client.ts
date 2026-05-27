import type {
  BlastRadiusEntry,
  RepositoryDependencyEdge,
  RepositoryIndexRecord,
  RepositoryIndexSummary,
} from './backend/repository-index/types';
import { getUtilitySupervisor } from './supervisor';

export interface RepositoryIndexStatusPayload {
  repositoryRoot: string;
  index: RepositoryIndexRecord | null;
  watchedRepositoryRoots: string[];
  unavailableReason?: string;
}

function call<T>(name: string, args: unknown[]): Promise<T> {
  return getUtilitySupervisor()
    .getBridge()
    .request<T>(name, { args }, { timeoutMs: 120_000 });
}

export function fetchRepositoryIndexStatus(
  baseDirectory: string,
): Promise<RepositoryIndexStatusPayload> {
  return call('repositoryIndex.status', [baseDirectory]);
}

export function fetchRepositoryIndexStatusForSession(
  providerSessionId: string,
): Promise<RepositoryIndexStatusPayload> {
  return call('repositoryIndex.statusForSession', [providerSessionId]);
}

export function startRepositoryIndex(
  baseDirectory: string,
  watch: boolean,
): Promise<RepositoryIndexSummary> {
  return call('repositoryIndex.index', [baseDirectory, watch]);
}

export function startRepositoryIndexForSession(
  providerSessionId: string,
  watch: boolean,
): Promise<RepositoryIndexSummary> {
  return call('repositoryIndex.indexForSession', [providerSessionId, watch]);
}

export function stopRepositoryIndexWatcher(
  baseDirectory: string,
): Promise<{ repositoryRoot: string; stopped: boolean }> {
  return call('repositoryIndex.stopWatcher', [baseDirectory]);
}

export function fetchRepositoryFileDependencies(
  baseDirectory: string,
  path: string,
): Promise<{
  repositoryRoot: string;
  path: string;
  dependencies: RepositoryDependencyEdge[];
}> {
  return call('repositoryIndex.dependencies', [baseDirectory, path]);
}

export function fetchRepositoryFileDependents(
  baseDirectory: string,
  path: string,
): Promise<{
  repositoryRoot: string;
  path: string;
  dependents: RepositoryDependencyEdge[];
}> {
  return call('repositoryIndex.dependents', [baseDirectory, path]);
}

export function fetchRepositoryBlastRadius(
  baseDirectory: string,
  paths: string[],
  maxDepth: number,
  limit: number,
): Promise<{
  repositoryRoot: string;
  paths: string[];
  maxDepth: number;
  blastRadius: BlastRadiusEntry[];
}> {
  return call('repositoryIndex.blastRadius', [
    baseDirectory,
    paths,
    maxDepth,
    limit,
  ]);
}
