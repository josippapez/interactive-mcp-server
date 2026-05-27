import type { FileNode, File, Path, Project } from '@opencode-ai/sdk/v2/client';
import { getClient } from './sdk-client';

const SDK_UTILITY_TIMEOUT_MS = 5_000;

export type OpenCodeUtilitySnapshot = {
  path: Path | null;
  project: Project | null;
  toolIds: string[];
  fileStatus: File[];
};

export type OpenCodeFileNode = FileNode;

export type OpenCodeFindFilesOptions = {
  query: string;
  baseDirectory?: string;
  limit?: number;
  type?: 'file' | 'directory';
};

export type OpenCodeListFilesOptions = {
  path: string;
  baseDirectory?: string;
};

function withDirectory(baseDirectory: string | undefined) {
  return baseDirectory ? { directory: baseDirectory } : undefined;
}

export async function fetchOpenCodeUtilitySnapshot(
  openCodePort: number,
  baseDirectory?: string,
): Promise<OpenCodeUtilitySnapshot> {
  const client = getClient(openCodePort, baseDirectory);
  const params = withDirectory(baseDirectory);
  const [pathResponse, projectResponse, toolIdsResponse, fileStatusResponse] =
    await Promise.all([
      client.path.get(params, {
        signal: AbortSignal.timeout(SDK_UTILITY_TIMEOUT_MS),
      }),
      client.project.current(params, {
        signal: AbortSignal.timeout(SDK_UTILITY_TIMEOUT_MS),
      }),
      client.tool.ids(params, {
        signal: AbortSignal.timeout(SDK_UTILITY_TIMEOUT_MS),
      }),
      client.file.status(params, {
        signal: AbortSignal.timeout(SDK_UTILITY_TIMEOUT_MS),
      }),
    ]);

  return {
    path: pathResponse.error ? null : (pathResponse.data ?? null),
    project: projectResponse.error ? null : (projectResponse.data ?? null),
    toolIds: toolIdsResponse.error ? [] : (toolIdsResponse.data ?? []),
    fileStatus: fileStatusResponse.error ? [] : (fileStatusResponse.data ?? []),
  };
}

export async function findOpenCodeFiles(
  openCodePort: number,
  options: OpenCodeFindFilesOptions,
): Promise<string[]> {
  const client = getClient(openCodePort, options.baseDirectory);
  const response = await client.find.files(
    {
      ...(options.baseDirectory ? { directory: options.baseDirectory } : {}),
      query: options.query,
      limit: options.limit ?? 50,
      type: options.type,
    },
    { signal: AbortSignal.timeout(SDK_UTILITY_TIMEOUT_MS) },
  );

  if (response.error) return [];
  return response.data ?? [];
}

export async function listOpenCodeFiles(
  openCodePort: number,
  options: OpenCodeListFilesOptions,
): Promise<FileNode[]> {
  const client = getClient(openCodePort, options.baseDirectory);
  const response = await client.file.list(
    {
      ...(options.baseDirectory ? { directory: options.baseDirectory } : {}),
      path: options.path,
    },
    { signal: AbortSignal.timeout(SDK_UTILITY_TIMEOUT_MS) },
  );

  if (response.error) return [];
  return response.data ?? [];
}
