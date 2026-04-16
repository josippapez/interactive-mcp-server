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

/**
 * Fetch VCS info from the OpenCode server using SDK.
 *
 * @param openCodePort - The port OpenCode server is running on
 * @returns VCS info including branch name, or null on error
 */
export async function fetchVcsInfo(
  openCodePort: number,
): Promise<VcsInfo | null> {
  try {
    const client = getClient(openCodePort);
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
