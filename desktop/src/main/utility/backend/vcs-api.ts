/**
 * Fetch VCS (version control) information from the OpenCode server.
 *
 * Uses the OpenCode SDK's vcs.get() to get accurate git branch info.
 */

import { getClient } from './sdk-client';

export interface VcsInfo {
  branch: string | null;
  defaultBranch: string | null;
  /** Change stats from session summary (if available) */
  additions?: number;
  deletions?: number;
  files?: number;
}

export type VcsDiffMode = 'git' | 'branch';

export interface VcsFileDiff {
  file: string;
  patch?: string;
  additions: number;
  deletions: number;
  status?: 'added' | 'deleted' | 'modified';
}

/**
 * Fetch VCS info from the OpenCode server using SDK.
 *
 * @param openCodePort - The port OpenCode server is running on
 * @param baseDirectory - Optional project directory to scope the VCS query.
 *   When provided, OpenCode runs `git` in that directory (via the
 *   `x-opencode-directory` header). When omitted, OpenCode falls back to its
 *   own `process.cwd()` which is `$HOME` (not a git repo) when spawned by us,
 *   yielding null branch info.
 * @returns VCS info including branch name, or null on error
 */
export async function fetchVcsInfo(
  openCodePort: number,
  baseDirectory?: string,
): Promise<VcsInfo | null> {
  try {
    const client = getClient(openCodePort, baseDirectory);
    const response = await client.vcs.get(
      {},
      { signal: AbortSignal.timeout(3000) },
    );

    if (response.error) return null;

    const data = response.data as
      | {
          branch?: string;
          default_branch?: string;
        }
      | undefined;

    if (!data) return null;

    return {
      branch: typeof data.branch === 'string' ? data.branch : null,
      defaultBranch:
        typeof data.default_branch === 'string' ? data.default_branch : null,
    };
  } catch {
    return null;
  }
}

export async function fetchVcsDiff(
  openCodePort: number,
  mode: VcsDiffMode,
  baseDirectory?: string,
): Promise<VcsFileDiff[]> {
  const client = getClient(openCodePort, baseDirectory);
  const response = await client.vcs.diff(
    { mode },
    { signal: AbortSignal.timeout(10_000) },
  );

  if (response.error) {
    const message =
      typeof response.error === 'object' &&
      response.error !== null &&
      'message' in response.error
        ? String(response.error.message)
        : 'Failed to fetch VCS diff';
    throw new Error(message);
  }

  return Array.isArray(response.data) ? (response.data as VcsFileDiff[]) : [];
}
