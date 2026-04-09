import type { PendingPermission } from '../../types';

type Props = {
  permissions: PendingPermission[];
};

export default function PermissionPrompt({
  permissions,
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
          <p className="text-xs text-[var(--color-text-muted)] italic">
            This permission request must be handled directly in OpenCode.
          </p>
        </div>
      ))}
    </div>
  );
}
