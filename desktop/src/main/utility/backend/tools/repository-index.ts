import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type {
  BlastRadiusEntry,
  RepositoryDependencyEdge,
  RepositoryIndexRecord,
} from '../repository-index/types';
import {
  getRepositoryBlastRadius,
  getRepositoryDependencies,
  getRepositoryDependents,
  getRepositoryIndex,
  getRegisteredConnection,
  getRegisteredConnectionBySessionId,
} from '../database';
import { normalizeRepositoryRoot } from '../repository-index/path-utils';
import { getWatchedRepositoryRoots } from '../repository-index/watcher';
import { resolveProviderSessionId } from '../resolver';
import {
  requireProviderSessionId,
  staleSessionError,
} from './connection-guard';

function textResult(text: string): CallToolResult {
  return { content: [{ type: 'text' as const, text }] };
}

function formatIndexStatus(
  repositoryRoot: string,
  index: RepositoryIndexRecord | null,
  watchedRepositoryRoots: string[],
): string {
  const watched = watchedRepositoryRoots.includes(repositoryRoot)
    ? 'yes'
    : 'no';
  if (!index)
    return `repo ${repositoryRoot}\nindex missing\nwatcher ${watched}`;
  const lines = [
    `repo ${repositoryRoot}`,
    `status ${index.status}`,
    `files ${index.indexedFileCount}/${index.fileCount}`,
    `edges ${index.edgeCount}`,
    `watcher ${watched}`,
  ];
  if (index.lastError) lines.push(`error ${index.lastError}`);
  return lines.join('\n');
}

function formatDependencyEdges(
  header: string,
  edges: RepositoryDependencyEdge[],
): string {
  if (edges.length === 0) return `${header}\nnone`;
  return [
    header,
    ...edges.map((edge) => {
      const target = edge.toPath ?? edge.specifier;
      const scope = edge.isExternal ? 'external' : 'internal';
      const location = edge.lineNumber ? `\tL${edge.lineNumber}` : '';
      const snippet = edge.lineSnippet ? `\t${edge.lineSnippet}` : '';
      return `${edge.kind}\t${scope}\t${edge.fromPath}\t${target}${location}${snippet}`;
    }),
  ].join('\n');
}

function formatBlastRadius(
  repositoryRoot: string,
  paths: string[],
  maxDepth: number,
  entries: BlastRadiusEntry[],
): string {
  const header = `repo ${repositoryRoot}\nroots ${paths.join(',')}\nmaxDepth ${maxDepth}`;
  if (entries.length === 0) return `${header}\nnone`;
  return [
    header,
    ...entries.map((entry) => {
      const via = entry.viaPath ? `\tvia ${entry.viaPath}` : '';
      const specifier = entry.specifier ? `\t${entry.specifier}` : '';
      const location = entry.lineNumber ? `\tL${entry.lineNumber}` : '';
      const snippet = entry.lineSnippet ? `\t${entry.lineSnippet}` : '';
      return `d${entry.distance}\t${entry.path}${via}${specifier}${location}${snippet}`;
    }),
  ].join('\n');
}

async function resolveBaseDirectory(
  connectionId: string,
  openCodeSessionId: string | undefined,
  requireSessionId: boolean,
): Promise<string | CallToolResult> {
  const providerSessionId = await resolveProviderSessionId(
    connectionId,
    openCodeSessionId,
  );

  const staleError = providerSessionId
    ? staleSessionError(providerSessionId)
    : null;
  if (staleError) return staleError;

  const missingParamErr = requireProviderSessionId(
    providerSessionId,
    requireSessionId,
  );
  if (missingParamErr) return missingParamErr;

  const connection = providerSessionId
    ? await getRegisteredConnectionBySessionId(providerSessionId)
    : await getRegisteredConnection(connectionId);
  if (!connection?.baseDirectory) {
    return textResult(
      'Error: No baseDirectory is available for this session. Start or select a session with a project directory before using repository index tools.',
    );
  }

  return connection.baseDirectory;
}

function disabledResult(): CallToolResult {
  return textResult(
    'Repository indexing is disabled in settings. Enable documentation/context indexing before using repository index tools.',
  );
}

export function registerRepositoryIndexTools(
  server: McpServer,
  connectionId: string,
  getIndexingEnabled: () => boolean,
  requireSessionId = false,
): void {
  server.registerTool(
    'get_repository_index_status',
    {
      description: `Use when you need to know whether the repository dependency graph is ready before asking dependency or impact questions.

Call this before get_file_dependencies, get_file_dependents, or get_blast_radius if you are unsure whether indexing has completed. Indexing is started automatically by the desktop app or manually by the user from the composer badge.

IMPORTANT: You MUST pass your openCodeSessionId (format: ses_<alphanumeric>) with every call for correct routing.`,
      title: 'Get repository index status',
      inputSchema: {
        openCodeSessionId: z.string().optional(),
      },
    },
    async ({ openCodeSessionId }): Promise<CallToolResult> => {
      if (!getIndexingEnabled()) return disabledResult();
      const baseDirectory = await resolveBaseDirectory(
        connectionId,
        openCodeSessionId,
        requireSessionId,
      );
      if (typeof baseDirectory !== 'string') return baseDirectory;

      const repositoryRoot = normalizeRepositoryRoot(baseDirectory);
      return textResult(
        formatIndexStatus(
          repositoryRoot,
          getRepositoryIndex(repositoryRoot),
          getWatchedRepositoryRoots(),
        ),
      );
    },
  );

  server.registerTool(
    'get_file_dependencies',
    {
      description: `Use when you need to know what a specific file imports or requires.

Call this before opening a file's imports one-by-one. Pass a repository-relative file path such as src/main/index.ts.

IMPORTANT: You MUST pass your openCodeSessionId (format: ses_<alphanumeric>) with every call for correct routing.`,
      title: 'Get file dependencies',
      inputSchema: {
        path: z.string().describe('Repository-relative file path.'),
        openCodeSessionId: z.string().optional(),
      },
    },
    async ({ path, openCodeSessionId }): Promise<CallToolResult> => {
      if (!getIndexingEnabled()) return disabledResult();
      const baseDirectory = await resolveBaseDirectory(
        connectionId,
        openCodeSessionId,
        requireSessionId,
      );
      if (typeof baseDirectory !== 'string') return baseDirectory;
      const repositoryRoot = normalizeRepositoryRoot(baseDirectory);
      return textResult(
        formatDependencyEdges(
          `repo ${repositoryRoot}\nfile ${path}\ndependencies`,
          getRepositoryDependencies(repositoryRoot, path),
        ),
      );
    },
  );

  server.registerTool(
    'get_file_dependents',
    {
      description: `Use when you need to answer "where is this file used?" or find direct callers/importers before editing a file.

Call this before broad grep/read sweeps. Pass a repository-relative file path such as src/main/index.ts.

IMPORTANT: You MUST pass your openCodeSessionId (format: ses_<alphanumeric>) with every call for correct routing.`,
      title: 'Get file dependents',
      inputSchema: {
        path: z.string().describe('Repository-relative file path.'),
        openCodeSessionId: z.string().optional(),
      },
    },
    async ({ path, openCodeSessionId }): Promise<CallToolResult> => {
      if (!getIndexingEnabled()) return disabledResult();
      const baseDirectory = await resolveBaseDirectory(
        connectionId,
        openCodeSessionId,
        requireSessionId,
      );
      if (typeof baseDirectory !== 'string') return baseDirectory;
      const repositoryRoot = normalizeRepositoryRoot(baseDirectory);
      return textResult(
        formatDependencyEdges(
          `repo ${repositoryRoot}\nfile ${path}\ndependents`,
          getRepositoryDependents(repositoryRoot, path),
        ),
      );
    },
  );

  server.registerTool(
    'get_blast_radius',
    {
      description: `Use when you need the likely impact set for one or more changed files before editing, testing, or reviewing.

Call this as soon as you know the files you are changing. Results include the starting files at distance 0 and transitive dependents at increasing distance.

IMPORTANT: You MUST pass your openCodeSessionId (format: ses_<alphanumeric>) with every call for correct routing.`,
      title: 'Get repository blast radius',
      inputSchema: {
        paths: z
          .array(z.string())
          .min(1)
          .describe('Repository-relative changed file paths.'),
        maxDepth: z.number().int().min(0).max(10).optional().default(3),
        limit: z.number().int().min(1).max(500).optional().default(100),
        openCodeSessionId: z.string().optional(),
      },
    },
    async ({
      paths,
      maxDepth,
      limit,
      openCodeSessionId,
    }): Promise<CallToolResult> => {
      if (!getIndexingEnabled()) return disabledResult();
      const baseDirectory = await resolveBaseDirectory(
        connectionId,
        openCodeSessionId,
        requireSessionId,
      );
      if (typeof baseDirectory !== 'string') return baseDirectory;
      const repositoryRoot = normalizeRepositoryRoot(baseDirectory);
      const resolvedMaxDepth = maxDepth ?? 3;
      return textResult(
        formatBlastRadius(
          repositoryRoot,
          paths,
          resolvedMaxDepth,
          getRepositoryBlastRadius(
            repositoryRoot,
            paths,
            resolvedMaxDepth,
            limit ?? 100,
          ),
        ),
      );
    },
  );
}
