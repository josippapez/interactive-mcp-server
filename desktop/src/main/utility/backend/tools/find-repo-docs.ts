import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { z } from 'zod';
import {
  staleSessionError,
  requireProviderSessionId,
} from './connection-guard';
import { resolveProviderSessionId } from '../resolver';
import {
  getRegisteredConnection,
  getRegisteredConnectionBySessionId,
} from '../database';
import {
  discoverDocs,
  searchDocs,
  formatSearchResults,
} from '../../../docs/context-injector';

const MAX_DOC_READ_BYTES = 512 * 1024;

type PackageDependencies = Record<string, string>;

interface PackageJson {
  dependencies?: PackageDependencies;
  devDependencies?: PackageDependencies;
}

function textResult(text: string): CallToolResult {
  return { content: [{ type: 'text' as const, text }] };
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
      'Error: No baseDirectory is available for this auto-registered OpenCode session. Start or select a session with a project directory before using repository docs/libs tools.',
    );
  }

  return connection.baseDirectory;
}

function formatDocPaths(
  baseDirectory: string,
  source: 'all' | 'docs_only' | 'readmes_only',
  limit: number,
  offset: number,
): string {
  let paths = discoverDocs(baseDirectory).map((doc) => doc.relPath);

  if (source === 'docs_only') {
    paths = paths.filter((path) => path.startsWith('docs/'));
  } else if (source === 'readmes_only') {
    paths = paths.filter((path) => path.toLowerCase().endsWith('readme.md'));
  }

  paths.sort((a, b) => a.localeCompare(b));

  const page = paths.slice(offset, offset + limit);
  if (page.length === 0) {
    return `No documentation paths found for source "${source}".`;
  }

  const lines = [`Documentation paths (${source}, ${paths.length} total):`];
  page.forEach((path, index) => {
    lines.push(`${offset + index + 1}. ${path}`);
  });

  const nextOffset = offset + page.length;
  if (nextOffset < paths.length) {
    lines.push(`More available: call list_docs with offset=${nextOffset}.`);
  }

  return lines.join('\n');
}

function readDoc(baseDirectory: string, requestedPath: string): string {
  const doc = discoverDocs(baseDirectory).find(
    (candidate) => candidate.relPath === requestedPath,
  );
  if (!doc) {
    return `Doc not found: ${requestedPath}. Use list_docs or find_docs to discover valid paths.`;
  }

  try {
    if (!existsSync(doc.absPath)) {
      return `Doc not found: ${requestedPath}.`;
    }
    const stats = statSync(doc.absPath);
    if (stats.size > MAX_DOC_READ_BYTES) {
      return `Doc is too large to read (${stats.size} bytes): ${requestedPath}.`;
    }
    return readFileSync(doc.absPath, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Unable to read ${requestedPath}: ${message}`;
  }
}

function tokenize(input: string): string[] {
  return String(input || '')
    .toLowerCase()
    .split(/[^a-z0-9@._/-]+/g)
    .filter(Boolean);
}

function findLibs(baseDirectory: string, query: string, limit: number): string {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return 'Please provide a non-empty query.';
  }

  const packageJsonPath = `${baseDirectory}/package.json`;
  let packageJson: PackageJson;
  try {
    packageJson = JSON.parse(
      readFileSync(packageJsonPath, 'utf8'),
    ) as PackageJson;
  } catch {
    return 'Unable to read package.json.';
  }

  const dependencies = packageJson.dependencies ?? {};
  const devDependencies = packageJson.devDependencies ?? {};
  const all = [
    ...Object.entries(dependencies).map(([name, version]) => ({
      name,
      version,
      kind: 'dependency' as const,
    })),
    ...Object.entries(devDependencies).map(([name, version]) => ({
      name,
      version,
      kind: 'devDependency' as const,
    })),
  ];

  const tokens = tokenize(trimmedQuery);
  if (tokens.length === 0) {
    return 'Please provide a more specific query.';
  }

  const matches: Array<{
    name: string;
    version: string;
    kind: 'dependency' | 'devDependency';
    score: number;
  }> = [];
  for (const pkg of all) {
    const lowerName = pkg.name.toLowerCase();
    let score = 0;
    if (lowerName.includes(trimmedQuery.toLowerCase())) {
      score += 10;
    }
    for (const token of tokens) {
      if (lowerName.includes(token)) {
        score += 4;
      }
    }
    if (score > 0) {
      matches.push({ ...pkg, score });
    }
  }

  if (matches.length === 0) {
    return `No library matches found for "${trimmedQuery}".`;
  }

  matches.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const top = matches.slice(0, limit);
  const lines = [`Top library matches for "${trimmedQuery}":`];
  top.forEach((item, index) => {
    lines.push(
      `${index + 1}. ${item.name}@${item.version} [${item.kind}] (score: ${item.score})`,
    );
  });

  return lines.join('\n');
}

export function registerRepoDocsTools(
  server: McpServer,
  connectionId: string,
  requireSessionId = false,
): void {
  server.registerTool(
    'find_docs',
    {
      description: `Find relevant repository docs by query without loading all docs up front. Uses the auto-registered baseDirectory for this OpenCode session.

This tool is only available when the desktop app knows a baseDirectory for the auto-registered session. If no baseDirectory is available, the tool returns an error.

The search matches on path, content, title, and directory context, and ranks results by combined score.

IMPORTANT: You MUST pass your openCodeSessionId (format: ses_<alphanumeric>) with every call for correct routing.`,
      title: 'Find repository docs',
      inputSchema: {
        query: z
          .string()
          .describe('Search query for repository docs and markdown files.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .default(8)
          .describe('Maximum number of matches to return (1-20, default 8).'),
        openCodeSessionId: z
          .string()
          .optional()
          .describe(
            'Your OpenCode session ID (format: ses_<alphanumeric>). Required for correct routing in multi-agent scenarios.',
          ),
      },
    },
    async ({ query, limit, openCodeSessionId }): Promise<CallToolResult> => {
      const baseDirectory = await resolveBaseDirectory(
        connectionId,
        openCodeSessionId,
        requireSessionId,
      );
      if (typeof baseDirectory !== 'string') return baseDirectory;

      const results = await searchDocs(query, baseDirectory, limit ?? 8);
      const text = formatSearchResults(results, query);

      return textResult(text);
    },
  );

  server.registerTool(
    'find_repo_docs',
    {
      description:
        "Backward-compatible alias for find_docs. Search repository documentation files by query using this session's auto-registered baseDirectory.",
      title: 'Search repository documentation',
      inputSchema: {
        query: z
          .string()
          .describe('Search query for repository docs and markdown files.'),
        limit: z.number().int().min(1).max(20).optional().default(8),
        openCodeSessionId: z.string().optional(),
      },
    },
    async ({ query, limit, openCodeSessionId }): Promise<CallToolResult> => {
      const baseDirectory = await resolveBaseDirectory(
        connectionId,
        openCodeSessionId,
        requireSessionId,
      );
      if (typeof baseDirectory !== 'string') return baseDirectory;

      return textResult(
        formatSearchResults(
          await searchDocs(query, baseDirectory, limit ?? 8),
          query,
        ),
      );
    },
  );

  server.registerTool(
    'list_docs',
    {
      description:
        'List available repository documentation paths so you can browse what exists before searching or reading.',
      title: 'List repository docs',
      inputSchema: {
        source: z
          .enum(['all', 'docs_only', 'readmes_only'])
          .optional()
          .default('all'),
        limit: z.number().int().min(1).max(5000).optional().default(200),
        offset: z.number().int().min(0).optional().default(0),
        openCodeSessionId: z.string().optional(),
      },
    },
    async ({
      source,
      limit,
      offset,
      openCodeSessionId,
    }): Promise<CallToolResult> => {
      const baseDirectory = await resolveBaseDirectory(
        connectionId,
        openCodeSessionId,
        requireSessionId,
      );
      if (typeof baseDirectory !== 'string') return baseDirectory;

      return textResult(
        formatDocPaths(
          baseDirectory,
          source ?? 'all',
          limit ?? 200,
          offset ?? 0,
        ),
      );
    },
  );

  server.registerTool(
    'read_doc',
    {
      description:
        'Read the full content of a repository documentation file by its relative path. Use find_docs first to discover relevant file paths.',
      title: 'Read repository doc',
      inputSchema: {
        path: z
          .string()
          .describe('Relative documentation path from the repository root.'),
        openCodeSessionId: z.string().optional(),
      },
    },
    async ({ path, openCodeSessionId }): Promise<CallToolResult> => {
      const baseDirectory = await resolveBaseDirectory(
        connectionId,
        openCodeSessionId,
        requireSessionId,
      );
      if (typeof baseDirectory !== 'string') return baseDirectory;

      return textResult(readDoc(baseDirectory, path));
    },
  );

  server.registerTool(
    'find_libs',
    {
      description:
        'Find relevant npm libraries from package.json dependencies/devDependencies in the auto-registered repository.',
      title: 'Find repository libraries',
      inputSchema: {
        query: z
          .string()
          .describe('Library search query, for example: tanstack router.'),
        limit: z.number().int().min(1).max(50).optional().default(20),
        openCodeSessionId: z.string().optional(),
      },
    },
    async ({ query, limit, openCodeSessionId }): Promise<CallToolResult> => {
      const baseDirectory = await resolveBaseDirectory(
        connectionId,
        openCodeSessionId,
        requireSessionId,
      );
      if (typeof baseDirectory !== 'string') return baseDirectory;

      return textResult(findLibs(baseDirectory, query, limit ?? 20));
    },
  );
}

export const registerFindRepoDocsTool = registerRepoDocsTools;
