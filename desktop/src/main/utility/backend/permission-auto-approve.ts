/**
 * permission-auto-approve.ts — pure helpers for permission auto-approve.
 *
 * Preserves the auto-approve logic that lived in the pre-C6 streaming
 * rewrite (`bus-event-forwarders.ts` + `bus-event-utils.ts`). The helpers
 * are intentionally side-effect-free so they can be unit tested without
 * mocking Electron, the OpenCode SDK, or the settings store.
 *
 * Invoked from `event-stream.ts` as an out-of-band short-circuit before
 * `permission.asked` is pushed through the `ConversationEvent` batch
 * pipeline — matching the approach used for `session.created/updated/
 * deleted` in the same file.
 */

/**
 * Matches any permission string that represents a file-read operation.
 * Case-insensitive. Mirrors the pre-rewrite implementation.
 */
export function isFileReadPermission(permission: string): boolean {
  const lower = permission.toLowerCase();
  return (
    lower.includes('read') ||
    lower.includes('file_read') ||
    lower.startsWith('read ')
  );
}

/**
 * Exact-match auto-approve lookup. Compared case-insensitively so users
 * can type `bash` / `Bash` / `BASH` in settings and have all variants
 * match.
 */
export function shouldAutoApprovePermission(
  permission: string,
  allowedPermissions: readonly string[],
): boolean {
  const normalizedPermission = permission.toLowerCase();
  return allowedPermissions.some(
    (item) => item.toLowerCase() === normalizedPermission,
  );
}

/**
 * Folder-scoped auto-approve for file-read permissions. Returns true when
 * ANY pattern falls inside ANY allowed folder. Patterns and folders are
 * compared as absolute path prefixes; a trailing slash is appended to the
 * folder when missing so `/tmp` does not match `/tmp-backup/…`.
 */
export function shouldAutoApproveReadPermission(
  patterns: readonly string[] | undefined,
  allowedFolders: readonly string[],
): boolean {
  if (!patterns || patterns.length === 0 || allowedFolders.length === 0) {
    return false;
  }

  for (const pattern of patterns) {
    if (!pattern.startsWith('/')) continue;

    for (const folder of allowedFolders) {
      const normalizedFolder = folder.endsWith('/') ? folder : `${folder}/`;
      if (pattern.startsWith(normalizedFolder) || pattern === folder) {
        return true;
      }
    }
  }

  return false;
}
