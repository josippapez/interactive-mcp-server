import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import type { PendingPermission, SessionNode } from '../types';
import PermissionToastCard from '../components/PermissionToastCard';

export type PermissionReply = 'once' | 'always' | 'reject';

export type FolderPromptRequest = {
  sessionID: string;
  requestId: string;
  directory?: string;
  filePath: string;
};

type Options = {
  connections: Map<string, SessionNode>;
  onReplyPermission: (
    sessionID: string,
    requestId: string,
    reply: PermissionReply,
    directory?: string,
  ) => void;
  onSelectSession: (sessionId: string) => void;
  onRequestFolderPrompt: (req: FolderPromptRequest) => void;
};

/**
 * Returns true for permissions whose "Always" reply should open the
 * folder-allow modal (file read prompts only).
 */
function isFileReadPermission(permission: string): boolean {
  const lower = permission.toLowerCase();
  return (
    lower.includes('read') ||
    lower.includes('file_read') ||
    lower.startsWith('read ')
  );
}

function extractFilePaths(patterns: string[] | undefined): string[] {
  if (!patterns) return [];
  return patterns.filter((p) => p.startsWith('/'));
}

/**
 * Sync `connections.pendingPermissions` to persistent sonner toasts.
 *
 * Each pending permission becomes a `toast.custom(...)` keyed by
 * `requestId` with `duration: Infinity` and `dismissible: false`. Toasts
 * are dismissed automatically when their permission is no longer pending.
 *
 * "Always" replies on file-read permissions trigger
 * `onRequestFolderPrompt` instead of replying directly; the caller is
 * responsible for opening `AllowFolderModal` and finalising the reply.
 *
 * Renders nothing — wire `<Toaster />` separately at the app root.
 */
export function usePermissionToasts({
  connections,
  onReplyPermission,
  onSelectSession,
  onRequestFolderPrompt,
}: Options): void {
  // Capture latest callbacks so toast bodies always see fresh closures
  // without re-mounting toasts on every render.
  const handlersRef = useRef({
    onReplyPermission,
    onSelectSession,
    onRequestFolderPrompt,
  });
  handlersRef.current = {
    onReplyPermission,
    onSelectSession,
    onRequestFolderPrompt,
  };

  // Track which requestIds are currently mounted so we can dismiss
  // resolved ones in the next sync pass.
  const shownRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const aggregated: {
      permission: PendingPermission;
      sessionTitle: string;
      nodeId: string;
    }[] = [];

    for (const [nodeId, node] of connections) {
      if (!node.pendingPermissions || node.pendingPermissions.length === 0) {
        continue;
      }
      for (const perm of node.pendingPermissions) {
        aggregated.push({
          permission: perm,
          sessionTitle: node.title ?? node.providerSessionId ?? 'Unknown',
          nodeId,
        });
      }
    }

    const activeIds = new Set(aggregated.map((a) => a.permission.requestId));

    // Dismiss resolved.
    for (const requestId of shownRef.current) {
      if (!activeIds.has(requestId)) {
        toast.dismiss(requestId);
        shownRef.current.delete(requestId);
      }
    }

    // Mount new.
    for (const { permission, sessionTitle, nodeId } of aggregated) {
      if (shownRef.current.has(permission.requestId)) continue;

      const replyAndDismiss = (reply: PermissionReply) => {
        toast.dismiss(permission.requestId);
        shownRef.current.delete(permission.requestId);
        handlersRef.current.onReplyPermission(
          permission.sessionID,
          permission.requestId,
          reply,
          permission.directory,
        );
      };

      const handleAlways = () => {
        const filePaths = extractFilePaths(permission.patterns);
        if (
          isFileReadPermission(permission.permission) &&
          filePaths.length > 0
        ) {
          // Defer the reply to the folder-modal flow; leave toast mounted
          // so cancelling the modal returns the user to the same prompt.
          handlersRef.current.onRequestFolderPrompt({
            sessionID: permission.sessionID,
            requestId: permission.requestId,
            directory: permission.directory,
            filePath: filePaths[0],
          });
        } else {
          replyAndDismiss('always');
        }
      };

      toast.custom(
        () => (
          <PermissionToastCard
            perm={permission}
            sessionTitle={sessionTitle}
            nodeId={nodeId}
            onAllowOnce={() => replyAndDismiss('once')}
            onAlways={handleAlways}
            onReject={() => replyAndDismiss('reject')}
            onGoToSession={(id) => handlersRef.current.onSelectSession(id)}
          />
        ),
        {
          id: permission.requestId,
          duration: Infinity,
          dismissible: false,
          position: 'bottom-right',
        },
      );

      shownRef.current.add(permission.requestId);
    }
  }, [connections]);

  // Dismiss all on unmount.
  useEffect(() => {
    const shown = shownRef.current;
    return () => {
      for (const id of shown) toast.dismiss(id);
      shown.clear();
    };
  }, []);
}

/**
 * Imperatively dismiss a single permission toast (e.g. after the folder
 * modal resolves). Safe to call even if the toast is already gone.
 */
export function dismissPermissionToast(requestId: string): void {
  toast.dismiss(requestId);
}
