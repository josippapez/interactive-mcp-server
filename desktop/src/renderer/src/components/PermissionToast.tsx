import { useMemo, useState, useCallback } from 'react';
import type { PendingPermission, SessionNode } from '../types';
import AllowFolderModal from './AllowFolderModal';
import { Button } from './ui/button';

type Props = {
  connections: Map<string, SessionNode>;
  onReplyPermission: (
    sessionID: string,
    requestId: string,
    reply: 'once' | 'always' | 'reject',
    directory?: string,
  ) => void;
  onSelectSession: (sessionId: string) => void;
};

/**
 * Check if this is a file read permission that can have folder-based auto-approval.
 */
function isFileReadPermission(permission: string): boolean {
  const lower = permission.toLowerCase();
  return (
    lower.includes('read') ||
    lower.includes('file_read') ||
    lower.startsWith('read ')
  );
}

/**
 * Extract file paths from permission patterns.
 */
function extractFilePaths(patterns: string[] | undefined): string[] {
  if (!patterns) return [];
  // Filter to paths that look like absolute file paths
  return patterns.filter((p) => p.startsWith('/'));
}

/**
 * Global floating toast for permission requests.
 * Shows all pending permissions from all sessions in a fixed position overlay.
 */
export default function PermissionToast({
  connections,
  onReplyPermission,
  onSelectSession,
}: Props): React.ReactElement | null {
  // State for the folder selection modal
  const [folderModalData, setFolderModalData] = useState<{
    sessionID: string;
    requestId: string;
    directory?: string;
    filePath: string;
  } | null>(null);

  // Aggregate all pending permissions from all connections
  const allPermissions = useMemo(() => {
    const result: Array<{
      permission: PendingPermission;
      sessionTitle: string;
      nodeId: string;
    }> = [];

    for (const [nodeId, node] of connections) {
      if (node.pendingPermissions && node.pendingPermissions.length > 0) {
        for (const perm of node.pendingPermissions) {
          result.push({
            permission: perm,
            sessionTitle: node.title ?? node.providerSessionId ?? 'Unknown',
            nodeId,
          });
        }
      }
    }

    return result;
  }, [connections]);

  const handleAlwaysClick = useCallback(
    (perm: PendingPermission) => {
      // Check if this is a file read permission with file paths
      const filePaths = extractFilePaths(perm.patterns);
      if (isFileReadPermission(perm.permission) && filePaths.length > 0) {
        // Show folder selection modal
        setFolderModalData({
          sessionID: perm.sessionID,
          requestId: perm.requestId,
          directory: perm.directory,
          filePath: filePaths[0], // Use first file path for folder detection
        });
      } else {
        // Not a file read permission, just reply with 'always'
        onReplyPermission(
          perm.sessionID,
          perm.requestId,
          'always',
          perm.directory,
        );
      }
    },
    [onReplyPermission],
  );

  const handleFolderSelected = useCallback(
    (folderPath: string) => {
      if (!folderModalData) return;

      // Reply immediately so the current permission is resolved before any
      // settings-driven refreshes can perturb the pending-permissions UI.
      onReplyPermission(
        folderModalData.sessionID,
        folderModalData.requestId,
        'always',
        folderModalData.directory,
      );

      // Persist the folder allow-list in parallel; this should not gate the
      // permission reply path.
      void window.api.addAllowedReadFolder(folderPath);

      // Close the modal
      setFolderModalData(null);
    },
    [folderModalData, onReplyPermission],
  );

  const handleFolderModalCancel = useCallback(() => {
    setFolderModalData(null);
  }, []);

  if (allPermissions.length === 0 && !folderModalData) return null;

  return (
    <>
      <div className="fixed top-12 right-4 z-50 flex flex-col gap-2 max-w-md">
        {allPermissions.map(({ permission: perm, sessionTitle, nodeId }) => (
          <div
            key={perm.requestId}
            className="bg-[var(--color-surface)] border border-[var(--color-warning,#e8a030)] rounded-lg shadow-lg shadow-black/20 overflow-hidden animate-in slide-in-from-right duration-200"
          >
            {/* Header */}
            <div className="flex items-center gap-2 px-3 py-2 bg-[var(--color-warning,#e8a030)]/10 border-b border-[var(--color-warning,#e8a030)]/30">
              <span
                className="text-[var(--color-warning,#e8a030)] text-sm"
                aria-hidden="true"
              >
                ⚠
              </span>
              <span className="text-xs font-semibold text-[var(--color-text)] flex-1">
                Permission Request
              </span>
              <button
                type="button"
                onClick={() => onSelectSession(nodeId)}
                className="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-agent)] underline"
              >
                {sessionTitle.length > 20
                  ? `${sessionTitle.slice(0, 20)}...`
                  : sessionTitle}
              </button>
            </div>

            {/* Content */}
            <div className="px-3 py-2">
              <p className="text-sm text-[var(--color-text-muted)] break-words">
                <span className="font-mono text-[var(--color-agent)] font-medium">
                  {perm.permission}
                </span>
              </p>
              {perm.patterns && perm.patterns.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {perm.patterns.slice(0, 3).map((pattern) => (
                    <span
                      key={pattern}
                      className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-[var(--color-surface-alt)] border border-[var(--color-border)] text-[var(--color-text-muted)] max-w-[200px] truncate"
                      title={pattern}
                    >
                      {pattern}
                    </span>
                  ))}
                  {perm.patterns.length > 3 && (
                    <span className="text-[10px] text-[var(--color-text-muted)]">
                      +{perm.patterns.length - 3} more
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 px-3 py-2 bg-[var(--color-surface-alt)] border-t border-[var(--color-border)]">
              <Button
                size="sm"
                onClick={() => {
                  console.info('[permission-toast] clicked allow once', {
                    sessionID: perm.sessionID,
                    requestId: perm.requestId,
                    directory: perm.directory,
                    permission: perm.permission,
                  });
                  onReplyPermission(
                    perm.sessionID,
                    perm.requestId,
                    'once',
                    perm.directory,
                  );
                }}
              >
                Allow Once
              </Button>
              {perm.always && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleAlwaysClick(perm)}
                >
                  Always
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  console.info('[permission-toast] clicked reject', {
                    sessionID: perm.sessionID,
                    requestId: perm.requestId,
                    directory: perm.directory,
                    permission: perm.permission,
                  });
                  onReplyPermission(
                    perm.sessionID,
                    perm.requestId,
                    'reject',
                    perm.directory,
                  );
                }}
                className="hover:border-[var(--color-error)] hover:text-[var(--color-error)]"
              >
                Reject
              </Button>
            </div>
          </div>
        ))}
      </div>

      {/* Folder selection modal */}
      {folderModalData && (
        <AllowFolderModal
          filePath={folderModalData.filePath}
          onSelectFolder={handleFolderSelected}
          onCancel={handleFolderModalCancel}
        />
      )}
    </>
  );
}
