/**
 * Fetch VCS (version control) information from the OpenCode server.
 *
 * Uses the OpenCode HTTP API at GET /vcs to get accurate git branch info.
 */

export interface VcsInfo {
  branch: string | null;
  defaultBranch: string | null;
  /** Change stats from session summary (if available) */
  additions?: number;
  deletions?: number;
  files?: number;
}

/**
 * Fetch VCS info from the OpenCode server.
 *
 * @param openCodePort - The port OpenCode server is running on
 * @returns VCS info including branch name, or null on error
 */
export async function fetchVcsInfo(
  openCodePort: number,
): Promise<VcsInfo | null> {
  const url = `http://localhost:${openCodePort}/vcs`;

  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
      headers: { Accept: 'application/json' },
    });

    if (!res.ok) {
      return null;
    }

    const data = (await res.json()) as {
      branch?: string;
      default_branch?: string;
    };

    return {
      branch: typeof data.branch === 'string' ? data.branch : null,
      defaultBranch:
        typeof data.default_branch === 'string' ? data.default_branch : null,
    };
  } catch {
    return null;
  }
}
