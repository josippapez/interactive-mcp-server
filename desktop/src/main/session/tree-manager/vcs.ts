/**
 * VCS (version control) information extraction from OpenCode session data.
 */

import type { SessionInfo, VcsInfo } from './types';

/**
 * Extract VCS (git) information from an OpenCode session.
 * The `version` field often contains a string like "0.0.0-work/feature-branch-123"
 * where the branch name follows the last hyphen-separated segment starting with a path.
 */
export function extractVcsInfo(session: SessionInfo): VcsInfo | null {
  const { version, summary } = session;

  // Extract branch name from version string (e.g., "0.0.0-work/feature-branch" → "work/feature-branch")
  let branch: string | null = null;
  if (version) {
    // Pattern: version often looks like "0.0.0-branchname" or "0.0.0-path/to/branch"
    const match = version.match(/^\d+\.\d+\.\d+-(.+)$/);
    if (match) {
      branch = match[1];
    }
  }

  // If no version or summary data, return null (no VCS info available)
  if (!branch && !summary) {
    return null;
  }

  return {
    branch,
    additions: summary?.additions ?? 0,
    deletions: summary?.deletions ?? 0,
    files: summary?.files ?? 0,
  };
}
