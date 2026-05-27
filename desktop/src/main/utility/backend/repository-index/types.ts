export type RepositoryIndexStatus = 'idle' | 'indexing' | 'ready' | 'error';

export type RepositoryDependencyKind =
  | 'import'
  | 'export'
  | 'dynamic-import'
  | 'require'
  | 'reference';

export interface RepositoryIndexRecord {
  repositoryRoot: string;
  status: RepositoryIndexStatus;
  fileCount: number;
  edgeCount: number;
  indexedFileCount: number;
  startedAt: string | null;
  completedAt: string | null;
  lastError: string | null;
  indexVersion: number;
  watcherEnabled: boolean;
  updatedAt: string;
}

export interface RepositoryFileRecord {
  repositoryRoot: string;
  path: string;
  language: string;
  size: number;
  mtimeMs: number;
  contentHash: string;
  updatedAt: string;
}

export interface RepositoryDependencyEdge {
  repositoryRoot: string;
  fromPath: string;
  toPath: string | null;
  specifier: string;
  kind: RepositoryDependencyKind;
  isExternal: boolean;
  lineNumber: number;
  lineSnippet: string;
}

export interface ExtractedDependency {
  specifier: string;
  kind: RepositoryDependencyKind;
  lineNumber: number;
  lineSnippet: string;
}

export interface RepositoryIndexSummary {
  status: RepositoryIndexRecord;
  filesIndexed: number;
  edgesIndexed: number;
}

export interface BlastRadiusEntry {
  path: string;
  distance: number;
  viaPath: string | null;
  specifier: string | null;
  lineNumber: number | null;
  lineSnippet: string | null;
}
