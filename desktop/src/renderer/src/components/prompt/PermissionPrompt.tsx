import type { PendingPermission } from '../../types';
import { Button } from '../ui/button';

type Props = {
  permissions: PendingPermission[];
  onReplyPermission: (
    sessionID: string,
    requestId: string,
    reply: 'once' | 'always' | 'reject',
  ) => void;
};

export default function PermissionPrompt({
  permissions,
  onReplyPermission,
}: Props): React.ReactElement | null {
  if (permissions.length === 0) return null;

  return (
    <div className="border-t border-[var(--color-border)] bg-[var(--color-surface-alt)]">
      {permissions.map((perm) => (
        <div
          key={perm.requestId}
          className="px-4 py-3 border-b border-[var(--color-border)] last:border-b-0"
        >
          <div className="flex items-start gap-2 mb-2">
            <span
              className="text-[var(--color-warning, #e8a030)] text-sm mt-0.5"
              aria-hidden="true"
            >
              ⚠
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-[var(--color-text)] mb-0.5">
                Permission request
              </p>
              <p className="text-sm text-[var(--color-text-muted)] break-words">
                <span className="font-mono text-[var(--color-agent)]">
                  {perm.permission}
                </span>
              </p>
              {perm.patterns && perm.patterns.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {perm.patterns.map((pattern) => (
                    <span
                      key={pattern}
                      className="px-1.5 py-0.5 rounded-sm text-[10px] font-mono bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-muted)]"
                    >
                      {pattern}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 mt-3">
            <Button
              size="sm"
              onClick={() =>
                onReplyPermission(perm.sessionID, perm.requestId, 'once')
              }
            >
              Allow Once
            </Button>
            {perm.always && (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  onReplyPermission(perm.sessionID, perm.requestId, 'always')
                }
              >
                Always Allow
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                onReplyPermission(perm.sessionID, perm.requestId, 'reject')
              }
              className="hover:border-[var(--color-error)] hover:text-[var(--color-error)]"
            >
              Reject
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
